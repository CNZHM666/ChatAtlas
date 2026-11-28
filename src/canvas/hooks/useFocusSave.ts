import { useCallback, useEffect, useRef } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { focusEditSignature, saveFocusSession } from "../../storage/focus-sessions";

/** Update the editor immediately; coalesce whole-result writes while typing. */
export function useFocusSave(onSaved: (session: FocusSession) => void, onStatus: (state: "saving" | "saved" | "failed") => void, initial?: FocusSession) {
  const callbacks = useRef({ onSaved, onStatus });
  callbacks.current = { onSaved, onStatus };
  const pending = useRef<FocusSession>();
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const saved = useRef(new Map<string, string>());
  const seeded = useRef<string>();
  if (initial && seeded.current !== initial.id) {
    seeded.current = initial.id;
    saved.current.set(initial.id, focusEditSignature(initial));
  }
  const adoptPersisted = useCallback((session: FocusSession) => {
    saved.current.set(session.id, focusEditSignature(session));
  }, []);
  const writes = useRef<Promise<FocusSession | undefined>>(Promise.resolve(undefined));
  const mounted = useRef(true);
  const version = useRef(0);
  const enqueue = useCallback((session: FocusSession) => {
    const currentVersion = ++version.current;
    const operation = writes.current.catch(() => undefined).then(async () => {
      const expected = saved.current.get(session.id);
      const stored = await (expected ? saveFocusSession(session, expected) : saveFocusSession(session));
      if (stored) adoptPersisted(stored);
      return stored;
    });
    writes.current = operation;
    void operation.then(stored => {
      callbacks.current.onSaved(stored ?? session);
      if (mounted.current && currentVersion === version.current && !pending.current) callbacks.current.onStatus("saved");
    }).catch(() => { if (mounted.current && currentVersion === version.current) callbacks.current.onStatus("failed"); });
    return operation;
  }, [adoptPersisted]);
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
  return { flush, save, adoptPersisted };
}
