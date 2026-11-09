import type { AtlasMessage } from "../shared/messages";
import type { Conversation, ConversationCapture, ImportDiagnostic, ImportDiagnostics, ImportFailureCategory, ImportJob } from "../shared/types";
import { getConversation, listConversations, saveDiscoveredConversations, setConversationHydrationState } from "../storage/conversations";
import { getImportJob, HISTORY_JOB_ID, saveImportJob } from "../storage/import-jobs";
import { listImportItems, saveDiscoveredImportItems, saveImportDiagnostics, saveImportItem } from "../storage/import-items";
import { saveConversationCapture } from "../storage/messages";
import { ChatGPTSyncError } from "./chatgpt-sync-adapter";
import { classifyImportError, isCurrentHydrationComplete, reconcileSnapshot } from "./import-state";
import { orderHydrationQueue } from "./hydration-queue";

export interface HistoryAdapter {
  isAvailable(): Promise<boolean>;
  list(offset: number, limit: number, archived: boolean): Promise<{ conversations: Conversation[]; hasMore: boolean }>;
  getConversation(id: string): Promise<ConversationCapture>;
}

const PAGE_SIZE = 50;
const MAX_CONCURRENCY = 4;
let running: Promise<void> | null = null;
let activeJob: ImportJob | null = null;
let pauseRequested = false;
let wakeActiveQueue: (() => void) | null = null;
const interactivePriorities = new Set<string>();
let activeSelectedScope: Set<string> | undefined;
const pauseWaiters = new Set<() => void>();
class ImportPausedError extends Error {}
let lastProgressBroadcast = { sessionId: "", status: "", phase: "", at: 0 };
let publication: Promise<void> = Promise.resolve();

function newSessionId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function emptyJob(): ImportJob {
  const now = Date.now();
  const sessionId = newSessionId();
  return {
    id: HISTORY_JOB_ID, sessionId, status: "idle", phase: "connecting", connectionStep: "finding_chatgpt_tab", scope: "active", inventoryComplete: false,
    offset: 0, discovered: 0, discoveredIds: [], persisted: 0, persistedIds: [], hydrated: 0, completed: 0, failed: 0,
    syncedMessages: 0, pendingIds: [], failedIds: [], startedAt: now, updatedAt: now,
    checkpoint: { sessionId, discoveredIds: [], persistedIds: [], failedIds: [], pendingIds: [], lastCursor: "0", startedAt: now, updatedAt: now },
  };
}

function syncCheckpoint(job: ImportJob): void {
  job.checkpoint = {
    sessionId: job.sessionId,
    discoveredIds: [...(job.discoveredIds ?? [])],
    persistedIds: [...job.persistedIds],
    failedIds: [...job.failedIds],
    pendingIds: [...job.pendingIds],
    lastCursor: String(job.offset),
    startedAt: job.startedAt,
    updatedAt: Date.now(),
  };
}

async function publish(job: ImportJob, forceBroadcast = false): Promise<void> {
  if (pauseRequested && job === activeJob) job.status = "paused";
  job.updatedAt = Date.now();
  syncCheckpoint(job);
  const snapshot = structuredClone(job);
  // Discovery, user selection and completed requests can publish concurrently.
  // Persist immutable snapshots in order so an older update cannot overwrite a newer checkpoint.
  publication = publication.catch(() => undefined).then(async () => {
    await saveImportJob(snapshot);
    const now = Date.now();
    const changedPhase = lastProgressBroadcast.sessionId !== snapshot.sessionId || lastProgressBroadcast.status !== snapshot.status || lastProgressBroadcast.phase !== snapshot.phase;
    const terminal = !["connecting", "discovering", "syncing", "reconciling"].includes(snapshot.status);
    if (forceBroadcast || changedPhase || terminal || now - lastProgressBroadcast.at >= 1000) {
      lastProgressBroadcast = { sessionId: snapshot.sessionId, status: snapshot.status, phase: snapshot.phase, at: now };
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) void chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_PROGRESS", job: snapshot } satisfies AtlasMessage).catch(() => undefined);
    }
  });
  await publication;
}

