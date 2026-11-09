import type { Conversation, ImportJob } from "../shared/types";
import type { NativeImportSource, NativeTransport } from "../shared/native-import";
import { NativeHistoryAdapter } from "./native-history-adapter";
import { getImportJob, saveImportJob } from "../storage/import-jobs";
import { getConversation, saveConversation, saveDiscoveredConversations, setConversationHydrationState } from "../storage/conversations";
import { saveConversationCapture } from "../storage/messages";
import { isCurrentHydrationComplete } from "./import-state";

class NativeImportPaused extends Error {}
const active = (job: ImportJob) => ["discovering", "syncing", "connecting", "reconciling"].includes(job.status);

/** One durable queue across selected platforms. Up to four conversations run
 * concurrently, capped at two per source; each transcript keeps sequential pagination. */
export function createNativeImportRunner(transport: NativeTransport, broadcast: (job: ImportJob) => Promise<void>) {
  let flight: Promise<void> | undefined, paused = false, current: ImportJob | undefined;
  let commands: Promise<unknown> = Promise.resolve();
  let publications: Promise<void> = Promise.resolve();
  let wakeScheduler: (() => void) | undefined, queueRevision = 0;
  const sourceLimits = new Map<string, number>();
  const serialize = <T>(work: () => Promise<T>) => { const next = commands.catch(() => undefined).then(work); commands = next; return next; };
  const check = () => { if (paused) throw new NativeImportPaused(); };
  const publish = async (job: ImportJob) => {
    job.updatedAt = Date.now();
    job.failed = job.failedIds.length;
    job.hydrated = job.persistedIds.length; job.completed = job.hydrated;
    const pending = new Set(job.pendingIds), activeIds = new Set(job.activeIds);
    job.priorityPendingIds = (job.priorityIds ?? []).filter(id => pending.has(id) && !activeIds.has(id));
    job.checkpoint = { sessionId: job.sessionId, discoveredIds: [...job.discoveredIds ?? []], persistedIds: [...job.persistedIds], failedIds: [...job.failedIds], pendingIds: [...job.pendingIds], lastCursor: JSON.stringify(job.native?.sources.map(source => [source.id, source.cursor, source.done])), startedAt: job.startedAt, updatedAt: job.updatedAt };
    const snapshot = structuredClone(job);
    publications = publications.catch(() => undefined).then(async () => { await saveImportJob(snapshot); await broadcast(snapshot); });
    await publications;
  };
  const prioritize = (job: ImportJob, ids: string[]) => {
    const selected = new Set(ids);
    job.pendingIds = [...selected, ...job.pendingIds.filter(id => !selected.has(id))];
    job.priorityIds = [...selected, ...(job.priorityIds ?? []).filter(id => !selected.has(id))];
    job.failedIds = job.failedIds.filter(id => !selected.has(id));
    for (const id of selected) if (job.failureReasons) delete job.failureReasons[id];
    queueRevision++;
  };
  const adapter = (source: NativeImportSource) => new NativeHistoryAdapter(source, async (target, request) => {
    for (let attempt = 0; ; attempt++) {
      check();
      try { return await transport(target, request); }
      catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        if (/429|50[0234]|network|fetch|timeout/iu.test(detail)) sourceLimits.set(target.id, 1);
        if (attempt >= 2 || !/429|50[0234]|network|fetch|timeout/iu.test(detail)) throw error;
        // Cancellable short waits; no busy loop or unbounded rate-limit retries.
        for (let step = 0; step < (attempt + 1) * 10; step++) { check(); await new Promise(resolve => setTimeout(resolve, 300)); }
      }
    }
  }, check);
  const process = async (job: ImportJob) => {
    const inFlight = new Map<string, Promise<void>>();
    try {
      if (!job.native) throw Error("Missing native import checkpoint");
      for (const source of job.native.sources) {
        if (source.done) continue;
        job.status = "discovering"; job.phase = "discovering";
        delete source.error;
        await publish(job);
        const reader = adapter(source), cursors = new Set<string>();
        try {
          for (let pageNumber = 0; !source.done; pageNumber++) {
            check();
            const cursor = source.cursor ?? "";
            if (pageNumber >= 10000 || cursors.has(cursor)) throw Error("历史分页重复或超过单次预算，未完成全量读取 / History pagination stalled");
            cursors.add(cursor);
            const page = await reader.list(cursor);
            check();
            if (page.next === cursor || page.next && !page.conversations.length) throw Error("历史分页没有推进 / History pagination did not advance");
            const known = new Set(job.discoveredIds);
            if (page.next && page.conversations.length && page.conversations.every(item => known.has(item.id))) throw Error("历史列表返回重复页，未视为完整 / Repeated history page");
            const previous = await saveDiscoveredConversations(page.conversations);
            for (const item of page.conversations) {
              const old = previous.get(item.id);
              if (old?.sourceAccount && old.sourceAccount !== source.account) throw Error("已保存来源属于另一账号 / Saved source belongs to another account");
              known.add(item.id);
              // Missing provider dates require a body check; sync time is never a source revision.
              const needsUpdate = !old || !isCurrentHydrationComplete(old) || old.historyCoverage !== "complete" || !item.sourceUpdatedAt || !old.hydratedSourceUpdatedAt || item.sourceUpdatedAt > old.hydratedSourceUpdatedAt;
              if (needsUpdate) {
                if (!job.pendingIds.includes(item.id)) job.pendingIds.push(item.id);
                await setConversationHydrationState(item.id, "queued");
              } else if (!job.persistedIds.includes(item.id)) job.persistedIds.push(item.id);
            }
            job.discoveredIds = [...known]; job.discovered = known.size; job.persisted = known.size;
            source.cursor = page.next; source.done = page.next === undefined;
            await publish(job);
          }
        } catch (error) {
          if (error instanceof NativeImportPaused) throw error;
          source.error = error instanceof Error ? error.message : "History discovery failed";
          job.lastError = `${source.label}: ${source.error}`;
          await publish(job);
        }
      }
      job.native.inventoryComplete = job.native.sources.every(source => source.done && !source.error);
      job.inventoryComplete = job.native.inventoryComplete;
      if (job.retryScope === "titles") {
        job.status = job.inventoryComplete ? "inventory_ready" : "partial";
        return;
      }
      job.phase = "syncing"; job.status = "syncing";
      const metadata = new Map((await Promise.all(job.pendingIds.map(getConversation))).filter((item): item is Conversation => Boolean(item)).map(item => [item.id, item]));
      const syncOne = async (id: string) => {
        const conversation = metadata.get(id) ?? await getConversation(id);
        let keepPending = false;
        await setConversationHydrationState(id, "syncing");
        try {
          if (!conversation) throw Error("来源记录缺失 / Source record missing");
          const source = job.native!.sources.find(item => item.id === conversation.nativeHistorySourceId);
          if (!source) throw Error("未找到对应的 AI 来源，请重新导入标题 / Rescan the source AI");
          const reader = adapter(source);
          // Bind/revalidate the login before comparing the saved account receipt.
          const capture = await reader.detail(conversation);
          check();
          const latest = await getConversation(id);
          if (latest?.rawRevision !== conversation.rawRevision) throw Error("读取期间原始对话已更新，请重试 / Source changed during import");
          await saveConversationCapture(capture, { warmIndex: false });
          if (!job.persistedIds.includes(id)) job.persistedIds.push(id);
          job.failedIds = job.failedIds.filter(item => item !== id);
          if (job.failureReasons) delete job.failureReasons[id];
          job.syncedMessages = (job.syncedMessages ?? 0) + capture.messages.length;
        } catch (error) {
          if (error instanceof NativeImportPaused) {
            keepPending = true; await setConversationHydrationState(id, "queued");
          } else {
            const message = error instanceof Error ? error.message : "Conversation import failed";
            if (!job.failedIds.includes(id)) job.failedIds.push(id);
            const sourceLabel = job.native!.sources.find(source => source.id === conversation?.nativeHistorySourceId)?.label ?? conversation?.platform ?? "AI";
            const detail = `${sourceLabel}「${conversation?.title.slice(0, 100) || id}」：${message}`;
            (job.failureReasons ??= {})[id] = detail;
            job.lastError = `${job.failedIds.length} 条对话同步失败 · ${detail}`;
            await setConversationHydrationState(id, "failed");
          }
        }
        if (!keepPending) job.pendingIds = job.pendingIds.filter(item => item !== id);
        await publish(job);
      };
      let fatal: unknown;
      job.currentConcurrency = 4;
      while (job.pendingIds.length || inFlight.size) {
        if (paused) break;
        const changed = new Promise<void>(resolve => { wakeScheduler = resolve; });
        const revision = queueRevision;
        const candidates = job.pendingIds.filter(id => !inFlight.has(id));
        await Promise.all(candidates.filter(id => !metadata.has(id)).map(async id => { const item = await getConversation(id); if (item) metadata.set(id, item); }));
        // A priority click during metadata loading must win over the old ordering.
        if (revision !== queueRevision) continue;
        if (paused) break;
        for (const id of candidates) {
          if (inFlight.size >= 4) break;
          const sourceId = metadata.get(id)?.nativeHistorySourceId ?? "unknown";
          const busy = [...inFlight.keys()].filter(id => (metadata.get(id)?.nativeHistorySourceId ?? "unknown") === sourceId).length;
          if (busy >= (sourceLimits.get(sourceId) ?? 2)) continue;
          const task = syncOne(id).catch(error => { fatal = error; }).finally(() => { inFlight.delete(id); });
          inFlight.set(id, task);
        }
        job.activeIds = [...inFlight.keys()]; await publish(job);
        // New work on another source can use free slots without waiting for a
        // slow source's outstanding requests to finish.
        if (inFlight.size) await Promise.race([...inFlight.values(), changed]);
        if (fatal) throw fatal;
      }
      if (!paused) { job.status = "reconciling"; job.phase = "reconciling"; }
      await Promise.all(inFlight.values());
      check();
      job.status = job.failedIds.length || !job.inventoryComplete ? "completed_with_warnings" : "completed";
      if (job.status === "completed") { job.lastSyncedAt = Date.now(); job.lastError = undefined; }
    } catch (error) {
      if (error instanceof NativeImportPaused) job.status = "paused";
      else { job.status = "failed"; job.lastError = error instanceof Error ? error.message : "Import failed"; }
    } finally {
      wakeScheduler = undefined;
      await Promise.allSettled(inFlight.values());
      job.activeIds = [];
      await publish(job);
    }
  };
  // A saved source keeps the tab it was detected in, which may have closed since: the AI's tabs open now replace it.
  const refreshTabs = (job: ImportJob, open: NativeImportSource[]) => {
    for (const source of job.native!.sources) {
      const match = open.find(item => item.id === source.id && item.platform === source.platform && item.origin === source.origin);
      if (match) source.tabId = match.tabId;
    }
  };
  const launch = async (job: ImportJob) => {
    paused = false; sourceLimits.clear(); current = job; await publish(job);
    const activity = setInterval(() => {
      if (typeof chrome !== "undefined") void chrome.runtime.getPlatformInfo?.().catch(() => undefined);
    }, 20000);
    flight = process(job).catch(async error => { job.status = "failed"; job.lastError = error instanceof Error ? error.message : "Import failed"; await publish(job); }).finally(() => { clearInterval(activity); flight = undefined; current = undefined; });
    return structuredClone(job);
  };
  return {
    isRunning: () => Boolean(flight),
    start: (sources: NativeImportSource[]) => serialize(async () => {
      if (flight) return structuredClone(current!);
      if (!sources.length) throw Error("请选择 AI 来源 / Select an AI source");
      const now = Date.now(), sessionId = crypto.randomUUID();
      const job: ImportJob = { id: "chatgpt-history", sessionId, status: "discovering", phase: "discovering", retryScope: "titles", offset: 0, discovered: 0, discoveredIds: [], persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0, pendingIds: [], failedIds: [], startedAt: now, updatedAt: now, checkpoint: { sessionId, discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "", startedAt: now, updatedAt: now }, native: { version: 1, sources: sources.map(source => ({ id: source.id, platform: source.platform, origin: source.origin, tabId: source.tabId, label: source.label })), inventoryComplete: false } };
      return launch(job);
    }),
    select: (ids: string[], available: NativeImportSource[] = [], force = false) => serialize(async () => {
      if (flight) {
        if (current?.retryScope === "titles") { paused = true; await flight; }
        else {
          const runningJob = current!;
          const records = await Promise.all(ids.map(getConversation));
          refreshTabs(runningJob, available);
          for (const item of records) {
            if (!item) throw Error("Selected source missing");
            if (runningJob.native!.sources.some(source => source.id === item.nativeHistorySourceId)) continue;
            const source = available.find(source => source.id === item.nativeHistorySourceId);
            if (!source) throw Error("请打开所选对话的来源 AI 后重试 / Open the source AI and retry");
            runningJob.native!.sources.push({ ...source, account: item.sourceAccount, done: true });
          }
          if (current === runningJob && runningJob.phase === "syncing") {
            prioritize(runningJob, ids);
            await publish(runningJob); wakeScheduler?.(); return structuredClone(runningJob);
          }
          if (flight) await flight;
        }
      }
      const job = await getImportJob();
      if (!job?.native) throw Error("请先导入对应 AI 的标题 / Import AI titles first");
      const records = await Promise.all([...new Set(ids)].map(getConversation));
      const valid = records.filter((item): item is Conversation => Boolean(item));
      if (valid.length !== new Set(ids).size) throw Error("所选来源缺失 / Selected source missing");
      refreshTabs(job, available);
      for (const item of valid) {
        if (job.native.sources.some(source => source.id === item.nativeHistorySourceId)) continue;
        const source = available.find(source => source.id === item.nativeHistorySourceId);
        if (!source) throw Error("请打开所选对话的来源 AI 后重试 / Open the source AI and retry");
        job.native.sources.push({ ...source, account: item.sourceAccount, done: true });
        // Persist the source binding independently of a particular import run.
        await saveConversation({ ...item, nativeHistorySourceId: source.id });
      }
      job.retryScope = "selected"; job.status = "syncing";
      // Asked to sync again: every selected conversation is read, synced or not.
      const requested = valid.filter(item => force || job.pendingIds.includes(item.id) || !isCurrentHydrationComplete(item) || item.historyCoverage !== "complete" || !item.sourceUpdatedAt || !item.hydratedSourceUpdatedAt || item.sourceUpdatedAt > item.hydratedSourceUpdatedAt).map(item => item.id);
      job.pendingIds = [...new Set([...job.pendingIds.filter(id => ids.includes(id)), ...requested])];
      prioritize(job, requested);
      return launch(job);
    }),
    pause: () => serialize(async () => {
      paused = true;
      wakeScheduler?.();
      if (flight) await flight;
      const job = await getImportJob();
      if (!job?.native) throw Error("No native import to pause");
      job.status = "paused"; await publish(job); return job;
    }),
    resume: (sources?: NativeImportSource[]) => serialize(async () => {
      if (flight) return structuredClone(current!);
      const job = await getImportJob();
      if (!job?.native) throw Error("No native import checkpoint");
      if (sources) refreshTabs(job, sources);
      for (const source of job.native.sources) delete source.error;
      job.pendingIds = [...new Set([...job.pendingIds, ...job.failedIds])];
      job.failedIds = []; job.lastError = undefined;
      return launch(job);
    }),
    recover: async () => { const job = await getImportJob(); if (job?.native && active(job) && !flight) { job.status = "paused"; job.activeIds = []; await publish(job); } },
  };
}
