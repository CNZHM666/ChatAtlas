import { ReaderBackButton } from "./ReaderBackButton";
import { chronologicalGroups } from "../review-presentation";
import { ChapterPhase } from "./ChapterPhase";
import { ChevronDown, ChevronRight, GripVertical, MoreHorizontal, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { ContextEpisode, Conversation, ConversationChapter, ConversationMessage, OrganizationRun } from "../../shared/types";
import { conversationDragType, parseConversationDragPayload, type ConversationDragPayload } from "../conversation-graph";
import { questionDisplayTitle } from "../conversation-structurer";
import { usePreferences } from "../preferences";
import { TaskSidebarSection } from "./TaskSidebarSection";
import { readerQuestionIndex } from "../reader-position";
import { isInternalSearchQueryMessage } from "../../shared/conversation-text";

interface ConversationSidebarProps {
  hidden?: boolean;
  conversation?: Conversation;
  conversations: Conversation[];
  messages: ConversationMessage[];
  questionTitles?: ReadonlyMap<string, string>;
  questionNavigation?: boolean;
  editable: boolean;
  showingAll: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onShowAll: () => void;
  backLabel?: string;
  onOverview?: () => void;
  overviewSelected?: boolean;
  onSelectConversation: (id: string) => void;
  onSelectMessage: (message: ConversationMessage) => void;
  onSelectUnassigned?: () => void;
  selectedMessageId?: string;
  chapters?: ConversationChapter[];
  episodes?: ContextEpisode[];
  outlineLoading?: boolean;
  selectedChapterId?: string | null;
  onSelectChapter?: (id: string) => void;
  onCreateChapter?: (title: string) => void;
  onAssignQuestion?: (chapterId: string, messageId: string) => void;
  manual?: boolean;
  tasks?: OrganizationRun[];
  onSelectTask?: (id: string) => void;
  onTaskHistory?: () => void;
}

function setDrag(event: React.DragEvent, payload: ConversationDragPayload) {
  event.dataTransfer.setData(conversationDragType, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copyMove";
}

export function ConversationSidebar(props: ConversationSidebarProps) {
  const { t, locale } = usePreferences();
  const [conversationQuery, setConversationQuery] = useState("");
  const [conversationLimit, setConversationLimit] = useState(80);
  const [addingChapter, setAddingChapter] = useState(false);
  const [chapterDraft, setChapterDraft] = useState("");
  const [questionQuery, setQuestionQuery] = useState("");
  const [expandedChapterIds, setExpandedChapterIds] = useState<Set<string>>(new Set());
  const [collapsedCurrentChapterId, setCollapsedCurrentChapterId] = useState<string | null>(null);
  const [allQuestions, setAllQuestions] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropChapterId, setDropChapterId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(() => localStorage.getItem("atlas-conversation-sidebar-visited") !== "1");
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const deferredQuestionQuery = useDeferredValue(questionQuery);
  const [questionLimit, setQuestionLimit] = useState(80);
  const [chapterLimits, setChapterLimits] = useState<Record<string, number>>({});
  const questions = useMemo(() => props.messages.filter((message) => message.role === "user"), [props.messages]);
  const questionPositions = useMemo(() => new Map(questions.map((message, index) => [message.id, index])), [questions]);
  const questionById = useMemo(() => new Map(questions.map((message) => [`conversation-message-${message.id}`, message])), [questions]);
  const questionByMessageId = useMemo(() => new Map(questions.map((message) => [message.id, message])), [questions]);
  const chapters = useMemo(() => [...(props.chapters ?? [])].sort((a, b) => a.order - b.order), [props.chapters]);
  const entriesByChapter = useMemo(() => {
    const episodesByChapter = new Map<string, ContextEpisode[]>();
    for (const episode of props.episodes ?? []) { const group = episodesByChapter.get(episode.chapterId) ?? []; group.push(episode); episodesByChapter.set(episode.chapterId, group); }
    return new Map(chapters.map((chapter) => {
      const used = new Set<string>();
      const entries: Array<{ message: ConversationMessage; title?: string; ids: string[] }> = [];
      for (const episode of episodesByChapter.get(chapter.id) ?? []) {
        const members = episode.questionIds.map((id) => questionById.get(id)).filter((message): message is ConversationMessage => Boolean(message));
        if (!members.length) continue;
        members.forEach((message) => used.add(message.id));
        entries.push({ message: members[0], title: episode.title, ids: members.map((message) => message.id) });
      }
      for (const id of chapter.questionIds) { const message = questionById.get(id); if (message && !used.has(message.id)) entries.push({ message, ids: [message.id] }); }
      return [chapter.id, entries.sort((a, b) => a.message.messageIndex - b.message.messageIndex)];
    }));
  }, [chapters, questionById, props.episodes]);
  const assignedQuestionIds = useMemo(() => new Set(chapters.flatMap((chapter) => chapter.questionIds)), [chapters]);
  const visibleMessages = useMemo(() => chapters.length ? questions.filter((message) => !assignedQuestionIds.has(`conversation-message-${message.id}`)) : questions, [chapters, questions, assignedQuestionIds]);
  const normalizedQuery = deferredQuestionQuery.trim().toLocaleLowerCase().normalize("NFKC");
  const matchesQuery = (value: string) => value.toLocaleLowerCase().normalize("NFKC").includes(normalizedQuery);
  const listedMessages = allQuestions ? questions : visibleMessages;
  const searchByMessageId = useMemo(() => {
    const readable = props.messages.filter(message => !isInternalSearchQueryMessage(message));
    const index = readerQuestionIndex(readable);
    const parts = new Map(questions.map(message => [message.id, [props.questionTitles?.get(message.id) ?? "", message.preview]]));
    for (const message of readable) { const id = index.get(message.id); if (id) parts.get(id)?.push(message.content); }
    return new Map([...parts].map(([id, texts]) => [id, texts.join(" ").toLocaleLowerCase().normalize("NFKC")]));
  }, [questions, props.messages, props.questionTitles]);
  const filteredMessages = useMemo(() => normalizedQuery ? listedMessages.filter((message) => searchByMessageId.get(message.id)?.includes(normalizedQuery)) : listedMessages, [normalizedQuery, listedMessages, searchByMessageId]);
  const matchingConversations = useMemo(() => props.conversations.filter((conversation) => conversation.title.toLocaleLowerCase().normalize("NFKC").includes(conversationQuery.trim().toLocaleLowerCase().normalize("NFKC"))), [props.conversations, conversationQuery]);
  useEffect(() => setConversationLimit(80), [conversationQuery]);
  useEffect(() => { setQuestionLimit(80); setChapterLimits({}); }, [deferredQuestionQuery, props.conversation?.id]);
  useEffect(() => { setAllQuestions(false); setMenuOpen(false); setExpandedChapterIds(new Set()); setCollapsedCurrentChapterId(null); setQuestionQuery(""); }, [props.conversation?.id]);
  useEffect(() => {
    if (props.selectedMessageId) itemRefs.current.get(props.selectedMessageId)?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [props.selectedMessageId]);
  useEffect(() => { if (!props.showingAll) { localStorage.setItem("atlas-conversation-sidebar-visited", "1"); setShowHelp(false); } }, [props.showingAll]);
  if (props.hidden) return null;
  if (props.collapsed) return <aside className="conversation-sidebar is-collapsed"><button className="conversation-sidebar-toggle" type="button" onClick={props.onToggleCollapsed} aria-label={locale === "zh-CN" ? "展开侧边栏" : "Expand sidebar"} title={locale === "zh-CN" ? "展开侧边栏" : "Expand sidebar"}><PanelLeftOpen size={18} /></button></aside>;
  if (props.showingAll) {
    return (
      <aside className="conversation-sidebar">
        <button className="conversation-sidebar-toggle" type="button" onClick={props.onToggleCollapsed} aria-label={locale === "zh-CN" ? "收起侧边栏" : "Collapse sidebar"} title={locale === "zh-CN" ? "收起侧边栏" : "Collapse sidebar"}><PanelLeftClose size={18} /></button>
        <div className="conversation-sidebar-heading">
          <span className="eyebrow">{t("allConversations")}</span>
          {showHelp ? <h2>{t("chooseConversation")}</h2> : null}
        </div>
        <label className="conversation-sidebar-search"><Search size={15} /><input value={conversationQuery} onChange={(event) => setConversationQuery(event.target.value)} placeholder={t("searchConversations")} /></label>
        <div className="conversation-picker-list">
          {matchingConversations.slice(0, conversationLimit).map((conversation) => (
            <button key={conversation.id} onClick={() => props.onSelectConversation(conversation.id)}>
              <span><strong>{conversation.title}</strong><small>{conversation.importState === "discovered" || conversation.messageCount === null ? t("contentPending") : <>{conversation.messageCount} {t("messages")}</>}</small></span>
              {props.editable ? <GripVertical size={13} /> : null}
            </button>
          ))}
          {matchingConversations.length > conversationLimit ? <button type="button" className="conversation-picker-more" onClick={() => setConversationLimit((value) => value + 80)}>{locale === "zh-CN" ? `显示更多（还有 ${matchingConversations.length - conversationLimit} 条）` : `Show more (${matchingConversations.length - conversationLimit} remaining)`}</button> : null}
        </div>
        {props.onSelectTask ? <TaskSidebarSection runs={props.tasks ?? []} activeId={null} onSelect={props.onSelectTask} /> : null}
      </aside>
    );
  }

  if (!props.conversation) return null;
  const activeConversation = props.conversation;
  const renderQuestion = (message: ConversationMessage, index: number, nested = false, displayTitle?: string, episodeIds?: string[]) => <button
    key={message.id}
    ref={(element) => { if (element) itemRefs.current.set(message.id, element); else itemRefs.current.delete(message.id); }}
    className={`conversation-message-item ${nested ? "is-nested" : ""} ${props.selectedMessageId === message.id || episodeIds?.includes(props.selectedMessageId ?? "") ? "is-current" : ""} ${props.editable ? "is-draggable" : ""}`}
    aria-current={props.selectedMessageId === message.id || episodeIds?.includes(props.selectedMessageId ?? "") ? "true" : undefined}
    draggable={props.editable}
    onDragStart={props.editable ? (event) => setDrag(event, { kind: "question", conversationId: activeConversation.id, messageId: message.id }) : undefined}
    onDragEnd={() => setDropChapterId(null)}
    onClick={() => props.onSelectMessage(message)}
    title={props.editable ? locale === "zh-CN" ? "拖到上方章节，或点击阅读" : "Drag into a chapter or click to read" : message.content.trim() || message.preview.trim()}
  >
    <span className="message-number">{nested ? "├" : String(index + 1).padStart(2, "0")}</span>
    <span className="message-list-copy"><small>{displayTitle?.trim() || props.questionTitles?.get(message.id)?.trim() || (props.questionNavigation ? message.content.trim() || message.preview.trim() : questionDisplayTitle(message.content.trim() || message.preview.trim()))}</small></span>
    {props.editable ? <GripVertical className="message-grip" size={14} /> : null}
  </button>;
  const currentChapterId = props.selectedChapterId ?? chapters.find((chapter) => chapter.questionIds.includes(`conversation-message-${props.selectedMessageId}`))?.id;
  const toggleChapter = (id: string) => {
    if (id === currentChapterId) { setCollapsedCurrentChapterId((current) => current === id ? null : id); return; }
    setExpandedChapterIds((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };
  const chapterItems = (chapter: ConversationChapter) => entriesByChapter.get(chapter.id) ?? [];
  const matchesEntry = (entry: ReturnType<typeof chapterItems>[number]) => matchesQuery(`${entry.title ?? ""} ${entry.ids.map((id) => { const message = questionByMessageId.get(id); return searchByMessageId.get(message?.id ?? id) ?? ""; }).join(" ")}`);
  const searchedChapters = normalizedQuery ? chapters.filter((chapter) => matchesQuery(chapter.title) || chapterItems(chapter).some(matchesEntry)) : chapters;

  const renderChapter = (chapter: ConversationChapter) => {
          const expanded = Boolean(normalizedQuery) || expandedChapterIds.has(chapter.id) || !props.overviewSelected && chapter.id === currentChapterId && collapsedCurrentChapterId !== chapter.id;
          const entries = chapterItems(chapter).filter((entry) => !normalizedQuery || matchesQuery(chapter.title) || matchesEntry(entry));
          return <div key={chapter.id} className={`conversation-outline-chapter ${dropChapterId === chapter.id ? "is-drop-target" : ""}`} onDragOver={props.editable ? (event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropChapterId(chapter.id); } : undefined} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropChapterId((current) => current === chapter.id ? null : current); }} onDrop={props.editable ? (event) => { event.preventDefault(); event.stopPropagation(); setDropChapterId(null); const payload = parseConversationDragPayload(event.dataTransfer.getData(conversationDragType)); if (payload?.kind === "question" && payload.conversationId === activeConversation.id && payload.messageId) { props.onAssignQuestion?.(chapter.id, payload.messageId); setExpandedChapterIds((current) => { const next = new Set(current); if (props.manual) next.delete(chapter.id); else next.add(chapter.id); return next; }); } } : undefined}>
            <div className="conversation-outline-chapter-heading"><button type="button" className={!props.overviewSelected && currentChapterId === chapter.id ? "is-current" : ""} aria-expanded={expanded} draggable={props.editable} onDragStart={props.editable ? (event) => setDrag(event, { kind: "chapter", conversationId: activeConversation.id, chapterId: chapter.id }) : undefined} onClick={() => { if (props.onSelectChapter) props.onSelectChapter(chapter.id); else toggleChapter(chapter.id); }}><span className="chapter-nav-order">{String(chapter.order + 1).padStart(2, "0")}</span><span className="chapter-nav-title">{chapter.title}</span><small>{chapter.questionIds.length}</small>{props.editable ? <GripVertical size={13} aria-hidden="true" /> : null}</button>{entries.length ? <button type="button" className="conversation-outline-expand" aria-label={expanded ? locale === "zh-CN" ? "收起问题" : "Collapse questions" : locale === "zh-CN" ? "展开问题" : "Expand questions"} aria-expanded={expanded} onClick={() => toggleChapter(chapter.id)}>{expanded ? <ChevronDown size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}</button> : null}</div>
            {dropChapterId === chapter.id ? <span className="conversation-drop-label">{locale === "zh-CN" ? "松开，移入此章节" : "Release to move into this chapter"}</span> : null}
            {expanded ? <div className="conversation-outline-questions">{entries.map((entry, index) => index < (chapterLimits[chapter.id] ?? 80) || entry.ids.includes(props.selectedMessageId ?? "") ? renderQuestion(normalizedQuery ? questionByMessageId.get(entry.ids.find(id => searchByMessageId.get(id)?.includes(normalizedQuery)) ?? "") ?? entry.message : entry.message, index, true, normalizedQuery ? undefined : entry.title, entry.ids) : null)}{entries.length > (chapterLimits[chapter.id] ?? 80) ? <button type="button" className="conversation-picker-more" onClick={() => setChapterLimits((current) => ({ ...current, [chapter.id]: (current[chapter.id] ?? 80) + 80 }))}>{locale === "zh-CN" ? "显示更多问题" : "Show more questions"}</button> : null}{!entries.length && props.editable ? <p className="conversation-outline-drop-hint">{locale === "zh-CN" ? "把问题拖到这里" : "Drop questions here"}</p> : null}</div> : null}
          </div>;
        };

  return (
    <aside className="conversation-sidebar">
      <div className="conversation-sidebar-top"><ReaderBackButton onClick={props.onShowAll} label={props.backLabel ?? t("allConversations")} /><div className="conversation-sidebar-tools">{!props.questionNavigation ? <button type="button" className="conversation-sidebar-toggle" onClick={() => setMenuOpen((value) => !value)} aria-label={locale === "zh-CN" ? "更多章节操作" : "More outline actions"} aria-expanded={menuOpen}><MoreHorizontal size={18} /></button> : null}<button className="conversation-sidebar-toggle" type="button" onClick={props.onToggleCollapsed} aria-label={locale === "zh-CN" ? "收起侧边栏" : "Collapse sidebar"} title={locale === "zh-CN" ? "收起侧边栏" : "Collapse sidebar"}><PanelLeftClose size={18} /></button></div></div>
      <div className="conversation-outline-intro"><h2 title={activeConversation.title}>{activeConversation.title}</h2>{!props.questionNavigation && (chapters.length || questions.length) ? <p>{allQuestions ? locale === "zh-CN" ? `全部问题 · ${questions.length}` : `All questions · ${questions.length}` : !chapters.length ? locale === "zh-CN" ? `${questions.length} 个问题` : `${questions.length} questions` : locale === "zh-CN" ? `${chapters.length} 章 · ${questions.length} 个问题` : `${chapters.length} chapters · ${questions.length} questions`}</p> : null}</div>
      {props.onOverview ? <button type="button" className="source-outline-overview" aria-current={props.overviewSelected ? "page" : undefined} onClick={props.onOverview}>{locale === "zh-CN" ? "对话总览" : "Conversation overview"}</button> : null}
      {chapters.length || questions.length ? <label className="conversation-outline-search"><Search size={16} /><input value={questionQuery} onChange={(event) => setQuestionQuery(event.target.value)} placeholder={props.questionNavigation ? locale === "zh-CN" ? "搜索问题或回答" : "Search questions or answers" : locale === "zh-CN" ? "查找章节或正文" : "Find chapters or discussion"} aria-label={props.questionNavigation ? locale === "zh-CN" ? "搜索问题或回答" : "Search questions or answers" : locale === "zh-CN" ? "查找章节或问题" : "Find chapters or questions"} /></label> : null}
      {menuOpen ? <div className="conversation-outline-menu"><button type="button" onClick={() => { setExpandedChapterIds(new Set(chapters.map((chapter) => chapter.id))); setCollapsedCurrentChapterId(null); setAllQuestions(false); setMenuOpen(false); }}>{locale === "zh-CN" ? "展开全部章节" : "Expand all chapters"}</button><button type="button" onClick={() => { setExpandedChapterIds(new Set()); setCollapsedCurrentChapterId(currentChapterId ?? null); setAllQuestions(false); setMenuOpen(false); }}>{locale === "zh-CN" ? "折叠全部章节" : "Collapse all chapters"}</button><button type="button" onClick={() => { setAllQuestions((value) => !value); setMenuOpen(false); }}>{allQuestions ? locale === "zh-CN" ? "查看章节" : "View chapters" : locale === "zh-CN" ? "查看全部问题" : "View all questions"}</button></div> : null}
      <div className="conversation-outline-list" aria-label={props.questionNavigation ? locale === "zh-CN" ? "问题导航" : "Question navigation" : props.onOverview ? locale === "zh-CN" ? "对话章节" : "Conversation chapters" : t("chaptersNavigation")}>
      {props.outlineLoading ? <p className="conversation-chapter-empty" role="status">{locale === "zh-CN" ? "正在读取章节…" : "Loading outline…"}</p> : null}
      {!props.outlineLoading && !allQuestions && (props.chapters?.length || props.manual) ? <div className="conversation-chapter-navigation">
        <div className="conversation-chapter-heading"><span className="eyebrow">{props.onOverview ? locale === "zh-CN" ? "对话章节" : "Conversation chapters" : t("chaptersNavigation")}</span>{props.editable && props.onCreateChapter ? <button type="button" onClick={() => setAddingChapter(true)} aria-label={locale === "zh-CN" ? "新建章节" : "New chapter"} title={locale === "zh-CN" ? "新建章节" : "New chapter"}><Plus size={16} /></button> : null}</div>
        {addingChapter ? <form className="conversation-chapter-create" onSubmit={(event) => { event.preventDefault(); const title = chapterDraft.trim(); if (!title) return; props.onCreateChapter?.(title); setChapterDraft(""); setAddingChapter(false); }}><input autoFocus value={chapterDraft} onChange={(event) => setChapterDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Escape") { setAddingChapter(false); setChapterDraft(""); } }} placeholder={locale === "zh-CN" ? "章节名称" : "Chapter title"} aria-label={locale === "zh-CN" ? "章节名称" : "Chapter title"} maxLength={52} /><button type="submit" disabled={!chapterDraft.trim()}>{locale === "zh-CN" ? "添加" : "Add"}</button></form> : null}
        {!props.chapters?.length ? <p className="conversation-chapter-empty">{locale === "zh-CN" ? "新建章节，再把下方问题拖到章节中。" : "Create a chapter, then drop questions into it."}</p> : null}
        {props.editable || searchedChapters.length <= 8 ? searchedChapters.map(renderChapter) : chronologicalGroups(searchedChapters, locale === "zh-CN").map((group) => <ChapterPhase key={group.id} title={group.title} count={group.items.length} active={group.items.some((item) => item.id === currentChapterId) && !props.overviewSelected} searching={Boolean(normalizedQuery)}>{group.items.map(renderChapter)}</ChapterPhase>)}
      </div> : null}
      {!props.outlineLoading && listedMessages.length && (allQuestions || !chapters.length || visibleMessages.length) ? <div className="conversation-message-list" aria-label={t("conversationMessages")}><div className="conversation-question-heading">{!allQuestions && props.chapters?.length && props.onSelectUnassigned ? <button type="button" className="conversation-unassigned-open" onClick={props.onSelectUnassigned}>{locale === "zh-CN" ? "未归入章节" : "Unassigned questions"}<span>{visibleMessages.length}</span></button> : <><span>{allQuestions ? locale === "zh-CN" ? "全部问题" : "All questions" : props.chapters?.length ? locale === "zh-CN" ? "未归入章节" : "Unassigned questions" : props.manual ? locale === "zh-CN" ? "待整理的问题" : "Questions to organize" : t("questionsOnly")}</span><span className="conversation-question-count">{normalizedQuery ? filteredMessages.length : listedMessages.length}</span></>}</div>{props.editable && props.chapters?.length && !allQuestions ? <p className="conversation-sidebar-drop-instruction">{locale === "zh-CN" ? "拖动问题到上方章节" : "Drag a question into a chapter above"}</p> : null}{filteredMessages.map((message, index) => index < questionLimit || message.id === props.selectedMessageId ? renderQuestion(message, questionPositions.get(message.id) ?? index) : null)}{filteredMessages.length > questionLimit ? <button type="button" className="conversation-picker-more" onClick={() => setQuestionLimit((limit) => limit + 80)}>{locale === "zh-CN" ? `显示更多问题（还有 ${filteredMessages.length - questionLimit} 条）` : `Show more questions (${filteredMessages.length - questionLimit} remaining)`}</button> : null}{questionQuery && !filteredMessages.length ? <p className="conversation-question-empty">{locale === "zh-CN" ? "没有匹配的问题" : "No matching questions"}</p> : null}</div> : null}
      </div>
      {props.onSelectTask ? <TaskSidebarSection runs={props.tasks ?? []} activeId={null} onSelect={props.onSelectTask} /> : null}
    </aside>
  );
}
