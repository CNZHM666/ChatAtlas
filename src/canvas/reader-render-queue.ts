import { startTransition } from "react";

const pending = new Set<() => void>();
let cancelScheduled: (() => void) | undefined;

function schedule() {
  if (cancelScheduled || !pending.size) return;
  const run = () => {
    cancelScheduled = undefined;
    const next = pending.values().next().value;
    if (next) {
      pending.delete(next);
      startTransition(next);
    }
    schedule();
  };
  if (typeof requestIdleCallback === "function") {
    const id = requestIdleCallback(run, { timeout: 250 });
    cancelScheduled = () => cancelIdleCallback(id);
  } else {
    const timer = setTimeout(run, 16);
    cancelScheduled = () => clearTimeout(timer);
  }
}

/** Prepare nearby Markdown without forcing a synchronous React commit while scrolling. */
export function queueReaderRender(render: () => void): () => void {
  pending.add(render);
  schedule();
  return () => {
    pending.delete(render);
    if (!pending.size) {
      cancelScheduled?.();
      cancelScheduled = undefined;
    }
  };
}
