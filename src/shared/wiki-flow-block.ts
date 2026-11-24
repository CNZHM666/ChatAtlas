import type { Paragraph, PhrasingContent } from "mdast";
import { WIKI_CLAIM_MARKER } from "./wiki-claim-markers";
import { wikiEvidenceTarget } from "./wiki-evidence-link";
import { wikiLiteralText } from "./wiki-plain-block";
import { wikiDocumentBlocks } from "./wiki-document-blocks";
import { wikiSupplementRanges } from "./wiki-source-supplements";
import { WIKI_FLOW_ARROW as ARROW, wikiFlowSteps } from "./wiki-flow-steps";

const TITLE = /^([^:：\n。；！？]{0,65}(?:流程|旅程|链路|路径|步骤|顺序|workflow|flow|journey|pipeline|process|sequence))\s*[：:]\s*/iu;
const GENERIC_TITLE = /^(?:(?:参考|示例|处理|执行|主要|整体)?(?:流程|旅程|链路|路径|步骤|顺序)|(?:(?:reference|example|main|overall)\s+)?(?:workflow|flow|journey|pipeline|process|sequence))$/iu;
const OBSERVATION = /浏览量|点击量|访问量|留存率|转化率|复用率|成功率|\b(?:views|clicks|stars|retention|conversion rate)\s*$/iu;
const DEPENDENT_END = /^(?:你的?|我的?|它的?|其|该|是否|有没有|能否|\b(?:your|my|its|their|whether)\b)/iu;
const STATUS = /\s*(〔(?:建议(?:／分析)?|AI 建议|已定|未定|此前|资料|发起人|你)(?: · [^〕\n]+)?〕|\[(?:Proposal|AI suggestion|Decided|Open|Earlier|Material|Project author|You)\]|[（(]AI\s*建议[，,]\s*未确认(?:\s*·\s*[^）)\n]+)?[）)])\s*$/iu;
const LOCATOR = /\[(?:S-\d+-[a-z0-9]+|来源\d+|Source \d+|〔已确认\d+〕|Confirmed \d+)\](?:\(#[^)]+\))?|〔(?:用户|(?:项目)?发起人)在整理时(?:确认|标记为已定) · C-\d+-[a-z0-9]+〕|\[User (?:confirmed|marked as decided) during organization · C-\d+-[a-z0-9]+\]/giu;

export interface WikiFlowBlock { title: string; steps: string[]; status?: string; references: string }

/** Promote only self-contained sequences. A labelled flow can have three
 * steps; an unlabelled chain needs explicit standing and at least four steps. */
export function wikiFlowBlock(value: string, zh: boolean): WikiFlowBlock | undefined {
  if (!ARROW.test(value) || value.length > 620 || /\n|<[^>]+>/u.test(value)) return;
  if ([...value.matchAll(/`[^`\n]+`/gu)].some(match => ARROW.test(match[0]))) return;
  const refs = [...value.matchAll(LOCATOR)];
  const firstRef = refs[0]?.index ?? value.length;
  const references = value.slice(firstRef).trim();
  if (references.replace(LOCATOR, "").trim()) return;
  const plain = value.slice(0, firstRef).replace(/\*\*|__/gu, "").replace(/`([^`\n]+)`/gu, "$1").trim();
  const status = STATUS.exec(plain);
  const body = (status ? plain.slice(0, status.index) : plain).trim();
  const title = TITLE.exec(body);
  if (!title && !status) return;
  const steps = wikiFlowSteps(body.slice(title?.[0].length ?? 0).replace(/[。.]$/u, "")).steps.map(step => step.trim());
  if (steps.length < (title ? 3 : 4) || steps.length > 12 ||
    steps.some(step => !step || step.length > 48 || /[。；;！？!?「」“”\]|]/u.test(step) || step.includes("[")) ||
    /^(?:例如|比如|若|如果|当|从|for example|if |when )/iu.test(body)) return;
  const label = title?.[1].trim();
  if (steps.filter(step => OBSERVATION.test(step)).length >= 2 && (!label || GENERIC_TITLE.test(label) || /指标|metrics?/iu.test(label))) return;
  const first = steps[0], last = steps[steps.length - 1];
  const meaningful = label && !GENERIC_TITLE.test(label);
  if (!meaningful && [first, last].some(step => step.length > 26 || DEPENDENT_END.test(step))) return;
  const standing = status?.[1].replace(/^[（(]AI\s*建议[，,]\s*未确认(?:\s*·\s*([^）)]+))?[）)]$/iu,
    (_text, scope: string | undefined) => "〔建议" + (scope ? " · " + scope.trim() : "") + "〕");
  return { title: meaningful ? label : zh
    ? `从${/^[a-z\d]/iu.test(first) ? " " : ""}${first}${/[a-z\d]$/iu.test(first) ? " " : ""}到${/^[a-z\d]/iu.test(last) ? " " : ""}${last}`
    : `${first} to ${last}`,
    steps, status: standing, references };
}

export const wikiFlowProposal = (status?: string) => Boolean(status && /^(?:〔(?:建议(?:／分析)?|AI 建议)(?: · [^〕]+)?〕|\[(?:Proposal|AI suggestion)\])$/iu.test(status));

/** Match the complete ordered sequence in one source. Shared step names alone
 * cannot establish a source, even if they occur in the same chapter. */
export function wikiFlowSourceQuote(steps: readonly string[]) {
  const escape = (word: string) => word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const markup = "(?:\\*\\*|__|`)?";
  const terminalVersion = steps.at(-1)?.match(/^(.+?)\s*[(（](v\d+(?:\.\d+)*)[）)]$/iu);
  const labels = steps.map((step, index) => {
    const version = index === steps.length - 1 ? terminalVersion : undefined;
    const label = (version?.[1] ?? step).split(/\s+/u).map(escape).join("\\s*");
    // A trailing Wiki version annotation can be absent from the source's node.
    // If the source itself gives a version, it must agree.
    const suffix = version ? `(?:\\s*[(（]\\s*${escape(version[2])}\\s*[）)]|(?!\\s*[(（]\\s*v\\d))` : "";
    return `${markup}${label}${suffix}${markup}`;
  });
  const sequence = new RegExp(labels.join(ARROW.source), "giu");
  return (excerpt: string) => {
    if (steps.length < 3 || !ARROW.test(excerpt)) return;
    for (const match of excerpt.matchAll(sequence)) {
      const before = excerpt.slice(0, match.index), rest = excerpt.slice(match.index + match[0].length);
      const trailing = terminalVersion && rest.match(/^\s*[(（]\s*(v\d+(?:\.\d+)*)\s*[）)]/iu);
      if (trailing && trailing[1].toLowerCase() !== terminalVersion?.[2].toLowerCase()) continue;
      const after = trailing ? rest.slice(trailing[0].length) : rest;
      if (!ARROW.test(before.trimEnd().slice(-2)) && !ARROW.test(after.trimStart().slice(0, 2))
        && !/[\p{L}\p{N}]$/u.test(before) && !/^[\p{L}\p{N}]/u.test(after)) return match[0] + (trailing?.[0] ?? "");
    }
  };
}

export function wikiFlowMarkdown(flow: WikiFlowBlock) {
  const heading = [`**${wikiLiteralText(flow.title)}**`, flow.status, flow.references].filter(Boolean).join(" ");
  return heading + "\n\n" + flow.steps.map(wikiLiteralText).join(" → ");
}

export function wikiChapterFlowBlocks(body: string, zh: boolean) {
  if (!ARROW.test(body)) return [];
  const supplements = wikiSupplementRanges(body);
  return wikiDocumentBlocks(body).flatMap(block => {
    if (block.kind !== "paragraph" || supplements.some(([start, end]) => block.start >= start && block.start < end)) return [];
    const flow = wikiFlowBlock(block.text, zh);
    return flow ? [{ start: block.start, end: block.end, flow }] : [];
  });
}

export const WIKI_FLOW_CLAIM_MARKER = "#atlas-flow-claim-";
const citation = (part: PhrasingContent) => part.type === "linkReference" && /^S-\d+-[a-z0-9]+$/iu.test(part.label ?? "")
  || part.type === "link" && (part.url.startsWith(WIKI_CLAIM_MARKER) || Boolean(wikiEvidenceTarget(part.url)) || /^#(?:source|confirmation)-/u.test(part.url));
const textOf = (part: PhrasingContent): string | undefined => {
  if (part.type === "text") return part.value;
  if (part.type === "inlineCode") return ARROW.test(part.value) ? undefined : part.value;
  if (part.type !== "strong" && part.type !== "emphasis") return;
  const content = part.children.map(textOf);
  return content.every(item => item !== undefined) ? content.join("") : undefined;
};

/** Matched evidence links are carried into the heading after claim markers
 * have been bound against the original sentence. */
export function wikiFlowParagraph(node: Paragraph, zh: boolean) {
  const firstLink = node.children.findIndex(citation);
  const tail = firstLink < 0 ? [] : node.children.slice(firstLink);
  if (tail.some(part => !citation(part) && (part.type !== "text" || part.value.trim()))) return;
  const links = tail.filter(citation);
  const words = (firstLink < 0 ? node.children : node.children.slice(0, firstLink)).map(textOf);
  if (words.some(word => word === undefined)) return;
  const flow = wikiFlowBlock(words.join(""), zh);
  if (flow) return { flow, links };
}
