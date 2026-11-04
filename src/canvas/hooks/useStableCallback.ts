import { useCallback, useLayoutEffect, useRef } from "react";

/** Stable event identity lets memoized lists skip progress updates, while using current state. */
export function useStableCallback<Args extends unknown[], Result>(callback: (...args: Args) => Result): (...args: Args) => Result {
  const latest = useRef(callback);
  useLayoutEffect(() => { latest.current = callback; });
  return useCallback((...args: Args) => latest.current(...args), []);
}
