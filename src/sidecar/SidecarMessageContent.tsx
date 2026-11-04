import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "../shared/markdown-gfm";
import type { ConversationMessage } from "../shared/types";
import { renderableConversationText } from "../shared/conversation-text";
import { messagePresentation } from "../shared/message-ui";
import { ReaderCodeBlock } from "../canvas/components/ReaderCodeBlock";
import { ReaderPlatformUI } from "../canvas/components/ReaderPlatformUI";

/** Same source presentation as the reader, without loading its math/graph runtime. */
export function SidecarMessageContent({ message, sourceUrl, zh }: { message: ConversationMessage; sourceUrl: string; zh: boolean }) {
  const original = /^https:\/\/(?:chatgpt\.com|chat\.openai\.com)\/c\//u.test(sourceUrl) ? sourceUrl : undefined;
  return messagePresentation(message.content, message.uiParts, message.role === "user").map((part, index) => part.kind === "ui"
    ? <ReaderPlatformUI key={index} raw={part.raw} fallbackText={part.fallbackText} truncated={part.truncated} sourceUrl={original} zh={zh} />
    : <ReactMarkdown key={index} remarkPlugins={[[remarkGfm, GFM_OPTIONS]]} skipHtml components={{ pre: ({ children }) => <ReaderCodeBlock zh={zh} copy>{children}</ReaderCodeBlock> }}>{renderableConversationText(part.text, message.role === "user")}</ReactMarkdown>);
}
