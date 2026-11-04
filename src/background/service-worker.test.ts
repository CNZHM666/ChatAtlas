import { beforeEach, afterEach, expect, it, vi } from "vitest";
vi.mock("../content/multi-ai-content.ts?script&iife",()=>({default:"multi-ai-content.js"}));
const runner = vi.hoisted(() => ({ historyImportStatus: vi.fn(), isHistoryImportRunning: vi.fn(), startHistoryImport: vi.fn(), setImportConnectionState: vi.fn(), raiseHistoryPriorities: vi.fn(), pauseHistoryImport: vi.fn(), waitForHistoryImportIdle: vi.fn() }));
vi.mock("../sync/import-runner", () => ({ ...runner, markHistoryUnavailable: vi.fn() }));
let alarm: (event: { name: string }) => void, installed: () => void, startup: () => void;
let message: (value: { type: string; reload?: boolean; conversationIds?: string[] }, sender: unknown, reply: (value: unknown) => void) => unknown;
const query = vi.fn(), create = vi.fn(), clear = vi.fn();
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  runner.historyImportStatus.mockResolvedValue({ status: "inventory_ready", retryScope: "titles" });
  runner.isHistoryImportRunning.mockReturnValue(false);
  vi.stubGlobal("chrome", {
    action: { onClicked: { addListener: vi.fn() } },
    runtime: { onInstalled: { addListener: (fn: typeof installed) => { installed = fn; } }, onStartup: { addListener: (fn: typeof startup) => { startup = fn; } }, onMessage: { addListener: (fn: typeof message) => { message = fn; } } },
    alarms: { create, clear, onAlarm: { addListener: (fn: typeof alarm) => { alarm = fn; } } },
    tabs: { query, onUpdated: { addListener: vi.fn() } },
    storage: { session: { get: vi.fn().mockResolvedValue({}), set: vi.fn(), remove: vi.fn() } },
  });
  await import("./service-worker");
});
afterEach(() => { vi.unstubAllGlobals(); });

it("sends an error response if reading import status rejects",async()=>{
  runner.historyImportStatus.mockRejectedValueOnce(Error("storage unavailable"));
  const reply=vi.fn();expect(message({type:"ATLAS_IMPORT_STATUS"},{},reply)).toBe(true);
  await vi.waitFor(()=>expect(reply).toHaveBeenCalledExactlyOnceWith({ok:false,error:"storage unavailable"}));
});

