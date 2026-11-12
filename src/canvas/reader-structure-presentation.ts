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

/** Whose a block is, as its caption's last words say it (wiki-source-code readableSourceCaptions). */
const WHOSE: Array<[RegExp, string]> = [[/^(?:AI\s*建议|AI suggestion)$/u, "atlas-caption-ai"], [/^(?:你确认|你提供|confirmed by you|provided by you)$/u, "atlas-caption-mine"], [/^(?:早期方案，已被替换|earlier version, since replaced)$/u, "atlas-caption-old"]];
/** What a block is, as wiki-source-code blockKind names it. */
const BLOCK_KIND = /^(?:对照表|命令|数据结构|代码示例|代码|界面草图|规则逻辑|事件清单|目录结构|提示词|计算规则|示例数据|界面文案|流程|对照|清单|Table|Commands|Data structure|Code example|Code|UI sketch|Rules|Event list|File layout|Prompt|Scoring|Sample data|UI copy|Flow|Mapping|List)$/u;
const LATER = /^(?:以你后来的决定为准：|your later decision holds: )/u;
/** A caption line over a block ("界面草图 · 首页布局引导 · AI 建议"): what the block is, its section, and whose it is as a tag;
 * a later decision that holds over it follows as a note. Other emphasis is left alone. */
function blockCaption(paragraph: Paragraph, next: RootContent | undefined): PhrasingContent[] | undefined {
  if (!next || next.type !== "code" && next.type !== "table" || paragraph.children.length !== 1) return undefined;
  const only = paragraph.children[0];
  if (only.type !== "emphasis") return undefined;
  // Read as plain words: the chapter view links a section name it holds ("AI Agent逻辑"), and the caption went unread,
  // shown as a line of italics between the text and the block.
  const plain = (node: PhrasingContent): string => "value" in node ? node.value : "children" in node ? (node.children as PhrasingContent[]).map(plain).join("") : "";
  const parts = plain(only).split(/\s*·\s*/u);
  const at = parts.findIndex((part, index) => index > 0 && WHOSE.some(([pattern]) => pattern.test(part)));
  // Saved now as the kind alone ("流程"), or the kind and a later decision; before, with a section and a holder.
  const rest = parts.slice(at > 0 ? at + 1 : 1);
  if (at < 1 && !(BLOCK_KIND.test(parts[0]) && rest.every(part => LATER.test(part)))) return undefined;
  const tag = at > 0 ? WHOSE.find(([pattern]) => pattern.test(parts[at]))![1] : "atlas-caption-ai", note = rest.join(" · ");
  // The bar names only what the block is: its section is the heading the reader is under, and most blocks are AI's,
  // so the tag shows only when it says something (you confirmed it, or it was replaced).
  return [emphasis("atlas-caption", [emphasis("atlas-caption-kind", [text(parts[0])]), ...(tag === "atlas-caption-ai" ? [] : [emphasis(tag, [text(parts[at])])]), ...(note ? [emphasis("atlas-caption-note", [text(note)])] : [])])];
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
        const caption = child.type === "paragraph" ? blockCaption(child, children[index + 1]) : undefined;
        if (caption) { (child as Paragraph).children = caption; continue; }
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
  "atlas-caption": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption" }, children),
  "atlas-caption-kind": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-kind" }, children),
  "atlas-caption-place": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-place" }, children),
  "atlas-caption-ai": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-whose is-ai" }, children),
  "atlas-caption-mine": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-whose is-mine" }, children),
  "atlas-caption-old": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-whose is-old" }, children),
  "atlas-caption-note": ({ children }: { children?: ReactNode }) => createElement("span", { className: "wiki-block-caption-note" }, children),
} as unknown as Components;
