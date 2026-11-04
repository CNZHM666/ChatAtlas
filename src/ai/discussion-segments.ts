import { estimateTokens } from "../shared/atlas/policy.js";

/** Lossless partition: prefer paragraph/code-block boundaries, then lines.
 * Oversized individual blocks still split, with nearby context sent separately.
 */
export function splitDiscussion(text: string, tokenLimit = 5000): string[] {
  const parts: string[] = [];
  let start = 0;
  while (start < text.length) {
    let low = 1;
    let high = Math.min(text.length - start, tokenLimit * 3);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (estimateTokens(text.slice(start, start + middle)) <= tokenLimit) low = middle;
      else high = middle - 1;
    }
    let end = start + low;
    if (end < text.length) {
      const window = text.slice(start, end);
      const fences = [...window.matchAll(/^\s*(```|~~~)/gm)];
      const openFence = fences.length % 2 ? fences.at(-1)!.index! : -1;
      const paragraph = window.lastIndexOf("\n\n");
      const line = window.lastIndexOf("\n");
      const boundary = openFence > window.length / 3 ? openFence : paragraph > window.length / 2 ? paragraph + 2 : line > window.length / 2 ? line + 1 : low;
      end = start + boundary;
      // Do not split a surrogate pair at the hard fallback boundary.
      if (end > start && /[\uD800-\uDBFF]/u.test(text[end - 1])) end--;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
}
