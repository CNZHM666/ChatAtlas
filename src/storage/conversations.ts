import type { Conversation, ConversationHydrationState } from "../shared/types";
import { conversationTime } from "../shared/conversation-time";
import { getDatabase } from "./db";

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return (await getDatabase()).get("conversations", id);
}

export async function listConversations(): Promise<Conversation[]> {
  const conversations = await (await getDatabase()).getAllFromIndex("conversations", "by-updated");
  return conversations.sort((a, b) => conversationTime(b) - conversationTime(a));
}

export async function saveConversation(conversation: Conversation): Promise<void> {
  await (await getDatabase()).put("conversations", conversation);
}

export async function setConversationHydrationState(id: string, hydrationState: ConversationHydrationState): Promise<void> {
  const db = await getDatabase();
  const conversation = await db.get("conversations", id);
  if (conversation && conversation.hydrationState !== hydrationState) await db.put("conversations", { ...conversation, hydrationState });
}

export async function saveDiscoveredConversation(conversation: Conversation): Promise<void> {
  await saveDiscoveredConversations([conversation]);
}

/** Inventory pages share one transaction instead of opening two transactions per row. */
export async function saveDiscoveredConversations(conversations: Conversation[]): Promise<Map<string, Conversation | undefined>> {
  const previous = new Map<string, Conversation | undefined>();
  if (!conversations.length) return previous;
  const db = await getDatabase();
  const tx = db.transaction("conversations", "readwrite");
  const store = tx.objectStore("conversations");
  const existing = await Promise.all(conversations.map((conversation) => store.get(conversation.id)));
  if (conversations.some((conversation, index) => conversation.sourceAccount && existing[index]?.sourceAccount && conversation.sourceAccount !== existing[index]?.sourceAccount)) {
    tx.abort();
    await tx.done.catch(() => undefined);
    throw Error("来源账号与已保存内容不一致 / Source account differs from saved content");
  }
  await Promise.all(conversations.map((conversation, index) => {
    const old = existing[index];
    previous.set(conversation.id, old);
    const hydratedVersion = old?.hydratedSourceUpdatedAt ?? (old?.importState === "complete" && (!old.hydrationState || old.hydrationState === "hydrated") ? old.sourceUpdatedAt : undefined);
    const changedSource = Boolean(old?.importState === "complete" && conversation.sourceUpdatedAt && (!hydratedVersion || conversation.sourceUpdatedAt > hydratedVersion));
    const next: Conversation = {
      ...conversation,
      ...old,
      ...(conversation.nativeHistorySourceId ? { nativeHistorySourceId: conversation.nativeHistorySourceId, sourceAccount: conversation.sourceAccount, source: conversation.source, url: conversation.url } : {}),
      title: conversation.title || old?.title || "Untitled conversation",
      updatedAt: old && !changedSource ? old.updatedAt : Math.max(conversation.updatedAt, old?.updatedAt ?? 0),
      sourceCreatedAt: conversation.sourceCreatedAt ?? old?.sourceCreatedAt,
      sourceUpdatedAt: Math.max(conversation.sourceUpdatedAt ?? 0, old?.sourceUpdatedAt ?? 0) || undefined,
      hydratedSourceUpdatedAt: hydratedVersion,
      messageCount: old?.importState === "complete" ? old.messageCount : conversation.messageCount,
      importState: old?.importState === "complete" ? "complete" : "discovered",
      hydrationState: old?.importState === "complete" ? changedSource || old.hydrationState && old.hydrationState !== "hydrated" ? "queued" : "hydrated" : old?.hydrationState ?? "metadata_only",
    };
    if (old && old.title === next.title && old.updatedAt === next.updatedAt && old.sourceCreatedAt === next.sourceCreatedAt && old.sourceUpdatedAt === next.sourceUpdatedAt && old.hydratedSourceUpdatedAt === next.hydratedSourceUpdatedAt && old.messageCount === next.messageCount && old.importState === next.importState && old.hydrationState === next.hydrationState && old.nativeHistorySourceId === next.nativeHistorySourceId && old.sourceAccount === next.sourceAccount && old.source === next.source && old.url === next.url) return Promise.resolve();
    return store.put(next).then(() => undefined);
  }));
  await tx.done;
  return previous;
}
