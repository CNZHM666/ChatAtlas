import type { Conversation, ConversationCapture, ConversationMessage } from "../shared/types";
import { createContentHash, normalizeMessageText, previewMessage } from "../content/message-identity";

export interface RawHistoryItem { id?: string; conversation_id?: string; title?: string; create_time?: number; update_time?: number; message_count?: number }
export interface RawConversationPage { items?: RawHistoryItem[]; total?: number }
export interface RawMessageNode { id?: string; message?: { id?: string; author?: { role?: string }; content?: { parts?: unknown[]; text?: string }; create_time?: number }; parent?: string | null; children?: string[] }
export interface RawConversation extends RawHistoryItem { mapping?: Record<string, RawMessageNode>; current_node?: string }

function time(value: number | undefined, fallback = Date.now()): number { return value ? value * 1000 : fallback; }
function sourceTime(value: number | undefined): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return undefined;
  const milliseconds = value * 1000;
  return milliseconds >= Date.UTC(2000, 0, 1) && milliseconds <= Date.now() + 86_400_000 ? milliseconds : undefined;
}

function messageText(content: RawMessageNode["message"], uiParts: NonNullable<ConversationMessage["uiParts"]>): string {
  if (!content?.content) return "";
  const parts = content.content.parts;
  let ordinal = 0, retainedBytes = 0;
  if (Array.isArray(parts)) return normalizeMessageText(parts.map(part => {
    if (typeof part === "string") { ordinal += part.split("【原平台交互内容】").length - 1; return part; }
    if (!part || typeof part !== "object") return "";
    const record = part as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text : typeof record.text === "object" && record.text && "value" in record.text && typeof record.text.value === "string" ? record.text.value : undefined;
    const type = record.type ?? record.content_type;
    if (type === "code" && text !== undefined) {
      ordinal += text.split("【原平台交互内容】").length - 1;
      const fence = "`".repeat(Math.max(2, ...Array.from(text.matchAll(/`+/gu), match => match[0].length)) + 1);
      const language = typeof record.language === "string" && /^[\w-]+$/u.test(record.language) ? record.language : "text";
      return `${fence}${language}\n${text}\n${fence}`;
    }
    if (text !== undefined && (!type || ["text", "output_text", "input_text"].includes(String(type)))) { ordinal += text.split("【原平台交互内容】").length - 1; return text; }
    if (["genui", "interactive", "widget", "html", "svg"].includes(String(type))) {
      const raw = JSON.stringify(record);
      const truncated = raw.length + retainedBytes > 200_000;
      if (uiParts.length < 32) uiParts.push({ ordinal, raw: truncated ? "" : raw, ...(truncated ? { truncated: true } : {}) });
      retainedBytes += truncated ? 0 : raw.length;
      ordinal++;
      return "【原平台交互内容】";
    }
    return "";
  }).filter(Boolean).join("\n"));
  return normalizeMessageText(content.content.text ?? "");
}

export function normalizeHistoryItem(raw: RawHistoryItem): Conversation | null {
  // A conversation's detail and some exports name it conversation_id, not id: "Conversation is missing its ID." failed
  // every conversation the native sync opened.
  const id = typeof raw.id === "string" && raw.id ? raw.id : typeof raw.conversation_id === "string" && raw.conversation_id ? raw.conversation_id : "";
  if (!id) return null;
  const item = { ...raw, id };
  const createdAt = sourceTime(item.create_time);
  const sourceUpdatedAt = sourceTime(item.update_time);
  const messageCount = Number.isSafeInteger(item.message_count) && item.message_count! >= 0 ? item.message_count! : null;
  return { id: item.id, platform: "chatgpt", title: item.title?.trim() || "Untitled conversation", url: `https://chatgpt.com/c/${encodeURIComponent(item.id)}`, createdAt, updatedAt: sourceUpdatedAt ?? createdAt ?? Date.now(), sourceCreatedAt: createdAt, sourceUpdatedAt, source: "chatgpt_live", messageCount, importState: "discovered", hydrationState: "metadata_only" };
}

/** Follow current_node through parent links; inactive regenerated branches are never mixed into the selected transcript. */
function activePath(raw: RawConversation): Array<{ key: string; node: RawMessageNode }> {
  const mapping = raw.mapping ?? {};
  if (!Object.keys(mapping).length) return [];
  const reversed: Array<{ key: string; node: RawMessageNode }> = [];
  const seen = new Set<string>();
  let key = raw.current_node;
  while (key && mapping[key] && !seen.has(key)) {
    seen.add(key);
    reversed.push({ key, node: mapping[key] });
    key = mapping[key].parent ?? undefined;
  }
  if (reversed.length) return reversed.reverse();
  return Object.entries(mapping).sort((a, b) => (a[1].message?.create_time ?? 0) - (b[1].message?.create_time ?? 0)).map(([key, node]) => ({ key, node }));
}

export async function normalizeHistoryConversation(raw: RawConversation, capturedAt = Date.now()): Promise<ConversationCapture> {
  const conversation = normalizeHistoryItem(raw);
  if (!conversation) throw new Error("Conversation is missing its ID.");
  const messages: ConversationMessage[] = [];
  const occurrence = new Map<string, number>();
  const userByNode = new Map<string, string>();
  let lastUserId: string | undefined;
  for (const { key: nodeKey, node } of activePath(raw)) {
    const role = node.message?.author?.role;
    if (role !== "user" && role !== "assistant") continue;
    const uiParts: NonNullable<ConversationMessage["uiParts"]> = [];
    const content = messageText(node.message, uiParts);
    if (!content) continue;
    const contentHash = await createContentHash(`${role}\n${content}`);
    const occurrenceKey = `${role}:${contentHash}`;
    const count = occurrence.get(occurrenceKey) ?? 0;
    occurrence.set(occurrenceKey, count + 1);
    const platformMessageId = node.message?.id ?? node.id ?? nodeKey;
    const id = platformMessageId ? `chatgpt:${conversation.id}:${platformMessageId}` : `chatgpt:${conversation.id}:${occurrenceKey}:${count}`;
    if (role === "user") { userByNode.set(nodeKey, id); lastUserId = id; }
    let parent = node.parent;
    const visited = new Set<string>();
    while (role === "assistant" && parent && !visited.has(parent) && !userByNode.has(parent)) { visited.add(parent); parent = raw.mapping?.[parent]?.parent; }
    messages.push({ id, conversationId: conversation.id, platformMessageId, replyToMessageId: role === "assistant" ? (parent ? userByNode.get(parent) : undefined) ?? lastUserId : undefined, messageIndex: messages.length, role, content, ...(uiParts.length ? { uiParts } : {}), preview: previewMessage(content), contentHash, sourceCreatedAt: sourceTime(node.message?.create_time), createdAt: time(node.message?.create_time, capturedAt), updatedAt: capturedAt });
  }
  return { conversation: { ...conversation, messageCount: messages.length, importState: "complete", hydrationState: "hydrated" }, messages, capturedAt };
}
