import type { MessageSourceRange, ReaderSearchContext } from "../../shared/message-location";
import { ReaderSearchOutline } from "./ReaderSearchOutline";
import { validReaderHits } from "../reader-search-context";
import { openNativeDiscussion, originalConversationUrl } from "../open-native-discussion";
import { ReaderBackButton } from "./ReaderBackButton";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Conversation, ConversationGraph, ConversationMessage, QuestionSnapshot } from "../../shared/types";
import { isInternalSearchQueryMessage } from "../../shared/conversation-text";
import { loadConversationGraph } from "../conversation-graph";
import { getDatabase } from "../../storage/db";
import { platformName } from "../../shared/platforms";
import { QuestionReader } from "./QuestionReader";
import { ConversationSidebar } from "./ConversationSidebar";
import { usePreferences } from "../preferences";
import { sourceChange } from "../source-freshness";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
import { ReaderSidebarResize } from "./ReaderSidebarResize";
import { readerPosition, readerQuestionIndex } from "../reader-position";
import type { FocusSession } from "../../shared/focus-session";
import { RelatedProjects } from "./RelatedProjects";
import { sourceReadingPosition, saveSourceReadingPosition } from "../source-reading-position";
import { ReaderToolbarProvider, ReaderToolbarSlot } from "./ReaderToolbar";
import { readerCitations, type ReaderCitation } from "../reader-citations";
import { ArrowUpRight, ChevronLeft, ChevronRight } from "lucide-react";

/** Stepping through a chapter's originals without leaving the full Reader. */
export interface ReaderEvidenceSteps { index: number; total: number; onPrevious: () => void; onNext: () => void; onChapter: () => void; chapterLabel: string }

const sidebarWidthKey = "atlas-source-sidebar-width";