async function retry<T>(action: () => Promise<T>, onRetry: (attempt: number, category: ImportFailureCategory, error: unknown) => Promise<void> | void): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    if (pauseRequested) throw new ImportPausedError();
    try { return await action(); }
    catch (error) {
      if (pauseRequested || error instanceof ImportPausedError) throw new ImportPausedError();
      const category = classifyImportError(error);
      const retryable = error instanceof ChatGPTSyncError ? error.retryable : category === "network" || category === "bridge_error";
      if (!retryable || attempt >= (category === "rate_limit" ? 2 : 3)) throw error;
      await onRetry(attempt + 1, category, error);
      const backoff = Math.min(60_000, Math.max(error instanceof ChatGPTSyncError ? error.retryAfterMs ?? 0 : 0, Math.min(16000, 2000 * 2 ** attempt)));
      await new Promise<void>((resolve, reject) => {
        const paused = () => { clearTimeout(timer); pauseWaiters.delete(paused); reject(new ImportPausedError()); };
        const timer = setTimeout(() => { pauseWaiters.delete(paused); resolve(); }, backoff + Math.random() * Math.min(1000, backoff * .25));
        pauseWaiters.add(paused);
        if (pauseRequested) paused();
      });
    }
  }
}

export async function reconcileImportSession(job: ImportJob, selectedIds?: string[]): Promise<ImportJob> {
  const preReconciliationState = job.status;
  job.status = "reconciling";
  job.phase = "reconciling";
  await publish(job);
  const [conversations, items] = await Promise.all([listConversations(), listImportItems(job.sessionId)]);
  const categories = Object.fromEntries(items.filter((item) => item.failureCategory).map((item) => [item.conversationId, item.failureCategory!])) as Record<string, ImportFailureCategory>;
  const result = reconcileSnapshot(job.discoveredIds ?? [], conversations, job.failedIds, job.pendingIds, categories);
  const discoveredIds = new Set(job.discoveredIds ?? []);
  const completeIds = conversations.filter((conversation) => discoveredIds.has(conversation.id) && isCurrentHydrationComplete(conversation)).map((conversation) => conversation.id);
  const completeSet = new Set(completeIds);
  const failedIds = job.failedIds.filter((id) => !completeSet.has(id));
  const failedSet = new Set(failedIds);
  job.persisted = result.persisted;
  job.persistedIds = completeIds;
  job.hydrated = result.hydrated;
  job.completed = result.hydrated;
  job.failedIds = failedIds;
  job.failed = failedIds.length;
  job.retryAfterAt = items.filter((item) => failedSet.has(item.conversationId) && item.nextRetryAt).reduce<number | undefined>((earliest, item) => earliest === undefined ? item.nextRetryAt : Math.min(earliest, item.nextRetryAt!), undefined);
  job.reconciliation = { ...result, failed: failedIds.length };
  job.status = pauseRequested ? "paused" : preReconciliationState === "auth_required" && result.hydrated < result.discovered ? "auth_required" : result.discovered === 0 && preReconciliationState === "auth_required" ? "auth_required" : result.discovered === 0 && preReconciliationState === "unavailable" ? "unavailable" : result.finalState;
  if (selectedIds?.length && job.status !== "paused" && job.status !== "auth_required") job.status = selectedIds.every((id) => completeSet.has(id)) ? "inventory_ready" : "partial";
  if (["completed", "completed_with_warnings", "partial", "inventory_ready"].includes(job.status) && result.persisted > 0) job.lastSyncedAt = Date.now();
  const success = job.status === "completed" || job.status === "inventory_ready";
  job.diagnostic = { stage: "sync", success, code: success ? undefined : "REQUEST_FAILED", message: success ? undefined : job.lastError };
  await publish(job);
  return job;
}

