import { useCallback, useEffect, useRef } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { saveFocusSession } from "../../storage/focus-sessions";

/** Update the editor immediately; coalesce whole-result writes while typing. */
export function useFocusSave(onSaved: (session: FocusSession) => void, onStatus: (state: "saving" | "saved" | "failed") => void) {
  const callbacks = useRef({ onSaved, onStatus });
  callbacks.current = { onSaved, onStatus };
  const pending = useRef<FocusSession>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const writes = useRef<Promise<void>>(Promise.resolve());
  const mounted = useRef(true);
  const version = useRef(0);
  const enqueue = useCallback((session: FocusSession) => {
    const currentVersion = ++version.current;
    const operation = writes.current.catch(() => undefined).then(() => saveFocusSession(session));
    writes.current = operation;
    void operation.then(() => {
      callbacks.current.onSaved(session);
      if (mounted.current && currentVersion === version.current && !pending.current) callbacks.current.onStatus("saved");
    }).catch(() => { if (mounted.current && currentVersion === version.current) callbacks.current.onStatus("failed"); });
    return operation;
  }, []);
  const flush = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const session = pending.current;
    pending.current = undefined;
    return session ? enqueue(session) : writes.current;
  }, [enqueue]);
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => {
    mounted.current = true;
    const leave = () => { void flushRef.current().catch(() => undefined); };
    window.addEventListener("pagehide", leave);
    return () => { mounted.current = false; window.removeEventListener("pagehide", leave); leave(); };
  }, []);
  const save = useCallback((session: FocusSession, immediate = false) => {
      callbacks.current.onStatus("saving");
      pending.current = session;
      clearTimeout(timer.current);
      if (immediate) return flush();
      timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 300);
      return Promise.resolve();
    }, [flush]);
  return { flush, save };
}
