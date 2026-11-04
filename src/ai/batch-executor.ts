import type { AtlasAIProvider } from "./provider";
import { MAX_CONCURRENCY } from "./model-routing";

/** Bound in-flight work, preserve result order, and drain started work on failure.
 * Successful batches can checkpoint before a sibling fails; no new work is then
 * scheduled. The limit is re-read so rate limiting can reduce it to one; the
 * provider's adaptive level, not a fixed local constant, sets the width.
 */
export async function executeBatches<T, R>(items: T[], provider: Pick<AtlasAIProvider, "capabilities"> | undefined, work: (item: T, index: number) => Promise<R>, signal?: AbortSignal): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const limit = () => {
    const value = provider?.capabilities?.maxConcurrency ?? 1;
    return Number.isFinite(value) ? Math.max(1, Math.min(MAX_CONCURRENCY, Math.floor(value))) : 1;
  };
  // Refill from the current limit after every completion. A temporary rate
  // reduction must not permanently retire workers for the rest of a long job.
  await new Promise<void>(resolve=>{
    let active=0;
    const pump=()=>{
      while(!failed&&next<items.length&&active<limit()){
        const index=next++;active++;
        Promise.resolve().then(()=>{signal?.throwIfAborted();return work(items[index],index);}).then(result=>{results[index]=result;},error=>{if(!failed){failed=true;failure=error;}}).finally(()=>{active--;pump();});
      }
      if(active===0&&(failed||next===items.length))resolve();
    };
    pump();
  });
  if (failed) throw failure;
  signal?.throwIfAborted();
  return results;
}
