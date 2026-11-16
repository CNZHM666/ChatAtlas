import { useCallback, useState } from "react";

export function useNoticeDismissal() {
  const [dismissed, setDismissed] = useState<Record<string, string | undefined>>({});

  const rememberDismissal = useCallback((key: string, revision?: string) => {
    setDismissed(previous => {
      if (previous[key] === revision) return previous;
      const next = { ...previous };
      if (revision) next[key] = revision;
      else delete next[key];
      return next;
    });
    try {
      if (revision) localStorage.setItem(key, revision);
      else localStorage.removeItem(key);
    } catch { /* The in-memory dismissal still works. */ }
  }, []);

  const dismissedRevision = (key: string) => {
    if (dismissed[key]) return dismissed[key];
    try { return localStorage.getItem(key) ?? undefined; }
    catch { return undefined; }
  };

  return { dismissedRevision, rememberDismissal };
}
