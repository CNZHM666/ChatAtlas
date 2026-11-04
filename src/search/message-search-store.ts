import { getDatabase } from "../storage/db";

/** Disposable derived data. This database never owns or writes original messages. */
export interface MessageSearchDocument {
  id: string; generation: string; messageId: string; messageKey: string; conversationId: string;
  platform: string; title: string; body: string; terms: string[]; timestamp: number; chunk: number; sourceStart: number; sourceEnd: number; sourcePart: "content" | "ui"; partIndex: number;
}
export interface MessageSearchManifest {
  id: string; generation: string; messageId: string; conversationId: string; fingerprint: string; documentFingerprint: string; documentIds: string[];
}
export interface MessageSearchState {
  id: "state"; active?: string; version: number; epoch: number;
  building?: { generation: string; version: number; cursor?: string; processed: number };
  conversations: Record<string, string>; updatedAt: number;
}
export const getMessageSearchDatabase = getDatabase;
