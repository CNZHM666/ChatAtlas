import { useMemo, useState } from "react";
import { extractComparisonProse } from "../../shared/diff-prose";
import { sentenceDiff } from "../../shared/text-diff";

/** The chapter's prose changes against its earlier version: removed sentences in red, added in green,
 * unchanged runs folded to a line, with reference examples and raw source-code fences filtered out. */
export function ChapterDiff({ before, after, zh }: { before: string; after: string; zh: boolean }) {
  const parts = useMemo(
    () => sentenceDiff(extractComparisonProse(before), extractComparisonProse(after)),
    [before, after],
  );
  const [unfolded, setUnfolded] = useState<number[]>([]);
  const removedCount = parts.filter((part) => part.kind === "removed").length;
  const addedCount = parts.filter((part) => part.kind === "added").length;
  if (!removedCount && !addedCount) {
    return <p className="chapter-diff-empty">{zh ? "正文与旧版相同" : "Same prose as the earlier version"}</p>;
  }
  const rows: Array<{ kind: "row"; index: number } | { kind: "fold"; start: number; count: number }> = [];
  for (let index = 0; index < parts.length;) {
    if (parts[index].kind !== "same") { rows.push({ kind: "row", index }); index++; continue; }
    let end = index;
    while (end < parts.length && parts[end].kind === "same") end++;
    const lead = index > 0 ? 1 : 0;
    const tail = end < parts.length ? 1 : 0;
    const hidden = end - index - lead - tail;
    if (hidden > 1 && !unfolded.includes(index)) {
      for (let at = index; at < index + lead; at++) rows.push({ kind: "row", index: at });
      rows.push({ kind: "fold", start: index, count: hidden });
      for (let at = end - tail; at < end; at++) rows.push({ kind: "row", index: at });
    } else {
      for (let at = index; at < end; at++) rows.push({ kind: "row", index: at });
    }
    index = end;
  }
  return (
    <div className="chapter-diff" role="region" aria-label={zh ? "与旧版的差异" : "Changes from the earlier version"}>
      <p className="chapter-diff-legend">
        <span className="is-removed">{zh ? "删除" : "Removed"} {removedCount}</span>
        <span className="is-added">{zh ? "新增" : "Added"} {addedCount}</span>
        <span className="chapter-diff-scope">{zh ? "仅正文" : "Prose only"}</span>
      </p>
      <ol>
        {rows.map((row) =>
          row.kind === "fold" ? (
            <li key={`fold-${row.start}`} className="is-fold">
              <button type="button" onClick={() => setUnfolded((current) => [...current, row.start])}>
                {zh ? `展开 ${row.count} 句未改动的内容` : `Show ${row.count} unchanged sentences`}
              </button>
            </li>
          ) : (
            <li key={row.index} className={`is-${parts[row.index].kind}`}>
              <span aria-hidden="true">{parts[row.index].kind === "removed" ? "−" : parts[row.index].kind === "added" ? "+" : ""}</span>
              <span className="chapter-diff-text">
                {parts[row.index].kind === "removed" ? (
                  <del>{parts[row.index].text.replace(/^#{1,6}\s+/u, "")}</del>
                ) : parts[row.index].kind === "added" ? (
                  <ins>{parts[row.index].text.replace(/^#{1,6}\s+/u, "")}</ins>
                ) : (
                  parts[row.index].text.replace(/^#{1,6}\s+/u, "")
                )}
              </span>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}