async function persistDiagnostics(job: ImportJob, events: ImportDiagnostics["events"]): Promise<void> {
  const requestDurations = events.filter((item) => item.stage === "detail_persisted" && item.durationMs !== undefined).map((item) => item.durationMs!);
  await saveImportDiagnostics({
    id: "lastImportDiagnostics", sessionId: job.sessionId, stage: job.status, discovered: job.discovered,
    persisted: job.persisted, hydrated: job.hydrated, failed: job.failed,
    retried: events.reduce((count, item) => count + Number(Boolean(item.retryCount)), 0),
    rateLimitCount: events.filter((item) => item.category === "rate_limit").length,
    timeoutCount: events.filter((item) => /timeout|took too long/i.test(item.message ?? "")).length,
    averageRequestDuration: requestDurations.length ? Math.round(requestDurations.reduce((sum, duration) => sum + duration, 0) / requestDurations.length) : undefined,
    currentConcurrency: job.currentConcurrency, pendingIds: [...job.pendingIds], failedIds: [...job.failedIds],
    duration: Date.now() - job.startedAt, finalState: job.status, events: events.slice(-250), reconciliation: job.reconciliation, updatedAt: Date.now(),
  });
}

async function processJob(job: ImportJob, adapter: HistoryAdapter, failedOnly = false, selectedIds?: string[]): Promise<void> {
  const events: ImportDiagnostics["events"] = [];
  const event = (stage: string, details: Omit<ImportDiagnostics["events"][number], "at" | "stage"> = {}) => events.push({ at: Date.now(), stage, ...details });
  try {
    event("session");
    if (!await adapter.isAvailable()) throw new ChatGPTSyncError("ChatAtlas could not verify a signed-in ChatGPT session.", false, "auth");
    job.status = job.phase === "syncing" ? "syncing" : "discovering";
    job.phase = job.phase === "syncing" ? "syncing" : "discovering";
    job.connectionStep = undefined;
    await publish(job);
    const discoveredIds = new Set(job.discoveredIds ?? []);
    let inventoryDone = job.phase !== "discovering";
    let inventoryError: unknown;
    let wakeQueue: (() => void) | null = null;
    let queueRevision = 0;
    const signalQueue = () => { queueRevision++; const wake = wakeQueue; wakeQueue = null; if (wake) wake(); };
    wakeActiveQueue = signalQueue;
    const discover = async () => {
    while (!pauseRequested && job.phase === "discovering") {
      let page: { conversations: Conversation[]; hasMore: boolean };
      try {
        page = await retry(() => adapter.list(job.offset, PAGE_SIZE, job.scope === "archived"), (attempt, category, error) => { event("discovery_retry", { retryCount: attempt, category, message: error instanceof Error ? error.message : String(error) }); });
      } catch (error) {
        if (job.scope !== "archived" || error instanceof ChatGPTSyncError && error.retryable) throw error;
        job.lastError = "Archived chats could not be listed; active history remains available.";
        job.phase = "syncing"; job.status = "syncing";
        break;
      }
      const previous = await saveDiscoveredConversations(page.conversations);
      const pagePending = new Set<string>();
      for (const conversation of page.conversations) {
        if (!discoveredIds.has(conversation.id)) discoveredIds.add(conversation.id);
        const old = previous.get(conversation.id);
        const hydratedVersion = old?.hydratedSourceUpdatedAt ?? (isCurrentHydrationComplete(old ?? conversation) ? old?.sourceUpdatedAt : undefined);
        if (!old || !isCurrentHydrationComplete(old) || Boolean(conversation.sourceUpdatedAt && (!hydratedVersion || hydratedVersion < conversation.sourceUpdatedAt))) pagePending.add(conversation.id);
      }
      await saveDiscoveredImportItems(job.sessionId, page.conversations.map((conversation) => ({ id: conversation.id, pending: pagePending.has(conversation.id) })));
      job.discoveredIds = [...discoveredIds]; job.discovered = discoveredIds.size; job.persisted = discoveredIds.size;
      job.pendingIds = orderHydrationQueue([...job.pendingIds, ...pagePending], page.conversations, job.priorityIds);
      job.offset += page.conversations.length;
      event("inventory_persisted", { message: `${page.conversations.length} rows` });
      await publish(job);
      signalQueue();
      if (!page.hasMore || !page.conversations.length) {
        if (job.scope === "archived") { job.inventoryComplete = true; job.phase = "syncing"; job.status = "syncing"; }
        else { job.scope = "archived"; job.offset = 0; }
        await publish(job);
      }
    }
    };
    const discoveryTask = discover().catch((error: unknown) => { inventoryError = error; }).finally(() => { inventoryDone = true; signalQueue(); });

    if (inventoryDone && !pauseRequested && job.pendingIds.length) job.pendingIds = orderHydrationQueue(job.pendingIds, await listConversations(), job.priorityIds);

    let concurrency = failedOnly ? 1 : MAX_CONCURRENCY;
    let healthyCompletions = 0;
    let authFailure = false;
    const inFlight = new Map<string, Promise<{ id: string; outcome: PromiseSettledResult<number> }>>();
    const fetchDetail = async (id: string): Promise<number> => {
        await saveImportItem(job.sessionId, id, job.failedIds.includes(id) ? "retrying" : "fetching");
        await setConversationHydrationState(id, "syncing");
        const started = Date.now();
        const capture = await retry(async () => {
          const wasRetrying = job.retryingIds?.includes(id);
          job.retryingIds = (job.retryingIds ?? []).filter(candidate => candidate !== id);
          if (wasRetrying) { await setConversationHydrationState(id, "syncing"); await publish(job, true); }
          return adapter.getConversation(id);
        }, async (attempt, category, error) => {
          if (category === "rate_limit" || category === "network" || category === "bridge_error") {
            concurrency = Math.max(1, Math.floor(concurrency / 2));
            healthyCompletions = 0;
            job.currentConcurrency = concurrency;
          }
          event("detail_retry", { conversationId: id, retryCount: attempt, category, message: error instanceof Error ? error.message : String(error) });
          job.retryingIds = [...new Set([...(job.retryingIds ?? []), id])];
          await Promise.all([
            saveImportItem(job.sessionId, id, "retrying", { retryCount: attempt, category, error: error instanceof Error ? error.message : String(error) }),
            setConversationHydrationState(id, category === "rate_limit" ? "rate_limited" : "retry_wait"),
          ]);
          await publish(job, true);
        });
        try { await saveConversationCapture(capture, { warmIndex: false }); }
        catch (error) { throw new ChatGPTSyncError(error instanceof Error ? error.message : "IndexedDB persistence failed.", false, "storage_error"); }
        await saveImportItem(job.sessionId, id, "persisted");
        event("detail_persisted", { conversationId: id, durationMs: Date.now() - started });
        return capture.messages.length;
    };
    const fillSlots = () => {
      while (!pauseRequested && !authFailure && inFlight.size < concurrency) {
        const candidates = job.pendingIds.filter(candidate => !inFlight.has(candidate));
        // Keep one of the existing four slots available for an explicit user request.
        // During platform backoff the reduced concurrency is still a hard limit.
        const urgent = candidates.find(candidate => interactivePriorities.has(candidate));
        const limit = concurrency === MAX_CONCURRENCY && !urgent ? MAX_CONCURRENCY - 1 : concurrency;
        if (inFlight.size >= limit) break;
        const id = urgent ?? candidates[0];
        if (!id) break;
        const task = fetchDetail(id).then(
          (value): { id: string; outcome: PromiseFulfilledResult<number> } => ({ id, outcome: { status: "fulfilled", value } }),
          (reason): { id: string; outcome: PromiseRejectedResult } => ({ id, outcome: { status: "rejected", reason } }),
        );
        inFlight.set(id, task);
        job.activeIds = [...inFlight.keys()];
      }
    };
    fillSlots();
    await publish(job, true);
    while (inFlight.size || !inventoryDone || !pauseRequested && !authFailure && job.pendingIds.length) {
      const revision = queueRevision;
      const before = inFlight.size;
      fillSlots();
      if (inFlight.size !== before) await publish(job, true);
      if (queueRevision !== revision) continue;
      if (!inFlight.size) {
        if (!inventoryDone) await new Promise<void>((resolve) => { wakeQueue = resolve; });
        continue;
      }
        const settled = await Promise.race([
          ...inFlight.values(),
          new Promise<null>(resolve => { wakeQueue = () => resolve(null); }),
        ]);
        wakeQueue = null;
        if (!settled) { fillSlots(); await publish(job, true); continue; }
        const { id, outcome } = settled;
        inFlight.delete(id);
        job.activeIds = [...inFlight.keys()];
        job.retryingIds = (job.retryingIds ?? []).filter(candidate => candidate !== id);
        interactivePriorities.delete(id);
        job.priorityPendingIds = [...interactivePriorities];
        if (outcome.status === "fulfilled") {
          job.syncedMessages = (job.syncedMessages ?? 0) + outcome.value;
          job.persistedIds = [...new Set([...job.persistedIds, id])];
          job.failedIds = job.failedIds.filter((failedId) => failedId !== id);
          if (job.failureReasons) delete job.failureReasons[id];
          if (++healthyCompletions >= 3) { concurrency = Math.min(MAX_CONCURRENCY, concurrency + 1); healthyCompletions = 0; }
        } else if (outcome.reason instanceof ImportPausedError) {
          await setConversationHydrationState(id, "queued");
          await saveImportItem(job.sessionId, id, "pending");
        } else {
          const category = classifyImportError(outcome.reason);
          const reason = outcome.reason instanceof Error ? outcome.reason.message : "Unable to import a conversation.";
          if (category === "auth") authFailure = true;
          if (["rate_limit", "network", "bridge_error"].includes(category)) { concurrency = Math.max(1, Math.floor(concurrency / 2)); healthyCompletions = 0; }
          job.failedIds = [...new Set([...job.failedIds, id])];
          (job.failureReasons ??= {})[id] = reason; job.lastError = reason;
          const nextRetryAt = ["rate_limit", "network", "bridge_error"].includes(category) ? Date.now() + (category === "rate_limit" ? 300_000 : 120_000) : undefined;
          if (nextRetryAt) job.retryAfterAt = Math.min(job.retryAfterAt ?? nextRetryAt, nextRetryAt);
          await saveImportItem(job.sessionId, id, "failed", { category, error: reason, nextRetryAt });
          await setConversationHydrationState(id, category === "rate_limit" ? "rate_limited" : "failed");
          event("detail_failed", { conversationId: id, category, message: reason });
        }
      if (!(outcome.status === "rejected" && outcome.reason instanceof ImportPausedError)) job.pendingIds = job.pendingIds.filter((pendingId) => pendingId !== id);
      job.hydrated = job.persistedIds.length; job.completed = job.hydrated; job.failed = job.failedIds.length;
      job.currentConcurrency = concurrency;
      fillSlots();
      await publish(job, outcome.status === "fulfilled" && job.priorityIds?.includes(id));
    }
    await discoveryTask;
    if (authFailure) {
      for (const id of job.pendingIds) {
        job.failedIds = [...new Set([...job.failedIds, id])];
        (job.failureReasons ??= {})[id] = "ChatGPT authorization needs to be renewed.";
        await saveImportItem(job.sessionId, id, "failed", { category: "auth", error: job.failureReasons[id] });
        await setConversationHydrationState(id, "failed");
      }
      job.pendingIds = [];
    }
    if (inventoryError) throw inventoryError;
    job.currentConcurrency = concurrency;
  } catch (error) {
    if (!(error instanceof ImportPausedError)) {
      const category = classifyImportError(error);
      job.lastError = error instanceof Error ? error.message : "History import failed.";
      event("session_failed", { category, message: job.lastError });
      if (category === "auth") job.status = "auth_required";
      else if (job.discovered === 0) job.status = category === "bridge_error" || category === "network" ? "unavailable" : "failed";
    }
  }
  if (!pauseRequested && job.discovered === 0 && !job.lastError && job.status !== "auth_required") {
    job.status = "unavailable";
    job.lastError = "ChatGPT returned no history conversations.";
  }
  job.activeIds = []; job.retryingIds = []; job.priorityPendingIds = [];
  await reconcileImportSession(job, selectedIds ? [...(activeSelectedScope ?? selectedIds)] : undefined);
  await persistDiagnostics(job, events);
}

