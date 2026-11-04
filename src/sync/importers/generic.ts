import { sourceMessageSignature } from "../../shared/source-signature";
import { platformFromLabel } from "../../shared/platforms";
import { baseConversation, captureFromDrafts, importRevision, isRecord, sourceTimestamp, type DraftMessage, type PlatformImporter } from "./types";

/** Platform-neutral conversation for files without an official export: JSON
 * produced by exporter extensions/scripts, and Markdown transcripts. Parsing
 * happens before the worker boundary so the record stays plain data. */
export interface GenericConversation { id?: string; platform: string; title: string; createdAt?: number; updatedAt?: number; messages: DraftMessage[]; fileName: string }

const USER_ROLES = /^(?:user|human|you|me|customer|用户|我|提问|问)$/u;
const ASSISTANT_ROLES = /^(?:assistant|ai|bot|model|chatbot|system_?bot|助手|回答|答|chatgpt|gpt|claude|gemini|bard|deepseek|kimi|豆包|doubao|qwen|qianwen|千问|通义|通义千问|grok|copilot|perplexity|mistral|le chat|元宝|智谱|chatglm)$/u;

function role(value: unknown): "user" | "assistant" | undefined {
  if (typeof value !== "string") return undefined;
  const label = value.trim().toLowerCase().replace(/\s+said$/u, "");
  return USER_ROLES.test(label) ? "user" : ASSISTANT_ROLES.test(label) ? "assistant" : undefined;
}

function contentText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(contentText).filter(Boolean).join("\n\n");
  if (!isRecord(value)) return "";
  if (typeof value.text === "string") return value.text;
  if (isRecord(value.text) && typeof value.text.value === "string") return value.text.value;
  if (Array.isArray(value.parts)) return contentText(value.parts);
  return typeof value.content === "string" || Array.isArray(value.content) ? contentText(value.content) : "";
}

function genericMessage(value: unknown): DraftMessage | undefined {
  if (!isRecord(value)) return undefined;
  const author = isRecord(value.author) ? value.author.role ?? value.author.name : value.author;
  const sender = isRecord(value.sender) ? value.sender.role ?? value.sender.name : value.sender;
  const speaker = role(value.role ?? author ?? sender ?? value.from ?? value.speaker ?? value.type);
  const text = contentText(value.content ?? value.text ?? value.message ?? value.body ?? value.parts);
  return speaker && text.trim() ? { ...(typeof value.id === "string" ? { id: value.id } : {}), role: speaker, content: text, createdAt: sourceTimestamp(value.created_at ?? value.createdAt ?? value.create_time ?? value.timestamp ?? value.time) } : undefined;
}

const messageList = (value: Record<string, unknown>) => [value.messages, value.chat_messages, value.conversation, value.turns, value.history, value.chatHistory].find(Array.isArray) as unknown[] | undefined;

function fromObject(value: Record<string, unknown>, fileName: string): GenericConversation | undefined {
  const list = messageList(value);
  const messages = list?.map(genericMessage).filter((item): item is DraftMessage => Boolean(item)) ?? [];
  if (!messages.some(item => item.role === "user") || !messages.some(item => item.role === "assistant")) return undefined;
  const platform = platformFromLabel(value.platform ?? value.source ?? value.provider ?? value.model) ?? "other";
  const title = [value.title, value.name, value.subject].find(item => typeof item === "string" && item.trim()) as string | undefined;
  return { ...(typeof value.id === "string" || typeof value.uuid === "string" ? { id: String(value.id ?? value.uuid) } : {}), platform, title: title ?? fileName.replace(/\.[^.]+$/u, ""), createdAt: sourceTimestamp(value.created_at ?? value.createdAt ?? value.create_time ?? value.date), updatedAt: sourceTimestamp(value.updated_at ?? value.updatedAt ?? value.update_time), messages, fileName };
}

