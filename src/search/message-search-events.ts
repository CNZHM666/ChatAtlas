import type { AtlasMessage } from "../shared/messages";
import { messageFullTextSearch, type MessageFullTextSearch } from "./message-fulltext";

/** Observes existing commit notifications; never writes or changes import transactions. */
export function observeMessageSearchEvents(service: MessageFullTextSearch = messageFullTextSearch) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let session = "", persisted = new Set<string>(), pending = new Set<string>();
  const schedule = () => { if (timer) return; timer = setTimeout(() => { timer = undefined; void service.prepare().catch(() => service.invalidate()); }, 500); };
  const listener = (message: AtlasMessage) => {
    if (message.type === "ATLAS_CAPTURE_SAVED") { service.invalidate(message.summary.conversationId); schedule(); }
    if (message.type === "ATLAS_IMPORT_PROGRESS") {
      if (session !== message.job.sessionId) { session = message.job.sessionId; persisted = new Set(); pending = new Set(); }
      const nextPending = new Set(message.job.pendingIds);
      const changed = message.job.persistedIds.filter(id => !persisted.has(id) || pending.has(id) && !nextPending.has(id));
      persisted = new Set(message.job.persistedIds); pending = nextPending;
      if (changed.length) { for (const id of changed) service.invalidate(id); schedule(); }
    }
  };
  if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) chrome.runtime.onMessage.addListener(listener);
  const focus = () => { service.invalidate(); schedule(); };
  if (typeof window !== "undefined") window.addEventListener("focus", focus);
  return () => { if (timer) clearTimeout(timer); if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) chrome.runtime.onMessage.removeListener(listener); if (typeof window !== "undefined") window.removeEventListener("focus", focus); };
}
