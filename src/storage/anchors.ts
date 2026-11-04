import type { MessageAnchor } from "../shared/types";
import { getDatabase } from "./db";

export async function getAnchorsForConversation(conversationId: string): Promise<MessageAnchor[]> {
  return (await getDatabase()).getAllFromIndex("anchors", "by-conversation", conversationId);
}

export async function getAnchorsByIds(ids: string[]): Promise<MessageAnchor[]> {
  const db = await getDatabase();
  const anchors = await Promise.all(ids.map((id) => db.get("anchors", id)));
  return anchors.filter((anchor): anchor is MessageAnchor => Boolean(anchor));
}

export async function saveAnchor(anchor: MessageAnchor): Promise<void> {
  await (await getDatabase()).put("anchors", anchor);
}
