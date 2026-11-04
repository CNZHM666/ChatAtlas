import { chatgptImporter, looksLikeChatGPT } from "./chatgpt";
import { claudeImporter, looksLikeClaude } from "./claude";
import { deepseekImporter, looksLikeDeepSeek } from "./deepseek";
import { geminiImporter, geminiSessions, looksLikeGeminiActivity } from "./gemini";
import { genericImporter, genericJsonConversations, markdownConversation } from "./generic";
import type { ImportRecord, PlatformImporter } from "./types";

export type { ImportRecord, PlatformImporter } from "./types";

const IMPORTERS: Record<string, PlatformImporter<never>> = { chatgpt: chatgptImporter, claude: claudeImporter, deepseek: deepseekImporter, gemini: geminiImporter, generic: genericImporter };

export function importerFor(record: ImportRecord): PlatformImporter<unknown> {
  const importer = IMPORTERS[record.platform];
  if (!importer) throw new Error(`Unsupported import format: ${record.platform}`);
  return importer as PlatformImporter<unknown>;
}

// ChatGPT shards are conversations.json or conversations-N.json; Claude and
// DeepSeek also name their file conversations.json, so content decides.
export const CHATGPT_EXPORT_NAME = /(?:^|\/)conversations(?:[-_][\w-]+)?\.json$/iu;

/** JSON filenames vary across exporters. Content decides whether an entry is a chat. */
export const isConversationEntry = (name: string) => /\.json$/iu.test(name);

/** Detect a format by content, sampling a few items so one odd record cannot
 * switch the whole file. Returns undefined for files with no conversations. */
export function recordsFromJson(data: unknown, name: string): ImportRecord[] | undefined {
  if (Array.isArray(data)) {
    const sample = data.slice(0, 20);
    const majority = (test: (item: unknown) => boolean) => sample.length > 0 && sample.filter(test).length * 2 > sample.length;
    if (majority(looksLikeClaude)) return data.map(raw => ({ platform: "claude", raw }));
    if (majority(looksLikeDeepSeek)) return data.map(raw => ({ platform: "deepseek", raw }));
    if (majority(looksLikeChatGPT)) return data.map(raw => ({ platform: "chatgpt", raw }));
    if (sample.some(looksLikeGeminiActivity)) return geminiSessions(data.filter(looksLikeGeminiActivity)).map(raw => ({ platform: "gemini", raw }));
  }
  const generic = genericJsonConversations(data, name.split("/").at(-1) ?? name);
  if (generic) return generic.map(raw => ({ platform: "generic", raw }));
  // Keep the established ChatGPT behaviour: its shards report per-record errors.
  if (Array.isArray(data) && CHATGPT_EXPORT_NAME.test(name)) return data.map(raw => ({ platform: "chatgpt", raw }));
  return undefined;
}

export function recordsFromMarkdown(text: string, name: string): ImportRecord[] | undefined {
  const conversation = markdownConversation(text, name.split("/").at(-1) ?? name);
  return conversation ? [{ platform: "generic", raw: conversation }] : undefined;
}
