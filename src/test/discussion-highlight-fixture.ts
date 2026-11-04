import type { Conversation, ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";

export const highlightSource: Conversation = { id: "highlights-source", title: "技术讨论", platform: "chatgpt", url: "https://chatgpt.com/c/highlights-source", updatedAt: 1, rawRevision: "v1", messageCount: 8, hydrationState: "hydrated" };
export function highlightMessages(): ConversationMessage[] {
  return Array.from({ length: 8 }, (_, i) => ({ id: `highlight-m${i}`, conversationId: highlightSource.id, role: i % 2 ? "assistant" : "user", messageIndex: i, content: i % 2 ? `完整回答 ${i}：保留代码、条件与后续解释。` : `问题 ${i}：如何处理这项方案？`, contentHash: `h${i}`, preview: "", createdAt: 1792375200000, updatedAt: 1 }));
}
export function highlightSession(messages = highlightMessages()): FocusSession {
  return { id: "highlight-project", title: "示例项目", goal: "整理", mode: "work", sourceConversationIds: [highlightSource.id], evidence: messages.map((m, i) => ({ id: `e${i}`, conversationId: m.conversationId, messageId: m.id, title: "原文", excerpt: m.content, sourceSignature: sourceMessageSignature(m.content) })),
    sections: [{ id: "later", title: "后期修正", wikiGroup: "技术方案", body: "整理正文", evidenceIds: ["e6", "e7"], transition: "", kind: "finding" }, { id: "early", title: "最初问题", wikiGroup: "产品定位", body: "整理正文", evidenceIds: ["e0", "e1"], transition: "", kind: "open_question" }],
    sourceOutlines: [{ conversationId: highlightSource.id, messageOrder: messages.map(m => m.id), messageRoles: Object.fromEntries(messages.map(m => [m.id, m.role])), messageSignatures: Object.fromEntries(messages.map(m => [m.id, sourceMessageSignature(m.content)])), chapters: [{ id: "early", title: "明确目标", summary: "", messageIds: messages.slice(0, 2).map(m => m.id) }, { id: "later", title: "修正方案", summary: "", messageIds: messages.slice(6).map(m => m.id) }] }], activeSectionId: "early", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
}
