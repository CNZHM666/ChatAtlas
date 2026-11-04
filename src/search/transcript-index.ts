import type { Conversation, ConversationMessage } from "../shared/types";
import { getMessagesForConversation } from "../storage/messages";
import type { SemanticDocument } from "./semantic-index";
import { getDatabase } from "../storage/db";

export interface SourceEvidence {
  messageId: string;
  messageIndex: number;
  excerpt: string;
}

export interface TranscriptPassage {
  document: SemanticDocument;
  evidence: SourceEvidence;
  text: string;
  start?: number;
  end?: number;
  before?: string;
  after?: string;
  role?: "user" | "assistant";
  /** Original message time when available; never the conversation import time. */
  discussedAt?:number;
}

/** Cover every message, including the end of long answers. Context resolves short follow-ups. */
export function transcriptPassages(conversation: Conversation, messages: ConversationMessage[]): TranscriptPassage[] {
  return [...iterateTranscriptPassages(conversation, messages)];
}

function* iterateTranscriptPassages(conversation: Conversation, messages: ConversationMessage[]): Generator<TranscriptPassage> {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  for (const [index, message] of ordered.entries()) {
    const before = ordered.slice(Math.max(0, index - 2), index).map((item) => `${item.role}: ${item.content.slice(-220)}`).join("\n");
    const after = ordered[index + 1];
    const afterText = after ? `${after.role}: ${after.content.slice(0, 220)}` : "";
    for (let offset = 0; offset < message.content.length; offset += 800) {
      const text = message.content.slice(offset, offset + 1000);
      const body = [before, `${message.role}: ${text}`, afterText].filter(Boolean).join("\n");
      yield {
        document: { id: `passage:${conversation.id}:${message.id}:${offset}`, conversationId: conversation.id, episodeId: "", title: conversation.title.slice(0, 140), body, terms: "" },
        evidence: { messageId: message.id, messageIndex: message.messageIndex, excerpt: text.slice(0, 240) },
        text,
        start: offset, end: offset + text.length, before, after: afterText, role: message.role,
      };
      if (offset + 1000 >= message.content.length) break;
    }
  }
}

export async function loadTranscriptPassages(conversations: Conversation[], signal?: AbortSignal): Promise<{ passages: TranscriptPassage[]; missing: number }> {
  const passages: TranscriptPassage[] = [];
  let missing = 0;
  for (let start = 0; start < conversations.length; start += 24) {
    signal?.throwIfAborted();
    const batch = await Promise.all(conversations.slice(start, start + 24).map(async (conversation) => {
      const result = await indexedTranscriptPassages(conversation);
      if (!result.length) missing++;
      return result;
    }));
    for (const group of batch) for (const passage of group) passages.push(passage);
  }
  signal?.throwIfAborted();
  return { passages, missing };
}

function fingerprint(conversation: Conversation): string {
  return `2:${conversation.updatedAt}:${conversation.messageCount}:${conversation.sourceUpdatedAt ?? ""}`;
}

async function indexedTranscriptPassages(conversation: Conversation): Promise<TranscriptPassage[]> {
  const db = await getDatabase();
  const cached = await db.get("transcriptIndexes", conversation.id);
  if (cached?.fingerprint === fingerprint(conversation)) return cached.passages;
  const messages = await getMessagesForConversation(conversation.id);
  const passages: TranscriptPassage[] = [];
  let sliceStarted = performance.now();
  for (const passage of iterateTranscriptPassages(conversation, messages)) {
    passages.push(passage);
    if (performance.now() - sliceStarted >= 6) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      sliceStarted = performance.now();
    }
  }
  await db.put("transcriptIndexes", { id: conversation.id, fingerprint: fingerprint(conversation), passages });
  return passages;
}

/** Warm the index after capture; retrieval can build it on demand before then. */
export async function refreshTranscriptIndex(conversationId: string): Promise<void> {
  const db = await getDatabase();
  const conversation = await db.get("conversations", conversationId);
  if (conversation) await indexedTranscriptPassages(conversation);
}

const pendingRefresh = new Set<string>();
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let refreshRunning = false;

export function queueTranscriptIndexRefresh(conversationId: string): void {
  pendingRefresh.add(conversationId);
  if (refreshTimer || refreshRunning) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    const next = pendingRefresh.values().next().value;
    if (!next) return;
    pendingRefresh.delete(next);
    refreshRunning = true;
    const run = () => {
      void refreshTranscriptIndex(next).catch(() => undefined).finally(() => {
        refreshRunning = false;
        if (pendingRefresh.size) queueTranscriptIndexRefresh(pendingRefresh.values().next().value!);
      });
    };
    if (typeof requestIdleCallback === "function") requestIdleCallback(run, { timeout: 5000 });
    else run();
  }, 1500);
}

const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase();
export function matchingTerms(text: string, terms: string[]): string[] {
  const normalized = normalize(text);
  return terms.filter((term) => {
    const needle = normalize(term);
    return /^[a-z0-9+#. _-]+$/u.test(needle)
      ? new RegExp(`(^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}(?=$|[^a-z0-9])`, "u").test(normalized)
      : normalized.includes(needle);
  });
}

/** Excerpts are copied from the matching passage, never generated by a model. */
export function passageEvidence(passage: TranscriptPassage, terms: string[]): SourceEvidence {
  const matches = matchingTerms(passage.text, terms).sort((a, b) => b.length - a.length);
  const position = matches.length ? normalize(passage.text).indexOf(normalize(matches[0])) : 0;
  const start = Math.max(0, position - 60);
  return { ...passage.evidence, excerpt: `${start ? "…" : ""}${passage.text.slice(start, start + 240)}${start + 240 < passage.text.length ? "…" : ""}` };
}
