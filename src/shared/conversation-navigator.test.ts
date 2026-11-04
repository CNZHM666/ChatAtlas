import { describe, expect, it } from "vitest";
import { buildNavigatorData } from "./conversation-navigator";
import type { Conversation, ConversationGraph, ConversationMessage, QuestionSnapshot } from "./types";

const conversation: Conversation = { id: "c1", platform: "chatgpt", title: "硬件 AI 方向推荐", url: "https://chatgpt.com/c/c1", updatedAt: 1, messageCount: 2 };
const message: ConversationMessage = { id: "m1", conversationId: "c1", platformMessageId: "source-1", messageIndex: 0, role: "user", content: "为什么关键词分章不准确？", preview: "为什么关键词分章不准确？", contentHash: "hash-1", createdAt: 1, updatedAt: 1 };
const graph: ConversationGraph = {
  conversationId: "c1", updatedAt: 9, nodes: [{ id: "q1", conversationId: "c1", kind: "question", title: "关键词分章", sourceMessageId: "m1", x: 0, y: 0 }], edges: [],
  chapters: [{ id: "chapter-1", conversationId: "c1", title: "AI 自动整理", questionIds: ["q1"], order: 0, collapsed: true, source: "user", createdAt: 1, updatedAt: 9 }],
};

describe("conversation navigator projection", () => {
  it("uses the stored chapter and snapshot title with a compact original-message locator", () => {
    const snapshot: QuestionSnapshot = { questionId: "m1", conversationId: "c1", displayTitle: "LLM 章节生成准确性", summary: "ignored", concepts: [], sourceHash: "hash-1", analysisVersion: 1, updatedAt: 1 };
    expect(buildNavigatorData("c1", graph, conversation, [message], [snapshot])).toEqual({
      conversationId: "c1", title: "硬件 AI 方向推荐", updatedAt: 9,
      chapters: [{ id: "chapter-1", title: "AI 自动整理", questionCount: 1, questions: [{ id: "q1", title: "LLM 章节生成准确性", message: { platformMessageId: "source-1", contentHash: "hash-1", preview: "为什么关键词分章不准确？", messageIndex: 0, role: "user", textLength: message.content.length } }] }],
      allQuestions: [{ id: "conversation-message-m1", title: "LLM 章节生成准确性", message: { platformMessageId: "source-1", contentHash: "hash-1", preview: "为什么关键词分章不准确？", messageIndex: 0, role: "user", textLength: message.content.length } }],
    });
  });

  it("reflects chapter and question edits from the canvas ahead of older snapshots", () => {
    const renamed = { ...graph, nodes: graph.nodes.map((node) => ({ ...node, displayTitle: "图节点短标题", displayTitleSource: "user" as const })), chapters: graph.chapters?.map((chapter) => ({ ...chapter, title: "章节合并策略" })) };
    const stale: QuestionSnapshot = { questionId: "m1", conversationId: "c1", displayTitle: "旧分析标题", summary: "", concepts: [], sourceHash: "hash-1", analysisVersion: 1, updatedAt: 1 };
    expect(buildNavigatorData("c1", renamed, conversation, [message], [stale]).chapters[0]).toMatchObject({ title: "章节合并策略", questions: [{ title: "图节点短标题" }] });
  });

  it("shows no chapters when there is no stored structure", () => {
    expect(buildNavigatorData("c1", undefined, conversation).chapters).toEqual([]);
    expect(buildNavigatorData("c1", { ...graph, chapters: [] }, conversation, [message]).chapters).toEqual([]);
  });

  it("uses an episode title to compress several questions while keeping every original question available", () => {
    const followUp = { ...message, id: "m2", platformMessageId: "source-2", messageIndex: 1, content: "哪个更好？", preview: "哪个更好？" };
    const structured: ConversationGraph = { ...graph,
      nodes: [...graph.nodes, { ...graph.nodes[0], id: "q2", sourceMessageId: "m2", title: "哪个更好" }],
      chapters: [{ ...graph.chapters![0], questionIds: ["q1", "q2"] }],
      episodes: [{ id: "episode-1", chapterId: "chapter-1", conversationId: "c1", title: "TurnMap 与 ChatAtlas 方案比较", questionIds: ["q1", "q2"], messageIds: ["m1", "m2"] }],
    };
    const projected = buildNavigatorData("c1", structured, conversation, [message, followUp]);
    expect(projected.chapters[0].questions).toMatchObject([{ title: "TurnMap 与 ChatAtlas 方案比较", memberMessageIndices: [0, 1] }]);
    expect(projected.chapters[0].questionCount).toBe(2);
    expect(projected.allQuestions).toHaveLength(2);
  });
});
