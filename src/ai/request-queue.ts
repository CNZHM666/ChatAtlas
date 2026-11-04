import { MAX_CONCURRENCY, providerConcurrencyCeiling } from "./model-routing";

type Entry = { priority: number; queuedAt: number; start: () => void; cancel: () => void };
const MAX_ACTIVE = 6;
/** Shared per service origin within this extension page, across AI instances and embeddings. */
export class ProviderQueue {
  /** maxActive: hosts known to accept many parallel requests ramp further than an unknown gateway. */
  constructor(private readonly maxActive = MAX_ACTIVE) {}
  private active = 0;
  private queue: Entry[] = [];
  private limitedUntil = 0;
  private reducedUntil = 0;
  private successes = 0;
  private timer?: ReturnType<typeof setTimeout>;
  async acquire(signal?: AbortSignal, priority = 1): Promise<() => void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const cleanup = () => { signal?.removeEventListener("abort", abort); clearTimeout(deadline); };
      const entry: Entry = { priority, queuedAt: Date.now(), start: () => {
        cleanup(); this.active++;
        let released = false;
        resolve(() => { if (!released) { released = true; this.active--; this.drain(); } });
      }, cancel: () => { this.queue = this.queue.filter(item => item !== entry); cleanup(); reject(signal?.reason ?? new DOMException("Request queue expired", "TimeoutError")); this.drain(); } };
      const abort = () => entry.cancel();
      const deadline = setTimeout(() => entry.cancel(), 180_000);
      signal?.addEventListener("abort", abort, { once: true });
      this.queue.push(entry); if (signal?.aborted) abort(); else this.drain();
    });
  }
  succeeded() { if(Date.now()>=this.reducedUntil)this.successes++;this.drain(); }
  rateLimited(delay = 1000) { this.successes=0;this.limitedUntil = Math.max(this.limitedUntil, Date.now() + Math.min(30_000, Math.max(1000, delay))); this.reducedUntil = Date.now() + 60_000; this.drain(); }
  private drain() {
    clearTimeout(this.timer);
    const remaining = this.limitedUntil - Date.now();
    if (remaining > 0) { if (this.queue.length) this.timer = setTimeout(() => this.drain(), remaining); return; }
    // Start at two; every three successes allow one more, up to the host's limit.
    // Any rate limit drops to one request for a minute and restarts the ramp.
    while (this.active < (Date.now() < this.reducedUntil ? 1 : Math.min(this.maxActive, 2 + Math.floor(this.successes / 3))) && this.queue.length) {
      // Aging prevents background work from starving during repeated queries.
      const weight = (entry: Entry) => entry.priority + Math.floor((Date.now() - entry.queuedAt) / 30_000);
      this.queue.sort((a, b) => weight(b) - weight(a) || a.queuedAt - b.queuedAt);
      this.queue.shift()!.start();
    }
  }
}
const queues = new Map<string, ProviderQueue>();
export function providerQueue(url: string): ProviderQueue {
  const origin = new URL(url).origin;
  let queue = queues.get(origin);
  // Writing 15 chapters at six slots left each request queued 13-34 s on a high-limit host.
  if (!queue) { queue = new ProviderQueue(providerConcurrencyCeiling(url) >= MAX_CONCURRENCY ? MAX_CONCURRENCY : MAX_ACTIVE); queues.set(origin, queue); }
  return queue;
}