async function processInventoryJob(job: ImportJob, adapter: HistoryAdapter): Promise<void> {
  try {
    if (!await adapter.isAvailable()) throw new ChatGPTSyncError("ChatAtlas could not verify a signed-in ChatGPT session.", false, "auth");
    job.status = "discovering"; job.phase = "discovering"; job.connectionStep = undefined;
    await publish(job);
    const discoveredIds = new Set(job.discoveredIds ?? []);
    while (!pauseRequested) {
      let page: { conversations: Conversation[]; hasMore: boolean };
      try { page = await retry(() => adapter.list(job.offset, PAGE_SIZE, job.scope === "archived"), () => undefined); }
      catch (error) {
        if (job.scope !== "archived" || error instanceof ChatGPTSyncError && error.retryable) throw error;
        job.lastError = "Archived chats could not be listed; active history remains available.";
        break;
      }
      const previous = await saveDiscoveredConversations(page.conversations);
      const pagePending = new Set<string>();
      for (const conversation of page.conversations) {
        discoveredIds.add(conversation.id);
        const old = previous.get(conversation.id);
        const hydratedVersion = old?.hydratedSourceUpdatedAt ?? (isCurrentHydrationComplete(old ?? conversation) ? old?.sourceUpdatedAt : undefined);
        if (!old || !isCurrentHydrationComplete(old) || Boolean(conversation.sourceUpdatedAt && (!hydratedVersion || hydratedVersion < conversation.sourceUpdatedAt))) pagePending.add(conversation.id);
      }
      await saveDiscoveredImportItems(job.sessionId, page.conversations.map((conversation) => ({ id: conversation.id, pending: pagePending.has(conversation.id) })));
      job.discoveredIds = [...discoveredIds]; job.discovered = discoveredIds.size; job.persisted = discoveredIds.size;
      job.pendingIds = [...new Set([...job.pendingIds, ...pagePending])];
      job.offset += page.conversations.length;
      await publish(job);
      if (!page.hasMore || !page.conversations.length) {
        if (job.scope === "archived") { job.inventoryComplete = true; break; }
        job.scope = "archived"; job.offset = 0;
        await publish(job);
      }
    }
    if (pauseRequested) job.status = "paused";
    else if (!job.discovered) { job.status = "unavailable"; job.lastError = "ChatGPT returned no history conversations."; }
    else job.status = "inventory_ready";
  } catch (error) {
    if (error instanceof ImportPausedError) job.status = "paused";
    else {
      job.lastError = error instanceof Error ? error.message : "Unable to scan conversation titles.";
      job.status = classifyImportError(error) === "auth" ? "auth_required" : job.discovered ? "partial" : "unavailable";
    }
  }
  await publish(job);
}

