import { MAX_CONCURRENCY } from "./model-routing";

/** One shared allowance for reading and early directory work. Re-read the
 * provider limit after each completion so rate limiting can lower concurrency. */
export function createRequestQueue(limit: () => number, signal: AbortSignal) {
  const pending: Array<() => void> = [];
  let active = 0;
  const pump = () => {
    while (pending.length && active < Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(limit() || 1)))) pending.shift()!();
  };
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        pending.push(() => {
          active++;
          Promise.resolve().then(() => { signal.throwIfAborted(); return work(); })
            .then(resolve, reject).finally(() => { active--; pump(); });
        });
        pump();
      });
    },
  };
}
