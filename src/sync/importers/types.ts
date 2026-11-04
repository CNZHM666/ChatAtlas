import type { Conversation, ConversationCapture, ConversationMessage } from "../../shared/types";
import { createContentHash, normalizeMessageText, previewMessage } from "../../content/message-identity";

/** One conversation found in an export file, tagged with the importer that owns it.
 * Records cross a worker boundary, so raw must stay structured-clone friendly. */
export interface ImportRecord { platform: string; raw: unknown }

export interface PlatformImporter<Raw = unknown> {
  platform: string;
  /** Validate one record and return its metadata without normalizing messages. Throws when unusable. */
  describe(raw: Raw): Conversation;
  /** Content fingerprint used to skip unchanged re-imports. */
  revision(raw: Raw): Promise<string>;
  normalize(raw: Raw, revision: string, capturedAt?: number): Promise<ConversationCapture>;
}

export interface DraftMessage { id?: string; role: "user" | "assistant"; content: string; createdAt?: number }

/** Accept only plausible provider timestamps; unknown stays unknown, never "now". */
export function sourceTimestamp(value: unknown): number | undefined {
  const milliseconds = typeof value === "number" ? (value < 1e12 ? value * 1000 : value) : typeof value === "string" && value.trim() ? (/^\d+(?:\.\d+)?$/u.test(value.trim()) ? sourceTimestamp(Number(value)) : Date.parse(value)) : NaN;
  return typeof milliseconds === "number" && Number.isFinite(milliseconds) && milliseconds >= Date.UTC(2000, 0, 1) && milliseconds <= Date.now() + 86_400_000 ? milliseconds : undefined;
}

export const importRevision = (raw: unknown) => createContentHash(JSON.stringify(raw));

/** Shared final step: stable message IDs, user→assistant reply links and hashes. */
export async function captureFromDrafts(conversation: Conversation, drafts: DraftMessage[], capturedAt = Date.now()): Promise<ConversationCapture> {
  const messages: ConversationMessage[] = [];
  const occurrence = new Map<string, number>();
  let lastUserId: string | undefined;
  for (const draft of drafts) {
    const content = normalizeMessageText(draft.content);
    if (!content) continue;
    const contentHash = await createContentHash(`${draft.role}\n${content}`);
    const occurrenceKey = `${draft.role}:${contentHash}`;
    const count = occurrence.get(occurrenceKey) ?? 0;
    occurrence.set(occurrenceKey, count + 1);
    // Without a platform ID, content plus occurrence keeps re-imports stable.
    const platformMessageId = draft.id ?? `${occurrenceKey}:${count}`;
    const id = `${conversation.id}:${platformMessageId}`;
    if (draft.role === "user") lastUserId = id;
    messages.push({ id, conversationId: conversation.id, platformMessageId, replyToMessageId: draft.role === "assistant" ? lastUserId : undefined, messageIndex: messages.length, role: draft.role, content, preview: previewMessage(content), contentHash, sourceCreatedAt: draft.createdAt, createdAt: draft.createdAt ?? capturedAt, updatedAt: capturedAt });
  }
  return { conversation: { ...conversation, messageCount: messages.length, importState: "complete", hydrationState: "hydrated" }, messages, capturedAt };
}

export function baseConversation(fields: { id: string; platform: string; source: string; title: string; url?: string; createdAt?: number; updatedAt?: number }): Conversation {
  return { id: fields.id, platform: fields.platform, title: fields.title.trim().slice(0, 300) || "Untitled conversation", url: fields.url ?? "", createdAt: fields.createdAt, updatedAt: fields.updatedAt ?? fields.createdAt ?? Date.now(), sourceCreatedAt: fields.createdAt, sourceUpdatedAt: fields.updatedAt, source: fields.source, messageCount: null, importState: "discovered", hydrationState: "metadata_only" };
}

export const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
