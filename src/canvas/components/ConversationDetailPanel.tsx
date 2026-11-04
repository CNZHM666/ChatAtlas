import { ArrowLeft, Check, Copy, MessageSquareText, PanelRightClose } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "../../shared/markdown-gfm";
import { readerEmphasis } from "../reader-emphasis";
import remarkMath from "remark-math";
import rehypeSanitize from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import { readerSanitizeSchema } from "../reader-sanitize";
import type { Conversation, ConversationGraph, ConversationGraphNode, ConversationMessage } from "../../shared/types";
import { hasReadableMessageGap, isInternalSearchQueryMessage, readableConversationText, renderableConversationText } from "../../shared/conversation-text";
import { episodeMessages, matchingEpisodes } from "../reader-path";
import { usePreferences } from "../preferences";

interface ConversationDetailPanelProps {
  conversation: Conversation;
  node: ConversationGraphNode;
  question?: ConversationMessage;
  answer?: ConversationMessage;
  messages?: ConversationMessage[];
  graph?: ConversationGraph | null;
  workspace?: boolean;
  loadingMessages?: boolean;
  onClose: () => void;
}

export function ConversationDetailPanel({ conversation, node, question, answer, messages, graph, workspace = false, loadingMessages = false, onClose }: ConversationDetailPanelProps) {
  const { t, locale } = usePreferences();
  const [fullAnswer, setFullAnswer] = useState(false);
  const [copied, setCopied] = useState(false);
  const [fullContext, setFullContext] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const answerText = answer && !isInternalSearchQueryMessage(answer) ? readableConversationText(answer.content) : "";
  const readableMessages = messages?.filter((message) => !isInternalSearchQueryMessage(message)) ?? [];
  const relatedContext = question && readableMessages.length ? episodeMessages(readableMessages, [{ conversationId: conversation.id, messageId: question.id }], [], graph) : [];
  const context = question && !relatedContext.some((message) => message.id === question.id) ? readableMessages : relatedContext;
  const episode = question ? matchingEpisodes([{ conversationId: conversation.id, messageId: question.id }], graph)[0] : undefined;
  const shownContext = fullContext ? readableMessages : context;
  const longAnswer = answerText.length > 600;
  const questionDate = question?.createdAt && question.createdAt >= Date.UTC(2000, 0, 1) && question.createdAt <= Date.now() + 86_400_000 ? question.createdAt : undefined;
  useLayoutEffect(() => {
    if (!workspace || !question || !context.length) return;
    const panel = panelRef.current;
    const target = panel?.querySelector<HTMLElement>("[data-reader-target='true']");
    if (!panel || !target) return;
    panel.scrollTop += target.getBoundingClientRect().top - panel.getBoundingClientRect().top - 96;
  }, [workspace, question, context.length]);
  const copyAnswer = async () => {
    try { await navigator.clipboard.writeText(answerText); setCopied(true); }
    catch { setCopied(false); }
  };

  return <aside ref={panelRef} className={`conversation-detail-panel ${workspace ? "is-workspace" : ""}`} aria-label={t("questionDetails")}>
    <header>{workspace ? <button className="conversation-reader-back" onClick={onClose}><ArrowLeft size={16} />{locale === "zh-CN" ? "返回画布" : "Back to canvas"}</button> : <span className="eyebrow">{t("questionCard")}</span>}{!workspace ? <button className="icon-button" onClick={onClose} aria-label={t("close")} title={t("close")}><PanelRightClose size={18} /></button> : null}</header>
    <h2>{node.displayTitle ?? node.title}</h2>
    {context.length ? <section className="conversation-context-section">
      <h3>{locale === "zh-CN" ? "当时的连续讨论" : "Original discussion in context"}</h3>
      {episode?.contextHeader ? <p className="knowledge-reader-intro">{locale === "zh-CN" ? "背景：" : "Context: "}{episode.contextHeader}</p> : null}
      <div className="conversation-context-messages">{shownContext.map((message, index) => <div key={message.id} data-reader-target={message.id === question?.id ? "true" : undefined}>
        {index > 0 && hasReadableMessageGap(messages ?? shownContext, shownContext[index - 1].messageIndex, message.messageIndex) ? <p className="knowledge-reader-gap">{locale === "zh-CN" ? "原对话中还有其他内容" : "Other messages in the original conversation"}</p> : null}
        <article className={`knowledge-reader-message is-${message.role}`}><span>{message.role === "user" ? locale === "zh-CN" ? "你" : "You" : "AI"}</span><div className="conversation-answer-markdown"><ReactMarkdown remarkPlugins={[[remarkGfm, GFM_OPTIONS], remarkMath, readerEmphasis]} rehypePlugins={[[rehypeSanitize, readerSanitizeSchema], rehypeKatex]} skipHtml>{renderableConversationText(message.content)}</ReactMarkdown></div></article>
      </div>)}</div>
      {context.length < readableMessages.length ? <button className="conversation-answer-more" onClick={() => setFullContext((value) => !value)}>{fullContext ? locale === "zh-CN" ? "收起完整对话" : "Show relevant discussion" : locale === "zh-CN" ? "在 ChatAtlas 查看完整对话" : "Read full conversation in ChatAtlas"}</button> : null}
    </section> : <section className="conversation-answer-section">
      {workspace && question ? <article className="knowledge-reader-message is-user"><span>{locale === "zh-CN" ? "你" : "You"}</span><div className="conversation-answer-markdown"><ReactMarkdown remarkPlugins={[[remarkGfm, GFM_OPTIONS], remarkMath, readerEmphasis]} rehypePlugins={[[rehypeSanitize, readerSanitizeSchema], rehypeKatex]} skipHtml>{renderableConversationText(question.content)}</ReactMarkdown></div></article> : null}
      {workspace && !question ? <p className="conversation-answer-empty">{loadingMessages ? locale === "zh-CN" ? "正在加载原始对话…" : "Loading the original discussion…" : locale === "zh-CN" ? "这条问题的原始内容暂不可用，请检查对话同步状态。" : "The original discussion is unavailable. Check the conversation sync status."}</p> : null}
      <div className="conversation-answer-heading"><h3>{t("aiAnswer")}{answerText ? <small> · {answerText.length} {t("characters")}</small> : null}</h3>{answerText ? <button type="button" onClick={() => void copyAnswer()} aria-label={copied ? t("answerCopied") : t("copyAnswer")} title={copied ? t("answerCopied") : t("copyAnswer")}>{copied ? <Check size={15} /> : <Copy size={15} />}</button> : null}</div>
      {answerText ? <div className={`conversation-answer-frame ${longAnswer && !fullAnswer ? "is-collapsed" : ""}`}><div className="conversation-answer-markdown"><ReactMarkdown remarkPlugins={[[remarkGfm, GFM_OPTIONS], remarkMath, readerEmphasis]} rehypePlugins={[[rehypeSanitize, readerSanitizeSchema], rehypeKatex]} skipHtml>{renderableConversationText(answerText)}</ReactMarkdown></div></div> : <p className="conversation-answer-empty">{t("noAnswerCaptured")}</p>}
      {longAnswer ? <button className="conversation-answer-more" aria-expanded={fullAnswer} onClick={() => setFullAnswer((value) => !value)}>{fullAnswer ? t("showAnswerPreview") : t("showFullAnswer")}</button> : null}
    </section>}
    <section className="conversation-source-section">
      <h3>{t("source")}</h3>
      <div className="conversation-detail-source"><MessageSquareText size={15} /><span>{conversation.title}</span>{questionDate ? <time>{new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(questionDate)}</time> : null}</div>
    </section>
  </aside>;
}
