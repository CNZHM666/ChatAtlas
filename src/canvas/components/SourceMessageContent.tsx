import type { ConversationMessage } from "../../shared/types";
import { messagePresentation } from "../../shared/message-ui";
import { ReaderMarkdown } from "./ReaderConversation";
import { ReaderPlatformUI } from "./ReaderPlatformUI";

/** The reader's original-message renderer, also used by previews and evidence. */
export function SourceMessageContent({ content, message, zh, sourceUrl, locatable = false }: { content?: string; message?: ConversationMessage; zh: boolean; sourceUrl?: string; locatable?: boolean }) {
  return <div className="source-message-content conversation-answer-markdown">{messagePresentation(content ?? message?.content ?? "", message?.uiParts, message?.role === "user", true).map((part, index) => part.kind === "text"
    ? <ReaderMarkdown key={index} content={part.text} sourceStart={part.sourceStart} zh={zh} literalWidgets={message?.role === "user"} literalCode={locatable} />
    : <ReaderPlatformUI key={index} raw={part.raw} fallbackText={part.fallbackText} truncated={part.truncated} sourceUrl={sourceUrl} zh={zh} />)}</div>;
}
