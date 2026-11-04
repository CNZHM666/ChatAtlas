/** Original offsets, with complete paragraphs and fenced code kept together where possible. */
export function discussionBlocks(text: string, limit = 3200): Array<{ start: number; end: number; text: string }> {
  const blocks: Array<{ start: number; end: number; text: string }> = [];
  let start = 0, fence = "";
  const add = (end: number) => { if (end > start && text.slice(start, end).trim()) blocks.push({ start, end, text: text.slice(start, end) }); start = end; };
  for (const line of text.matchAll(/[^\n]*\n|[^\n]+$/gu)) {
    const marker = line[0].trim().match(/^(`{3,}|~{3,})/u)?.[1];
    if (marker) { if (!fence) fence = marker; else if (marker[0] === fence[0] && marker.length >= fence.length) fence = ""; }
    const end = line.index! + line[0].length;
    if (!fence && (!line[0].trim() || end - start >= limit)) add(end);
  }
  add(text.length);
  return blocks;
}

/** Safe display excerpt: never expose a half code fence or cut a quoted paragraph. */
export function discussionExcerpt(text: string, range?: { start: number; end: number }): string {
  const blocks = discussionBlocks(text);
  if (!range) return blocks.slice(0, 2).map(block => block.text).join("").trim();
  const at = blocks.findIndex(block => block.end > range.start);
  if (at < 0) return text.trim();
  const last = blocks.findIndex(block => block.end >= range.end);
  return blocks.slice(Math.max(0, at - 1), Math.min(blocks.length, Math.max(at, last) + 2)).map(block => block.text).join("").trim();
}

/** Bounded analysis fragments retain original bytes; overlapping context is labelled separately. */
export function discussionParts(text: string, limit = 3200): string[] {
  const parts: string[] = [];
  let pending = "";
  for (const block of discussionBlocks(text, limit)) {
    if (pending && pending.length + block.text.length > limit) { parts.push(pending); pending = ""; }
    if (block.text.length <= limit) { pending += block.text; continue; }
    for (let start = 0; start < block.text.length;) {
      let end = Math.min(start + limit, block.text.length);
      const newline = block.text.lastIndexOf("\n", end);
      if (end < block.text.length && newline > start + limit / 2) end = newline + 1;
      if (end < block.text.length && /[\uD800-\uDBFF]/u.test(block.text[end - 1])) end--;
      parts.push(block.text.slice(start, end)); start = end;
    }
  }
  if (pending) parts.push(pending);
  return parts;
}
