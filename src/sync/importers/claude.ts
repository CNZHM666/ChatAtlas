import { baseConversation, captureFromDrafts, importRevision, isRecord, sourceTimestamp, type DraftMessage, type PlatformImporter } from "./types";

/** Claude data export (Settings → Privacy → Export data): conversations.json is an
 * array of {uuid,name,created_at,updated_at,chat_messages:[{uuid,sender,text,content,...}]}. */
export interface ClaudeConversation { uuid?: string; name?: string; created_at?: string; updated_at?: string; chat_messages?: ClaudeMessage[] }
interface ClaudeMessage { uuid?: string; sender?: string; text?: string; content?: unknown[]; created_at?: string; parent_message_uuid?: string; attachments?: Array<{ file_name?: string; extracted_content?: string }>; files?: Array<{ file_name?: string }> }

// Pasted long text arrives as an attachment; keep it, but bounded per message.
const MAX_ATTACHMENT_CHARACTERS = 20_000;
const ROOT = "00000000-0000-4000-8000-000000000000";

export const looksLikeClaude = (item: unknown) => isRecord(item) && typeof item.uuid === "string" && Array.isArray(item.chat_messages);

function blockText(block: unknown): string {
  if (!isRecord(block)) return "";
  // Thinking and ordinary tool traffic are process, not the discussion itself.
  if (block.type === "text" && typeof block.text === "string") return block.text;
  // Artifacts are the substantive output of many Claude answers.
  if (block.type === "tool_use" && block.name === "artifacts" && isRecord(block.input) && typeof block.input.content === "string") {
    const title = typeof block.input.title === "string" ? block.input.title : "Artifact";
    const language = typeof block.input.language === "string" && /^[\w-]+$/u.test(block.input.language) ? block.input.language : typeof block.input.type === "string" && /markdown/u.test(block.input.type) ? "markdown" : "text";
    const fence = "`".repeat(Math.max(2, ...Array.from(block.input.content.matchAll(/`+/gu), match => match[0].length)) + 1);
    return `**${title}**\n\n${fence}${language}\n${block.input.content}\n${fence}`;
  }
  return "";
}

function messageText(message: ClaudeMessage): string {
  const blocks = Array.isArray(message.content) ? message.content.map(blockText).filter(Boolean) : [];
  const body = blocks.length ? blocks.join("\n\n") : typeof message.text === "string" ? message.text : "";
  const attachments = (message.attachments ?? []).flatMap(item => typeof item?.extracted_content === "string" && item.extracted_content.trim()
    ? [`【附件 ${item.file_name ?? ""}】\n${item.extracted_content.length > MAX_ATTACHMENT_CHARACTERS ? `${item.extracted_content.slice(0, MAX_ATTACHMENT_CHARACTERS)}\n…（附件过长，已截断）` : item.extracted_content}`] : []);
  const files = (message.files ?? []).flatMap(item => typeof item?.file_name === "string" ? [`【文件 ${item.file_name}】`] : []);
  return [body, ...attachments, ...files].filter(text => text.trim()).join("\n\n");
}

/** Edited or regenerated turns form a tree. Follow the latest leaf back to the root,
 * like ChatGPT's current_node, so abandoned branches are not mixed in. */
function activeMessages(messages: ClaudeMessage[]): ClaudeMessage[] {
  if (!messages.length || !messages.every(message => typeof message.uuid === "string" && typeof message.parent_message_uuid === "string")) return messages;
  const byId = new Map(messages.map(message => [message.uuid!, message]));
  const parents = new Set(messages.map(message => message.parent_message_uuid));
  const leaves = messages.filter(message => !parents.has(message.uuid));
  const latest = leaves.reduce((best, message) => (sourceTimestamp(message.created_at) ?? 0) >= (sourceTimestamp(best.created_at) ?? 0) ? message : best, leaves[0] ?? messages.at(-1)!);
  const path: ClaudeMessage[] = [];
  const seen = new Set<string>();
  for (let current: ClaudeMessage | undefined = latest; current && !seen.has(current.uuid!); current = current.parent_message_uuid === ROOT ? undefined : byId.get(current.parent_message_uuid!)) { seen.add(current.uuid!); path.push(current); }
  return path.reverse();
}

export const claudeImporter: PlatformImporter<ClaudeConversation> = {
  platform: "claude",
  describe(raw) {
    if (typeof raw.uuid !== "string" || !raw.uuid) throw new Error("Claude conversation is missing its ID.");
    if (!Array.isArray(raw.chat_messages)) throw new Error("Claude conversation is missing its messages.");
    const createdAt = sourceTimestamp(raw.created_at);
    return baseConversation({ id: `claude:${raw.uuid}`, platform: "claude", source: "claude_export", title: raw.name ?? "", url: `https://claude.ai/chat/${encodeURIComponent(raw.uuid)}`, createdAt, updatedAt: sourceTimestamp(raw.updated_at) ?? createdAt });
  },
  revision: importRevision,
  async normalize(raw, revision, capturedAt) {
    const conversation = { ...claudeImporter.describe(raw), sourceRevision: revision };
    const drafts = activeMessages(raw.chat_messages ?? []).flatMap((message): DraftMessage[] => {
      const role = message.sender === "human" ? "user" : message.sender === "assistant" ? "assistant" : undefined;
      return role ? [{ id: message.uuid, role, content: messageText(message), createdAt: sourceTimestamp(message.created_at) }] : [];
    });
    return captureFromDrafts(conversation, drafts, capturedAt);
  },
};
