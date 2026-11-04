import type { ComponentPropsWithoutRef } from "react";
import type { Components } from "react-markdown";

/** labelled: every stage opens on its own name ("第一阶段"), shown as the card's title beside its number. */
export function ReadingStageList({ children, start = 1, labelled = false }: ComponentPropsWithoutRef<"ol"> & { labelled?: boolean }) {
  return <div className="reading-stage-flow-frame"><ol className={`reading-stage-flow reading-flow${labelled ? " is-labelled" : ""}`} start={start} style={{ counterReset: `atlas-stage ${start - 1}` }} aria-label="阶段流程 / Stage sequence">{children}</ol></div>;
}

export const readerStageList: Components["ol"] = ({ node, children, start, ...props }) => {
  const kind = /atlas-stage-flow(-labelled)?$/u.exec(String(node?.properties?.id ?? ""));
  return kind ? <ReadingStageList start={start} labelled={Boolean(kind[1])}>{children}</ReadingStageList> : <ol {...props} start={start}>{children}</ol>;
};
