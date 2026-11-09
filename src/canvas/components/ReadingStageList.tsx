import { Children, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Components } from "react-markdown";

const textOf = (node: ReactNode): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : "";
/** Steps written as sentences read as a numbered column; cards suit short stage names only. */
const sentenceSteps = (children: ReactNode) => Children.toArray(children).filter(isValidElement).some(item => textOf(item).trim().length > 24);

/** labelled: every stage opens on its own name ("第一阶段"), shown as the card's title beside its number. */
export function ReadingStageList({ children, start = 1, labelled = false }: ComponentPropsWithoutRef<"ol"> & { labelled?: boolean }) {
  return <div className="reading-stage-flow-frame"><ol className={`reading-stage-flow reading-flow${labelled ? " is-labelled" : sentenceSteps(children) ? " is-steps" : ""}`} start={start} style={{ counterReset: `atlas-stage ${start - 1}` }} aria-label="阶段流程 / Stage sequence">{children}</ol></div>;
}

export const readerStageList: Components["ol"] = ({ node, children, start, ...props }) => {
  const kind = /atlas-stage-flow(-labelled)?$/u.exec(String(node?.properties?.id ?? ""));
  return kind ? <ReadingStageList start={start} labelled={Boolean(kind[1])}>{children}</ReadingStageList> : <ol {...props} start={start}>{children}</ol>;
};
