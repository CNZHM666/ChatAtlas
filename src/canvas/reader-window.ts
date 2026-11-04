import type { ConversationMessage } from "../shared/types";

export const READER_PAGE_MESSAGES = 24;
const PAGE_CHARACTERS = 24000;

export function readerPageEnd(messages: ConversationMessage[], start: number): number {
  let end = start;
  let characters = 0;
  while (end < messages.length && end - start < READER_PAGE_MESSAGES) {
    const next = messages[end].content.length;
    if (end > start && characters + next > PAGE_CHARACTERS) break;
    characters += next; end++;
  }
  return end;
}

export function readerWindow(messages: ConversationMessage[], focusMessageId?: string) {
  const index = focusMessageId ? messages.findIndex((message) => message.id === focusMessageId) : -1;
  const start = index < 0 ? 0 : Math.max(0, index - 2);
  return { start, end: Math.max(index + 1, readerPageEnd(messages, start)) };
}
