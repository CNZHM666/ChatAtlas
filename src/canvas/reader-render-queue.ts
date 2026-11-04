import { flushSync } from "react-dom";

const pending = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;

/** One Markdown commit per browser task, with a paint/input opportunity between turns. */
export function queueReaderRender(render: () => void): () => void {
  pending.add(render);
  const schedule = () => {
    if (timer !== undefined || !pending.size) return;
    timer = setTimeout(() => {
      timer = undefined;
      const next = pending.values().next().value;
      if (next) { pending.delete(next); flushSync(next); }
      schedule();
    }, 16);
  };
  schedule();
  return () => {
    pending.delete(render);
    if (!pending.size && timer !== undefined) { clearTimeout(timer); timer = undefined; }
  };
}
