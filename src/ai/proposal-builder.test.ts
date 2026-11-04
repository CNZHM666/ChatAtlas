import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { Conversation, ConversationSemanticProfile } from "../shared/types";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { getDatabase } from "../storage/db";
import { analyzedVersion, ANALYSIS_VERSION } from "./conversation-profiler";
import { buildKnowledgeProposal } from "./proposal-builder";

describe("knowledge proposal membership", () => {
  it("builds one intent-led space from confirmed cached sources only", async () => {
    const selected: Conversation = { id: "intent-confirmed", platform: "chatgpt", title: "控制实践", url: "https://chatgpt.com/c/intent-confirmed", messageCount: 2, updatedAt: 1 };
    const unselected: Conversation = { ...selected, id: "intent-unselected", title: "另一个讨论" };
    const profile = (conversation: Conversation): ConversationSemanticProfile => ({ conversationId: conversation.id, title: conversation.title, summary: "状态空间与稳定性", domains: ["自动化"], topics: [], concepts: ["状态空间", "稳定性"], intent: "学习", questionCount: 1, evidenceRefs: [{ conversationId: conversation.id, questionId: `${conversation.id}-q` }], analysisVersion: ANALYSIS_VERSION, analysisSource: "ai", analysisModelKey: "another:model", analysisMode: "balanced", analyzedVersion: analyzedVersion(conversation), updatedAt: 1 });
    const db = await getDatabase();
    await db.put("semanticProfiles", profile(selected));
    await db.put("semanticProfiles", profile(unselected));
    const requests: string[][] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      requests.push(request.conversationIds ?? []);
      return request.validate({ domains: [{ title: "自动化", conversationIds: [selected.id, unselected.id], concepts: ["状态空间"], backbone: ["状态空间"], bridgeCandidates: [], freeCardCandidates: [] }] });
    } };
    const proposal = await buildKnowledgeProposal({ conversations: [selected], intent: "整理我的控制理论学习", intentTitle: "控制理论学习", loadMessages: async () => { throw new Error("Cached profile should avoid raw messages"); }, existingCanvases: [], provider, requireAI: true, now: 3400 });
    expect(requests.flat()).not.toContain(unselected.id);
    expect(proposal.canvases.map((canvas) => canvas.title)).toEqual(["控制理论学习"]);
    expect(proposal.sources.map((source) => source.conversationId)).toEqual([selected.id]);
    expect(proposal.cards.map((card) => card.title)).toEqual(["状态空间"]);
    const sameName = await buildKnowledgeProposal({ conversations: [selected], intent: "另一个复习目标", intentTitle: "控制理论学习", runId: "another-run", loadMessages: async () => { throw new Error("Cached profile should avoid raw messages"); }, existingCanvases: proposal.canvases, provider, requireAI: true, now: 3401 });
    expect(sameName.canvases[0].id).not.toBe(proposal.canvases[0].id);
  });

  it("places a conversation's concepts only in domains that selected those concepts", async () => {
    const conversations: Conversation[] = ["a", "b"].map((id) => ({ id: `domain-scoped-${id}`, platform: "chatgpt", title: id, url: `https://chatgpt.com/c/${id}`, messageCount: 2, updatedAt: 1 }));
    const concepts = [["Alpha", "Gamma"], ["Beta", "Delta"]];
    const db = await getDatabase();
    for (const [index, conversation] of conversations.entries()) {
      const profile: ConversationSemanticProfile = {
        conversationId: conversation.id, title: conversation.title, summary: `Summary ${conversation.title}`,
        domains: ["领域甲", "领域乙"], topics: [], concepts: concepts[index], intent: "学习", questionCount: 2,
        evidenceRefs: [], analysisVersion: ANALYSIS_VERSION, analysisSource: "ai", analysisModelKey: "test:one", analysisMode: "balanced",
        analyzedVersion: analyzedVersion(conversation), updatedAt: 1,
      };
      await db.put("semanticProfiles", profile);
    }
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => request.validate({ domains: [
      { title: "领域甲", conversationIds: conversations.map((item) => item.id), concepts: ["Alpha", "Beta"], backbone: ["Alpha"], bridgeCandidates: [], freeCardCandidates: [] },
      { title: "领域乙", conversationIds: conversations.map((item) => item.id), concepts: ["Gamma", "Delta"], backbone: ["Gamma"], bridgeCandidates: [], freeCardCandidates: [] },
    ] }) };
    const proposal = await buildKnowledgeProposal({ conversations, loadMessages: async () => [], existingCanvases: [], provider, now: 3200 });
    const titles = new Map(proposal.cards.map((card) => [card.id, card.title]));
    const byDomain = new Map(proposal.canvases.map((canvas) => [canvas.title, proposal.memberships.filter((item) => item.canvasId === canvas.id).map((item) => titles.get(item.cardId)).sort()]));
    expect(byDomain.get("领域甲")).toEqual(["Alpha", "Beta"]);
    expect(byDomain.get("领域乙")).toEqual(["Delta", "Gamma"]);
  });

  it("uses linked historical profiles as planning context without reorganizing unselected conversations", async () => {
    const selected: Conversation = { id: "history-context-new", platform: "chatgpt", title: "容器集群配置", url: "https://chatgpt.com/c/history-context-new", messageCount: 1, updatedAt: 1 };
    const old: Conversation = { id: "history-context-old", platform: "chatgpt", title: "Kubernetes 实践", url: "https://chatgpt.com/c/history-context-old", messageCount: 1, updatedAt: 1 };
    const profile = (conversation: Conversation): ConversationSemanticProfile => ({ conversationId: conversation.id, title: conversation.title, summary: "Kubernetes 集群管理", domains: ["平台工程"], topics: [], concepts: ["Kubernetes"], intent: "实践", questionCount: 1, evidenceRefs: [{ conversationId: conversation.id, questionId: `${conversation.id}-q` }], analysisVersion: ANALYSIS_VERSION, analysisSource: "ai", analysisModelKey: "test:one", analysisMode: "balanced", analyzedVersion: analyzedVersion(conversation), updatedAt: 1 });
    const db = await getDatabase();
    await db.put("semanticProfiles", profile(selected));
    await db.put("semanticProfiles", profile(old));
    await db.put("knowledgeCards", { id: "historical-kubernetes-card", type: "concept", title: "Kubernetes", tags: [], origin: "ai", userEdited: false, createdAt: 1, updatedAt: 1 });
    await db.put("sourceRelations", { id: "historical-kubernetes-source", cardId: "historical-kubernetes-card", sourceType: "conversation", sourceId: old.id, conversationId: old.id, createdAt: 1 });
    let relatedIds: string[] = [];
    const provider: AtlasAIProvider = { id: "test", modelId: "one", testConnection: async () => ({ ok: true, model: "one" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const prompt = JSON.parse(request.prompt) as { relatedExistingProfiles: Array<{ id: string }> };
      relatedIds = prompt.relatedExistingProfiles.map((item) => item.id);
      return request.validate({ domains: [{ title: "平台工程", conversationIds: [selected.id, old.id], concepts: ["Kubernetes"], backbone: ["Kubernetes"], bridgeCandidates: [], freeCardCandidates: [] }] });
    } };
    const proposal = await buildKnowledgeProposal({ conversations: [selected], loadMessages: async () => { throw new Error("Cached conversation should not reload messages"); }, existingCanvases: [], provider, now: 3300 });
    expect(relatedIds).toContain(old.id);
    expect(proposal.sources.map((source) => source.conversationId)).toContain(selected.id);
    expect(proposal.sources.map((source) => source.conversationId)).not.toContain(old.id);
  });
});
