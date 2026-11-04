import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationCapture } from "../shared/types";
import { getDatabase } from "../storage/db";
import { listConversations, saveDiscoveredConversations } from "../storage/conversations";
import { saveImportJob } from "../storage/import-jobs";
import { saveConversationCapture } from "../storage/messages";
import { ChatGPTSyncError } from "./chatgpt-sync-adapter";
import { historyImportStatus, isHistoryImportRunning, pauseHistoryImport, raiseHistoryPriority, setImportConnectionState, startHistoryImport, waitForHistoryImportIdle, type HistoryAdapter } from "./import-runner";

const conversation: Conversation = { id: "history-1", platform: "chatgpt", title: "One", url: "https://chatgpt.com/c/history-1", updatedAt: 1000, sourceUpdatedAt: 1000, messageCount: 0 };

describe("history import states", () => {
  it("resumes a title cursor after connection checks rather than restarting the imported pages", async () => {
    const old = { ...conversation, id: "checkpoint-title" };
    await saveDiscoveredConversations([old]);
    const job = await historyImportStatus();
    Object.assign(job, { status: "discovering", retryScope: "titles", scope: "active", offset: 50, discovered: 1, discoveredIds: [old.id], pendingIds: [old.id] });
    await saveImportJob(job);
    await setImportConnectionState("checking_session", "connecting", { stage: "session", success: true });
    const list = vi.fn(async () => ({ conversations: [], hasMore: false }));
    await startHistoryImport({ isAvailable: async () => true, list, getConversation: vi.fn() }, "titles", [], { resumeTitles: true });
    await waitForHistoryImportIdle();
    expect(list.mock.calls[0]).toEqual([50, 50, false]);
    expect((await historyImportStatus()).discoveredIds).toContain(old.id);
  });
  it("resumes a paused title scan at its saved offset without fetching bodies", async () => {
    const old = { ...conversation, id: "scanned" }, next = { ...conversation, id: "next-page" };
    await saveDiscoveredConversations([old]);
    const job = await historyImportStatus();
    Object.assign(job, { status: "paused", retryScope: "titles", phase: "discovering", scope: "active", offset: 50, discoveredIds: [old.id], discovered: 1, pendingIds: [old.id] });
    await saveImportJob(job);
    const list = vi.fn(async (_offset: number, _limit: number, archived: boolean) => ({ conversations: archived ? [] : [next], hasMore: false }));
    const detail = vi.fn();
    await startHistoryImport({ isAvailable: async () => true, list, getConversation: detail }, "titles");
    await waitForHistoryImportIdle();
    expect(list.mock.calls[0][0]).toBe(50);
    expect((await historyImportStatus()).discoveredIds).toEqual(expect.arrayContaining([old.id, next.id]));
    expect(detail).not.toHaveBeenCalled();
  });
  beforeEach(async () => {
    vi.stubGlobal("chrome", { runtime: { sendMessage: vi.fn().mockResolvedValue(undefined) } });
    await (await getDatabase()).clear("importJobs");
    await (await getDatabase()).clear("conversations");
  });

  it("scans titles first and fetches only the conversation the user selects", async () => {
    const first = { ...conversation, id: "select-a", title: "First", url: "https://chatgpt.com/c/select-a" };
    const second = { ...conversation, id: "select-b", title: "Second", url: "https://chatgpt.com/c/select-b" };
    const list = vi.fn(async (_offset: number, _limit: number, archived: boolean) => ({ conversations: archived ? [] : [first, second], hasMore: false }));
    const getConversation = vi.fn(async (id: string) => ({ conversation: id === first.id ? first : second, messages: [], capturedAt: 1000 }));
    const adapter: HistoryAdapter = { isAvailable: async () => true, list, getConversation };
    await startHistoryImport(adapter, "titles");
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("inventory_ready"));
    await waitForHistoryImportIdle();
    expect((await listConversations()).map((item) => item.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    expect(getConversation).not.toHaveBeenCalled();
    await startHistoryImport(adapter, "selected", [first.id]);
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "inventory_ready", hydrated: 1, diagnostic: { success: true } }));
    expect(getConversation).toHaveBeenCalledOnce();
    expect(getConversation).toHaveBeenCalledWith(first.id);
    expect((await listConversations()).find((item) => item.id === second.id)?.importState).toBe("discovered");
  });

  it("does not call a zero-conversation history import complete", async () => {
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: async () => ({ conversations: [], hasMore: false }), getConversation: async () => { throw new Error("Not expected"); } };
    await startHistoryImport(adapter);
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("unavailable"));
    expect((await historyImportStatus()).discovered).toBe(0);
  });

  it("marks failed detail fetches as partial, not complete", async () => {
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : [conversation], hasMore: false }), getConversation: async () => { throw new ChatGPTSyncError("Detail unavailable"); } };
    await startHistoryImport(adapter);
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("partial"));
    expect(await historyImportStatus()).toMatchObject({ discovered: 1, completed: 0, failed: 1 });
    expect((await historyImportStatus()).failureReasons?.[conversation.id]).toBe("Detail unavailable");
    await startHistoryImport({ ...adapter, getConversation: async () => ({ conversation, messages: [], capturedAt: 1000 }) });
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
    expect((await historyImportStatus()).failureReasons?.[conversation.id]).toBeUndefined();
  });

  it("retries only failed IDs without rediscovering or refetching completed conversations", async () => {
    const completed = { ...conversation, id: "retry-complete" };
    const failed = { ...conversation, id: "retry-failed" };
    const first: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : [completed, failed], hasMore: false }),
      getConversation: async (id) => {
        if (id === failed.id) throw new ChatGPTSyncError("Temporary failure", false, "network");
        return { conversation: completed, messages: [], capturedAt: 1000 };
      },
    };
    await startHistoryImport(first);
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "completed_with_warnings", failedIds: [failed.id] }));
    await setImportConnectionState("finding_chatgpt_tab", "connecting", { stage: "tab", success: true }, true);
    const list = vi.fn();
    const getConversation = vi.fn(async () => ({ conversation: failed, messages: [], capturedAt: 1000 }));
    await startHistoryImport({ isAvailable: async () => true, list, getConversation }, "failed");
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "completed", failed: 0 }));
    expect(list).not.toHaveBeenCalled();
    expect(getConversation).toHaveBeenCalledOnce();
    expect(getConversation).toHaveBeenCalledWith(failed.id);
    expect((await historyImportStatus()).retryScope).toBe("failed");
    expect((await historyImportStatus()).persistedIds).toEqual(expect.arrayContaining([completed.id, failed.id]));
  });

  it("makes discovered metadata available before detail sync and leaves the curated canvas untouched", async () => {
    let finishDetail!: (capture: ConversationCapture) => void;
    const detail = new Promise<ConversationCapture>((resolve) => { finishDetail = resolve; });
    const adapter: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : [conversation], hasMore: false }),
      getConversation: () => detail,
    };
    await startHistoryImport(adapter);
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "syncing", discovered: 1, hydrated: 0 }));
    expect((await listConversations()).some((item) => item.id === conversation.id)).toBe(true);
    expect(await (await getDatabase()).count("cards")).toBe(0);
    finishDetail({ conversation, messages: [{ id: "history-message", conversationId: conversation.id, messageIndex: 0, role: "user", content: "Why?", preview: "Why?", contentHash: "hash", createdAt: 1000, updatedAt: 1000 }], capturedAt: 1000 });
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
  });

  it("uses bounded concurrency and retains every discovered row", async () => {
    const inventory = Array.from({ length: 7 }, (_, index) => ({ ...conversation, id: `history-${index}`, url: `https://chatgpt.com/c/history-${index}` }));
    let active = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const adapter: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : inventory, hasMore: false }),
      getConversation: async (id) => {
        active += 1; peak = Math.max(peak, active);
        await new Promise<void>((resolve) => release.push(resolve));
        active -= 1;
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: 1000 };
      },
    };
    await startHistoryImport(adapter);
    await vi.waitFor(() => expect(release).toHaveLength(3));
    expect(peak).toBe(3);
    expect((await listConversations()).filter((item) => item.id.startsWith("history-")).length).toBe(7);
    release.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(release).toHaveLength(3));
    release.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(() => expect(release).toHaveLength(1));
    release.splice(0).forEach((resolve) => resolve());
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
  });

  it("hydrates the first page while later inventory pages are still loading", async () => {
    let finishSecondPage!: () => void;
    const secondPage = new Promise<void>((resolve) => { finishSecondPage = resolve; });
    const detail = vi.fn(async () => ({ conversation, messages: [], capturedAt: Date.now() }));
    await startHistoryImport({
      isAvailable: async () => true,
      list: async (offset, _limit, archived) => {
        if (archived) return { conversations: [], hasMore: false };
        if (offset === 0) return { conversations: [conversation], hasMore: true };
        await secondPage;
        return { conversations: [], hasMore: false };
      },
      getConversation: detail,
    });
    await vi.waitFor(() => expect(detail).toHaveBeenCalledWith(conversation.id));
    expect((await historyImportStatus()).inventoryComplete).toBe(false);
    finishSecondPage();
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
  });

  it("fills a free detail slot before slower requests in the same group finish", async () => {
    const inventory = Array.from({ length: 5 }, (_, index) => ({ ...conversation, id: `rolling-${index}` }));
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    await startHistoryImport({
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : inventory, hasMore: false }),
      getConversation: async (id) => {
        started.push(id);
        await new Promise<void>((resolve) => { releases.set(id, resolve); });
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: Date.now() };
      },
    });
    await vi.waitFor(() => expect(started).toHaveLength(3));
    releases.get(started[0])!();
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(releases.has(started[3])).toBe(true);
    releases.get(started[1])!();
    await vi.waitFor(() => expect(started).toHaveLength(5));
    for (const release of releases.values()) release();
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
  });

  it("moves newly selected sources ahead of a running batch without waiting or refetching in-flight bodies", async () => {
    const inventory = Array.from({ length: 8 }, (_, index) => ({ ...conversation, id: `priority-${index}` }));
    await saveDiscoveredConversations(inventory);
    const releases = new Map<string, () => void>();
    const started: string[] = [];
    const adapter: HistoryAdapter = {
      isAvailable: async () => true,
      list: vi.fn(),
      getConversation: async (id) => {
        started.push(id);
        await new Promise<void>((resolve) => { releases.set(id, resolve); });
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: Date.now() };
      },
    };
    await startHistoryImport(adapter, "selected", inventory.slice(0, 7).map((item) => item.id));
    await vi.waitFor(() => expect(started).toHaveLength(3));
    const chosen = [inventory[7].id, inventory[6].id];
    await startHistoryImport(adapter, "selected", [...chosen, started[1]]);
    expect(isHistoryImportRunning()).toBe(true);
    expect((await listConversations()).find((item) => item.id === started[1])?.hydrationState).toBe("syncing");
    await vi.waitFor(() => expect(started).toHaveLength(4));
    expect(started[3]).toBe(chosen[0]);
    // No background request has completed: the click uses the reserved slot immediately.
    expect((await historyImportStatus()).activeIds).toContain(chosen[0]);
    releases.get(chosen[0])!();
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(started[4]).toBe(chosen[1]);
    for (const release of releases.values()) release();
    await vi.waitFor(() => expect(started).toHaveLength(8));
    for (const release of releases.values()) release();
    await waitForHistoryImportIdle();
    expect(new Set(started).size).toBe(8);
    expect(adapter.list).not.toHaveBeenCalled();
    expect((await listConversations()).every((item) => item.importState === "complete")).toBe(true);
  });

  it("reduces detail concurrency after ChatGPT rate limiting and saves the eventual success", async () => {
    const inventory = Array.from({ length: 9 }, (_, index) => ({ ...conversation, id: `limited-${index}`, url: `https://chatgpt.com/c/limited-${index}` }));
    const attempts = new Map<string, number>();
    let active = 0;
    let laterPeak = 0;
    const adapter: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : inventory, hasMore: false }),
      getConversation: async (id) => {
        const count = (attempts.get(id) ?? 0) + 1;
        attempts.set(id, count);
        if (id === inventory[0].id && count === 1) throw new ChatGPTSyncError("ChatGPT rate-limited the import (429).", true);
        active += 1;
        if (id.endsWith("-4") || id.endsWith("-5") || id.endsWith("-6") || id.endsWith("-7") || id.endsWith("-8")) laterPeak = Math.max(laterPeak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: 1000 };
      },
    };
    await startHistoryImport(adapter);
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"), { timeout: 8000 });
    expect(laterPeak).toBeLessThanOrEqual(3);
    expect((await historyImportStatus()).failed).toBe(0);
  });

  it("resumes immediately after pause without losing pending selections or refetching active requests", async () => {
    const inventory = Array.from({ length: 5 }, (_, index) => ({ ...conversation, id: `pause-${index}` }));
    await saveDiscoveredConversations(inventory);
    const releases = new Map<string, () => void>(), started: string[] = [];
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: vi.fn(), getConversation: async id => {
      started.push(id); await new Promise<void>(resolve => releases.set(id, resolve));
      return { conversation: inventory.find(item => item.id === id)!, messages: [], capturedAt: Date.now() };
    } };
    await startHistoryImport(adapter, "selected", inventory.map(item => item.id));
    await vi.waitFor(() => expect(started).toHaveLength(3));
    const paused = await pauseHistoryImport();
    expect(paused.status).toBe("paused");
    const resumed = startHistoryImport(adapter, "selected", [inventory[4].id]);
    expect(started).toHaveLength(3);
    for (const release of releases.values()) release();
    await resumed;
    await vi.waitFor(() => expect(started).toHaveLength(5));
    expect(started[3]).toBe(inventory[4].id);
    for (const release of releases.values()) release();
    await waitForHistoryImportIdle();
    expect(new Set(started).size).toBe(5);
    expect(await historyImportStatus()).toMatchObject({ status: "inventory_ready", pendingIds: [], failed: 0 });
    expect(adapter.list).not.toHaveBeenCalled();
  });

  it("does not report success when a newly prioritized conversation fails outside the original selection", async () => {
    const first = { ...conversation, id: "scope-first" }, second = { ...conversation, id: "scope-new" };
    await saveDiscoveredConversations([first, second]);
    let release!: () => void;
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: vi.fn(), getConversation: async id => {
      if (id === second.id) throw new ChatGPTSyncError("Not accessible", false, "permission");
      await new Promise<void>(resolve => { release = resolve; });
      return { conversation: first, messages: [], capturedAt: Date.now() };
    } };
    await startHistoryImport(adapter, "selected", [first.id]);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await startHistoryImport(adapter, "selected", [second.id]);
    await vi.waitFor(async () => expect((await historyImportStatus()).failedIds).toContain(second.id));
    release(); await waitForHistoryImportIdle();
    expect(await historyImportStatus()).toMatchObject({ status: "partial", discoveredIds: [first.id, second.id], failedIds: [second.id], completed: 1 });
  });

  it("stops an automatic backoff on pause, retains the body in the checkpoint, and explicitly resumes it", async () => {
    await saveDiscoveredConversations([conversation]);
    const detail = vi.fn().mockRejectedValueOnce(new ChatGPTSyncError("Rate limited", true, "rate_limit", 429, 60000)).mockResolvedValue({ conversation, messages: [], capturedAt: Date.now() });
    const adapter: HistoryAdapter = { isAvailable: async () => true, list: vi.fn(), getConversation: detail };
    await startHistoryImport(adapter, "selected", [conversation.id]);
    await vi.waitFor(async () => expect((await historyImportStatus()).retryingIds).toEqual([conversation.id]));
    await pauseHistoryImport(); await waitForHistoryImportIdle();
    expect(detail).toHaveBeenCalledOnce();
    expect(await historyImportStatus()).toMatchObject({ status: "paused", pendingIds: [conversation.id], failed: 0, activeIds: [], retryingIds: [] });
    await startHistoryImport(adapter, "selected", [conversation.id]); await waitForHistoryImportIdle();
    expect(detail).toHaveBeenCalledTimes(2);
    expect(await historyImportStatus()).toMatchObject({ status: "inventory_ready", completed: 1, failed: 0 });
  });

  it("reports a missing web session without treating an empty inventory as success", async () => {
    const list = vi.fn();
    await startHistoryImport({ isAvailable: async () => false, list, getConversation: async () => { throw new Error("Not expected"); } });
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("auth_required"));
    expect(list).not.toHaveBeenCalled();
  });

  it("reconciles 127 discovered rows with 124 durable bodies and three isolated rate limits", async () => {
    const inventory = Array.from({ length: 127 }, (_, index) => ({ ...conversation, id: `batch-${index}`, messageCount: null, importState: "discovered" as const }));
    const adapter: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : inventory, hasMore: false }),
      getConversation: async (id) => {
        if (["batch-124", "batch-125", "batch-126"].includes(id)) throw new ChatGPTSyncError("Rate limited", false, "rate_limit");
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: Date.now() };
      },
    };
    await startHistoryImport(adapter);
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "completed_with_warnings", discovered: 127, hydrated: 124, failed: 3 }), { timeout: 15_000 });
    expect((await listConversations()).find((item) => item.id === "batch-126")).toMatchObject({ messageCount: null, hydrationState: "rate_limited" });
    const broadcasts = (chrome.runtime.sendMessage as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([message]) => message as { type: string; job?: { status: string } }).filter((message) => message.type === "ATLAS_IMPORT_PROGRESS");
    expect(broadcasts.length).toBeLessThan(50);
    expect(broadcasts.at(-1)?.job?.status).toBe("completed_with_warnings");
  }, 20_000);

  it("skips unchanged conversations on incremental sync and hydrates only new or updated IDs", async () => {
    const old = { ...conversation, id: "incremental-old", sourceUpdatedAt: 1000 };
    const changed = { ...conversation, id: "incremental-changed", sourceUpdatedAt: 1000 };
    const first: HistoryAdapter = {
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : [old, changed], hasMore: false }),
      getConversation: async (id) => ({ conversation: id === old.id ? old : changed, messages: [], capturedAt: Date.now() }),
    };
    await startHistoryImport(first);
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
    await vi.waitFor(() => expect(isHistoryImportRunning()).toBe(false));
    const noChanges = vi.fn(first.getConversation);
    await startHistoryImport({ ...first, getConversation: noChanges }, "incremental");
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
    await vi.waitFor(() => expect(isHistoryImportRunning()).toBe(false));
    expect(noChanges).not.toHaveBeenCalled();
    const newest = { ...conversation, id: "incremental-new", sourceUpdatedAt: 2000 };
    const updated = { ...changed, sourceUpdatedAt: 2000 };
    const fetch = vi.fn(async (id: string) => ({ conversation: id === newest.id ? newest : updated, messages: [], capturedAt: Date.now() }));
    await startHistoryImport({ isAvailable: async () => true, list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : [old, updated, newest], hasMore: false }), getConversation: fetch }, "incremental");
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
    expect(fetch.mock.calls.map(([id]) => id).sort()).toEqual(["incremental-changed", "incremental-new"]);
  }, 15_000);

  it("moves a clicked metadata-only conversation to the next hydration batch", async () => {
    const inventory = Array.from({ length: 6 }, (_, index) => ({ ...conversation, id: `priority-${index}`, messageCount: null }));
    const requested: string[] = [];
    const release: Array<() => void> = [];
    await startHistoryImport({
      isAvailable: async () => true,
      list: async (_offset, _limit, archived) => ({ conversations: archived ? [] : inventory, hasMore: false }),
      getConversation: async (id) => {
        requested.push(id);
        if (requested.length <= 4) await new Promise<void>((resolve) => release.push(resolve));
        return { conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: Date.now() };
      },
    });
    await vi.waitFor(() => expect(release).toHaveLength(3));
    await raiseHistoryPriority("priority-5");
    await vi.waitFor(() => expect(requested).toHaveLength(4));
    expect(requested[3]).toBe("priority-5");
    release.forEach((resolve) => resolve());
    await vi.waitFor(async () => expect((await historyImportStatus()).status).toBe("completed"));
    expect(requested[3]).toBe("priority-5");
  }, 10_000);

  it("resumes a 77/127 checkpoint without rediscovering or refetching the 77 durable bodies", async () => {
    const inventory = Array.from({ length: 127 }, (_, index) => ({ ...conversation, id: `resume-${index}`, messageCount: null }));
    await saveDiscoveredConversations(inventory);
    for (const item of inventory.slice(0, 77)) await saveConversationCapture({ conversation: item, messages: [], capturedAt: Date.now() });
    const job = await historyImportStatus();
    job.status = "paused"; job.phase = "syncing"; job.inventoryComplete = true; job.scope = "archived";
    job.discovered = 127; job.discoveredIds = inventory.map((item) => item.id);
    job.hydrated = 77; job.completed = 77; job.persistedIds = inventory.slice(0, 77).map((item) => item.id);
    job.pendingIds = inventory.slice(77).map((item) => item.id);
    await saveImportJob(job);
    const list = vi.fn();
    const detail = vi.fn(async (id: string) => ({ conversation: inventory.find((item) => item.id === id)!, messages: [], capturedAt: Date.now() }));
    await startHistoryImport({ isAvailable: async () => true, list, getConversation: detail });
    await vi.waitFor(async () => expect(await historyImportStatus()).toMatchObject({ status: "completed", discovered: 127, hydrated: 127 }), { timeout: 15_000 });
    expect(list).not.toHaveBeenCalled();
    expect(detail).toHaveBeenCalledTimes(50);
  }, 20_000);
});
