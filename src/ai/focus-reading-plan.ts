import { getDatabase } from "../storage/db";
import { sourceMessageSignature } from "../shared/source-signature";
import { MAX_FOCUS_PASSAGES } from "../shared/atlas/policy.js";

interface Material { id: string; conversationId: string }
interface Plan { version: 1; batches: string[][] }

/** Partition hints only. Every model result still requires its exact input cache key. */
export async function stableReadingBatches<T extends Material>(materials: T[], options: {
  namespace?: string; signal: AbortSignal;
  partial?: boolean;
  fits: (batch: T[]) => boolean;
  partition: (items: T[], legacy?: boolean) => Promise<T[][]>;
  cached?: (batch: T[]) => Promise<boolean>;
}): Promise<T[][]> {
  const batches: T[][] = [];
  const groups = new Map<string, T[]>();
  for (const item of materials) { const group = groups.get(item.conversationId) ?? []; group.push(item); groups.set(item.conversationId, group); }
  const db = options.namespace && globalThis.indexedDB ? await getDatabase().catch(() => undefined) : undefined;
  for (const [sourceId, items] of groups) {
    options.signal.throwIfAborted();
    const identity = JSON.stringify([options.namespace, sourceId]);
    const digest = globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity)))].map(byte => byte.toString(16).padStart(2, "0")).join("") : `${sourceMessageSignature(identity)}:${identity}`;
    const id = `focus-reading-plan-v1:${digest}`;
    const record = await db?.get("semanticDecisionCache", id).catch(() => undefined);
    const plan = record?.providerId === "focus-reading-planner" ? record.result as Partial<Plan> | undefined : undefined;
    const positions = new Map(items.map((item, index) => [item.id, index]));
    const anchors: Array<{ start: number; batch: T[] }> = [];
    if (plan?.version === 1 && Array.isArray(plan.batches) && plan.batches.length <= 10000) {
      let end = 0;
      const planned = plan.batches.filter(ids => Array.isArray(ids) && ids.length && ids.every(key => typeof key === "string")).sort((a, b) => (positions.get(a[0]) ?? Infinity) - (positions.get(b[0]) ?? Infinity));
      for (const ids of planned) {
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_FOCUS_PASSAGES || ids.some(key => typeof key !== "string")) continue;
        const start = positions.get(ids[0]);
        if (start === undefined || start < end || !ids.every((key, offset) => items[start + offset]?.id === key)) continue;
        const batch = items.slice(start, start + ids.length);
        if (options.fits(batch)) { anchors.push({ start, batch }); end = start + batch.length; }
      }
    } else if (options.cached) {
      // Adopt successful pre-upgrade boundaries without flushing paid analysis.
      for (const batch of await options.partition(items, true)) {
        options.signal.throwIfAborted();
        if (options.fits(batch) && await options.cached(batch)) anchors.push({ start: positions.get(batch[0].id)!, batch });
      }
    }
    const selected: T[][] = [];
    let cursor = 0;
    for (const anchor of anchors) {
      if (anchor.start > cursor) selected.push(...await options.partition(items.slice(cursor, anchor.start)));
      selected.push(anchor.batch); cursor = anchor.start + anchor.batch.length;
    }
    if (cursor < items.length) selected.push(...await options.partition(items.slice(cursor)));
    options.signal.throwIfAborted();
    const retained = options.partial && plan?.version === 1 && Array.isArray(plan.batches) ? plan.batches.filter(ids => Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_FOCUS_PASSAGES && ids.every(key => typeof key === "string" && !positions.has(key))) : [];
    await db?.put("semanticDecisionCache", { id, taskType: "synthesis", inputHash: id, analysisVersion: 1, providerId: "focus-reading-planner", modelId: options.namespace ?? "", result: { version: 1, batches: [...selected.map(batch => batch.map(item => item.id)), ...retained] } satisfies Plan, createdAt: Date.now() }).catch(() => undefined);
    batches.push(...selected);
  }
  return batches;
}
