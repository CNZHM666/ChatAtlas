import { createElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import type { Paragraph, PhrasingContent, Root, RootContent } from "mdast";

/** Presentation only, on the rendered tree: the saved text is unchanged and every character stays, so copying, claim
 * highlights and markers still find it.
 * - A run of three or more short steps joined by arrows ("找到相关消息 -> 用户确认 -> 生成上下文 -> 插入当前 AI") reads
 *   as a strip of steps.
 * - A long paragraph with no emphasis of its own leads with its first sentence, set apart, so it can be skimmed. */
const ARROW = /\s*(?:→|->|—>|=>)\s*/u;
const STEP = String.raw`(?:[^，,。；;：:（）()「」『』“”\n→>=—-]|-(?!>)|=(?!>)|—(?!>)){1,18}`;
const FLOW = new RegExp(`${STEP}(?:\\s*(?:→|->|—>|=>)\\s*${STEP}){2,}`, "gu");
/** A paragraph this long is skimmed by its first sentence. */
const LEAD_LENGTH = 150, LEAD_MAX = 80;

const emphasis = (hName: string, children: PhrasingContent[]): PhrasingContent => ({ type: "emphasis", data: { hName }, children } as PhrasingContent);
const text = (value: string): PhrasingContent => ({ type: "text", value });

/** The text with each arrow run as a strip: steps and the arrows between them, as they were written. */
function withFlows(value: string): PhrasingContent[] | undefined {
  const result: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(FLOW)) {
    const run = match[0].trim(), start = match.index! + match[0].indexOf(run), steps = run.split(ARROW), arrows = run.match(new RegExp(ARROW.source, "gu")) ?? [];
    if (steps.length < 3 || steps.some(step => !step.trim())) continue;
    if (start > last) result.push(text(value.slice(last, start)));
    result.push(emphasis("atlas-flow", steps.flatMap((step, index) => [emphasis("atlas-flow-step", [text(step)]), ...(arrows[index] ? [emphasis("atlas-flow-arrow", [text(arrows[index])])] : [])])));
    last = start + run.length;
  }
  if (!result.length) return undefined;
  if (last < value.length) result.push(text(value.slice(last)));
  return result;
}

const plain = (node: RootContent): string => "value" in node && typeof node.value === "string" ? node.value : "children" in node ? (node.children as RootContent[]).map(plain).join("") : "";

function leadSentence(paragraph: Paragraph) {
  const first = paragraph.children[0];
  if (first?.type !== "text" || plain(paragraph).length < LEAD_LENGTH || paragraph.children.some(child => child.type === "strong")) return;
  const end = first.value.search(/[。！？!?]/u);
  if (end < 8 || end + 1 > LEAD_MAX) return;
  paragraph.children.splice(0, 1, emphasis("atlas-lead", [text(first.value.slice(0, end + 1))]), ...(first.value.slice(end + 1) ? [text(first.value.slice(end + 1))] : []));
}

export function readerStructurePresentation() {
  return (tree: Root) => {
    const visit = (node: RootContent | Root, inList = false) => {
      if (node.type === "code" || node.type === "inlineCode" || node.type === "link" || node.type === "table") return;
      if (node.type === "paragraph" && !inList) leadSentence(node);
      if (!("children" in node)) return;
      const children = node.children as RootContent[];
      for (let index = 0; index < children.length; index++) {
        const child = children[index];
        if (child.type === "text") {
          const parts = withFlows(child.value);
          if (parts) { children.splice(index, 1, ...(parts as RootContent[])); index += parts.length - 1; }
          continue;
        }
        visit(child, inList || node.type === "listItem");
      }
    };
    visit(tree);
  };
}

/** The presentation tags as styled spans; the sanitizer passes them through with no attributes. */
export const readerStructureComponents = {
  "atlas-flow": ({ children }: { children?: ReactNode }) => createElement("span", { className: "reading-inline-flow" }, children),
  "atlas-flow-step": ({ children }: { children?: ReactNode }) => createElement("span", { className: "reading-inline-flow-step" }, children),
  "atlas-flow-arrow": ({ children }: { children?: ReactNode }) => createElement("span", { className: "reading-inline-flow-arrow" }, children),
  "atlas-lead": ({ children }: { children?: ReactNode }) => createElement("span", { className: "reading-lead" }, children),
} as unknown as Components;
