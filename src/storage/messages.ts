import { searchMatcher } from "../search/query";
import type { ConversationCapture, ConversationMessage } from "../shared/types";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getDatabase } from "./db";
import { cachedReaderMessages, invalidateMessageReadCache } from "./message-read-cache";
import { sourceVersion } from "./source-versions";
import { invalidateMessageSearchReaders } from "../search/message-search-invalidation";

let indexVersion = 0;
let rebuilding: Promise<number> | null = null;
let messageSearchIndex: Array<{ message: ConversationMessage; normalized: string; question?: ConversationMessage }> | null = null;
const readRevisions = new Map<string, string>();

export function invalidateStoredMessageSearchIndex(): void {
  messageSearchIndex = null; indexVersion++; rebuilding = null;
  invalidateMessageSearchReaders();
}

export async function rebuildStoredMessageSearchIndex(): Promise<number> {
  const version = indexVersion;
  const db = await getDatabase();
  const index: NonNullable<typeof messageSearchIndex> = [];
  let cursor = await db.transaction("messages").store.openCursor();
  while (cursor) {
    if (!isInternalSearchQueryMessage(cursor.value)) index.push({ message: cursor.value, normalized: cursor.value.content.toLocaleLowerCase().normalize("NFKC") });
    cursor = await cursor.continue();
  }
  index.sort((a, b) => a.message.conversationId.localeCompare(b.message.conversationId) || a.message.messageIndex - b.message.messageIndex);
  let question: ConversationMessage | undefined;
  let conversationId: string | undefined;
  for (const entry of index) {
    if (entry.message.conversationId !== conversationId) { question = undefined; conversationId = entry.message.conversationId; }
    if (entry.message.role === "user") question = entry.message;
    entry.question = question;
  }
  if (version === indexVersion) messageSearchIndex = index;
  return index.length;
}

export async function getMessagesForConversation(conversationId: string, options: { cache?: boolean } = {}): Promise<ConversationMessage[]> {
  const db = await getDatabase(), metadata = await db.get("conversations", conversationId);
  const load = async () => {
    const messages = await db.getAllFromIndex("messages", "by-conversation", conversationId);
    return messages.sort((a, b) => a.messageIndex - b.messageIndex);
  };
  if (options.cache === false) return load();
  if (!metadata) { invalidateMessageReadCache(conversationId); return load(); }
  const revision = JSON.stringify([metadata.rawRevision, metadata.sourceRevision, metadata.updatedAt, metadata.messageCount, metadata.sourceUpdatedAt]);
  if (readRevisions.get(conversationId) !== revision) invalidateMessageReadCache(conversationId);
  readRevisions.set(conversationId, revision);
  return [...await cachedReaderMessages(conversationId, load)];
}

async function readySearchIndex() {
  while (!messageSearchIndex) {
    rebuilding ??= rebuildStoredMessageSearchIndex();
    const pending = rebuilding;
    try { await pending; } finally { if (rebuilding === pending) rebuilding = null; }
  }
  return messageSearchIndex;
}

export async function searchStoredMessages(query: string, limit = 30, matcher?: (normalized: string) => number, conversationIds?: ReadonlySet<string>): Promise<ConversationMessage[]> {
  if (query.trim().length < 2) return [];
  const index = await readySearchIndex();
  const found: Array<{ message: ConversationMessage; score: number }> = [];
  const rank = matcher ?? searchMatcher(query, true, true);
  let lastYield = performance.now();
  for (let position = 0; position < index.length; position++) {
    const entry = index[position];
    if (conversationIds && !conversationIds.has(entry.message.conversationId)) continue;
    const score = rank(entry.normalized);
    if (score) found.push({ message: entry.message, score });
    if (performance.now() - lastYield >= 8) { await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = performance.now(); }
  }
  return found.sort((a, b) => b.score - a.score).slice(0, limit).map((item) => item.message);
}

export interface StoredDiscussionMatch { message: ConversationMessage; question?: ConversationMessage }

