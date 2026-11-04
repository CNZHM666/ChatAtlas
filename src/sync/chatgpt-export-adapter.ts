import type { ConversationCapture } from "../shared/types";
import { normalizeHistoryConversation, type RawConversation } from "./chatgpt-normalizer";
import { createContentHash } from "../content/message-identity";

/** The export-file fallback shares ChatAtlas normalization, but never depends on a live web session. */
export class ChatGPTExportAdapter {
  revision(raw: RawConversation): Promise<string> {
    return createContentHash(JSON.stringify(raw));
  }

  async normalizeConversation(raw: RawConversation, revision?: string): Promise<ConversationCapture> {
    const capture = await normalizeHistoryConversation(raw);
    capture.conversation.source = "chatgpt_export";
    capture.conversation.sourceRevision = revision ?? await this.revision(raw);
    return capture;
  }
}