it("repairs page entries on installation and startup without restarting title imports", async () => {
  query.mockResolvedValue([]);installed(); startup();
  expect(clear).toHaveBeenCalledWith("atlas-incremental-sync");
  expect(create).not.toHaveBeenCalledWith("atlas-incremental-sync", expect.anything());
  await vi.waitFor(() => expect(runner.historyImportStatus).toHaveBeenCalled());
  expect(query).toHaveBeenCalledTimes(2);
  expect(query).toHaveBeenCalledWith({url:"https://chatgpt.com/*"});
  expect(runner.startHistoryImport).not.toHaveBeenCalled();
});
it("ignores an old 30-minute alarm and a late connection retry once title import completed", async () => {
  alarm({ name: "atlas-incremental-sync" });
  alarm({ name: "atlas-import-connect-retry" });
  await vi.waitFor(() => expect(runner.historyImportStatus).toHaveBeenCalled());
  expect(query).not.toHaveBeenCalled();
  expect(runner.startHistoryImport).not.toHaveBeenCalled();
});
it("does not restart an in-progress title scanner from the resume alarm", async () => {
  runner.historyImportStatus.mockResolvedValue({ status: "discovering", retryScope: "titles" });
  runner.isHistoryImportRunning.mockReturnValue(true);
  alarm({ name: "atlas-import-resume" });
  await vi.waitFor(() => expect(runner.historyImportStatus).toHaveBeenCalledTimes(2));
  expect(query).not.toHaveBeenCalled();
  expect(runner.startHistoryImport).not.toHaveBeenCalled();
});
it("still reconnects when the user explicitly retries a failed import without a pending intent", async () => {
  runner.historyImportStatus.mockResolvedValue({ status: "unavailable", retryScope: "titles" });
  runner.setImportConnectionState.mockResolvedValue({ status: "connecting", retryScope: "titles" });
  query.mockResolvedValue([]);
  const reply = vi.fn();
  message({ type: "ATLAS_IMPORT_RETRY" }, {}, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalled());
  expect(query).toHaveBeenCalledWith({ url: "https://chatgpt.com/*" });
});
it("raises the complete selection in one batch while syncing, without reconnecting or reversing its order", async () => {
  const job = { status: "syncing", phase: "syncing", retryScope: "selected", pendingIds: ["first"] };
  runner.historyImportStatus.mockResolvedValue(job); runner.isHistoryImportRunning.mockReturnValue(true);
  const reply = vi.fn(); message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["second", "third"] }, {}, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(job));
  expect(runner.raiseHistoryPriorities).toHaveBeenCalledOnce();
  expect(runner.raiseHistoryPriorities).toHaveBeenCalledWith(["second", "third"]);
  expect(query).not.toHaveBeenCalled(); expect(runner.waitForHistoryImportIdle).not.toHaveBeenCalled();
});
it("returns a priority command error without replacing or marking the active import unavailable", async () => {
  runner.historyImportStatus.mockResolvedValue({ status: "syncing", phase: "syncing", retryScope: "selected" });
  runner.isHistoryImportRunning.mockReturnValue(true);
  runner.raiseHistoryPriorities.mockRejectedValueOnce(new Error("Sign in again"));
  const reply = vi.fn(); message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["blocked"] }, {}, reply);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith({ ok: false, error: "Sign in again" }));
  expect(runner.setImportConnectionState).not.toHaveBeenCalled(); expect(query).not.toHaveBeenCalled();
});
it("keeps a second selection made during connection and verifies the session only once", async () => {
  let job = { status: "inventory_ready", phase: "syncing", retryScope: "selected", pendingIds: [] as string[] };
  let running = false, release!: (value: unknown) => void;
  runner.historyImportStatus.mockImplementation(async () => job);
  runner.isHistoryImportRunning.mockImplementation(() => running);
  runner.setImportConnectionState.mockImplementation(async (_step, status) => job = { ...job, status });
  runner.startHistoryImport.mockImplementation(async (adapter, mode, ids) => {
    expect(await adapter.isAvailable()).toBe(true);
    running = true; return job = { ...job, status: "syncing", retryScope: mode, pendingIds: ids };
  });
  runner.raiseHistoryPriorities.mockImplementation(async ids => job = { ...job, pendingIds: [...job.pendingIds, ...ids] });
  query.mockResolvedValue([{ id: 7, status: "complete", url: "https://chatgpt.com/" }]);
  const tabMessages = vi.fn(async (_id, command) => command.type === "ATLAS_PING" ? { ready: true } : new Promise(resolve => { release = resolve; }));
  Object.assign(chrome.tabs, { sendMessage: tabMessages });
  const first = vi.fn(), second = vi.fn();
  message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["first"] }, {}, first);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["second"] }, {}, second);
  release({ ok: true, value: true });
  await vi.waitFor(() => expect(second).toHaveBeenCalled());
  expect(first).toHaveBeenCalled(); expect(runner.startHistoryImport).toHaveBeenCalledOnce();
  expect(runner.raiseHistoryPriorities).toHaveBeenCalledWith(["second"]);
  expect(job.pendingIds).toEqual(["first", "second"]);
  expect(tabMessages.mock.calls.filter(([, command]) => command.type === "ATLAS_SYNC_SESSION")).toHaveLength(1);
});
it("honors pause while connecting instead of starting a sync after the tab lookup completes", async () => {
  let release!: (tabs: unknown[]) => void;
  query.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const paused = { status: "paused", pendingIds: ["first"] };
  runner.pauseHistoryImport.mockResolvedValue(paused);
  const reply = vi.fn(), second = vi.fn(), pauseReply = vi.fn();
  message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["first"] }, {}, reply);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  message({ type: "ATLAS_IMPORT_SELECT", conversationIds: ["second"] }, {}, second);
  message({ type: "ATLAS_IMPORT_PAUSE" }, {}, pauseReply);
  runner.historyImportStatus.mockResolvedValue(paused);
  await vi.waitFor(() => expect(pauseReply).toHaveBeenCalledWith(paused));
  release([{ id: 7, status: "complete" }]);
  await vi.waitFor(() => expect(reply).toHaveBeenCalledWith(paused));
  await vi.waitFor(() => expect(second).toHaveBeenCalledWith(paused));
  expect(runner.startHistoryImport).not.toHaveBeenCalled();
});
