import ReactMarkdown, { type Components, type ExtraProps } from "react-markdown";
import type { MessageSourceRange } from "../../shared/message-location";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "../../shared/markdown-gfm";
import { readerEmphasis } from "../reader-emphasis";
import {readerIndentedProse} from "../reader-indented-prose";
import remarkMath from "remark-math";
import { createElement, memo, useEffect, useMemo, useRef, useState, type HTMLAttributes } from "react";
import type { ConversationMessage } from "../../shared/types";
import { isInternalSearchQueryMessage, readableConversationText, renderableConversationText } from "../../shared/conversation-text";
import { READER_PAGE_MESSAGES, readerPageEnd, readerWindow } from "../reader-window";
import { queueReaderRender } from "../reader-render-queue";
import { useReaderPlugins } from "../hooks/useReaderPlugins";
import { readerQuestionIndex } from "../reader-position";
import { evidenceSourceRanges, evidenceTextRange } from "../evidence-highlight";
import { ReaderEvidenceHighlight } from "./ReaderEvidenceHighlight";
import { sourceMessageSignature } from "../../shared/source-signature";
import { readerEvidenceTarget } from "../reader-evidence-location";
import { ReaderCodeBlock } from "./ReaderCodeBlock";
import { messagePresentation } from "../../shared/message-ui";
import { ReaderPlatformUI } from "./ReaderPlatformUI";
import { readerStagePresentation } from "../reader-stage-presentation";
import { readerStageList } from "./ReadingStageList";
import {readerQuoteHighlights,type QuoteHighlightRange} from "../reader-quote-highlights";
import type {PluggableList} from "unified";
import { BookOpen, CircleCheck, Copy, Flag } from "lucide-react";
import type { ReaderCitation } from "../reader-citations";

