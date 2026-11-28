import { Children, cloneElement, isValidElement, type ComponentPropsWithoutRef, type ReactNode } from "react";
import type { Components } from "react-markdown";

const textOf = (node: ReactNode): string => typeof node === "string" || typeof node === "number" ? String(node) : Array.isArray(node) ? node.map(textOf).join("") : isValidElement(node) ? textOf((node.props as { children?: ReactNode }).children) : "";
/** Steps written as sentences read as a numbered column; cards suit short stage names only. */
const sentenceSteps = (children: ReactNode) => Children.toArray(children).filter(isValidElement).some(item => textOf(item).trim().length > 24);

type StageStatus = "current" | "deferred" | "done";
const STAGE_TAG: Array<{ status: StageStatus; re: RegExp }> = [
  { status: "current", re: /^\s*(?:【当前】|\[当前\]|\(当前\)|【Current】|\[Current\])/iu },
  { status: "deferred", re: /^\s*(?:【(?:延后|暂缓|后续)】|\[(?:延后|暂缓|Deferred|Later)\])/iu },
  { status: "done", re: /^\s*(?:【已完成】|\[(?:已完成|Done)\])/iu },
];

const stageStatusOf = (text: string): StageStatus | undefined =>
  STAGE_TAG.find(({ re }) => re.test(text))?.status;

const stripStatusTag = (node: ReactNode): ReactNode => {
  if (typeof node === "string") {
    for (const { re } of STAGE_TAG) if (re.test(node)) return node.replace(re, "").trimStart();
    return node;
  }
  if (Array.isArray(node)) {
    let stripped = false;
    return node.map(child => {
      if (stripped) return child;
      const next = stripStatusTag(child);
      if (next !== child) stripped = true;
      return next;
    });
  }
  if (isValidElement<{ children?: ReactNode }>(node)) {
    const next = stripStatusTag(node.props.children);
    return next === node.props.children ? node : cloneElement(node, undefined, next);
  }
  return node;
};

/** labelled: every stage opens on its own name ("第一阶段"), shown as the card's title beside its number. */
export function ReadingStageList({ children, start = 1, labelled = false }: ComponentPropsWithoutRef<"ol"> & { labelled?: boolean }) {
  const enhanced = Children.map(children, child => {
    if (!isValidElement<{ children?: ReactNode; "data-stage-status"?: StageStatus }>(child) || child.type !== "li") return child;
    const status = stageStatusOf(textOf(child));
    if (!status) return child;
    return cloneElement(child, { "data-stage-status": status }, stripStatusTag(child.props.children));
  });
  return <div className="reading-stage-flow-frame"><ol className={`reading-stage-flow reading-flow${labelled ? " is-labelled" : sentenceSteps(children) ? " is-steps" : " is-compact"}`} start={start} style={{ counterReset: `atlas-stage ${start - 1}` }} aria-label="阶段流程 / Stage sequence">{enhanced}</ol></div>;
}

export const readerStageList: Components["ol"] = ({ node, children, start, ...props }) => {
  const kind = /atlas-stage-flow(-labelled)?$/u.exec(String(node?.properties?.id ?? ""));
  return kind ? <ReadingStageList start={start} labelled={Boolean(kind[1])}>{children}</ReadingStageList> : <ol {...props} start={start}>{children}</ol>;
};