/** One strongest passage per source, filtered before ranking. Browsing never invokes AI. */
export async function searchStoredDiscussions(query: string, conversationIds: ReadonlySet<string>): Promise<StoredDiscussionMatch[]> {
  if (!query.trim() || !conversationIds.size) return [];
  const index = await readySearchIndex();
  const rank = searchMatcher(query, false, true);
  const best = new Map<string, { match: StoredDiscussionMatch; score: number }>();
  let lastYield = performance.now();
  for (const entry of index) {
    if (conversationIds.has(entry.message.conversationId)) {
      const score = rank(entry.normalized);
      if (score && score > (best.get(entry.message.conversationId)?.score ?? 0)) best.set(entry.message.conversationId, { match: { message: entry.message, question: entry.question }, score });
    }
    if (performance.now() - lastYield >= 8) { await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = performance.now(); }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map(item => item.match);
}

export async function saveConversationCapture(capture: ConversationCapture, options: { replace?: boolean; warmIndex?: boolean } = {}): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(["conversations", "messages", "sourceVersions"], "readwrite");
  const existing = await tx.objectStore("conversations").get(capture.conversation.id);
  if (existing?.sourceAccount && capture.conversation.sourceAccount && existing.sourceAccount !== capture.conversation.sourceAccount) {
    tx.abort(); await tx.done.catch(() => undefined);
    throw Error("Source account differs from saved content");
  }
  const messageStore = tx.objectStore("messages");
  const existingMessages = await messageStore.index("by-conversation").getAll(capture.conversation.id);
  const existingById = new Map(existingMessages.map((message) => [message.id, message]));
  const existingByPosition = new Map(existingMessages.map((message) => [`${message.messageIndex}:${message.role}`, message]));
  const authoritativeOrder=capture.conversation.hydrationState==="hydrated"&&["chatgpt_live","chatgpt_export"].includes(capture.conversation.source??"");
  const visibleWebCapture=options.replace===false&&capture.conversation.platform!=="chatgpt"&&capture.conversation.source===`${capture.conversation.platform}_dom`;
  const idRemap = new Map<string, string>();
  const normalizedMessages = capture.messages.map((message) => {
    const atPosition = existingByPosition.get(`${message.messageIndex}:${message.role}`);
    const matched = existingById.get(message.id) ?? (!visibleWebCapture&&atPosition?.contentHash === message.contentHash ? atPosition : undefined);
    if (matched && matched.id !== message.id) idRemap.set(message.id, matched.id);
    // A visible DOM capture may not contain the original widget payload. Do not erase it
    // when the corresponding article is unchanged; a changed article invalidates offsets.
    // A virtualized DOM capture numbers its visible subset from zero. Updating
    // a known ID must not move an imported late question to the transcript top.
    const timestamped = { ...message, ...(options.replace===false&&matched&&!authoritativeOrder?{messageIndex:matched.messageIndex}:{}),sourceCreatedAt: message.sourceCreatedAt ?? matched?.sourceCreatedAt };
    const preserved = matched?.content === message.content && !message.uiParts?.length && matched.uiParts?.length ? { ...timestamped, uiParts: matched.uiParts } : timestamped;
    return matched && matched.id !== message.id ? { ...preserved, id: matched.id, platformMessageId: options.replace === false ? matched.platformMessageId ?? message.platformMessageId : message.platformMessageId ?? matched.platformMessageId } : preserved;
  }).map((message) => ({ ...message, replyToMessageId: message.replyToMessageId ? idRemap.get(message.replyToMessageId) ?? message.replyToMessageId : undefined }));
  const capturedIds = new Set(normalizedMessages.map((message) => message.id));
  let nextMessages = [...(options.replace === false ? existingMessages.filter(message => !capturedIds.has(message.id)) : []), ...normalizedMessages];
  if(visibleWebCapture){
    // Visible windows restart their DOM index at zero. Use saved ID anchors to
    // insert newly loaded history/new replies, retaining every unseen message.
    const ordered=existingMessages.slice().sort((a,b)=>a.messageIndex-b.messageIndex).map(message=>message.id);
    let anchor:string|undefined;
    for(let index=0;index<normalizedMessages.length;index++){
      const message=normalizedMessages[index];
      if(!ordered.includes(message.id)){
        const following=normalizedMessages.slice(index+1).find(item=>ordered.includes(item.id));
        const position=following?ordered.indexOf(following.id):anchor?ordered.indexOf(anchor)+1:ordered.length;
        ordered.splice(position,0,message.id);
      }
      anchor=message.id;
    }
    const byId=new Map(nextMessages.map(message=>[message.id,message]));
    nextMessages=ordered.map((id,messageIndex)=>({...byId.get(id)!,messageIndex}));
  }
  for (const messages of [existingMessages, nextMessages]) if (messages.length) {
    const version = sourceVersion(capture.conversation.id, messages, messages === existingMessages ? existing?.updatedAt ?? capture.capturedAt : capture.capturedAt);
    if (!await tx.objectStore("sourceVersions").get(version.id)) await tx.objectStore("sourceVersions").add(version);
  }
  await tx.objectStore("conversations").put({
    ...existing,
    ...capture.conversation,
    ...(options.replace === false && existing?.nativeHistorySourceId ? { source: existing.source, sourceAccount: existing.sourceAccount, nativeHistorySourceId: existing.nativeHistorySourceId, historyCoverage: normalizedMessages.some(message => existingById.get(message.id)?.contentHash !== message.contentHash) ? "loaded" as const : existing.historyCoverage } : {}),
    createdAt: existing?.createdAt ?? capture.conversation.createdAt ?? capture.capturedAt,
    updatedAt: capture.capturedAt,
    messageCount: visibleWebCapture?nextMessages.length:options.replace === false ? Math.max(existing?.messageCount ?? 0, capture.messages.length) : capture.messages.length,
    sourceCreatedAt: capture.conversation.sourceCreatedAt ?? existing?.sourceCreatedAt,
    sourceUpdatedAt: capture.conversation.sourceUpdatedAt ?? existing?.sourceUpdatedAt,
    hydratedSourceUpdatedAt: capture.conversation.sourceUpdatedAt ?? existing?.sourceUpdatedAt,
    rawRevision: sourceVersion(capture.conversation.id, nextMessages, capture.capturedAt).fingerprint,
    importState: "complete",
    hydrationState: "hydrated",
  });
  await Promise.all([
    ...(options.replace === false ? [] : existingMessages.filter((message) => !capturedIds.has(message.id)).map((message) => messageStore.delete(message.id))),
    ...(visibleWebCapture?nextMessages:normalizedMessages).map((message) => messageStore.put({
      ...message,
      createdAt: existingById.get(message.id)?.createdAt ?? message.createdAt,
    })),
  ]);
  await tx.done;
  invalidateStoredMessageSearchIndex();
  invalidateMessageReadCache(capture.conversation.id);
  // Bulk imports persist the original text; build search passages when they are actually needed.
  // Background imports have no DOM, and no visible reader to warm. Its later
  // page/worker search rebuilds on demand from committed originals and revisions.
  if (options.warmIndex !== false && typeof document !== "undefined") void import("../search/transcript-index").then(({ queueTranscriptIndexRefresh }) => queueTranscriptIndexRefresh(capture.conversation.id)).catch(() => undefined);
}
