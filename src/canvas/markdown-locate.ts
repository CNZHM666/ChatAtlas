/** Characters Markdown adds around the words a reader sees: skipped when the rendered text is looked for in the source. */
const MARKUP = /[*_`~#>|[\]]/u;

/** Where rendered text ("首版不做书签") sits in a chapter's Markdown ("**首版**不做书签"): its start and end in the
 * source, or undefined. Markup and runs of spaces are ignored on both sides; a sentence the editor cannot find whole is
 * looked for by its opening words, so a reworded ending still lands on it. from: where to start looking; past the
 * last match it starts over from the top unless wrap is false. */
export function locateInMarkdown(body: string, text: string, from = 0, wrap = true): [number, number] | undefined {
  const plain: string[] = [], at: number[] = [];
  for (let index = 0; index < body.length; index++) {
    const char = body[index];
    if (MARKUP.test(char)) continue;
    if (/\s/u.test(char)) { if (plain.length && plain[plain.length - 1] !== " ") { plain.push(" "); at.push(index); } continue; }
    plain.push(char.toLocaleLowerCase()); at.push(index);
  }
  const haystack = plain.join("");
  const wanted = text.replace(new RegExp(MARKUP.source, "gu"), "").replace(/\s+/gu, " ").trim().toLocaleLowerCase().replace(/[。.！!？?；;，,]+$/u, "");
  if (!wanted) return undefined;
  const start = at.findIndex(position => position >= from), offset = start < 0 ? haystack.length : start;
  for (const length of [wanted.length, 40, 24, 14, 8]) {
    if (length > wanted.length) continue;
    const piece = wanted.slice(0, length);
    const found = haystack.indexOf(piece, offset);
    const index = found >= 0 ? found : from > 0 && wrap ? haystack.indexOf(piece) : -1;
    if (index >= 0) return [at[index], at[index + piece.length - 1] + 1];
  }
  return undefined;
}
