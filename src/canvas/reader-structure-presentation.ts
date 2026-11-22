import { createElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import type { Paragraph, PhrasingContent, Root, RootContent } from "mdast";
import { WIKI_FLOW_CLAIM_MARKER, wikiFlowParagraph, wikiFlowProposal, wikiFlowSourceQuote } from "../shared/wiki-flow-block";
import { WIKI_CLAIM_MARKER, type WikiClaimMarkerPoint } from "../shared/wiki-claim-markers";
import { wikiSupplementRanges } from "../shared/wiki-source-supplements";
import { wikiEvidenceHref, wikiEvidenceTarget } from "../shared/wiki-evidence-link";
import type { FocusEvidence } from "../shared/focus-session";
import { wikiFlowSteps } from "../shared/wiki-flow-steps";

/** Presentation only, on the rendered tree: the saved text is unchanged and every character stays, so copying, claim
 * highlights and markers still find it.
 * - A run of three or more short steps joined by arrows ("找到相关消息 -> 用户确认 -> 生成上下文 -> 插入当前 AI") reads
 *   as a strip of steps.
 * - A long paragraph with no emphasis of its own leads with its first sentence, set apart, so it can be skimmed. */
const STEP = String.raw`(?:[^，,。；;：:（）()「」『』“”\n→>=—-]|-(?!>)|=(?!>)|—(?!>))+`;
const FLOW = new RegExp(`${STEP}(?:\\s*(?:→|->|—>|=>)\\s*${STEP}){2,}`, "gu");
/** A paragraph this long is skimmed by its first sentence. */

const emphasis = (hName: string, children: PhrasingContent[]): PhrasingContent => ({ type: "emphasis", data: { hName }, children } as PhrasingContent);
const text = (value: string): PhrasingContent => ({ type: "text", value });

/** The text with each arrow run as a strip: steps and the arrows between them, as they were written. */
function withFlows(value: string): PhrasingContent[] | undefined {
  // A chain embedded in an explanatory sentence stays ordinary prose.
  if (/[「」“”『』…]|\.{3}|范围有分歧|版本未定/u.test(value)) return;
  if (/\[|[（(【]/u.test(value)) {
    const { steps, arrows } = wikiFlowSteps(value);
    return arrows.length ? steps.flatMap((step, index) => [text(step), ...(arrows[index] ? [emphasis("atlas-flow-arrow", [text(arrows[index])])] : [])]) : undefined;
  }
  if (/[，,。；;!?！？]/u.test(value.trim().replace(/[。.!?！？]$/u, ""))) {
    const parts:PhrasingContent[]=[];let last=0;
    for(const match of value.matchAll(/->|=>|—>|→/gu)){
      if(match.index!>last)parts.push(text(value.slice(last,match.index)));
      parts.push(emphasis("atlas-flow-arrow",[text(match[0])]));last=match.index!+match[0].length;
    }
    if(!parts.length)return;
    if(last<value.length)parts.push(text(value.slice(last)));
    return parts;
  }
  const result: PhrasingContent[] = [];
  let last = 0;
  for (const match of value.matchAll(FLOW)) {
    let run = match[0].trim(), start = match.index! + match[0].indexOf(run);
    const intro=/^(?:.{0,18}?(?:流程|路径|主链|顺序|链路)(?:首选|优先|为|是)?\s*[:：]?\s*|(?:deployment\s+)?(?:path|workflow|pipeline)\s+(?:is\s+)?)/iu.exec(run)?.[0];
    if(intro){start+=intro.length;run=run.slice(intro.length);}
    const { steps, arrows } = wikiFlowSteps(run);
    // Match entire clauses first. A bounded regex used to cut identifiers in half ("Vali" + "dator").
    if (steps.length < 3 || steps.some(step => !step.trim() || step.trim().length > 60)) continue;
    if (start > last) result.push(text(value.slice(last, start)));
    result.push(emphasis("atlas-flow", steps.flatMap((step, index) => [emphasis("atlas-flow-step", [text(step)]), ...(arrows[index] ? [emphasis("atlas-flow-arrow", [text(arrows[index])])] : [])])));
    last = start + run.length;
  }
  if (!result.length) return undefined;
  if (last < value.length) result.push(text(value.slice(last)));
  return result;
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

export function readerStructurePresentation({ cards = false, zh = true, flowSources, claimMarkers }: { cards?: boolean; zh?: boolean; flowSources?: readonly FocusEvidence[]; claimMarkers?: readonly WikiClaimMarkerPoint[] } = {}) {
  return (tree: Root, file: { value: unknown }) => {
    if (cards) {
      const supplements = wikiSupplementRanges(String(file.value ?? ""));
      const approximate = new Set(claimMarkers?.filter(point => point.approximate).map(point => WIKI_CLAIM_MARKER + encodeURIComponent(point.key)));
      const available = flowSources && new Set(flowSources.map(ref => ref.id));
      tree.children = tree.children.map(node => {
        const start = node.position?.start.offset;
        if (node.type !== "paragraph" || start === undefined || supplements.some(([from, to]) => start >= from && start < to)) return node;
        const match = wikiFlowParagraph(node, zh);
        if (!match) return node;
        const { flow, links } = match;
        const sources: PhrasingContent[] = [];
        const hasFullSequence = wikiFlowSourceQuote(flow.steps);
        const fullSources = flowSources?.filter(ref => hasFullSequence(ref.excerpt)) ?? [];
        const directSource = fullSources.find(ref => links.some(link => link.type === "link" && wikiEvidenceTarget(link.url)?.id === ref.id))
          ?? (new Set(fullSources.map(ref => JSON.stringify([ref.conversationId,ref.messageId]))).size === 1 ? fullSources[0] : undefined);
        if (directSource) sources.push({ type: "link", url: wikiEvidenceHref(directSource), children: [text(zh ? "来源" : "Source")] });
        for (const link of directSource ? [] : links) {
          if (link.type === "link") {
            const direct = wikiEvidenceTarget(link.url);
            if (approximate.has(link.url) || direct && available && !available.has(direct.id)) continue;
            if (link.url.startsWith(WIKI_CLAIM_MARKER)) {
              sources.push({ ...link, url: WIKI_FLOW_CLAIM_MARKER + link.url.slice(WIKI_CLAIM_MARKER.length) });
              continue;
            }
          }
          sources.push(link);
        }
        return { type: "blockquote", data: { hName: "atlas-wiki-flow" }, children: [
          { type: "paragraph", children: [{ type: "strong", children: [text(flow.title)] }, ...(flow.status && !wikiFlowProposal(flow.status) ? [{ type: "emphasis" as const, children: [text(flow.status.slice(1, -1))] }] : [])] },
          { type: "paragraph", children: sources.length || !flowSources ? sources : [text(zh ? "来源待核对" : "Source unverified")] },
          { type: "list", ordered: true, children: flow.steps.map(step => ({ type: "listItem", children: [{ type: "paragraph", children: [text(step)] }] })) },
        ] };
      });
    }
    const visit = (node: RootContent | Root) => {
      if (node.type === "code" || node.type === "inlineCode" || node.type === "link" || node.type === "table" || node.type === "blockquote") return;
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
        visit(child);
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
