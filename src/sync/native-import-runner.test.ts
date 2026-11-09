import "fake-indexeddb/auto";
import { beforeEach, expect, it, vi } from "vitest";
import { createNativeImportRunner } from "./native-import-runner";
import { getDatabase } from "../storage/db";
import { getImportJob } from "../storage/import-jobs";
import { getConversation, setConversationHydrationState } from "../storage/conversations";
import { getMessagesForConversation } from "../storage/messages";
import type { NativeImportSource, NativeTransport } from "../shared/native-import";

const source: NativeImportSource = { id: "deepseek", platform: "deepseek", origin: "https://chat.deepseek.com", tabId: 1, label: "DeepSeek" };
const listing = { data: { biz_data: { chat_sessions: [{ id: "a", title: "A", updated_at: 1700000000 }], has_more: false } } };
const body = (content: string) => ({ data: { biz_data: { chat_messages: [{ message_id: "m1", role: "USER", content }] } } });
const idle = async (runner: ReturnType<typeof createNativeImportRunner>) => { await vi.waitFor(() => expect(runner.isRunning()).toBe(false)); };
beforeEach(async () => { const db = await getDatabase(); await Promise.all(["conversations", "messages", "importJobs", "sourceVersions"].map(name => db.clear(name as "conversations"))); });
it("persists inventory, syncs selected bodies, and detects old-conversation edits incrementally", async () => {
  let revised = false;
  const transport = vi.fn<NativeTransport>().mockImplementation(async (_s, req) => ({ account: "account-a", data: req.path.includes("fetch_page") ? revised ? { data: { biz_data: { chat_sessions: [{ id: "a", title: "A", updated_at: 1700000100 }], has_more: false } } } : listing : body(revised ? "Edited question" : "Original question") }));
  const runner = createNativeImportRunner(transport, async () => {});
  await runner.start([source]); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "inventory_ready", discovered: 1, inventoryComplete: true });
  await runner.select(["deepseek:a"]); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "completed", completed: 1 });
  expect(await getConversation("deepseek:a")).toMatchObject({ historyCoverage: "complete", sourceAccount: "account-a" });
  const first = await getMessagesForConversation("deepseek:a");
  revised = true; await runner.start([source]); await idle(runner);
  expect((await getImportJob())?.pendingIds).toEqual(["deepseek:a"]);
  await runner.select(["deepseek:a"]); await idle(runner);
  const updated = await getMessagesForConversation("deepseek:a");
  expect(updated).toHaveLength(1); expect(updated[0].id).toBe(first[0].id); expect(updated[0].content).toBe("Edited question");
});
it("retains successful sources when another platform fails discovery", async () => {
  const runner = createNativeImportRunner(async s => { if (s.platform === "kimi") throw Error("401 sign in"); return { account: "account-a", data: listing }; }, async () => {});
  await runner.start([source, { ...source, id: "kimi", platform: "kimi" }]); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "partial", discovered: 1, inventoryComplete: false });
  expect(await getConversation("deepseek:a")).toBeDefined();
});
it("keeps old text on body failure and retries only the failed item", async () => {
  let fail = false;
  const runner = createNativeImportRunner(async (_s, req) => {
    if (req.path.includes("fetch_page")) return { account: "account-a", data: listing };
    if (fail) throw Error("response format changed");
    return { account: "account-a", data: body("Keep this") };
  }, async () => {});
  await runner.start([source]); await idle(runner); await runner.select(["deepseek:a"]); await idle(runner);
  await setConversationHydrationState("deepseek:a", "queued");
  fail = true; await runner.select(["deepseek:a"]); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "completed_with_warnings", failedIds: ["deepseek:a"] });
  expect((await getImportJob())?.lastError).toContain("1 条对话同步失败 · DeepSeek「A」");
  expect((await getMessagesForConversation("deepseek:a"))[0].content).toBe("Keep this");
  fail = false; await runner.resume(); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "completed", failedIds: [] });
});
it("does not call a repeated cursor a completed account inventory", async () => {
  const runner = createNativeImportRunner(async () => ({ account: "account-a", data: { data: { biz_data: { ...listing.data.biz_data, has_more: true } } } }), async () => {});
  await runner.start([source]); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "partial", inventoryComplete: false });
});
it("pauses before committing an in-flight response and can resume its checkpoint", async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let delayed = true;
  const runner = createNativeImportRunner(async () => { if (delayed) await gate; return { account: "account-a", data: listing }; }, async () => {});
  await runner.start([source]);
  const pause = runner.pause();
  await Promise.resolve(); release(); await pause;
  expect(await getImportJob()).toMatchObject({ status: "paused", discovered: 0 });
  delayed = false; await runner.resume(); await idle(runner);
  expect(await getImportJob()).toMatchObject({ status: "inventory_ready", discovered: 1 });
});
it("reuses complete bodies when their source version has not changed", async () => {
  const transport = vi.fn<NativeTransport>(async (_s, req) => ({ account: "account-a", data: req.path.includes("fetch_page") ? listing : body("Body") }));
  const runner = createNativeImportRunner(transport, async () => {});
  await runner.start([source]); await idle(runner); await runner.select(["deepseek:a"]); await idle(runner);
  transport.mockClear();
  await runner.select(["deepseek:a"]); await idle(runner);
  expect(transport).not.toHaveBeenCalled();
  expect((await getImportJob())?.status).toBe("completed");
});
it("syncs multiple sources concurrently with a hard global and per-source bound", async () => {
  let running = 0, peak = 0, release!: () => void;
  const perSource = new Map<string, number>(), peaks = new Map<string, number>();
  const gate = new Promise<void>(resolve => { release = resolve; });
  const transport: NativeTransport = async (s, request) => {
    if (request.path.includes("fetch_page")) return { account: "account-a", data: { data: { biz_data: { chat_sessions: Array.from({ length: 3 }, (_, i) => ({ id: `${s.id}-${i}`, title: `${s.id}-${i}`, updated_at: 1700000000 })), has_more: false } } } };
    running++; peak = Math.max(peak, running);
    perSource.set(s.id, (perSource.get(s.id) ?? 0) + 1); peaks.set(s.id, Math.max(peaks.get(s.id) ?? 0, perSource.get(s.id)!));
    if (running === 4) release();
    await gate;
    perSource.set(s.id, perSource.get(s.id)! - 1); running--;
    return { account: "account-a", data: body("Body") };
  };
  const runner = createNativeImportRunner(transport, async () => {});
  await runner.start([{ ...source, id: "A" }, { ...source, id: "B" }]); await idle(runner);
  const ids = (await getImportJob())!.discoveredIds!;
  await runner.select(ids); await idle(runner);
  expect(peak).toBe(4); expect([...peaks.values()]).toEqual([2, 2]);
  expect(await getImportJob()).toMatchObject({ status: "completed", completed: 6, pendingIds: [] });
});
it("moves an already queued priority click ahead of background work without duplicating active requests", async () => {
  const requested: string[] = [], releases = new Map<string, () => void>();
  let releaseAll = false;
  const runner = createNativeImportRunner(async (_s, request) => {
    if (request.path.includes("fetch_page")) return { account: "account-a", data: { data: { biz_data: { chat_sessions: Array.from({ length: 6 }, (_, i) => ({ id: `p${i}`, title: `P${i}`, updated_at: 1700000000 })), has_more: false } } } };
    const id = new URL(request.path, source.origin).searchParams.get("chat_session_id")!;
    requested.push(id);
    if (!releaseAll) await new Promise<void>(resolve => { releases.set(id, resolve); });
    return { account: "account-a", data: body(id) };
  }, async () => {});
  await runner.start([source]); await idle(runner);
  await runner.select((await getImportJob())!.discoveredIds!);
  try {
    await vi.waitFor(() => expect(requested).toEqual(["p0", "p1"]));
    const promoted = await runner.select(["deepseek:p5", "deepseek:p0"]);
    expect(promoted.pendingIds[0]).toBe("deepseek:p5");
    expect(promoted.priorityPendingIds).toContain("deepseek:p5");
    releases.get("p0")!();
    await vi.waitFor(() => expect(requested[2]).toBe("p5"));
    expect(requested.filter(id => id === "p0")).toHaveLength(1);
  } finally {
    releaseAll = true; releases.forEach(release => release()); await idle(runner);
  }
  expect(await getImportJob()).toMatchObject({ status: "completed", completed: 6, pendingIds: [], priorityPendingIds: [] });
});
it("wakes free slots for a newly selected source while another source's requests are still pending", async () => {
  const requested: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const runner = createNativeImportRunner(async (s, request) => {
    if (request.path.includes("fetch_page")) return { account: "account-a", data: { data: { biz_data: { chat_sessions: Array.from({ length: 2 }, (_, i) => ({ id: `${s.id}${i}`, title: `${s.id}${i}`, updated_at: 1700000000 })), has_more: false } } } };
    requested.push(new URL(request.path, source.origin).searchParams.get("chat_session_id")!);
    await gate;
    return { account: "account-a", data: body("Body") };
  }, async () => {});
  await runner.start([{ ...source, id: "A" }, { ...source, id: "B" }]); await idle(runner);
  await runner.select(["deepseek:A0", "deepseek:A1"]);
  try {
    await vi.waitFor(() => expect(requested).toEqual(["A0", "A1"]));
    await runner.select(["deepseek:B1"]);
    await vi.waitFor(() => expect(requested).toEqual(["A0", "A1", "B1"]));
  } finally { release(); await idle(runner); }
  expect(await getImportJob()).toMatchObject({ status: "completed", completed: 3 });
});
it("reads an already synced, unchanged conversation again only when asked to sync it again", async () => {
  let text = "First read";
  const runner = createNativeImportRunner(async (_s, req) => ({ account: "account-a", data: req.path.includes("fetch_page") ? listing : body(text) }), async () => {});
  await runner.start([source]); await idle(runner); await runner.select(["deepseek:a"]); await idle(runner);
  text = "Read again";
  await runner.select(["deepseek:a"]); await idle(runner);
  expect((await getMessagesForConversation("deepseek:a"))[0].content).toBe("First read");
  await runner.select(["deepseek:a"], [], true); await idle(runner);
  expect((await getMessagesForConversation("deepseek:a"))[0].content).toBe("Read again");
});
