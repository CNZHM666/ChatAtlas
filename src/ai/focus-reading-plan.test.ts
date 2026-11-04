import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import { stableReadingBatches } from "./focus-reading-plan";
beforeEach(async () => { await (await getDatabase()).clear("semanticDecisionCache"); });
const items = (count: number) => Array.from({ length: count }, (_, i) => ({ id: `m${i}`, conversationId: "source", text: `Text ${i}` }));
const options = (size: number, namespace = "model:en:balanced") => ({ namespace, signal: new AbortController().signal, fits: () => true, partition: vi.fn(async (list: ReturnType<typeof items>) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size))) });
it("keeps completed batch boundaries when new messages arrive or planning sizes change", async () => {
  const first = await stableReadingBatches(items(5), options(3));
  const next = options(4);
  const second = await stableReadingBatches(items(7), next);
  expect(second.slice(0, 2)).toEqual(first); expect(second[2].map(item => item.id)).toEqual(["m5", "m6"]);
  expect(next.partition).toHaveBeenCalledWith(items(7).slice(5));
  const changed = items(7); changed[1].text = "Later correction";
  expect((await stableReadingBatches(changed, options(2)))[0][1].text).toBe("Later correction");
  expect((await stableReadingBatches(items(7), options(4, "different-model:zh:balanced")))[0]).toHaveLength(4);
});
it("adopts only cached legacy batches and replans deleted or oversized groups without skipping text", async () => {
  const partition = vi.fn(async (list: ReturnType<typeof items>, legacy?: boolean) => Array.from({ length: Math.ceil(list.length / (legacy ? 2 : 4)) }, (_, i) => list.slice(i * (legacy ? 2 : 4), (i + 1) * (legacy ? 2 : 4))));
  const first = await stableReadingBatches(items(6), { ...options(4), partition, cached: async batch => batch[0].id === "m0" });
  expect(first.map(batch => batch.map(item => item.id))).toEqual([["m0", "m1"], ["m2", "m3", "m4", "m5"]]);
  const remaining = items(6).filter(item => item.id !== "m1");
  const next = await stableReadingBatches(remaining, { ...options(2), fits: batch => batch.length <= 2 });
  expect(next.flat()).toEqual(remaining); expect(next.every(batch => batch.length <= 2)).toBe(true);
});
it("does not persist a cancelled plan", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(stableReadingBatches(items(6), { ...options(2), signal: controller.signal })).rejects.toBeDefined();
  expect(await (await getDatabase()).count("semanticDecisionCache")).toBe(0);
});
it("keeps disjoint full-source boundaries through partial updates and restores chronological planning", async () => {
  const first = await stableReadingBatches(items(9), options(3));
  expect(first.map(batch => batch.map(item => item.id))).toEqual([["m0", "m1", "m2"], ["m3", "m4", "m5"], ["m6", "m7", "m8"]]);
  const partial = await stableReadingBatches(items(9).slice(6), { ...options(2), partial: true });
  expect(partial.flat().map(item => item.id)).toEqual(["m6", "m7", "m8"]);
  const complete = await stableReadingBatches(items(10), options(5));
  expect(complete.slice(0, 3)).toEqual(first); expect(complete[3].map(item => item.id)).toEqual(["m9"]);
});
