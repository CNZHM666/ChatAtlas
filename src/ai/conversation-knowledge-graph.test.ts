import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage, QuestionSnapshot } from "../shared/types";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { judgeConversationComposition, organizeConversationKnowledgeGraph, validateConversationChapterPlan } from "./conversation-knowledge-graph";

const conversation: Conversation = { id: "chapter-plan-test", platform: "chatgpt", title: "产品开发", url: "https://chatgpt.com/c/chapter-plan-test", messageCount: 6, updatedAt: 1 };
const ordered: QuestionSnapshot[] = Array.from({ length: 6 }, (_, index) => ({
  questionId: `q${index + 1}`, conversationId: conversation.id, displayTitle: index % 2 ? "工程实现" : "产品定位",
  summary: index % 2 ? "实现细节" : "产品目标", concepts: [], sourceHash: `${index}`, analysisVersion: 1, updatedAt: 1,
}));
const group = (title: string, questionIds: string[]) => ({ title, summary: `${title}的具体讨论。`, questionIds });
const fallback = { chapters: [], questionRelations: [] };

describe("conversation chapter plan validation", () => {
  it("keeps chapters as continuous parts of the original learning process", () => {
    const result = validateConversationChapterPlan({ groups: [group("产品定位", ["q1", "q2", "q3"]), group("工程实现", ["q4", "q5", "q6"])] }, conversation, ordered, fallback, 2);
    expect(result.chapters.map((chapter) => chapter.questionIds)).toEqual([
      ["conversation-message-q1", "conversation-message-q2", "conversation-message-q3"],
      ["conversation-message-q4", "conversation-message-q5", "conversation-message-q6"],
    ]);
    expect(() => validateConversationChapterPlan({ groups: [group("产品定位", ["q1", "q3", "q5"]), group("工程实现", ["q2", "q4", "q6"])] }, conversation, ordered, fallback, 2)).toThrow("Chapter boundaries split");
  });

  it("preserves specific AI chapter titles and summaries, including two chapters for four questions", () => {
    const result = validateConversationChapterPlan({ chapters: [
      { title: "市场边界判断", summary: "明确优先服务的用户群和暂不覆盖的场景。", questionIds: ["q1", "q2"] },
      { title: "实现风险评估", summary: "比较实现方案的依赖与交付风险。", questionIds: ["q3", "q4"] },
    ] }, conversation, ordered.slice(0, 4), fallback, 2);
    expect(result.chapters.map((chapter) => chapter.title)).toEqual(["市场边界判断", "实现风险评估"]);
    expect(result.chapters.map((chapter) => chapter.summary)).toEqual(["明确优先服务的用户群和暂不覆盖的场景。", "比较实现方案的依赖与交付风险。"]);
  });

  it("rejects missing, repeated, or out-of-order questions", () => {
    expect(() => validateConversationChapterPlan({ groups: [group("产品定位", ["q1", "q3", "q5"]), group("工程实现", ["q2", "q4", "q5"])] }, conversation, ordered, fallback, 2)).toThrow("Question coverage changed");
    expect(() => validateConversationChapterPlan({ groups: [group("产品定位", ["q3", "q1", "q5"]), group("工程实现", ["q2", "q4", "q6"])] }, conversation, ordered, fallback, 2)).toThrow("Question order changed within a chapter");
  });

  it("keeps a short conversation compressed instead of accepting one chapter per question", () => {
    expect(() => validateConversationChapterPlan({ chapters: ordered.slice(0, 3).map((snapshot) => group("产品定位", [snapshot.questionId])) }, conversation, ordered.slice(0, 3), fallback, 2)).toThrow("Insufficient compression");
  });

  it("keeps only sourced, non-redundant bridge and insight candidates", () => {
    const result = validateConversationChapterPlan({ chapters: [group("产品定位", ["q1", "q2", "q3"]), group("工程实现", ["q4", "q5", "q6"])], backbone: [0, 1], bridgeCandidates: [
      { fromOrder: 0, toOrder: 1, text: "产品边界决定工程实现的优先级", questionIds: ["q1", "q4"] },
      { fromOrder: 0, toOrder: 1, text: "没有来源的关系说明", questionIds: ["invented"] },
    ], freeCardCandidates: [
      { afterOrder: 0, type: "insight", title: "设计原则", body: "产品目标需要和工程约束共同确定实施顺序。", questionIds: ["q1", "q2"] },
      { afterOrder: 1, type: "insight", title: "无证据结论", body: "这是一条缺乏对应来源的总结内容。", questionIds: ["q6"] },
      { afterOrder: 1, type: "draft", title: "目标用户是谁？", body: "AI 不应替用户回答", questionIds: ["q6"] },
    ] }, conversation, ordered, fallback, 2);
    expect(result.bridges).toHaveLength(1);
    expect(result.bridges?.[0].questionIds).toEqual(["conversation-message-q1", "conversation-message-q4"]);
    expect(result.freeCards?.map((card) => card.type)).toEqual(["insight", "draft"]);
    expect(result.freeCards?.[1].body).toBeUndefined();
  });

  it("drops rejected decorations without losing chapters or question assignments", async () => {
    const structure = validateConversationChapterPlan({ chapters: [group("产品定位", ["q1", "q2", "q3"]), group("工程实现", ["q4", "q5", "q6"])], bridgeCandidates: [{ fromOrder: 0, toOrder: 1, text: "产品边界决定工程实现优先级", questionIds: ["q1", "q4"] }], freeCardCandidates: [{ afterOrder: 0, type: "insight", title: "设计原则", body: "产品目标需要和工程约束共同确定实施顺序。", questionIds: ["q1", "q4"] }] }, conversation, ordered, fallback, 2);
    const provider: AtlasAIProvider = { testConnection: async () => ({ ok: true as const, model: "test" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ decisions: [{ id: "bridge:0", supported: true, useful: true }, { id: "free:0", supported: false, useful: false }] }) };
    const judged = await judgeConversationComposition(structure, ordered, provider);
    expect(judged.chapters).toEqual(structure.chapters);
    expect(judged.bridges).toHaveLength(1);
    expect(judged.freeCards).toHaveLength(0);
  });

  it("uses an AI chapter plan even for a three-question conversation", async () => {
    const short: Conversation = { ...conversation, id: "short-ai-chapter-plan", messageCount: 3 };
    const messages: ConversationMessage[] = Array.from({ length: 3 }, (_, index) => ({ id: `short-q-${index}`, conversationId: short.id, messageIndex: index, role: "user", content: `产品问题 ${index}`, preview: `产品问题 ${index}`, contentHash: `short-hash-${index}`, createdAt: 1, updatedAt: 1 }));
    const requests: string[] = [];
    const provider: AtlasAIProvider = {
      id: "test", modelId: "test", testConnection: async () => ({ ok: true, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        requests.push(request.taskType ?? "unknown");
        if (request.taskType === "question_snapshot") return request.validate({ snapshots: messages.map((message) => ({ conversationId: short.id, questionId: message.id, displayTitle: message.content, summary: message.content, concepts: ["产品定位"] })) });
        return request.validate({ chapters: [{ title: "产品定位", summary: "讨论产品目标与范围。", questionIds: messages.map((message) => message.id) }] });
      },
    };
    const graph = await organizeConversationKnowledgeGraph({ conversation: short, messages, provider });
    expect(requests).toContain("chapter_planning");
    expect(graph.chapters?.map((chapter) => chapter.title)).toEqual(["产品定位"]);
  });
});
