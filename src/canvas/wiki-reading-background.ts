import type { FocusSession } from "../shared/focus-session";
import type { WikiReadingProjection, WikiReadingRequest } from "./wiki-reading-worker";
import type { ProjectWikiPages, WikiPageTarget } from "./project-wiki-pages";

function readWikiInWorker<T>(request: WikiReadingRequest, signal?: AbortSignal): Promise<T | undefined> | undefined {
  if (typeof Worker === "undefined" || signal?.aborted) return;
  let worker: Worker;
  try { worker = new Worker(new URL("./wiki-reading-worker.ts", import.meta.url), { type: "module" }); }
  catch { return; }
  return new Promise(resolve => {
    const finish = (projection?: T) => {
      signal?.removeEventListener("abort", cancel);
      worker.terminate();
      resolve(projection);
    };
    const cancel = () => finish();
    worker.onmessage = ({ data }: MessageEvent<T>) => finish(data);
    worker.onerror = worker.onmessageerror = cancel;
    signal?.addEventListener("abort", cancel, { once: true });
    try { worker.postMessage(request); }
    catch { cancel(); }
  });
}

export function refreshWikiReading(session: FocusSession, signal: AbortSignal) {
  return readWikiInWorker<WikiReadingProjection>({ session, target: "chapter" }, signal);
}

export function readWikiPages(session: FocusSession, zh: boolean, signal: AbortSignal, target: WikiPageTarget = "pages") {
  return readWikiInWorker<Partial<ProjectWikiPages>>({ session, target, zh }, signal);
}
