import type { CanvasCard, Conversation, ConversationMessage } from "../shared/types";
import type { ReviewMark } from "../storage/review-marks";
import { platformName } from "../shared/platforms";

function sourceLine(conversation?: Conversation): string {
  if (!conversation) return "Source unavailable in ChatAtlas";
  const date = new Date(conversation.sourceCreatedAt ?? conversation.createdAt ?? conversation.updatedAt).toISOString().slice(0, 10);
  return `${conversation.title} · ${date} · ${platformName(conversation.platform, "en")}`;
}

export function messageWithSource(message: ConversationMessage, card: CanvasCard, conversation?: Conversation): string {
  return `${message.content}\n\n— ${card.title} · ${sourceLine(conversation)}`;
}

export function knowledgeMarkdown(card: CanvasCard, marks: ReviewMark[], conversations: Conversation[]): string {
  const parts = [`# ${card.title}`];
  if (card.description) parts.push(card.description);
  if (card.notes) parts.push(`## My understanding\n\n${card.notes}`);
  if (marks.length) parts.push("## Conclusions and decisions");
  for (const mark of marks) {
    const conversation = conversations.find((item) => item.id === mark.conversationId);
    parts.push(`### ${mark.kind === "decision" ? "Decision" : "Conclusion"}\n\n${mark.originalText.split("\n").map((line) => `> ${line}`).join("\n")}\n\nSource: ${sourceLine(conversation)}${mark.updateNote ? `\n\nMy later update: ${mark.updateNote}` : ""}`);
  }
  return parts.join("\n\n") + "\n";
}

export function downloadKnowledgeMarkdown(card: CanvasCard, marks: ReviewMark[], conversations: Conversation[]): void {
  const url = URL.createObjectURL(new Blob([knowledgeMarkdown(card, marks, conversations)], { type: "text/markdown;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${card.title.replace(/[<>:"/\\|?*]/gu, "-").slice(0, 72) || "atlas-knowledge"}.md`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
