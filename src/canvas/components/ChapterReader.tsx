import { ArrowLeft, ArrowRight } from "lucide-react";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useEffect, useMemo, useRef } from "react";
import type { ContextEpisode, Conversation, ConversationChapter, ConversationGraph, ConversationMessage } from "../../shared/types";
import { usePreferences } from "../preferences";
import { QuestionReader } from "./QuestionReader";
import { ReaderLocator } from "./ReaderLocator";
import { questionDisplayTitle } from "../conversation-structurer";
import { dependsOnEarlierContext } from "../../ai/episode-candidates";
import { platformName } from "../../shared/platforms";

export function ChapterReader({ chapter, graph, conversation, messages, initialQuestionId, onClose, onChapter }: {
  chapter: ConversationChapter;
  graph: ConversationGraph;
  conversation: Conversation;
  messages: ConversationMessage[];
  initialQuestionId?: string | null;
  onClose: () => void;
  onChapter: (id: string) => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const scrollRef = useRef<HTMLDivElement>(null);
  const chapters = [...(graph.chapters ?? [])].sort((a, b) => a.order - b.order);
  const chapterIndex = chapters.findIndex((item) => item.id === chapter.id);
  const ordered = useMemo(() => [...messages].sort((a, b) => a.messageIndex - b.messageIndex), [messages]);
  const sections = useMemo(() => {
    const existing = graph.episodes?.filter((episode) => episode.chapterId === chapter.id) ?? [];
    const selectedIds = chapter.questionIds.map((id) => id.replace(/^conversation-message-/u, ""));
    if (existing.length && existing.flatMap((episode) => episode.questionIds).join("\u0000") === selectedIds.join("\u0000")) return existing;
    const selected = new Set(selectedIds);
    const groups: Array<{ questionIds: string[]; messageIds: string[] }> = [];
    let userOrder = -1;
    let previousSelectedOrder = -2;
    for (let index = 0; index < ordered.length; index += 1) {
      const message = ordered[index];
      if (message.role !== "user") continue;
      userOrder += 1;
      if (!selected.has(message.id)) continue;
      const next = ordered.findIndex((item, nextIndex) => nextIndex > index && item.role === "user");
      const segment = ordered.slice(index, next < 0 ? ordered.length : next).map((item) => item.id);
      if (previousSelectedOrder === userOrder - 1 && groups.length) { groups.at(-1)!.questionIds.push(message.id); groups.at(-1)!.messageIds.push(...segment); }
      else groups.push({ questionIds: [message.id], messageIds: segment });
      previousSelectedOrder = userOrder;
    }
    return groups.map<ContextEpisode>((group, index) => ({ id: `${chapter.id}-reading-${index}`, chapterId: chapter.id, conversationId: chapter.conversationId, title: groups.length === 1 ? chapter.title : questionDisplayTitle(ordered.find((message) => message.id === group.questionIds[0])?.content ?? chapter.title), ...group }));
  }, [graph.episodes, chapter, ordered]);
  const anchors = useMemo(() => sections.map((episode) => ({ id: `reader-${episode.id}`, title: episode.title })), [sections]);
  const byId = new Map(ordered.map((message) => [message.id, message]));
  const focus = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "instant" : "smooth", block: "start" });
  useEffect(() => { if (!initialQuestionId) return; const frame = requestAnimationFrame(() => focus(`reader-message-${initialQuestionId}`)); return () => cancelAnimationFrame(frame); }, [initialQuestionId]);
  const outline = sections.length > 1 ? anchors : chapter.questionIds.map((id) => { const messageId = id.replace(/^conversation-message-/u, ""); return { id: `reader-message-${messageId}`, title: questionDisplayTitle(byId.get(messageId)?.content ?? id) }; });
  return <aside className="chapter-reader" aria-label={zh ? "章节阅读" : "Chapter reader"}>
    <WorkspaceBackButton className="chapter-reader-back" onClick={onClose} label={zh ? "返回对话画布" : "Back to conversation canvas"} />
    <div className="chapter-reader-scroll" ref={scrollRef}>
      <div className="chapter-reader-content">
        <header className="chapter-reader-header"><span className="chapter-reader-eyebrow">{zh ? `第 ${chapterIndex + 1} 章 · ${chapter.questionIds.length} 个问题` : `Chapter ${chapterIndex + 1} · ${chapter.questionIds.length} questions`}</span><h1>{chapter.title}</h1></header>
        {outline.length > 1 ? <nav className="chapter-reader-overview" aria-label={zh ? "章节大纲" : "Chapter overview"}><h2>{zh ? "本章大纲" : "In this chapter"}</h2><ol>{outline.map((item, index) => <li key={item.id}><button onClick={() => focus(item.id)}><span>{String(index + 1).padStart(2, "0")}</span>{item.title}</button></li>)}</ol></nav> : null}
        {!sections.length ? <p className="chapter-reader-empty">{zh ? "本章还没有问题。返回画布，把问题拖到左侧章节中。" : "This chapter has no questions yet. Return to the canvas and drop questions into this chapter."}</p> : null}
        <div className="chapter-reader-sections">{sections.map((episode) => {
          const sectionMessages = episode.messageIds.map((id) => byId.get(id)).filter((message): message is ConversationMessage => Boolean(message));
          const first = sectionMessages[0];
          const firstPosition = first ? ordered.findIndex((message) => message.id === first.id) : -1;
          const priorQuestion = firstPosition > 0 ? ordered.slice(0, firstPosition).reverse().find((message) => message.role === "user") : undefined;
          const contextMessages = graph.organizationMode === "manual" && first && dependsOnEarlierContext(first.content) && priorQuestion
            ? ordered.slice(ordered.findIndex((message) => message.id === priorQuestion.id), firstPosition) : [];
          return <section id={`reader-${episode.id}`} key={episode.id} className="chapter-reader-section">{episode.title.trim() !== chapter.title.trim() ? <h2>{episode.title}</h2> : null}{episode.contextHeader ? <p className="chapter-reader-context">{episode.contextHeader}</p> : null}{contextMessages.length ? <div className="chapter-reader-prior-context"><p className="chapter-reader-context">{zh ? "理解这段追问需要的前文" : "Earlier context for this follow-up"}</p><QuestionReader messages={contextMessages} zh={zh} /></div> : null}<QuestionReader messages={sectionMessages} zh={zh} /></section>;
        })}</div>
        <div className="chapter-reader-source"><span>{zh ? "来源" : "Source"}</span><p>{conversation.title} · {platformName(conversation.platform, zh ? "zh-CN" : "en")}</p></div>
        <nav className="chapter-reader-path" aria-label={zh ? "章节路线" : "Chapter path"}>
          {chapters[chapterIndex - 1] ? <button onClick={() => onChapter(chapters[chapterIndex - 1].id)}><ArrowLeft size={16} />{chapters[chapterIndex - 1].title}</button> : <span />}
          {chapters[chapterIndex + 1] ? <button onClick={() => onChapter(chapters[chapterIndex + 1].id)}>{chapters[chapterIndex + 1].title}<ArrowRight size={16} /></button> : null}
        </nav>
      </div>
    </div>
    <ReaderLocator anchors={anchors} scrollRef={scrollRef} />
  </aside>;
}
