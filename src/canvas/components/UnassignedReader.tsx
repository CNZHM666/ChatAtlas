import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useEffect, useMemo, useRef } from "react";
import type { Conversation, ConversationMessage } from "../../shared/types";
import { questionDisplayTitle } from "../conversation-structurer";
import { usePreferences } from "../preferences";
import { QuestionReader } from "./QuestionReader";

export function UnassignedReader({ conversation, messages, questionIds, initialQuestionId, variant = "unassigned", onClose }: {
  conversation: Conversation;
  messages: ConversationMessage[];
  questionIds: string[];
  initialQuestionId?: string | null;
  variant?: "unassigned" | "chronological";
  onClose: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const chronological = variant === "chronological";
  const scrollRef = useRef<HTMLDivElement>(null);
  const sections = useMemo(() => {
    const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
    const selected = new Set(questionIds);
    return ordered.flatMap((message, index) => {
      if (message.role !== "user" || !selected.has(message.id)) return [];
      const next = ordered.findIndex((item, position) => position > index && item.role === "user");
      return [{ question: message, messages: ordered.slice(index, next < 0 ? ordered.length : next) }];
    });
  }, [messages, questionIds]);
  const focus = (id: string) => [...(scrollRef.current?.querySelectorAll<HTMLElement>("[data-question-id]") ?? [])].find((element) => element.dataset.questionId === id)?.scrollIntoView?.({ block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "instant" : "smooth" });
  useEffect(() => {
    if (!initialQuestionId) return;
    const frame = requestAnimationFrame(() => focus(initialQuestionId));
    return () => cancelAnimationFrame(frame);
  }, [initialQuestionId]);

  return <aside className="chapter-reader unassigned-reader" aria-label={chronological ? zh ? "原对话阅读" : "Original conversation reader" : zh ? "未归入章节阅读" : "Unassigned questions reader"}>
    <WorkspaceBackButton className="chapter-reader-back" onClick={onClose} label={zh ? "返回对话画布" : "Back to conversation canvas"} />
    <div className="chapter-reader-scroll" ref={scrollRef}>
      <div className="chapter-reader-content">
        <header className="chapter-reader-header"><span className="chapter-reader-eyebrow">{conversation.title} · {sections.length} {zh ? "个问题" : "questions"}</span><h1>{chronological ? zh ? "按时间顺序" : "Chronological conversation" : zh ? "未归入章节" : "Unassigned questions"}</h1></header>
        {sections.length > 1 ? <nav className="chapter-reader-overview" aria-label={chronological ? zh ? "原对话大纲" : "Original conversation outline" : zh ? "未归入章节大纲" : "Unassigned questions outline"}><h2>{zh ? "问题列表" : "Questions"}</h2><ol>{sections.map(({ question }, index) => <li key={question.id}><button type="button" onClick={() => focus(question.id)}><span>{String(index + 1).padStart(2, "0")}</span>{questionDisplayTitle(question.preview || question.content)}</button></li>)}</ol></nav> : null}
        <div className="chapter-reader-sections">{sections.map(({ question, messages: discussion }) => <section key={question.id} data-question-id={question.id} className="chapter-reader-section"><h2>{questionDisplayTitle(question.preview || question.content)}</h2><QuestionReader messages={discussion} zh={zh} /></section>)}</div>
      </div>
    </div>
  </aside>;
}
