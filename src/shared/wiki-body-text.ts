/** Edits of a chapter body at a paragraph's own place. A paragraph's text can also stand inside another paragraph
 * before it: a restored "Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded." ends
 * the feedback sentence "…, but Pocket Ledger v1 supports USD only; multi-currency …", and an edit of its first
 * occurrence changed that sentence instead, leaving "…USD only;\n\nIn version 1, … multi-currency …" in the export. */

/** Where text stands as a paragraph or a line of its own in body, else where it first stands; -1 when it is not there. */
export function paragraphIndex(body: string, text: string): number {
  if (!text) return -1;
  for (let at = body.indexOf(text); at >= 0; at = body.indexOf(text, at + 1)) {
    const end = at + text.length;
    if ((at === 0 || body[at - 1] === "\n") && (end === body.length || body[end] === "\n")) return at;
  }
  return body.indexOf(text);
}

/** body with the paragraph before replaced by after, at its own place. */
export function replaceParagraph(body: string, before: string, after: string | (() => string)): string {
  const at = paragraphIndex(body, before);
  if (at < 0) return body;
  return body.slice(0, at) + (typeof after === "function" ? after() : after) + body.slice(at + before.length);
}

/** body without the paragraph text, with the blank line before it. */
export function removeParagraph(body: string, text: string): string {
  const at = paragraphIndex(body, text);
  if (at < 0) return body;
  const start = body.slice(Math.max(0, at - 2), at) === "\n\n" ? at - 2 : at;
  return body.slice(0, start) + body.slice(at + text.length);
}

/** A table row's cells, without its outer bars. */
export const tableCells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map(cell => cell.trim());
/** text with the table rows that match taken out, while the table keeps a row; unchanged otherwise. */
export function withoutTableRows(text: string, matches: (cells: string[]) => boolean): string {
  const lines = text.split("\n"), head = lines.findIndex((line, at) => line.trim().startsWith("|") && /^\s*\|?\s*:?-{3,}/u.test(lines[at + 1] ?? ""));
  if (head < 0) return text;
  let end = head + 2;
  while (end < lines.length && lines[end].trim().startsWith("|")) end++;
  const rows = lines.slice(head + 2, end), kept = rows.filter(line => !matches(tableCells(line)));
  if (kept.length === rows.length || !kept.length) return text;
  return [...lines.slice(0, head + 2), ...kept, ...lines.slice(end)].join("\n");
}