/** {messages:[...]}, an array of such objects, or a bare array of messages. */
export function genericJsonConversations(data: unknown, fileName: string, depth=0): GenericConversation[] | undefined {
  if(depth>8)return undefined;
  if (isRecord(data)) {
    const one=fromObject(data,fileName);if(one)return [one];
    // Read recognized export containers, without guessing roles or changing order.
    for(const key of ["data","conversations","chats","sessions","items","result"]){
      const records=genericJsonConversations(data[key],fileName,depth+1);
      if(records?.length)return records;
    }
    return undefined;
  }
  if (!Array.isArray(data) || !data.length) return undefined;
  const conversations = data.flatMap(item => genericJsonConversations(item,fileName,depth+1) ?? []);
  if (conversations.length) return conversations;
  return fromObject({ messages: data }, fileName) ? [fromObject({ messages: data }, fileName)!] : undefined;
}

// Speaker lines: "## User", "**ChatGPT said:** text", "> **Claude:**", "用户：text".
// The label must still be a known role word; headings and bold carry no text.
const SPEAKERS = [
  /^\s{0,3}#{1,6}\s+(?:\*\*|__)([^\n*_:：]{1,24}?)\s*[:：]?\s*(?:\*\*|__)\s*[:：]?\s*(.*)$/u,
  /^\s{0,3}#{1,6}\s+([^\n:：#*]{1,24}?)\s*[:：]\s*(.*)$/u,
  /^\s{0,3}#{1,6}\s+([^\n:：#*]{1,24}?)\s*[:：]?\s*$/u,
  /^\s{0,3}(?:>\s*)?(?:\*\*|__)([^\n*_:：]{1,24}?)\s*[:：]?\s*(?:\*\*|__)\s*[:：]?\s*(.*)$/u,
  /^\s{0,3}([^\s:：#*>`|-][^\n:：*`|]{0,23}?)\s*[:：]\s*(.*)$/u,
];
const speakerLine = (line: string) => {
  for (const pattern of SPEAKERS) { const match = pattern.exec(line); const speaker = match ? role(match[1]) : undefined; if (speaker) return { speaker, label: match![1].trim(), rest: match![2] ?? "" }; }
  return undefined;
};

/** Markdown transcripts from exporter extensions. Requires both speakers, so
 * ordinary notes that merely contain a "Q:" line are not misread as chats. */
export function markdownConversation(text: string, fileName: string): GenericConversation | undefined {
  const lines = text.replace(/\r\n?/gu, "\n").split("\n");
  const messages: DraftMessage[] = [];
  let title: string | undefined, assistantLabel: string | undefined, fence = false, current: DraftMessage | undefined;
  for (const line of lines) {
    if (/^\s*(```|~~~)/u.test(line)) fence = !fence;
    const found = fence ? undefined : speakerLine(line);
    if (found) {
      current = { role: found.speaker, content: found.rest };
      messages.push(current);
      if (found.speaker === "assistant") assistantLabel ??= found.label;
      continue;
    }
    if (!current) { if (!title && /^#\s+\S/u.test(line)) title = line.replace(/^#\s+/u, "").trim(); continue; }
    current.content += `\n${line}`;
  }
  const kept = messages.filter(message => message.content.trim());
  if (!kept.some(item => item.role === "user") || !kept.some(item => item.role === "assistant")) return undefined;
  return { platform: platformFromLabel(assistantLabel) ?? platformFromLabel(title) ?? "other", title: title ?? fileName.replace(/\.[^.]+$/u, ""), messages: kept, fileName };
}

export const genericImporter: PlatformImporter<GenericConversation> = {
  platform: "generic",
  describe(raw) {
    if (!Array.isArray(raw.messages) || !raw.messages.length) throw new Error("Imported conversation has no messages.");
    // Without a platform ID, the file name, title and opening turn identify it across re-imports.
    const key = raw.id ?? sourceMessageSignature(JSON.stringify([raw.fileName, raw.title, raw.messages[0]?.content.slice(0, 500)]));
    return baseConversation({ id: `${raw.platform}:import:${key}`, platform: raw.platform, source: "file_import", title: raw.title, createdAt: raw.createdAt ?? raw.messages[0]?.createdAt, updatedAt: raw.updatedAt ?? raw.messages.at(-1)?.createdAt });
  },
  revision: importRevision,
  async normalize(raw, revision, capturedAt) {
    return captureFromDrafts({ ...genericImporter.describe(raw), sourceRevision: revision }, raw.messages, capturedAt);
  },
};