export function OriginalReader({ conversation, conversations, messages, loading, error, targetMessageId, onBack, onRetry, onOrganize, reviews = [], onOpenReview, backLabel, targetExcerpt, targetRange, emptyContent, searchContext, onOpenChapter, evidenceSteps }: {
  conversation: Conversation; conversations?: Conversation[]; messages: ConversationMessage[]; loading: boolean; error?: string; targetMessageId?: string;
  onBack: () => void; onRetry?: () => void; onOrganize?: () => void; reviews?: FocusSession[]; onOpenReview?: (id: string) => void; backLabel?: string; targetExcerpt?: string; targetRange?: MessageSourceRange; emptyContent?: ReactNode; searchContext?: ReaderSearchContext;
  onOpenChapter?: (sessionId: string, sectionId: string) => void; evidenceSteps?: ReaderEvidenceSteps;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [matchOutline, setMatchOutline] = useState(Boolean(searchContext));
  const [nativeBusy, setNativeBusy] = useState(false), [nativeNotice, setNativeNotice] = useState("");
  const nativeHref = originalConversationUrl(conversation), nativeName = platformName(conversation.platform, locale === "zh-CN" ? "zh-CN" : "en");
  const hits = useMemo(() => validReaderHits(searchContext, messages), [searchContext, messages]);
  useEffect(() => { setMatchOutline(Boolean(searchContext)); setNativeNotice(""); }, [searchContext, conversation.id]);
  const [graph, setGraph] = useState<ConversationGraph | null>(null);
  const [snapshots, setSnapshots] = useState<QuestionSnapshot[]>([]);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("atlas-conversation-sidebar-collapsed") === "1");
  const [sidebarWidth, setSidebarWidth] = useState(() => { const width = Number(localStorage.getItem(sidebarWidthKey)); return width >= 210 && width <= 480 ? width : 250; });
  const [focusId, setFocusId] = useState(targetMessageId);
  const [focusVersion, setFocusVersion] = useState(0);
  const [currentQuestionId, setCurrentQuestionId] = useState<string>();
  const readingBody = useRef<HTMLElement>(null);
  const scrollFrame = useRef(0);
  const jumpingUntil = useRef(0);
  const resumedConversation = useRef<string>();
  const locatedTarget = useRef<string>();
  const readable = useMemo(() => messages.filter((message) => !isInternalSearchQueryMessage(message)), [messages]);
  const messageById = useMemo(() => new Map(messages.map((message) => [message.id, message])), [messages]);
  const questionByMessage = useMemo(() => readerQuestionIndex(readable), [readable]);
  const citations = useMemo(() => onOpenChapter ? readerCitations(conversation.id, messages, reviews) : undefined, [onOpenChapter, conversation.id, messages, reviews]);
  const openCitation = useCallback((citation: ReaderCitation) => onOpenChapter?.(citation.sessionId, citation.sectionId), [onOpenChapter]);
  const sourceReview = [...reviews].sort((a, b) => b.createdAt - a.createdAt).find((review) => review.sourceConversationIds.includes(conversation.id));
  const changes = sourceReview ? [sourceChange(sourceReview, conversation.id, messages)] : [];
  const questionTitles = useMemo(() => {
    const titles = new Map(snapshots.map((snapshot) => [snapshot.questionId, snapshot.displayTitle]));
    for (const node of graph?.nodes ?? []) if (node.kind === "question" && node.sourceMessageId) titles.set(node.sourceMessageId, node.displayTitleSource !== "fallback" && node.displayTitle || titles.get(node.sourceMessageId) || node.displayTitle || node.title);
    return titles;
  }, [graph, snapshots]);

  useEffect(() => {
    let live = true;
    void Promise.allSettled([loadConversationGraph(conversation.id), Promise.resolve().then(getDatabase).then((db) => db.getAllFromIndex("questionSnapshots", "by-conversation", conversation.id))]).then(([storedGraph, storedSnapshots]) => {
      if (!live) return;
      setGraph(storedGraph.status === "fulfilled" ? storedGraph.value : null);
      setSnapshots(storedSnapshots.status === "fulfilled" ? storedSnapshots.value : []);
    });
    return () => { live = false; };
  }, [conversation.id]);
  useEffect(() => { if (targetMessageId) { setFocusId(targetMessageId); setFocusVersion((value) => value + 1); } }, [targetMessageId]);
  useEffect(() => () => window.cancelAnimationFrame(scrollFrame.current), []);
  useEffect(() => {
    if (loading || error || !readable.length || resumedConversation.current === conversation.id) return;
    resumedConversation.current = conversation.id;
    const saved = sourceReadingPosition(conversation.id);
    const id = targetMessageId ? questionByMessage.get(targetMessageId) : saved && questionByMessage.get(saved);
    if (id) {
      setCurrentQuestionId(id);
      if (!targetMessageId) { setFocusId(id); setFocusVersion(value => value + 1); jumpingUntil.current = performance.now() + 700; }
      saveSourceReadingPosition(conversation.id, id);
    }
  }, [conversation.id, loading, error, readable, questionByMessage, targetMessageId]);
  const rememberQuestion = useCallback((id: string) => {
    const question = questionByMessage.get(id);
    if (!question) return;
    setCurrentQuestionId(question);
    saveSourceReadingPosition(conversation.id, question);
  }, [conversation.id, questionByMessage]);
  useEffect(() => {
    if (!targetMessageId) { locatedTarget.current = undefined; return; }
    const key = `${conversation.id}:${targetMessageId}`;
    if (locatedTarget.current === key || !questionByMessage.has(targetMessageId)) return;
    locatedTarget.current = key;
    rememberQuestion(targetMessageId);
  }, [conversation.id, targetMessageId, questionByMessage, rememberQuestion]);

  const updateReadingPosition = () => {
    if (performance.now() < jumpingUntil.current || scrollFrame.current) return;
    scrollFrame.current = window.requestAnimationFrame(() => {
      scrollFrame.current = 0;
      if (performance.now() < jumpingUntil.current) return;
      const body = readingBody.current;
      if (!body) return;
      const boundary = body.getBoundingClientRect().top + 115;
      const displayed = body.querySelector(".reader-conversation")?.children;
      if (!displayed?.length) return;
      const first = displayed[0].hasAttribute("data-reader-message-id") ? 0 : 1;
      const end = displayed[displayed.length - 1].hasAttribute("data-reader-message-id") ? displayed.length : displayed.length - 1;
      const index = readerPosition(end - first, (position) => displayed[position + first].getBoundingClientRect().top, boundary);
      const question = questionByMessage.get(displayed[index + first]?.getAttribute("data-reader-message-id") ?? "");
      if (question) rememberQuestion(question);
    });
  };
  const jumpTo = useCallback((message: ConversationMessage) => {
    jumpingUntil.current = performance.now() + 700;
    setFocusId(message.id); rememberQuestion(message.id); setFocusVersion((value) => value + 1);
  }, [rememberQuestion]);
  const selectedQuestion = currentQuestionId ?? (focusId ? questionByMessage.get(focusId) : undefined) ?? readable.find((message) => message.role === "user")?.id;
  const activeHit = hits.find(hit => hit.messageId === focusId);
  const toggleSidebar = () => setCollapsed(value => { localStorage.setItem("atlas-conversation-sidebar-collapsed", value ? "0" : "1"); return !value; });
  const returnOutline = () => { setMatchOutline(false); setCollapsed(false); };
  const nativeRequest = useRef(0);
  useEffect(() => { nativeRequest.current++; setNativeBusy(false); }, [conversation.id]);
  const readNative = async () => {
    if (nativeBusy) return;
    const request = ++nativeRequest.current;
    setNativeBusy(true); setNativeNotice("");
    try {
      const result = await openNativeDiscussion(conversation, readable, selectedQuestion ?? focusId);
      if (request === nativeRequest.current && result === "opened") setNativeNotice(zh ? "已打开原对话；原平台未能定位当前问答，可继续在 Reader 阅读。" : "Original chat opened. The current question could not be located; you can continue in Reader.");
    } catch { if (request === nativeRequest.current) setNativeNotice(zh ? "原平台打开失败，请重试。" : "Could not open the original platform. Try again."); }
    finally { if (request === nativeRequest.current) setNativeBusy(false); }
  };

  return <ReaderToolbarProvider><div className={`original-reading${searchContext ? " has-search-outline" : ""}`} style={{ "--source-sidebar-width": `${sidebarWidth}px` } as CSSProperties}>
    <ConversationSidebar hidden={Boolean(searchContext && matchOutline)} conversation={conversation} conversations={conversations ?? [conversation]} messages={messages} questionTitles={questionTitles} questionNavigation editable={false} showingAll={false} collapsed={collapsed} onToggleCollapsed={toggleSidebar} onShowAll={searchContext ? () => setMatchOutline(true) : onBack} backLabel={searchContext ? zh ? "返回命中目录" : "Search matches" : backLabel} onSelectConversation={() => undefined} onSelectMessage={jumpTo} selectedMessageId={selectedQuestion} />
    {searchContext && matchOutline ? <ReaderSearchOutline context={searchContext} hits={hits} messages={messages} selectedId={focusId} collapsed={collapsed} zh={zh} onToggle={toggleSidebar} onReturn={returnOutline} onSelect={hit => { const message = messageById.get(hit.messageId); if (message) jumpTo(message); }}/> : null}
    {!collapsed ? <ReaderSidebarResize width={sidebarWidth} zh={zh} onChange={(width) => { setSidebarWidth(width); try { localStorage.setItem(sidebarWidthKey, String(width)); } catch { /* Resizing works without persistence. */ } }} /> : null}
    <div className="source-reader-content">
      <header className="source-reader-header">
        <div className="source-reader-title">{collapsed || searchContext ? <ReaderBackButton className="original-back" onClick={searchContext && collapsed && !backLabel ? matchOutline ? returnOutline : () => { setMatchOutline(true); setCollapsed(false); } : onBack} label={backLabel ?? (searchContext && collapsed ? matchOutline ? zh ? "返回原目录" : "Original outline" : zh ? "返回命中目录" : "Search matches" : (zh ? searchContext ? "返回对话列表" : "全部对话" : searchContext ? "Back to the list" : "All conversations"))} /> : null}<h1 title={conversation.title}>{conversation.title}</h1></div>
        <ReaderToolbarSlot />
        <div className="source-library-actions">{onOpenReview ? <RelatedProjects sessions={reviews} zh={zh} onOpen={onOpenReview} /> : null}{nativeHref ? <a className="source-native-link" href={nativeHref} target="_blank" rel="noopener noreferrer" aria-disabled={nativeBusy || undefined} title={zh ? "在原平台打开并定位当前问答" : "Open on the original platform at the current question"} onClick={event => { if (typeof chrome !== "undefined" && typeof chrome.tabs?.query === "function") { event.preventDefault(); void readNative(); } }}>{nativeBusy ? zh ? "正在打开…" : "Opening…" : zh ? `在 ${nativeName} 中打开` : `Open in ${nativeName}`}<ArrowUpRight size={14} aria-hidden="true" /></a> : null}</div>
      </header>
    <main ref={readingBody} className="original-reading-body" onScroll={updateReadingPosition}>
      {conversation.source===`${conversation.platform}_dom`?<p className="muted">{zh?"网页采集：这里保留的是网页已加载过的消息，可能不包含整段历史。可在原平台加载更早消息后补充。":"Page capture: these are messages loaded on the website; earlier history may be missing. Load earlier messages on the original platform to add them."}</p>:null}
      {nativeNotice ? <p role="status" className="muted">{nativeNotice}</p> : null}
      {!loading && sourceReview && onOpenReview ? <SourceUpdateNotice changes={changes} conversations={[conversation]} zh={zh} updateLabel={zh ? "查看待更新回顾" : "Review changes"} onUpdate={() => onOpenReview(sourceReview.id)} /> : null}
      {loading ? <p role="status">{zh ? "读取正文…" : "Loading discussion…"}</p> : error ? <div role="alert"><p>{zh ? "读取本地正文时出错。" : "Could not load the local discussion."} {error}</p>{onRetry ? <button type="button" onClick={onRetry}>{zh ? "重试" : "Retry"}</button> : null}</div> : readable.length ? <>
        {targetMessageId && !messageById.has(targetMessageId) ? <p role="status" className="muted">{zh ? "引用位置已变化，可在原文中继续查阅。" : "The cited message has changed. You can continue reading the original discussion."}</p> : null}<QuestionReader key={conversation.id} messages={messages} zh={zh} initialFocused={Boolean(targetMessageId && questionByMessage.has(targetMessageId))} focusMessageId={focusId} focusPlacement={searchContext ? "evidence" : "question"} highlightTurn={false} focusExcerpt={activeHit?.excerpt ?? (focusId === targetMessageId ? targetExcerpt : undefined)} focusRange={activeHit?.sourceRange ?? (focusId === targetMessageId ? targetRange : undefined)} focusNonce={focusVersion} selectedQuestionId={selectedQuestion} onQuestionChange={rememberQuestion} citations={citations} onCitation={onOpenChapter ? openCitation : undefined} />
      </> : <div><p>{zh ? "本地正文尚未就绪，请同步后重试。" : "Local text is not ready. Sync and retry."}</p>{emptyContent}{onOrganize ? <button type="button" onClick={onOrganize}>{zh ? "去工作台同步" : "Sync on Workbench"}</button> : onRetry ? <button type="button" onClick={onRetry}>{zh ? "重新读取" : "Reload"}</button> : null}</div>}
    </main>
    {evidenceSteps ? <nav className="reader-evidence-steps" aria-label={zh ? "依据导航" : "Evidence navigation"}>
      <button type="button" disabled={evidenceSteps.index <= 0} onClick={evidenceSteps.onPrevious}><ChevronLeft size={15} aria-hidden="true" />{zh ? "上一条依据" : "Previous evidence"}</button>
      <span>{evidenceSteps.index + 1}/{evidenceSteps.total}</span>
      <button type="button" disabled={evidenceSteps.index >= evidenceSteps.total - 1} onClick={evidenceSteps.onNext}>{zh ? "下一条依据" : "Next evidence"}<ChevronRight size={15} aria-hidden="true" /></button>
      <button type="button" onClick={evidenceSteps.onChapter}>{evidenceSteps.chapterLabel}</button>
    </nav> : null}
    </div>
  </div></ReaderToolbarProvider>;
}