export async function startHistoryImport(adapter: HistoryAdapter, mode: "full" | "incremental" | "failed" | "titles" | "selected" = "full", selectedIds: string[] = [], options: { resumeTitles?: boolean; force?: string[] } = {}): Promise<ImportJob> {
  if (running) {
    if (mode === "selected" && (pauseRequested || activeJob?.retryScope === "titles" || activeJob?.phase === "reconciling")) {
      if (activeJob?.retryScope === "titles") await pauseHistoryImport();
      await running;
      return startHistoryImport(adapter, mode, selectedIds, options);
    }
    if (mode === "selected") await raiseHistoryPriorities(selectedIds);
    return (await getImportJob()) ?? emptyJob();
  }
  const previous = await getImportJob();
  if (mode === "selected") {
    const job = previous ?? emptyJob();
    const candidates = [...new Set([...selectedIds, ...(job.retryScope === "selected" ? job.pendingIds : [])])];
    const records = await Promise.all(candidates.map((id) => getConversation(id)));
    const requested = candidates.filter((_, index) => Boolean(records[index]));
    job.discoveredIds = [...new Set([...(job.discoveredIds ?? []), ...requested])];
    job.discovered = job.discoveredIds.length;
    // Asked to sync again: read even an already synced conversation, whose saved copy a failed read kept.
    const forced = new Set(options.force ?? []);
    const pending = candidates.filter((id, index) => records[index] && (forced.has(id) || !isCurrentHydrationComplete(records[index]!)));
    if (!pending.length) return job;
    job.pendingIds = pending; job.priorityIds = [...new Set([...pending, ...(job.priorityIds ?? [])])];
    job.status = "syncing"; job.phase = "syncing"; job.retryScope = "selected";
    job.failedIds = job.failedIds.filter((id) => !pending.includes(id));
    for (const id of pending) if (job.failureReasons) delete job.failureReasons[id];
    job.lastError = undefined;
    job.failed = job.failedIds.length; job.diagnostic = undefined;
    job.activeIds = []; job.retryingIds = []; job.priorityPendingIds = [];
    pauseRequested = false;
    await publish(job);
    activeJob = job;
    activeSelectedScope = new Set(pending);
    running = processJob(job, adapter, false, pending).finally(clearActiveImport);
    return job;
  }
  if (mode === "titles") {
    // Connection checks change the status to "connecting"; retain the cursor for a real resume.
    const resumable = previous?.retryScope === "titles" && !previous.inventoryComplete && (previous.status === "paused" || options.resumeTitles);
    const job = resumable ? previous! : emptyJob();
    job.lastError = undefined; job.diagnostic = undefined;
    job.status = "connecting"; job.phase = "discovering"; job.retryScope = "titles";
    pauseRequested = false;
    await publish(job);
    activeJob = job;
    running = processInventoryJob(job, adapter).finally(clearActiveImport);
    return job;
  }
  if (mode === "failed" && !previous?.failedIds.length) return previous ?? emptyJob();
  const failureCategories = mode === "failed" && previous ? new Map((await listImportItems(previous.sessionId)).map((item) => [item.conversationId, item.failureCategory])) : new Map<string, ImportFailureCategory | undefined>();
  const eligibleFailures = previous?.failedIds.filter((id) => !["auth", "permission", "not_found", "parse_error", "storage_error"].includes(failureCategories.get(id) ?? "unknown")) ?? [];
  if (mode === "failed" && !eligibleFailures.length) return previous!;
  const resumable = previous && mode === "full" && previous.discovered > 0 && (previous.pendingIds.length > 0 || ["paused", "partial", "completed_with_warnings", "connecting", "discovering", "syncing", "reconciling", "auth_required", "unavailable"].includes(previous.status));
  const job = mode === "failed" || resumable ? previous! : emptyJob();
  if (mode === "failed") {
    job.pendingIds = orderHydrationQueue(eligibleFailures, await listConversations(), job.priorityIds);
    job.phase = "syncing";
    job.status = "syncing";
  } else if (resumable) {
    job.pendingIds = [...new Set([...job.pendingIds, ...job.failedIds])];
    job.failedIds = []; job.failed = 0; job.lastError = undefined; job.failureReasons = {};
    job.phase = (job.inventoryComplete ?? ["syncing", "reconciling"].includes(previous!.phase)) ? "syncing" : "discovering";
  } else if (mode === "incremental") {
    job.status = "discovering"; job.phase = "discovering";
  } else {
    job.status = "connecting"; job.phase = "connecting";
  }
  job.retryScope = mode;
  pauseRequested = false;
  await publish(job);
  activeJob = job;
  running = processJob(job, adapter, mode === "failed").finally(clearActiveImport);
  return job;
}

