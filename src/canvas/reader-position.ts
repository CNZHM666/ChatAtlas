import type { ConversationMessage } from "../shared/types";

/** Messages are in discussion order. Build this once, rather than scanning the
 * entire transcript on every scroll frame to find the preceding question. */
export function readerQuestionIndex(messages: ConversationMessage[]): Map<string, string> {
  const questions = new Map<string, string>();
  const byId = new Map(messages.flatMap(message => [[message.id, message], ...(message.platformMessageId ? [[message.platformMessageId, message] as const] : [])] as Array<readonly [string, ConversationMessage]>));
  let current: string | undefined;
  for (const message of messages) {
    if (message.role === "user") current = message.id;
    const parent = message.replyToMessageId ? byId.get(message.replyToMessageId) : undefined;
    const owner = parent?.role === "user" ? parent.id : parent ? questions.get(parent.id) : undefined;
    if (owner || current) questions.set(message.id, owner ?? current!);
  }
  return questions;
}

/** Ordered message wrappers allow logarithmic layout reads. Never measure all
 * offscreen Markdown descendants just to update the highlighted question. */
export function readerPosition(length: number, topAt: (index: number) => number, boundary: number): number {
  if (!length) return -1;
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (topAt(middle) <= boundary) low = middle + 1;
    else high = middle;
  }
  return Math.max(0, low - 1);
}
