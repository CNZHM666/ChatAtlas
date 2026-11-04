import { ArrowLeft, ArrowRight } from "lucide-react";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CanvasCard, Conversation, ConversationGraph, ConversationMessage, MessageAnchor } from "../../shared/types";
import { getMessagesForConversation } from "../../storage/messages";
import { getReadingProgress, saveReadingProgress } from "../../storage/reading-progress";
import { getStoredConversationGraph } from "../../storage/conversation-graphs";
import { readerMessages } from "../reader-message-cache";
import { readerQuestionIndex } from "../reader-position";
import { episodeMessages, matchingEpisodes } from "../reader-path";
import { usePreferences } from "../preferences";
import { QuestionReader } from "./QuestionReader";
import { ReaderLocator } from "./ReaderLocator";
import { deleteReviewMark, listReviewMarks, markDiscussion, saveReviewMark, type ReviewMark } from "../../storage/review-marks";
import { downloadKnowledgeMarkdown, messageWithSource } from "../review-export";
import { platformName } from "../../shared/platforms";

interface KnowledgeReaderProps {
  card: CanvasCard;
  conversations: Conversation[];
  anchors: MessageAnchor[];
  previous: CanvasCard[];
  next: CanvasCard[];
  related?: Array<{ card: CanvasCard; label?: string }>;
  onSelectCard: (id: string) => void;
  onClose: () => void;
  onEditPath?: () => void;
  onNotesChange?: (notes: string) => void;
  onNotesBlur?: () => void;
  onProgress?: () => void;
  initialMessageId?: string;
}

