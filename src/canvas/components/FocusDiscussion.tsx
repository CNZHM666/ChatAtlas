import { memo, useEffect, useMemo, useState } from "react";
import type { FocusEvidence } from "../../shared/focus-session";
import type { ConversationGraph, ConversationMessage } from "../../shared/types";
import { invalidateReaderMessages, readerMessages } from "../reader-message-cache";
import { getStoredConversationGraph } from "../../storage/conversation-graphs";
import { readerQuestionIndex } from "../reader-position";
import { episodeMessages } from "../reader-path";
import { QuestionReader } from "./QuestionReader";
import { ReaderGuide } from "./ReaderGuide";

/** Resolve saved evidence into continuous original discussion rather than isolated Q&A. */
export const FocusDiscussion = memo(function FocusDiscussion({ evidence, zh, focusMessageId, focusExcerpt, showFull = false }: { evidence: FocusEvidence[]; zh: boolean; focusMessageId?: string; focusExcerpt?: string; showFull?: boolean }) {
  const [data, setData] = useState<{ messages: ConversationMessage[]; graph?: ConversationGraph } | null>(null);
  const [error, setError] = useState(false);
  const [full, setFull] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const conversationId = evidence[0]?.conversationId;
  useEffect(() => {
    let live = true;
    setData(null); setError(false);
    if (conversationId) void Promise.all([readerMessages(conversationId), getStoredConversationGraph(conversationId).catch(() => undefined)])
      .then(([messages, graph]) => { if (live) setData({ messages, graph: graph ?? undefined }); }).catch(() => { if (live) setError(true); });
    return () => { live = false; };
  }, [conversationId, attempt]);
  const questions = useMemo(() => readerQuestionIndex(data?.messages ?? []), [data]);
  const messages = useMemo(() => data ? full || showFull ? data.messages : episodeMessages(data.messages, evidence.map((item) => ({ conversationId: item.conversationId, messageId: item.messageId, questionId: questions.get(item.messageId) })), [], data.graph) : [], [data, full, showFull, evidence, questions]);
  if (error) return <p role="alert">{zh ? "原文读取失败。" : "Could not load discussion."} <button onClick={() => { if (conversationId) invalidateReaderMessages(conversationId); setAttempt((value) => value + 1); }}>{zh ? "重试" : "Retry"}</button></p>;
  if (!data) return <p role="status">{zh ? "读取原文…" : "Loading discussion…"}</p>;
  if (!data.messages.length) return <div><p>{zh ? "本地正文暂不可用。" : "The local discussion is unavailable."}</p>{evidence.some(ref => ref.excerpt.trim()) ? <section className="reader-source-excerpt"><h2>{zh ? "已保存的原文摘录" : "Saved source excerpt"}</h2>{[...new Set(evidence.map(ref => ref.excerpt.trim()).filter(Boolean))].map(excerpt => <ReaderGuide key={excerpt} content={excerpt} zh={zh} complete />)}</section> : null}<button type="button" onClick={() => { if (conversationId) invalidateReaderMessages(conversationId); setAttempt(value => value + 1); }}>{zh ? "重新读取" : "Reload"}</button></div>;
  const missing = !showFull && evidence.some((item) => !data.messages.some((message) => message.id === item.messageId));
  return <div className="focus-discussion">{missing ? <p className="muted">{zh ? "部分引用位置已更新，请核对完整原文。" : "Some cited positions have changed. Check the full discussion."}</p> : null}<QuestionReader contextMessages={data.messages} messages={messages} zh={zh} focusMessageId={focusMessageId} focusExcerpt={focusExcerpt} focusPlacement="question" />{messages.length < data.messages.length || full ? <button onClick={() => setFull(!full)}>{full ? zh ? "收起完整对话" : "Collapse full conversation" : zh ? "展开完整原始对话" : "Read full original conversation"}</button> : null}</div>;
});
