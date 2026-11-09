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