export function KnowledgeReader({ card, conversations, anchors, previous, next, related = [], onSelectCard, onClose, onEditPath, onNotesChange, onNotesBlur, onProgress, initialMessageId }: KnowledgeReaderProps) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, ConversationMessage[]>>({});
  const [graphsByConversation, setGraphsByConversation] = useState<Record<string, ConversationGraph | null | undefined>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [failedSources, setFailedSources] = useState<Set<string>>(() => new Set());
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesDraft, setNotesDraft] = useState(card.notes ?? "");
  const [reviewMarks, setReviewMarks] = useState<ReviewMark[]>([]);
  const [selectedMarks, setSelectedMarks] = useState<Set<string>>(() => new Set());
  const [actionStatus, setActionStatus] = useState("");
  const [restoredMessageId, setRestoredMessageId] = useState<string | undefined>();
  const [jumpMessageId, setJumpMessageId] = useState<string | undefined>();
  const [jumpVersion, setJumpVersion] = useState(0);
  const locatedJump = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<number | null>(null);
  const restored = useRef(false);
  const questionByMessage = useMemo(() => new Map(Object.values(messagesByConversation).flatMap(messages => [...readerQuestionIndex(messages)])), [messagesByConversation]);
  const sourceKey = conversations.map((item) => item.id).join("|");

  useEffect(() => {
    let live = true;
    void listReviewMarks(card.id).then((marks) => { if (live) { setReviewMarks(marks); setSelectedMarks(new Set(marks.map((mark) => mark.id))); } }).catch(() => undefined);
    return () => { live = false; };
  }, [card.id]);

  const copyMessage = (message: ConversationMessage) => {
    const conversation = conversations.find((item) => item.id === message.conversationId);
    void navigator.clipboard.writeText(messageWithSource(message, card, conversation)).then(() => setActionStatus(zh ? "已复制并附来源" : "Copied with source")).catch(() => setActionStatus(zh ? "复制失败" : "Copy failed"));
  };
  const addMark = (message: ConversationMessage, kind: ReviewMark["kind"]) => {
    void markDiscussion(card.id, card.canvasId, message, kind).then((mark) => {
      setReviewMarks((current) => current.some((item) => item.id === mark.id) ? current : [...current, mark]);
      setSelectedMarks((current) => new Set(current).add(mark.id));
      setActionStatus(zh ? "已保存到当前知识" : "Saved to this knowledge");
    }).catch(() => setActionStatus(zh ? "保存失败" : "Save failed"));
  };
  useEffect(() => {
    if (!jumpMessageId || locatedJump.current === `${jumpMessageId}:${jumpVersion}`) return;
    const frame = requestAnimationFrame(() => {
      const root = scrollRef.current;
      const element = [...root?.querySelectorAll<HTMLElement>("[data-reader-message-id]") ?? []].find((item) => item.dataset.readerMessageId === (questionByMessage.get(jumpMessageId) ?? jumpMessageId));
      if (root && element) { root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - 75; locatedJump.current = `${jumpMessageId}:${jumpVersion}`; }
    });
    return () => cancelAnimationFrame(frame);
  }, [jumpMessageId, jumpVersion, expanded, questionByMessage]);

  useEffect(() => {
    let live = true;
    setFailedSources(new Set());
    setMessagesByConversation({});
    setGraphsByConversation({});
    setExpanded(new Set());
    for (const id of sourceKey ? sourceKey.split("|") : []) {
      void Promise.all([readerMessages(id), getStoredConversationGraph(id).catch(() => null)])
        .then(([messages, graph]) => { if (live) { setMessagesByConversation((current) => ({ ...current, [id]: messages })); setGraphsByConversation((current) => ({ ...current, [id]: graph })); } })
        .catch(() => { if (live) setFailedSources((current) => new Set(current).add(id)); });
    }
    return () => { live = false; };
    // A selected card is remounted by key; sourceKey also catches source changes while it stays open.
  }, [sourceKey]);

  useEffect(() => {
    if (restored.current || Object.keys(messagesByConversation).length + failedSources.size < conversations.length) return;
    let live = true;
    void getReadingProgress(card.canvasId, card.id).then((progress) => {
      if (!live || restored.current) return;
      restored.current = true;
      if (!progress) void saveReadingProgress({ canvasId: card.canvasId, cardId: card.id, scrollTop: 0 }).then(onProgress).catch(() => undefined);
      const target = initialMessageId ?? progress?.messageId;
      const targetSource = target ? Object.entries(messagesByConversation).find(([, messages]) => messages.some((message) => message.id === target))?.[0] : undefined;
      if (targetSource) setExpanded((current) => new Set(current).add(targetSource));
      setRestoredMessageId(target);
      window.setTimeout(() => requestAnimationFrame(() => {
        const root = scrollRef.current;
        if (!root) return;
        const element = target ? [...root.querySelectorAll<HTMLElement>("[data-reader-message-id]")].find((item) => item.dataset.readerMessageId === (initialMessageId ? questionByMessage.get(target) ?? target : target)) : null;
        if (element) root.scrollTop += element.getBoundingClientRect().top - root.getBoundingClientRect().top - 72;
        else if (progress) root.scrollTop = progress.scrollTop;
      }), 0);
    }).catch(() => { restored.current = true; });
    return () => { live = false; };
  }, [card.id, card.canvasId, initialMessageId, messagesByConversation, failedSources, conversations.length, onProgress, questionByMessage]);

  const persistProgress = () => {
    const root = scrollRef.current;
    if (!root) return;
    const boundary = root.getBoundingClientRect().top + 110;
    let messageId: string | undefined;
    for (const item of root.querySelectorAll<HTMLElement>("[data-reader-message-id]")) {
      if (item.getBoundingClientRect().top <= boundary) messageId = item.dataset.readerMessageId;
      else break;
    }
    void saveReadingProgress({ canvasId: card.canvasId, cardId: card.id, messageId, scrollTop: root.scrollTop }).then(onProgress).catch(() => undefined);
  };
  useEffect(() => () => { if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); }, []);

  const orderedSources = useMemo(() => [...conversations].sort((a, b) => {
    const aIndex = card.evidenceRefs?.findIndex((ref) => ref.conversationId === a.id) ?? -1;
    const bIndex = card.evidenceRefs?.findIndex((ref) => ref.conversationId === b.id) ?? -1;
    if (aIndex >= 0 || bIndex >= 0) return (aIndex < 0 ? Infinity : aIndex) - (bIndex < 0 ? Infinity : bIndex);
    return (a.sourceCreatedAt ?? a.createdAt ?? a.updatedAt) - (b.sourceCreatedAt ?? b.createdAt ?? b.updatedAt);
  }), [conversations, card.evidenceRefs]);
  const readerAnchors = useMemo(() => orderedSources.flatMap((conversation) => {
    if (expanded.has(conversation.id)) return [];
    const saved = new Set(messagesByConversation[conversation.id]?.map((message) => message.id) ?? []);
    return matchingEpisodes(card.evidenceRefs?.filter((ref) => ref.conversationId === conversation.id) ?? [], graphsByConversation[conversation.id])
      .filter((episode) => episode.messageIds.some((id) => saved.has(id)))
      .map((episode) => ({ id: `knowledge-${conversation.id}-${episode.id}`, title: episode.title }));
  }), [orderedSources, card.evidenceRefs, graphsByConversation, messagesByConversation, expanded]);

  return <aside className="knowledge-reader" aria-label={zh ? "知识阅读" : "Knowledge reader"}>
    <WorkspaceBackButton className="knowledge-reader-back" onClick={() => { persistProgress(); onClose(); }} label={zh ? "返回知识空间" : "Back to Knowledge Space"} />
    <header className="knowledge-reader-header">
      <h2>{card.title}</h2>
    </header>
    <div className="knowledge-reader-scroll" ref={scrollRef} onScroll={() => { if (!restored.current) return; if (saveTimer.current !== null) window.clearTimeout(saveTimer.current); saveTimer.current = window.setTimeout(persistProgress, 450); }}>
      {card.description && card.description !== card.notes ? <p className="knowledge-reader-intro">{card.description}</p> : null}
      {actionStatus ? <p className="reader-action-status" role="status">{actionStatus}</p> : null}
      <h3 className="knowledge-reader-section-title">{zh ? "当时的讨论" : "The original discussion"}</h3>
      {orderedSources.length ? orderedSources.map((conversation, sourceIndex) => {
        if (!messagesByConversation[conversation.id]) return <section key={conversation.id} className="knowledge-reader-source"><strong>{conversation.title}</strong><p className="knowledge-reader-status" role={failedSources.has(conversation.id) ? "alert" : "status"}>{failedSources.has(conversation.id) ? zh ? "读取失败" : "Could not load this source" : zh ? "正在读取…" : "Loading…"}</p>{failedSources.has(conversation.id) ? <button onClick={() => { setFailedSources((current) => { const next = new Set(current); next.delete(conversation.id); return next; }); void getMessagesForConversation(conversation.id).then((messages) => setMessagesByConversation((current) => ({ ...current, [conversation.id]: messages }))).catch(() => setFailedSources((current) => new Set(current).add(conversation.id))); }}>{zh ? "重试" : "Retry"}</button> : null}</section>;
        const allMessages = messagesByConversation[conversation.id] ?? [];
        const refs = card.evidenceRefs?.filter((ref) => ref.conversationId === conversation.id) ?? [];
        const savedIds = new Set(allMessages.map((message) => message.id));
        const matchedEpisodes = matchingEpisodes(refs, graphsByConversation[conversation.id]).filter((episode) => episode.messageIds.some((id) => savedIds.has(id)));
        const transition = matchedEpisodes[0]?.contextHeader;
        const excerpt = episodeMessages(allMessages, refs, anchors, graphsByConversation[conversation.id]);
        const hasExcerpt = excerpt.length < allMessages.length;
        const shown = expanded.has(conversation.id) ? allMessages : excerpt;
        return <section className="knowledge-reader-source" key={conversation.id} aria-label={conversation.title}>
          {sourceIndex > 0 && transition ? <p className="knowledge-reader-transition">{transition}</p> : null}
          <div className="knowledge-reader-source-heading"><div><strong>{conversation.title}</strong><small>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }).format(conversation.sourceCreatedAt ?? conversation.createdAt ?? conversation.updatedAt)} · {platformName(conversation.platform, zh ? "zh-CN" : "en")}</small></div></div>
          {shown.length ? expanded.has(conversation.id) || !matchedEpisodes.length ? <QuestionReader messages={shown} zh={zh} focusMessageId={jumpMessageId ?? initialMessageId ?? restoredMessageId} focusNonce={jumpVersion} focusPlacement={initialMessageId || jumpMessageId ? "question" : "evidence"} onCopy={copyMessage} onMark={addMark} /> : matchedEpisodes.map((episode) => {
            const ids = new Set(episode.messageIds);
            const sectionMessages = allMessages.filter((message) => ids.has(message.id));
            return <section id={`knowledge-${conversation.id}-${episode.id}`} key={episode.id} className="chapter-reader-section"><h3>{episode.title}</h3>{episode.contextHeader ? <p className="chapter-reader-context">{episode.contextHeader}</p> : null}<QuestionReader messages={sectionMessages} zh={zh} focusMessageId={initialMessageId ?? restoredMessageId} focusPlacement={initialMessageId ? "question" : "evidence"} onCopy={copyMessage} onMark={addMark} /></section>;
          }) : <p className="knowledge-reader-status">{zh ? "这条来源的对话内容尚未保存到 ChatAtlas。" : "This source has no conversation content saved in ChatAtlas yet."}</p>}
          <div className="knowledge-reader-source-actions">
            {hasExcerpt ? <button onClick={() => setExpanded((current) => { const next = new Set(current); if (next.has(conversation.id)) next.delete(conversation.id); else next.add(conversation.id); return next; })}>{expanded.has(conversation.id) ? zh ? "收起完整对话" : "Show relevant discussion" : zh ? "在 ChatAtlas 查看完整对话" : "Read full conversation in ChatAtlas"}</button> : null}
          </div>
        </section>;
      }) : <p className="knowledge-reader-status">{zh ? "这个知识还没有关联对话。可以在编辑模式中添加来源，并写下自己的理解。" : "No conversations are linked yet. Add a source and your understanding in Edit mode."}</p>}
      {card.notes?.trim() || onNotesChange ? <section className="knowledge-reader-notes"><h3>{zh ? "我的理解" : "My understanding"}</h3>{notesOpen ? <textarea autoFocus value={notesDraft} onChange={(event) => { setNotesDraft(event.target.value); onNotesChange?.(event.target.value); }} onBlur={onNotesBlur} aria-label={zh ? "我的理解" : "My understanding"} /> : card.notes?.trim() ? <p>{card.notes}</p> : null}{onNotesChange ? <button type="button" onClick={() => { if (notesOpen) onNotesBlur?.(); setNotesOpen(!notesOpen); }}>{notesOpen ? zh ? "完成" : "Done" : zh ? "记下我的理解" : "Add my understanding"}</button> : null}</section> : null}
      <section className="reader-review-tools"><div><h3>{zh ? "结论与决策" : "Conclusions and decisions"}</h3><button type="button" onClick={() => downloadKnowledgeMarkdown(card, reviewMarks.filter((mark) => selectedMarks.has(mark.id)), conversations)}>{zh ? "导出所选 Markdown" : "Export selected Markdown"}</button></div>{reviewMarks.map((mark) => <article key={mark.id} className="reader-review-mark"><label><input type="checkbox" checked={selectedMarks.has(mark.id)} onChange={() => setSelectedMarks((current) => { const next = new Set(current); if (next.has(mark.id)) next.delete(mark.id); else next.add(mark.id); return next; })} /><strong>{mark.kind === "decision" ? zh ? "决策" : "Decision" : zh ? "结论" : "Conclusion"}</strong></label><p>{mark.originalText}</p><small>{conversations.find((item) => item.id === mark.conversationId)?.title ?? (zh ? "来源对话" : "Source conversation")}</small><label className="reader-review-update">{zh ? "现在的补充" : "My later update"}<textarea value={mark.updateNote} onChange={(event) => setReviewMarks((current) => current.map((item) => item.id === mark.id ? { ...item, updateNote: event.target.value } : item))} onBlur={() => void saveReviewMark(mark).catch(() => setActionStatus(zh ? "补充保存失败" : "Could not save update"))} /></label><button type="button" onClick={() => { setJumpMessageId(mark.messageId); setJumpVersion(value => value + 1); setExpanded((current) => new Set(current).add(mark.conversationId)); }}>{zh ? "查看当时讨论" : "Read original discussion"}</button><button type="button" onClick={() => void deleteReviewMark(mark.id).then(() => setReviewMarks((current) => current.filter((item) => item.id !== mark.id))).catch(() => undefined)}>{zh ? "移除标记" : "Remove mark"}</button></article>)}</section>
    </div>
    <ReaderLocator anchors={readerAnchors} scrollRef={scrollRef} />
    <nav className="knowledge-reader-path" aria-label={zh ? "复习路线" : "Review path"}>
      <div>{previous.map((item) => <button key={item.id} onClick={() => { persistProgress(); onSelectCard(item.id); }} title={item.title}><ArrowLeft size={15} /><span>{item.title}</span></button>)}</div>
      {onEditPath ? <button className="knowledge-reader-edit-path" onClick={onEditPath}>{zh ? "调整顺序" : "Edit order"}</button> : null}
      <div>{next.map((item) => <button key={item.id} onClick={() => { persistProgress(); onSelectCard(item.id); }} title={item.title}><span>{item.title}</span><ArrowRight size={15} /></button>)}</div>
    </nav>
    {related.length ? <div className="knowledge-reader-related"><span>{zh ? "相关知识" : "Related knowledge"}</span>{related.map(({ card: item, label }) => <button key={item.id} title={label} onClick={() => { persistProgress(); onSelectCard(item.id); }}>{item.title}</button>)}</div> : null}
  </aside>;
}
