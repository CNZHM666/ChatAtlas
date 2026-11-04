/** A reading diff between two versions of a chapter, by sentence: what was removed, added or kept, in reading order.
 * Headings and list items count as one unit each, so a moved heading reads as one change. */
export interface DiffPart { kind: "same" | "removed" | "added"; text: string }

function units(text: string): string[] {
  return text.split(/\n+/u).flatMap(line => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    if (/^(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\|)/u.test(trimmed)) return [trimmed];
    return trimmed.match(/[^。！？!?]+[。！？!?]*["”」』）)]*/gu)?.map(item => item.trim()).filter(Boolean) ?? [trimmed];
  });
}
const key = (text: string) => text.normalize("NFKC").replace(/\s+|\*\*|__/gu, "");

export function sentenceDiff(before: string, after: string): DiffPart[] {
  const a = units(before), b = units(after), ak = a.map(key), bk = b.map(key);
  // Longest common subsequence over sentences; chapters hold at most a few hundred.
  const table = Array.from({ length: a.length + 1 }, () => new Uint16Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) table[i][j] = ak[i] === bk[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const parts: DiffPart[] = [];
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && ak[i] === bk[j]) { parts.push({ kind: "same", text: b[j] }); i++; j++; }
    // Removals before additions at the same place, as a code review shows them.
    else if (i < a.length && (j >= b.length || table[i + 1][j] >= table[i][j + 1])) { parts.push({ kind: "removed", text: a[i] }); i++; }
    else { parts.push({ kind: "added", text: b[j] }); j++; }
  }
  return parts;
}
