import type { ConversationCapture, ConversationMessage } from "../shared/types";
import type { CaptureAdapter, ParsedChatMessage } from "./capture-adapter";
import { createContentHash, previewMessage } from "./message-identity";
import { sourceMessageSignature } from "../shared/source-signature";

function localMessageId(conversationId: string, message: ParsedChatMessage, hash: string, occurrence: number, platform: string, question?: string, answer = 0): string {
  const prefix = platform === "chatgpt" ? `chatgpt:${conversationId}` : conversationId;
  if (message.stableId) return `${prefix}:${message.stableId}`;
  // A growing answer without a native ID keeps its owning question's identity.
  if (platform !== "chatgpt" && message.role === "assistant" && question) return `${question}:answer:${answer}`;
  return `${prefix}:${message.role}:${hash}:${occurrence}`;
}

export async function buildConversationCapture(
  adapter: CaptureAdapter,
  capturedAt = Date.now(),
): Promise<ConversationCapture | null> {
  const detected = adapter.detectConversation();
  if (!detected) return null;
  const parsed = adapter.parseMessages();
  if (!parsed.length) return null;

  const occurrenceByHash = new Map<string, number>();
  const messages: ConversationMessage[] = [];
  const platform = adapter.platform ?? "chatgpt";
  let lastQuestionId: string | undefined;
  let answer = 0;
  for (const message of parsed) {
    const contentHash = await createContentHash(`${message.role}\n${message.text}`);
    const occurrenceKey = `${message.role}:${contentHash}`;
    const occurrence = occurrenceByHash.get(occurrenceKey) ?? 0;
    occurrenceByHash.set(occurrenceKey, occurrence + 1);
    message.element.dataset.atlasContentHash = contentHash;
    const id = localMessageId(detected.id, message, contentHash, occurrence, platform, lastQuestionId, answer);
    if (message.role === "user") { lastQuestionId = id; answer = 0; } else answer++;
    messages.push({
      id,
      conversationId: detected.id,
      platformMessageId: message.stableId,
      replyToMessageId: message.role === "assistant" ? lastQuestionId : undefined,
      messageIndex: message.index,
      role: message.role,
      content: message.text,
      ...(message.uiParts?.length ? { uiParts: message.uiParts } : {}),
      preview: previewMessage(message.text),
      contentHash,
      createdAt: capturedAt,
      updatedAt: capturedAt,
    });
  }

  return {
    conversation: {
      id: detected.id,
      platform,
      ...(platform !== "chatgpt" ? { source: `${platform}_dom` } : {}),
      title: detected.title,
      url: detected.url,
      createdAt: capturedAt,
      updatedAt: capturedAt,
      messageCount: messages.length,
    },
    messages,
    capturedAt,
  };
}

export function captureFingerprint(capture: ConversationCapture): string {
  const last = capture.messages.at(-1);
  return `${capture.conversation.id}:${capture.conversation.title}:${capture.messages.length}:${last?.contentHash ?? "empty"}:${sourceMessageSignature(JSON.stringify(capture.messages.map(message => [message.contentHash, message.uiParts ?? []])))}`;
}
