import { getDatabase } from "./db";

/** Personal navigation only. These records never confirm project facts. */
export interface DiscussionHighlightEdit {
  id: string;
  conversationId: string;
  messageId: string;
  title?: string;
  /** Last visible label for the recovery list; never overrides a regenerated title. */
  sourceTitle?: string;
  category?: string;
  hidden?: boolean;
  manual?: boolean;
  messageIds?: string[];
  signatures?: Record<string, string>;
  updatedAt: number;
}

export const discussionHighlightId = (conversationId: string, messageId: string) => JSON.stringify([conversationId, messageId]);

export async function saveDiscussionHighlight(edit: Omit<DiscussionHighlightEdit, "updatedAt">): Promise<DiscussionHighlightEdit> {
  if (edit.id !== discussionHighlightId(edit.conversationId, edit.messageId) || edit.title !== undefined && (!edit.title.trim() || edit.title.length > 160) || edit.category !== undefined && edit.category.length > 60) throw Error("Invalid discussion highlight");
  const value = { ...edit, title: edit.title?.trim(), category: edit.category?.trim(), updatedAt: Date.now() };
  await (await getDatabase()).put("discussionHighlights", value);
  return value;
}
