import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationSemanticProfile, QuestionSnapshot } from "../shared/types";
import { getDatabase } from "../storage/db";
import { getMessagesForConversation } from "../storage/messages";
import { rankKnowledgeSources, recommendKnowledgeSourcesWithAI } from "./knowledge-source-retrieval";
import { fallbackKnowledgeTitle } from "./knowledge-intent";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";

vi.mock("../storage/db", () => ({ getDatabase: vi.fn() }));
vi.mock("../storage/messages", () => ({ getMessagesForConversation: vi.fn() }));

const conversation = (id: string, title: string): Conversation => ({ id, title, platform: "chatgpt", url: `https://chatgpt.com/c/${id}`, messageCount: 2, importState: "complete", updatedAt: 1 });

describe("intent-first local retrieval", () => {
  it("uses cached profiles and question snapshots without transcript text or an AI provider", () => {
    const conversations = [conversation("control", "现代控制实践"), conversation("physics", "大学物理实验"), conversation("numpy", "Python 数值计算")];
    const profiles: ConversationSemanticProfile[] = [{ conversationId: "control", title: "现代控制实践", summary: "状态空间和系统极点", domains: ["控制与自动化"], topics: [], concepts: ["控制理论", "状态空间"], intent: "学习", questionCount: 2, evidenceRefs: [], analyzedVersion: "v1", updatedAt: 1 }];
    const snapshots: QuestionSnapshot[] = [{ conversationId: "numpy", questionId: "q", displayTitle: "控制系统的特征值计算", summary: "使用 NumPy 计算极点", concepts: ["控制系统"], sourceHash: "x", analysisVersion: 1, updatedAt: 1 }];
    const ranked = rankKnowledgeSources("整理我的控制理论学习", conversations, profiles, snapshots);
    expect(ranked[0].conversation.id).toBe("control");
    expect(ranked.find((item) => item.conversation.id === "numpy")?.relevance).not.toBe("other");
    expect(ranked.at(-1)?.conversation.id).toBe("physics");
    expect(ranked.at(-1)?.relevance).toBe("other");
  });

  it("finds a mixed Latin and Chinese topic after removing request wording", () => {
    const ranked = rankKnowledgeSources(fallbackKnowledgeTitle("整理一下C语言"), [conversation("c", "C语言基础"), conversation("other", "自然语言处理")], [], []);
    expect(ranked[0]).toMatchObject({ conversation: { id: "c" }, relevance: "high" });
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].relevance).toBe("other");
  });

  it("does not treat a generic request verb as a topic match", () => {
    const ranked = rankKnowledgeSources("整理我的控制理论学习内容", [conversation("unrelated", "学习方法与资料整理"), conversation("control", "控制理论")], [], []);
    expect(ranked.find((item) => item.conversation.id === "unrelated")?.relevance).toBe("other");
  });

  it("uses the connected model to rank catalog evidence and ignores invented IDs", async () => {
    vi.mocked(getDatabase).mockResolvedValue({ getAll: vi.fn(async () => []), get: vi.fn(async () => undefined), put: vi.fn(async () => undefined) } as unknown as Awaited<ReturnType<typeof getDatabase>>);
    vi.mocked(getMessagesForConversation).mockImplementation(async (id) => id === "control" ? [{ id: "q1", conversationId: id, messageIndex: 0, role: "user", content: "Why do poles determine stability?", preview: "Why do poles determine stability?", contentHash: "hash", createdAt: 1, updatedAt: 1 }] : []);
    const calls: string[] = [];
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        if (request.taskType === "other") return request.validate({ queries: [] });
        calls.push(request.prompt);
        return request.validate({ matches: [{ id: "control", relevance: "high", reason: "State-space learning" }, { id: "invented", relevance: "high", reason: "Not in catalog" }] });
      },
    };
    const sources = [conversation("control", "State-space notes"), conversation("other", "Travel plans")];
    const ranked = await recommendKnowledgeSourcesWithAI("Review control theory", sources, provider);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("State-space notes");
    expect(calls[0]).toContain("Why do poles determine stability?");
    expect(ranked[0]).toMatchObject({ conversation: { id: "control" }, relevance: "high", reason: "State-space learning" });
    expect(ranked[1]).toMatchObject({ conversation: { id: "other" }, relevance: "other" });
    expect(ranked).toHaveLength(2);
  });
});
