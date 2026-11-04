import { useEffect, useState } from "react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { readSessionSource } from "../../storage/source-versions";
import { discussionExcerpt } from "../../shared/discussion-context";
import { SourceMessageContent } from "./SourceMessageContent";
import type { ConversationMessage } from "../../shared/types";

export function HomeEvidencePreview({ evidence, answer, zh }: { evidence: FocusEvidence; answer: FocusSession; zh: boolean }) {
  const [content, setContent] = useState(evidence.excerpt);
  const [context, setContext] = useState<ConversationMessage[]>([]), [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let live = true;
    void readSessionSource(answer, evidence.conversationId, evidence.messageId, evidence.sourceVersionId).then(messages => {
      const message = messages.find(item => item.id === evidence.messageId);
      if (!live || !message) return;
      const excerpt = evidence.excerpt.replace(/^…|…$/gu, ""), at = excerpt ? message.content.indexOf(excerpt) : -1;
      setContent(discussionExcerpt(message.content, at >= 0 ? { start: at, end: at + excerpt.length } : undefined));
      const position = messages.indexOf(message);
      let start = Math.max(0, position - 1);
      if (messages[start]?.role === "assistant" && messages[start - 1]?.role === "user") start--;
      setContext(messages.slice(start, Math.min(messages.length, position + 2)));
    }).catch(() => { /* Retained excerpt remains readable if originals are unavailable. */ });
    return () => { live = false; };
  }, [answer, evidence]);
  return <><SourceMessageContent content={content} zh={zh} />{context.length ? <details onToggle={event => setExpanded(event.currentTarget.open)}><summary>{zh ? "前后对话" : "Surrounding conversation"}</summary>{expanded ? context.map(message => <section key={message.id}><small>{message.role === "user" ? zh ? "我的提问" : "My question" : zh ? "AI 回复" : "AI reply"}</small><SourceMessageContent message={message} zh={zh} /></section>) : null}</details> : null}</>;
}
