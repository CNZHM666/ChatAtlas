import { getDatabase } from "../storage/db";
import type { FocusEvidence } from "../shared/focus-session";

interface Material { id: string; conversationId: string; messageId: string; rawEvidenceIds: string[] }
interface IdentityLedger { version: 1; aliases: Record<string, number>; next: number }

/** Stable message aliases preserve paid cache keys when earlier messages are inserted/deleted. */
export async function stabilizeMaterialIdentity<T extends Material>(materials: T[], evidence: FocusEvidence[], signal: AbortSignal): Promise<{ materials: T[]; evidence: FocusEvidence[] }> {
  if (!globalThis.indexedDB) return { materials, evidence };
  const db = await getDatabase();
  const remap = new Map<string, string>();
  for (const conversationId of new Set(materials.map(item => item.conversationId))) {
    signal.throwIfAborted();
    const id = `focus-material-identity-v1:${encodeURIComponent(conversationId)}`;
    // Serialize allocation across simultaneous project generation requests.
    const tx = db.transaction("semanticDecisionCache", "readwrite");
    const record = await tx.store.get(id);
    const stored = record?.providerId === "focus-material-identity" ? record.result as IdentityLedger : undefined;
    const ledger: IdentityLedger = stored?.version === 1 ? { version: 1, aliases: Object.assign(Object.create(null), stored.aliases), next: stored.next } : { version: 1, aliases: Object.create(null), next: 0 };
    const items = materials.filter(item => item.conversationId === conversationId);
    // First adoption uses the legacy numeric positions; future allocation never recycles them.
    if (!stored) for (const item of items) { const alias = Number(item.id.split(":").at(-2)); ledger.aliases[item.messageId] = alias; ledger.next = Math.max(ledger.next, alias + 1); }
    for (const item of items) {
      if (!Object.hasOwn(ledger.aliases, item.messageId)) ledger.aliases[item.messageId] = ledger.next++;
      remap.set(item.id, `e:${encodeURIComponent(conversationId)}:${ledger.aliases[item.messageId]}:${item.id.split(":").at(-1)}`);
    }
    await tx.store.put({ id, taskType: "synthesis", inputHash: id, analysisVersion: 1, providerId: "focus-material-identity", modelId: "", result: ledger, createdAt: Date.now() });
    await tx.done;
  }
  signal.throwIfAborted();
  return { materials: materials.map(item => ({ ...item, id: remap.get(item.id)!, rawEvidenceIds: item.rawEvidenceIds.map(id => remap.get(id) ?? id) })), evidence: evidence.map(ref => ({ ...ref, id: remap.get(ref.id) ?? ref.id })) };
}
