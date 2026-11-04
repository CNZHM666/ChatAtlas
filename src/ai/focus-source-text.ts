import type { Conversation } from "../shared/types";
import type { TranscriptPassage } from "../search/transcript-index";
import { getMessagesForConversation } from "../storage/messages";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";

/** Small goal-retrieval windows, built locally without another database/index pass. */
export function sampleReadingPassages(full: TranscriptPassage[]): TranscriptPassage[] {
  return full.flatMap((passage, index) => {
    const windows: TranscriptPassage[] = [];
    const previous = full[index - 1];
    const next = full[index + 1];
    for (let start = 0; start < passage.text.length;) {
      let end = Math.min(passage.text.length, start + 1200);
      if (end < passage.text.length && /[\uD800-\uDBFF]/u.test(passage.text[end - 1])) end--;
      const text = passage.text.slice(start, end);
      const before = start ? passage.text.slice(Math.max(0, start - 300), start) : previous?.document.conversationId === passage.document.conversationId && passage.evidence.messageIndex === previous.evidence.messageIndex + 1 ? `${previous.role}: ${previous.text.slice(-400)}` : "";
      const after = end < passage.text.length ? passage.text.slice(end, end + 300) : next?.document.conversationId === passage.document.conversationId && next.evidence.messageIndex === passage.evidence.messageIndex + 1 ? `${next.role}: ${next.text.slice(0, 400)}` : "";
      windows.push({ ...passage, start, end, text, before, after,
        document: { ...passage.document, id: `${passage.document.id}:${start}`, body: [before, `${passage.role}: ${text}`, after].filter(Boolean).join("\n") },
        evidence: { ...passage.evidence, excerpt: text.slice(0, 240) } });
      start = end;
    }
    return windows;
  });
}

/** Full reading needs original messages, not overlapping search windows or a persistent search index. */
export async function loadFullReadingPassages(sources: Conversation[], signal: AbortSignal): Promise<{ passages: TranscriptPassage[]; missing: number }> {
  const passages: TranscriptPassage[] = [];
  let missing = 0;
  let sliceStarted = performance.now();
  for (const source of sources) {
    signal.throwIfAborted();
    const messages = await getMessagesForConversation(source.id);
    let included = 0;
    for (const message of messages) {
      signal.throwIfAborted();
      if (!message.content.length || isInternalSearchQueryMessage(message)) continue;
      passages.push({
        document: { id: `reading:${source.id}:${message.id}`, conversationId: source.id, episodeId: "", title: source.title.slice(0, 140), body: `${message.role}: ${message.content}`, terms: "" },
        evidence: { messageId: message.id, messageIndex: message.messageIndex, excerpt: message.content.slice(0, 240) },
        text: message.content, role: message.role, start: 0, end: message.content.length,
      });
      included++;
      if (performance.now() - sliceStarted >= 6) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        sliceStarted = performance.now();
      }
    }
    if (!included) missing++;
  }
  signal.throwIfAborted();
  return { passages, missing };
}