/** A click can move a metadata-only conversation ahead of older background work. */
export async function raiseHistoryPriority(conversationId: string): Promise<ImportJob | undefined> {
  return raiseHistoryPriorities([conversationId]);
}

/** A batch selection reads the checkpoint once and publishes one queue update. */
export async function raiseHistoryPriorities(conversationIds: string[]): Promise<ImportJob | undefined> {
  const job = activeJob ?? await getImportJob();
  if (!job) return undefined;
  const uniqueIds = [...new Set(conversationIds)];
  const [conversations, items] = await Promise.all([
    Promise.all(uniqueIds.map(getConversation)),
    listImportItems(job.sessionId),
  ]);
  const blockedIds = new Set(items.filter((item) => item.failureCategory === "auth").map((item) => item.conversationId));
  if (conversations.some(conversation => conversation && !isCurrentHydrationComplete(conversation) && blockedIds.has(conversation.id))) throw new Error("请重新登录 ChatGPT，再重试同步这些对话。");
  const pending = conversations.filter((conversation): conversation is Conversation => Boolean(conversation && !isCurrentHydrationComplete(conversation) && !blockedIds.has(conversation.id)));
  if (!pending.length) return job;
  const ids = pending.map((conversation) => conversation.id);
  const selected = new Set(ids);
  job.priorityIds = [...ids, ...(job.priorityIds ?? []).filter((id) => !selected.has(id))];
  job.pendingIds = [...ids, ...job.pendingIds.filter((id) => !selected.has(id))];
  job.discoveredIds = [...new Set([...(job.discoveredIds ?? []), ...ids])];
  job.discovered = job.discoveredIds.length;
  // Explicit retry clears stale failures; authentication failures still require reconnection.
  job.failedIds = job.failedIds.filter(id => !selected.has(id));
  job.failed = job.failedIds.length;
  for (const id of ids) {
    if (job.failureReasons) delete job.failureReasons[id];
    interactivePriorities.add(id);
    activeSelectedScope?.add(id);
  }
  job.priorityPendingIds = [...interactivePriorities];
  await Promise.all(pending.filter((conversation) => !["syncing", "retry_wait", "rate_limited"].includes(conversation.hydrationState ?? "")).map((conversation) => setConversationHydrationState(conversation.id, "queued")));
  await publish(job, true);
  wakeActiveQueue?.();
  return job;
}

