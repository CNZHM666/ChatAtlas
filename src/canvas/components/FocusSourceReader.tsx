import { useEffect, useState } from "react";
import type { Conversation, ConversationMessage } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import { invalidateReaderMessages } from "../reader-message-cache";
import { OriginalReader, type ReaderEvidenceSteps } from "./OriginalReader";
import { ReaderGuide } from "./ReaderGuide";
import { readSessionSource } from "../../storage/source-versions";

export function FocusSourceReader({ conversation, session, zh, onBack, targetMessageId, targetExcerpt, sourceVersionId, evidenceSteps }: { conversation: Conversation; session: FocusSession; zh: boolean; onBack: () => void; targetMessageId?: string; targetExcerpt?: string; sourceVersionId?: string; evidenceSteps?: ReaderEvidenceSteps }) {
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { let live = true; setLoading(true); setMessages([]); setError(""); void readSessionSource(session, conversation.id, targetMessageId, sourceVersionId).then((items) => { if (live) setMessages(items); }).catch(() => { if (live) setError(zh ? "原文读取失败" : "Could not read source"); }).finally(() => { if (live) setLoading(false); }); return () => { live = false; }; }, [conversation.id, session, targetMessageId, sourceVersionId, attempt, zh]);
  const target = messages.find(message => message.id === targetMessageId || Boolean(targetMessageId && message.platformMessageId === targetMessageId));
  const excerpt = targetExcerpt || session.evidence.find(ref => ref.conversationId === conversation.id && ref.messageId === targetMessageId)?.excerpt;
  return <OriginalReader conversation={conversation} messages={messages} loading={loading} error={error} reviews={[session]} targetMessageId={target?.id ?? targetMessageId} targetExcerpt={targetExcerpt} emptyContent={excerpt ? <section className="reader-source-excerpt"><h2>{zh ? "已保存的原文摘录" : "Saved source excerpt"}</h2><ReaderGuide content={excerpt} zh={zh} complete /></section> : undefined} backLabel={zh ? "返回阅读原位置" : "Back to reading"} onBack={onBack} evidenceSteps={evidenceSteps} onRetry={() => { invalidateReaderMessages(conversation.id); setAttempt((value) => value + 1); }} />;
}
