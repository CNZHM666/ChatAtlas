import type { FocusSession } from "../shared/focus-session";
import { sameProjectReadingInputs } from "../shared/project-reading-cache";
import type { WikiReadingProjection, WikiReadingRequest } from "./wiki-reading-worker";
import type { ProjectWikiPages, WikiPageTarget } from "./project-wiki-pages";

interface CachedPageEntry {
  session: FocusSession;
  zh: boolean;
  target: WikiPageTarget;
  value: Partial<ProjectWikiPages>;
}

interface QueuedJob<T = unknown> {
  request: WikiReadingRequest;
  cancelled: boolean;
  resolve: (value: T | undefined) => void;
  cleanup?: () => void;
}

const MAX_PAGE_CACHE = 12;

let activeWorkerCtor: typeof Worker | undefined;
let sharedWorker: Worker | undefined;
let activeJob: QueuedJob | undefined;
const queue: QueuedJob[] = [];
const pageCache: CachedPageEntry[] = [];

function syncWorkerEnvironment() {
  const currentCtor = typeof Worker === "undefined" ? undefined : Worker;
  if (currentCtor === activeWorkerCtor) return;
  activeWorkerCtor = currentCtor;
  resetWorkerState();
  pageCache.length = 0;
}

function resetWorkerState() {
  if (sharedWorker) {
    try { sharedWorker.terminate(); } catch { /* ignore */ }
    sharedWorker = undefined;
  }
  if (activeJob) {
    activeJob.cleanup?.();
    activeJob.resolve(undefined);
    activeJob = undefined;
  }
  while (queue.length) {
    const job = queue.shift()!;
    job.cleanup?.();
    job.resolve(undefined);
  }
}

function ensureWorker(): Worker | undefined {
  syncWorkerEnvironment();
  if (typeof Worker === "undefined") return undefined;
  if (sharedWorker) return sharedWorker;
  try {
    const worker = new Worker(new URL("./wiki-reading-worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      const finished = activeJob;
      activeJob = undefined;
      if (finished) {
        finished.cleanup?.();
        if (finished.request.target !== "chapter" && data && typeof data === "object") {
          storeWikiPagesCache(finished.request.session, finished.request.zh, finished.request.target, data as Partial<ProjectWikiPages>);
        }
        finished.resolve(finished.cancelled ? undefined : data);
      }
      pumpQueue();
    };
    worker.onerror = worker.onmessageerror = () => {
      resetWorkerState();
    };
    sharedWorker = worker;
    return worker;
  } catch {
    return undefined;
  }
}

function pumpQueue() {
  if (activeJob) return;
  while (queue.length) {
    const next = queue.shift()!;
    if (next.cancelled) {
      next.cleanup?.();
      next.resolve(undefined);
      continue;
    }
    const worker = ensureWorker();
    if (!worker) {
      next.cleanup?.();
      next.resolve(undefined);
      return;
    }
    activeJob = next;
    try {
      worker.postMessage(next.request);
      return;
    } catch {
      resetWorkerState();
      return;
    }
  }
}

function storeWikiPagesCache(session: FocusSession, zh: boolean, target: WikiPageTarget, value: Partial<ProjectWikiPages>) {
  const index = pageCache.findIndex(entry =>
    entry.zh === zh && entry.target === target && sameProjectReadingInputs(entry.session, session));
  if (index >= 0) pageCache.splice(index, 1);
  pageCache.unshift({ session, zh, target, value });
  if (pageCache.length > MAX_PAGE_CACHE) pageCache.length = MAX_PAGE_CACHE;
}

export function peekWikiPages(session: FocusSession, zh: boolean, target: WikiPageTarget = "pages"): Partial<ProjectWikiPages> | undefined {
  syncWorkerEnvironment();
  const exact = pageCache.find(entry =>
    entry.zh === zh && entry.target === target && sameProjectReadingInputs(entry.session, session));
  if (exact) return exact.value;
  if (target === "overview" || target === "ledger") {
    const full = pageCache.find(entry =>
      entry.zh === zh && entry.target === "pages" && sameProjectReadingInputs(entry.session, session));
    if (full) return full.value;
  }
  return undefined;
}

function readWikiInWorker<T>(request: WikiReadingRequest, signal?: AbortSignal): Promise<T | undefined> | undefined {
  syncWorkerEnvironment();
  if (typeof Worker === "undefined" || signal?.aborted) return;
  if (!ensureWorker()) return;
  return new Promise(resolve => {
    const job: QueuedJob<T> = { request, cancelled: false, resolve };
    const cancel = () => {
      job.cancelled = true;
      const queuedIndex = queue.indexOf(job as QueuedJob);
      if (queuedIndex >= 0) {
        queue.splice(queuedIndex, 1);
        job.cleanup?.();
        job.resolve(undefined);
      }
    };
    job.cleanup = () => signal?.removeEventListener("abort", cancel);
    signal?.addEventListener("abort", cancel, { once: true });
    queue.push(job as QueuedJob);
    pumpQueue();
  });
}

export function refreshWikiReading(session: FocusSession, signal: AbortSignal) {
  return readWikiInWorker<WikiReadingProjection>({ session, target: "chapter" }, signal);
}

export function readWikiPages(session: FocusSession, zh: boolean, signal: AbortSignal, target: WikiPageTarget = "pages") {
  const cached = peekWikiPages(session, zh, target);
  if (cached) return Promise.resolve(cached);
  return readWikiInWorker<Partial<ProjectWikiPages>>({ session, target, zh }, signal);
}