export const ReaderMarkdown = memo(function ReaderMarkdown({ content, zh, literalWidgets = false, sourceStart = 0, hideImages = false, literalCode = false, quoteHighlights }: { content: string; zh: boolean; literalWidgets?: boolean; sourceStart?: number; hideImages?: boolean; literalCode?: boolean; quoteHighlights?:QuoteHighlightRange[] }) {
  const text = useMemo(() => renderableConversationText(content, literalWidgets), [content, literalWidgets]);
  const [formattedText, setFormattedText] = useState<string>();
  const math = text.includes("$");
  const code = /(?:^|\n)\s*(?:`{3,}|~{3,})/u.test(text);
  const format = text.length <= 24000 || formattedText === text;
  useEffect(() => {
    if (format) return;
    return queueReaderRender(() => setFormattedText(text));
  }, [text, format]);
  const plugins = useReaderPlugins(math && format, code && format);
  const sourceAttrs = (node: ExtraProps["node"]) => text === content && node?.position?.start.offset !== undefined && node.position.end.offset !== undefined ? { "data-reader-source-start": sourceStart + node.position.start.offset, "data-reader-source-end": sourceStart + node.position.end.offset } : {};
  const components: Components = { ol: readerStageList, pre: ({ children, node }) => <div {...sourceAttrs(node)}><ReaderCodeBlock zh={zh} literal={literalCode}>{children}</ReaderCodeBlock></div> };
  if (hideImages) components.img = ({ alt }) => <span>{alt}</span>;
  for (const tag of ["p", "li", "blockquote", "h1", "h2", "h3", "h4", "h5", "h6", "table"] as const) Object.assign(components, { [tag]: ({ node, ...props }: HTMLAttributes<HTMLElement> & ExtraProps) => createElement(tag, { ...props, ...sourceAttrs(node) }) });
  // A message is indivisible for context, but parsing an unbounded Markdown AST
  // (especially tables/math) must not freeze navigation just to show its text.
  if (!format) return <div className="reader-long-text" aria-busy="true">{text}</div>;
  const remarkPlugins:PluggableList=[[remarkGfm, GFM_OPTIONS],...math?[remarkMath]:[],readerIndentedProse,readerEmphasis,readerStagePresentation];
  if(quoteHighlights?.length&&text===content)remarkPlugins.push([readerQuoteHighlights,{ranges:quoteHighlights}]);
  return <ReactMarkdown remarkPlugins={remarkPlugins} rehypePlugins={plugins} skipHtml components={components}>{text}</ReactMarkdown>;
});

/** Parse Markdown only as the user approaches it, rather than blocking one frame
 * on all messages in a page. Once parsed, memoization keeps it stable. */
const VisibleMarkdown = memo(function VisibleMarkdown({ content, uiParts, sourceUrl, zh, immediate, literalWidgets, literalCode }: { content: string; uiParts?: ConversationMessage["uiParts"]; sourceUrl?: string; zh: boolean; immediate: boolean; literalWidgets: boolean; literalCode: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(immediate || typeof IntersectionObserver === "undefined");
  useEffect(() => {
    if (ready || !root.current) return;
    let cancel: (() => void) | undefined;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      cancel = queueReaderRender(() => setReady(true));
    }, { rootMargin: "400px" });
    observer.observe(root.current);
    return () => { observer.disconnect(); cancel?.(); };
  }, [ready]);
  const segments = useMemo(() => messagePresentation(content, uiParts, literalWidgets, true), [content, uiParts, literalWidgets]);
  return <div ref={root}>{ready || immediate ? segments.map((part, index) => part.kind === "text" ? <ReaderMarkdown key={index} content={part.text} sourceStart={part.sourceStart} zh={zh} literalWidgets={literalWidgets} literalCode={literalCode} /> : <div key={index} data-reader-ui-part={part.partIndex}><ReaderPlatformUI raw={part.raw} fallbackText={part.fallbackText} truncated={part.truncated} zh={zh} sourceUrl={sourceUrl} /></div>) : <div className="reader-long-text reader-markdown-placeholder" aria-busy="true">{readableConversationText(content, literalWidgets)}</div>}</div>;
});

export const ReaderConversation = memo(function ReaderConversation({ messages, zh, focusMessageId, focusExcerpt, focusRange, focusNonce = 0, focusPlacement = "question", selectedQuestionId, focusOnly = false, hidden = false, highlightTurn = true, onCopy, onMark, citations, onCitation }: { messages: ConversationMessage[]; zh: boolean; focusMessageId?: string; focusExcerpt?: string; focusRange?: MessageSourceRange; focusNonce?: number; focusPlacement?: "question" | "evidence"; selectedQuestionId?: string; focusOnly?: boolean; hidden?: boolean; highlightTurn?: boolean; onCopy?: (message: ConversationMessage) => void; onMark?: (message: ConversationMessage, kind: "conclusion" | "decision") => void; citations?: Map<string, ReaderCitation[]>; onCitation?: (citation: ReaderCitation) => void }) {
  const readableMessages = useMemo(() => messages.filter((message) => !isInternalSearchQueryMessage(message)), [messages]);
  const questionIndex = useMemo(() => readerQuestionIndex(readableMessages), [readableMessages]);
  const windowFocus = focusPlacement === "question" && focusMessageId ? questionIndex.get(focusMessageId) ?? focusMessageId : focusMessageId;
  const focusWindow = useMemo(() => {
    const next = readerWindow(readableMessages, windowFocus);
    // Keep the cited answer available even when a question has several replies.
    return { ...next, end: Math.max(next.end, readableMessages.findIndex(message => message.id === focusMessageId) + 1) };
  }, [readableMessages, windowFocus, focusMessageId]);
  const selected = selectedQuestionId ?? (focusMessageId ? questionIndex.get(focusMessageId) : undefined);
  const questionGroups = useMemo(() => {
    const groups = new Map<string, ConversationMessage[]>();
    for (const message of readableMessages) {
      const question = questionIndex.get(message.id);
      if (!question) continue;
      const group = groups.get(question) ?? [];
      group.push(message); groups.set(question, group);
    }
    return groups;
  }, [readableMessages, questionIndex]);
  const focusedMessages = selected ? questionGroups.get(selected) ?? [] : [];
  const positions = useMemo(() => new Map(messages.map((message, index) => [message.id, index])), [messages]);
  const replyGroups = useMemo(() => {
    const groups = new Map<string, string>();
    readableMessages.forEach((message, index) => {
      const previous = readableMessages[index - 1];
      const owner = message.replyToMessageId ?? questionIndex.get(message.id);
      const previousOwner = previous?.replyToMessageId ?? (previous ? questionIndex.get(previous.id) : undefined);
      const continuous = previous && message.messageIndex - previous.messageIndex === positions.get(message.id)! - positions.get(previous.id)!;
      const join = message.role === "assistant" && previous?.role === "assistant" && message.conversationId === previous.conversationId && owner && owner === previousOwner && continuous;
      groups.set(message.id, join ? groups.get(previous.id)! : message.id);
    });
    return groups;
  }, [readableMessages, questionIndex, positions]);
  const focusedGroup = focusMessageId ? replyGroups.get(focusMessageId) : undefined;
  const [range, setRange] = useState(focusWindow);
  const root = useRef<HTMLDivElement>(null);
  const proofHost = useRef<HTMLDivElement>(null);
  const [proofRange, setProofRange] = useState<Range | null>(null);
  const previousFocus = useRef(windowFocus);
  const previousNonce = useRef(focusNonce);
  const located = useRef<string>();
  useEffect(() => {
    const next = focusWindow;
    const focusChanged = previousFocus.current !== windowFocus || previousNonce.current !== focusNonce;
    previousFocus.current = windowFocus;
    previousNonce.current = focusNonce;
    setRange((current) => {
      const updated = focusChanged || !current.end ? next : { start: Math.min(current.start, Math.max(0, readableMessages.length - 1)), end: Math.min(readableMessages.length, Math.max(current.end, readerPageEnd(readableMessages, current.start))) };
      return current.start === updated.start && current.end === updated.end ? current : updated;
    });
  }, [readableMessages, focusWindow, windowFocus, focusNonce]);
  useEffect(() => {
    if (hidden || !focusMessageId || !root.current) { setProofRange(null); return; }
    const container = root.current;
    const source = readableMessages.find(message => message.id === focusMessageId);
    const locationKey = JSON.stringify([focusMessageId, focusExcerpt, focusRange, focusNonce, focusOnly, focusPlacement, windowFocus, sourceMessageSignature(source?.content ?? ""), source?.uiParts]);
    if (located.current === locationKey) return;
    const locate = () => {
      const element = [...container.querySelectorAll<HTMLElement>("[data-reader-message-id]")].find((item) => item.dataset.readerMessageId === focusMessageId);
      if (!element) return false;
      const original = readableMessages.find(message => message.id === focusMessageId);
      const field = focusRange?.part === "ui" ? original?.uiParts?.[focusRange.partIndex ?? -1]?.fallbackText : original?.content;
      // A saved search link can outlive an edit. Never apply old offsets to changed text.
      const validRange = focusRange && field !== undefined && Number.isSafeInteger(focusRange.start) && Number.isSafeInteger(focusRange.end) && focusRange.start >= 0 && focusRange.end > focusRange.start && focusRange.end <= field.length && (!focusRange.excerpt || field.slice(focusRange.start, focusRange.end) === focusRange.excerpt) ? focusRange : undefined;
      const target = readerEvidenceTarget(element, focusRange && !validRange ? undefined : focusExcerpt, validRange);
      container.querySelectorAll(".reader-evidence-target").forEach((item) => item.classList.remove("reader-evidence-target"));
      target.classList.add("reader-evidence-target");
      const quote = validRange ? field!.slice(validRange.start, validRange.end) : focusRange ? undefined : focusExcerpt;
      const blockStart = Number(target.dataset.readerSourceStart ?? 0);
      const occurrence = quote && validRange ? Math.max(0, field!.slice(blockStart, validRange.start).split(quote).length - 1) : 0;
      const sourceRange=validRange&&validRange.part!=="ui"&&original?evidenceSourceRanges(element,original.content,[{start:validRange.start,end:validRange.end,kind:"quote"}])[0]?.range:undefined;
      setProofRange(sourceRange??(quote ? evidenceTextRange(target, quote, occurrence) ?? null : null));
      const question = [...container.querySelectorAll<HTMLElement>("[data-reader-message-id]")].find(item => item.dataset.readerMessageId === windowFocus);
      const landing = validRange ? target : focusPlacement === "question" ? question ?? element : target;
      landing.scrollIntoView?.({ block: validRange || focusPlacement === "evidence" ? "center" : "start" });
      located.current = locationKey;
      return true;
    };
    // Markdown, math and native UI snapshots change preceding message heights.
    // Stabilize this jump briefly; any deliberate navigation immediately stops it.
    let stopped = false, frame = 0;
    const refresh = () => { if (!stopped && !frame) frame = window.requestAnimationFrame(() => { frame = 0; if (!stopped) locate(); }); };
    const resize = typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refresh);
    resize?.observe(container);
    const mutation = new MutationObserver(refresh);
    mutation.observe(container, { childList: true, subtree: true, characterData: true });
    const stop = () => { stopped = true; resize?.disconnect(); mutation.disconnect(); window.cancelAnimationFrame(frame); };
    const events = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    events.forEach(event => container.ownerDocument.addEventListener(event, stop, { passive: true, capture: true }));
    const settle = window.setTimeout(stop, 2000);
    // Run after the focus window commits, rather than scrolling the previous page.
    const timer = window.setTimeout(locate, 0);
    return () => { stop(); window.clearTimeout(timer); window.clearTimeout(settle); events.forEach(event => container.ownerDocument.removeEventListener(event, stop, true)); };
  }, [focusMessageId, focusExcerpt, focusRange, focusNonce, range.start, range.end, readableMessages, focusOnly, focusPlacement, windowFocus, hidden]);
  const shown = focusOnly ? focusedMessages : readableMessages.slice(range.start, range.end);
  // Native chats scroll continuously: approaching the end loads the next page; the button stays as a fallback.
  const more = useRef<HTMLButtonElement>(null);
  const hasMore = !focusOnly && !hidden && range.end < readableMessages.length;
  useEffect(() => {
    const button = more.current;
    if (!hasMore || !button || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some(entry => entry.isIntersecting)) setRange(current => current.end >= readableMessages.length ? current : { ...current, end: readerPageEnd(readableMessages, current.end) });
    }, { rootMargin: "600px" });
    observer.observe(button);
    return () => observer.disconnect();
  }, [hasMore, range.end, readableMessages]);
  if (hidden) return null;
  return <div className="reader-proof-host" ref={proofHost}><ReaderEvidenceHighlight range={proofRange} host={proofHost}/><div className="reader-conversation" ref={root}>
    {!focusOnly && range.start > 0 ? <button type="button" className="reader-load-more" onClick={() => setRange((current) => ({ ...current, start: Math.max(0, current.start - READER_PAGE_MESSAGES) }))}>{zh ? `阅读更早的内容（前面 ${range.start} 条）` : `Read earlier (${range.start} messages)`}</button> : null}
    {shown.map((message, index) => {
      const group = replyGroups.get(message.id);
      const start = index === 0 || replyGroups.get(shown[index - 1].id) !== group;
      const end = index === shown.length - 1 || replyGroups.get(shown[index + 1].id) !== group;
      return <div key={message.id} id={`reader-message-${message.id}`} data-reader-message-id={message.id} className={`reader-reply-part${start ? " is-reply-start" : ""}${end ? " is-reply-end" : ""}${highlightTurn && focusedGroup === group ? " is-highlighted-reply" : ""}`}>
      {index > 0 && message.messageIndex - shown[index - 1].messageIndex > positions.get(message.id)! - positions.get(shown[index - 1].id)! ? <p className="knowledge-reader-gap">{zh ? "原对话中还有其他内容" : "Other messages in the original conversation"}</p> : null}
      <article className={`knowledge-reader-message is-${message.role}${message.id === focusMessageId ? " is-focused" : ""}${highlightTurn && selected && questionIndex.get(message.id) === selected ? " is-selected-turn" : ""}`}>{start ? <span className="reader-role">{message.role === "user" ? zh ? "你" : "You" : "AI"}</span> : null}<div className="conversation-answer-markdown"><VisibleMarkdown literalCode={message.id === focusMessageId && (focusPlacement === "evidence" || Boolean(focusRange))} content={message.content} uiParts={message.uiParts} sourceUrl={message.id.startsWith("chatgpt:") ? `https://chatgpt.com/c/${encodeURIComponent(message.conversationId)}` : undefined} zh={zh} literalWidgets={message.role === "user"} immediate={index < 2 || message.id === focusMessageId || message.id === windowFocus} /></div>{onCitation && citations?.get(message.id)?.length ? <div className="reader-citations">{citations.get(message.id)!.map(citation => <button type="button" key={`${citation.sessionId}:${citation.sectionId}`} title={`${citation.project} · ${citation.section}`} aria-label={zh ? `被章节引用：${citation.section}，打开` : `Cited in ${citation.section}; open`} onClick={() => onCitation(citation)}><BookOpen size={12} aria-hidden="true" /><span>{citation.section}</span></button>)}</div> : null}{onCopy || onMark ? <div className="reader-message-actions">{onCopy ? <button type="button" aria-label={zh ? "复制并附来源" : "Copy with source"} title={zh ? "复制并附来源" : "Copy with source"} onClick={() => onCopy(message)}><Copy size={15} aria-hidden="true" /></button> : null}{onMark ? <><button type="button" aria-label={zh ? "标为结论" : "Mark conclusion"} title={zh ? "标为结论" : "Mark conclusion"} onClick={() => onMark(message, "conclusion")}><CircleCheck size={15} aria-hidden="true" /></button><button type="button" aria-label={zh ? "标为决策" : "Mark decision"} title={zh ? "标为决策" : "Mark decision"} onClick={() => onMark(message, "decision")}><Flag size={15} aria-hidden="true" /></button></> : null}</div> : null}</article>
    </div>; })}
    {!focusOnly && range.end < readableMessages.length ? <button ref={more} type="button" className="reader-load-more" onClick={() => setRange((current) => ({ ...current, end: readerPageEnd(readableMessages, current.end) }))}>{zh ? `继续阅读（还有 ${readableMessages.length - range.end} 条）` : `Continue reading (${readableMessages.length - range.end} more)`}</button> : null}
  </div></div>;
});
