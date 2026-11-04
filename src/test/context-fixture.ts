import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { projectStateSignature } from "../shared/project-state";
import { sourceMessageSignature } from "../shared/source-signature";
import type { ProjectKnowledge } from "../context/types";

export function contextKnowledge(): ProjectKnowledge {
  const messages: ConversationMessage[] = [
    { id: "m-db", conversationId: "c", role: "user", messageIndex: 0, content: "数据库使用 IndexedDB，消息按 ID 独立保存，不能覆盖原始聊天。", preview: "", contentHash: "", createdAt: 1, updatedAt: 2 },
    { id: "m-ui", conversationId: "c", role: "assistant", messageIndex: 1, content: "侧边栏按钮沿用界面规范。保留已有草稿，不自动发送消息。\n\n```ts\nconst action = 'preview';\n```", preview: "", contentHash: "", createdAt: 3, updatedAt: 4 },
  ];
  const conversations: Conversation[] = [{ id: "c", title: "ChatAtlas 项目", platform: "chatgpt", url: "https://chatgpt.com/c/example", updatedAt: 4, messageCount: 2 }];
  const session: FocusSession = { id: "project", canvasId: "space", mode: "work", title: "ChatAtlas", goal: "构建本地优先的跨 AI 知识助手", createdAt: 1, updatedAt: 4,
    sourceConversationIds: ["c"], sourceSignatures: { c: Object.fromEntries(messages.map(message => [message.id, sourceMessageSignature(message.content)])) },
    sourceRoles: { c: { "m-db": "user", "m-ui": "assistant" } }, evidence: [
      { id: "e-db", conversationId: "c", messageId: "m-db", title: "数据库", excerpt: messages[0].content },
      { id: "e-ui", conversationId: "c", messageId: "m-ui", title: "侧栏", excerpt: "侧边栏按钮沿用界面规范。保留已有草稿，不自动发送消息。" },
    ], sections: [
      { id: "database", title: "数据库存储", body: messages[0].content, transition: "", kind: "finding", evidenceIds: ["e-db"], evidenceReview: { status: "verified", invalidClaims: 0, checkedClaims: 1, totalClaims: 1 } },
      { id: "sidebar", title: "侧边栏按钮与界面规范", body: messages[1].content, transition: "", kind: "proposal", evidenceIds: ["e-ui"], evidenceReview: { status: "verified", invalidClaims: 0, checkedClaims: 1, totalClaims: 1 } },
    ], activeSectionId: "database", completedSectionIds: ["database"], notes: "绝不默认带出的私人笔记",
    brief: { summary: "ChatAtlas 恢复过去的理解。", turningPoints: [], confirmed: [], openQuestions: ["数据库是否需要备份？"] },
    projectState: { summary: "本地优先的历史知识助手。", modules: [], relations: [], constraints: [],
      decisions: [
        { id: "db", text: "数据库使用 IndexedDB", reason: "消息按 ID 独立保存，不能覆盖原始聊天。", status: "documented", quote: messages[0].content, evidenceIds: ["e-db"] },
        { id: "ui", text: "侧边栏按钮沿用界面规范", reason: "保留已有草稿，不自动发送消息。", status: "proposal", quote: "侧边栏按钮沿用界面规范。", evidenceIds: ["e-ui"] },
        { id: "old", text: "曾考虑 Firebase", reason: "", status: "superseded", quote: "", evidenceIds: [] },
      ], actions: [{ id: "ui-task", text: "侧边栏按钮调整", reason: "", status: "documented", quote: "侧边栏按钮沿用界面规范。", evidenceIds: ["e-ui"] }], signature: "", generatedAt: 4, basis: "organized", verification: "original" },
    projectMaintenance: { decisions: { db: { text: "数据库使用 IndexedDB", confirmed: true } }, actions: { "ui-task": { text: "侧边栏按钮调整", done: true } } },
  };
  session.projectState!.signature = projectStateSignature(session);
  return { session, messages, conversations, sourcesStale: false, signature: "fixture" };
}