export function isHistoryImportRunning(): boolean { return running !== null; }

export async function waitForHistoryImportIdle(): Promise<void> {
  if (running) await running;
}

export async function pauseHistoryImport(): Promise<ImportJob> {
  pauseRequested = true;
  for (const paused of pauseWaiters) paused();
  const job = activeJob ?? (await getImportJob()) ?? emptyJob();
  job.status = "paused";
  await publish(job);
  wakeActiveQueue?.();
  return job;
}

function clearActiveImport(): void {
  running = null; activeJob = null; wakeActiveQueue = null;
  interactivePriorities.clear(); activeSelectedScope = undefined;
}

export async function historyImportStatus(): Promise<ImportJob> { return (await getImportJob()) ?? emptyJob(); }

export async function markHistoryUnavailable(reason: string): Promise<ImportJob> {
  const job = emptyJob();
  job.status = "unavailable"; job.lastError = reason;
  job.diagnostic = { stage: "bridge", success: false, code: "REQUEST_FAILED", message: reason };
  await publish(job);
  return job;
}

export async function setImportConnectionState(connectionStep: NonNullable<ImportJob["connectionStep"]>, status: "connecting" | "auth_required" | "unavailable", diagnostic: ImportDiagnostic, preserveFailed = false): Promise<ImportJob> {
  const previous = await getImportJob();
  const job = previous && (preserveFailed && previous.failedIds.length > 0 || previous.pendingIds.length > 0 || ["connecting", "discovering", "syncing", "reconciling", "paused", "unavailable", "auth_required"].includes(previous.status)) ? previous : emptyJob();
  job.status = status; job.phase = "connecting"; job.connectionStep = connectionStep; job.diagnostic = diagnostic; job.lastError = diagnostic.message;
  await publish(job);
  return job;
}
