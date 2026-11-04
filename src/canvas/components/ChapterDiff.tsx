import { useMemo, useState } from "react";
import { sentenceDiff } from "../../shared/text-diff";

/** The chapter's changes against its earlier version, like a code review: removed sentences in red, added in green,
 * unchanged runs folded to a line so the changes stand out. */
export function ChapterDiff({ before, after, zh }: { before: string; after: string; zh: boolean }) {
  const parts = useMemo(() => sentenceDiff(before, after), [before, after]);
  const [unfolded, setUnfolded] = useState<number[]>([]);
  const changed = parts.filter(part => part.kind !== "same").length;
  if (!changed) return <p className="chapter-diff-empty">{zh ? "正文与旧版相同" : "Same as the earlier version"}</p>;
  const rows: Array<{ kind: "row"; index: number } | { kind: "fold"; start: number; count: number }> = [];
  // Keep one unchanged sentence of context on each side of a change; longer unchanged runs fold.
  for (let index = 0; index < parts.length;) {
    if (parts[index].kind !== "same") { rows.push({ kind: "row", index }); index++; continue; }
    let end = index; while (end < parts.length && parts[end].kind === "same") end++;
    const lead = index > 0 ? 1 : 0, tail = end < parts.length ? 1 : 0, hidden = end - index - lead - tail;
    if (hidden > 1 && !unfolded.includes(index)) {
      for (let at = index; at < index + lead; at++) rows.push({ kind: "row", index: at });
      rows.push({ kind: "fold", start: index, count: hidden });
      for (let at = end - tail; at < end; at++) rows.push({ kind: "row", index: at });
    } else for (let at = index; at < end; at++) rows.push({ kind: "row", index: at });
    index = end;
  }
  return <div className="chapter-diff" role="region" aria-label={zh ? "与旧版的差异" : "Changes from the earlier version"}>
    <p className="chapter-diff-legend"><span className="is-removed">{zh ? "删除" : "Removed"} {parts.filter(part => part.kind === "removed").length}</span><span className="is-added">{zh ? "新增" : "Added"} {parts.filter(part => part.kind === "added").length}</span></p>
    <ol>{rows.map(row => row.kind === "fold"
      ? <li key={`fold-${row.start}`} className="is-fold"><button type="button" onClick={() => setUnfolded(current => [...current, row.start])}>{zh ? `展开 ${row.count} 句未改动的内容` : `Show ${row.count} unchanged sentences`}</button></li>
      : <li key={row.index} className={`is-${parts[row.index].kind}`}><span aria-hidden="true">{parts[row.index].kind === "removed" ? "−" : parts[row.index].kind === "added" ? "+" : ""}</span><span className="chapter-diff-text">{parts[row.index].kind === "removed" ? <del>{parts[row.index].text}</del> : parts[row.index].kind === "added" ? <ins>{parts[row.index].text}</ins> : parts[row.index].text}</span></li>)}</ol>
  </div>;
}
