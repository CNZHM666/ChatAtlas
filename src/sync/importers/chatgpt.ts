import { ChatGPTExportAdapter } from "../chatgpt-export-adapter";
import { normalizeHistoryItem, type RawConversation } from "../chatgpt-normalizer";
import { isRecord, type PlatformImporter } from "./types";

const adapter = new ChatGPTExportAdapter();

/** The original ChatGPT export path, unchanged: IDs, revisions and branch selection stay compatible. */
export const chatgptImporter: PlatformImporter<RawConversation> = {
  platform: "chatgpt",
  describe(raw) {
    if (!isRecord(raw.mapping)) throw new Error("Conversation detail is missing its message mapping.");
    const item = normalizeHistoryItem(raw);
    if (!item) throw new Error("Conversation is missing its ID.");
    return item;
  },
  revision: raw => adapter.revision(raw),
  normalize: (raw, revision) => adapter.normalizeConversation(raw, revision),
};

export const looksLikeChatGPT = (item: unknown) => isRecord(item) && isRecord(item.mapping) && !Object.values(item.mapping).some(node => isRecord(node) && isRecord(node.message) && Array.isArray(node.message.fragments));
