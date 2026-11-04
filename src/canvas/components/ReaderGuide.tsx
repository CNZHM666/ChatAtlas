import "../reader-guide-prose.css";
import {readerGuideHighlights,type ReaderHighlights} from "../reader-guide-highlights";
import {aiAdvicePresentation} from "../../shared/ai-advice-presentation";
import { Children, isValidElement, memo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "../../shared/markdown-gfm";
import remarkMath from "remark-math";
import { useReaderPlugins } from "../hooks/useReaderPlugins";
import { evidencePresentation } from "../evidence-presentation";
import { ReadingFlow } from "./ReadingFlow";
import { flowSteps } from "../reading-flow";
import { readerEmphasis } from "../reader-emphasis";
import {readerIndentedProse} from "../reader-indented-prose";
import { readerKnowledgePresentation } from "../reader-knowledge-presentation";
import { renderableConversationText } from "../../shared/conversation-text";
import { generatedProse } from "../../shared/generated-structure-prose";
import { ReaderCodeBlock } from "./ReaderCodeBlock";
import { readerStagePresentation } from "../reader-stage-presentation";
import { readerStructureComponents, readerStructurePresentation } from "../reader-structure-presentation";
import { WIKI_CHAPTER_LINK, WIKI_OPEN_CHAPTER_EVENT } from "../../shared/wiki-chapter-links";
import { WIKI_HISTORY_LABEL } from "../../shared/wiki-reading-format";
import { WIKI_CLAIM_MARKER, wikiClaimMarkers, type WikiClaimMarkerPoint } from "../../shared/wiki-claim-markers";
import { WikiClaimMarker } from "./WikiClaimMarker";
import type { PluggableList } from "unified";

/** A generated "> **演变记录**" block renders collapsed. */
const wikiHistoryBlock = (node: unknown) => {
  const first = (node as { children?: Array<{ tagName?: string; children?: Array<{ tagName?: string; children?: Array<{ value?: string }> }> }> })?.children?.find(child => child.tagName === "p");
  const strong = first?.children?.[0];
  return strong?.tagName === "strong" && strong.children?.[0]?.value === WIKI_HISTORY_LABEL && first?.children?.length === 1;
};
import { readerStageList } from "./ReadingStageList";

const Markdown = memo(function Markdown({ content, zh, generated, collapseCode = false, highlights, claimMarkers }: { content: string; zh: boolean; generated: boolean; collapseCode?: boolean; highlights?:ReaderHighlights; claimMarkers?: WikiClaimMarkerPoint[] }) {
  const markers: PluggableList = claimMarkers?.length ? [[wikiClaimMarkers, { points: claimMarkers }]] : [];
  const math = content.includes("$");
  const plugins = useReaderPlugins(math, false);
  return <div className="conversation-answer-markdown reader-guide-prose"><ReactMarkdown components={{ ...readerStructureComponents, ol: readerStageList, blockquote: ({ node, children }) => generated && wikiHistoryBlock(node) ? <details className="reader-supplement wiki-history"><summary>{zh ? "演变记录" : "History"}</summary>{Children.toArray(children).filter(child => typeof child !== "string" || child.trim()).slice(1)}</details> : <blockquote>{children}</blockquote>, a: ({ href, children }) => href?.startsWith(WIKI_CLAIM_MARKER) ? <WikiClaimMarker pointKey={decodeURIComponent(href.slice(WIKI_CLAIM_MARKER.length))} /> : href?.startsWith(WIKI_CHAPTER_LINK) ? <a href={href} onClick={event => { event.preventDefault(); window.dispatchEvent(new CustomEvent(WIKI_OPEN_CHAPTER_EVENT, { detail: decodeURIComponent(href.slice(WIKI_CHAPTER_LINK.length)) })); }}>{children}</a> : <a href={href}>{children}</a>, table: ({ node, children }) => generated && String(node?.properties?.id ?? "").endsWith("atlas-knowledge-audit") ? <details className="reader-supplement"><summary>{zh ? "补充说明" : "Additional details"}</summary><table>{children}</table></details> : <div className="reader-table-scroll" role="region" aria-label={zh ? "表格，可横向滚动" : "Table, scroll horizontally"} tabIndex={0}><table>{children}</table></div>, pre: ({ children }) => { const code = isValidElement<{ className?: string; children?: unknown }>(children) ? children : undefined; const steps = code?.props.className === "language-atlas-flow" ? flowSteps(String(code.props.children)) : undefined; return steps ? <ReadingFlow steps={steps} /> : collapseCode ? <details className="reader-code-example"><summary>{zh ? "查看技术示例" : "View technical example"}</summary><ReaderCodeBlock zh={zh}>{children}</ReaderCodeBlock></details> : <ReaderCodeBlock zh={zh}>{children}</ReaderCodeBlock>; } }} remarkPlugins={math ? [[remarkGfm, GFM_OPTIONS], remarkMath, readerIndentedProse, readerEmphasis, [readerGuideHighlights,{...highlights,enabled:Boolean(highlights)}], readerStagePresentation, readerStructurePresentation, [readerKnowledgePresentation, { zh, generated }], ...markers] : [[remarkGfm, GFM_OPTIONS], readerIndentedProse, readerEmphasis, [readerGuideHighlights,{...highlights,enabled:Boolean(highlights)}], readerStagePresentation, readerStructurePresentation, [readerKnowledgePresentation, { zh, generated }], ...markers]} rehypePlugins={plugins} skipHtml>{content}</ReactMarkdown></div>;
});

/** Long AI guides are optional; original discussion remains the main reading path. */
export const ReaderGuide = memo(function ReaderGuide({ content: original, zh, complete = false, hideEvidenceMarkers = false, hideCitationAnnotations = false, sourceTexts, collapseCode = false, highlights, claimMarkers }: { content: string; zh: boolean; complete?: boolean; hideEvidenceMarkers?: boolean; hideCitationAnnotations?:boolean; sourceTexts?: string[]; collapseCode?: boolean; highlights?:ReaderHighlights;
  /** Point-by-point evidence: a marker after each claim sentence found in the prose. */
  claimMarkers?: WikiClaimMarkerPoint[] }) {
  const [expanded, setExpanded] = useState(false);
  const prose = hideEvidenceMarkers ? generatedProse(original, sourceTexts) : { body: original, removedBlocks: 0 };
  const narration=hideEvidenceMarkers?aiAdvicePresentation(prose.body,sourceTexts):prose.body;
  const content = renderableConversationText(hideEvidenceMarkers || hideCitationAnnotations ? evidencePresentation(narration) : narration);
  if (!content.trim() && prose.removedBlocks) return <p className="muted">{zh ? "本页仅包含结构分析数据，暂无阅读正文。" : "This page contains only structure metadata; no reading text is available."}</p>;
  if (complete || content.length <= 900) return <Markdown content={content} zh={zh} generated={hideEvidenceMarkers} collapseCode={collapseCode} highlights={highlights} claimMarkers={claimMarkers} />;
  const introduction = content.split(/\n\s*\n/u)[0].replace(/^[#>*\s]+/u, "").slice(0, 240);
  return <section className="reader-guide"><div>{expanded ? <Markdown content={content} zh={zh} generated={hideEvidenceMarkers} collapseCode={collapseCode} highlights={highlights} claimMarkers={claimMarkers} /> : <p>{introduction}{introduction.length < content.split(/\n\s*\n/u)[0].length ? "…" : ""}</p>}</div><button type="button" className="reader-text-action" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? zh ? "收起导读" : "Collapse guide" : zh ? "展开完整导读" : "Read full guide"}</button></section>;
});
