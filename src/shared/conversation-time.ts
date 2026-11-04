import type { Conversation } from "./types";

/** Prefer ChatGPT's conversation activity time over the local import/capture time. */
export function conversationTime(conversation: Conversation): number {
  return conversation.sourceUpdatedAt ?? conversation.sourceCreatedAt ?? (conversation.source ? 0 : conversation.updatedAt);
}

/** Never present an import timestamp (or an invalid epoch) as the conversation's date. */
export function conversationDisplayTime(conversation: Conversation): number | undefined {
  const plausible = (value: number | undefined): value is number =>
    typeof value === "number" && Number.isFinite(value) && value >= Date.UTC(2000, 0, 1) && value <= Date.now() + 86_400_000;
  if (plausible(conversation.sourceUpdatedAt)) return conversation.sourceUpdatedAt;
  if (plausible(conversation.sourceCreatedAt)) return conversation.sourceCreatedAt;
  if (conversation.source) return undefined;
  if (conversation.importState !== "discovered" && conversation.importState !== "failed" && plausible(conversation.createdAt)) return conversation.createdAt;
  if (conversation.importState !== "discovered" && conversation.importState !== "failed" && plausible(conversation.updatedAt)) return conversation.updatedAt;
  return undefined;
}
