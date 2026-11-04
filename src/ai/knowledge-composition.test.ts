import { describe, expect, it } from "vitest";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import type { ConversationSemanticProfile } from "../shared/types";
import { planKnowledgeComposition } from "./knowledge-composition";

const profile = (id: string): ConversationSemanticProfile => ({ conversationId: id, title: id, summary: "讨论特征值和控制理论的联系。", domains: ["数学"], topics: [], concepts: ["矩阵特征值", "系统极点"], intent: "学习", evidenceRefs: [{ conversationId: id, messageId: `m-${id}` }], analyzedVersion: "1", updatedAt: 1 });

describe("knowledge composition planning", () => {
  it("retrieves a historical concept even when its name is an alias", async () => {
    const current = { ...profile("current-alias"), concepts: ["极点"], domains: [] };
    const historical = { ...profile("historical-alias"), concepts: ["系统极点"], domains: [] };
    let relatedIds: string[] = [];
    const provider: AtlasAIProvider = { testConnection: async () => ({ ok: true, model: "test" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt) as { relatedExistingProfiles: Array<{ id: string }> };
      relatedIds = payload.relatedExistingProfiles.map((item) => item.id);
      return request.validate({ domains: [] });
    } };
    const result = await planKnowledgeComposition({ profiles: [current], historicalProfiles: [historical], freshIds: new Set([current.conversationId]), existingDomainTitles: [], provider });
    expect(relatedIds).toEqual([historical.conversationId]);
    expect(result.profiles.map((item) => item.conversationId)).toEqual([current.conversationId]);
  });

  it("plans only fresh profiles and rejects invented concepts, sources, and unsupported cards", async () => {
    let requestCount = 0;
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true as const, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        requestCount += 1;
        if (request.prompt.includes('"candidates"')) return request.validate({ decisions: [{ id: "0:0", supported: true, useful: true }] });
        const payload = JSON.parse(request.prompt) as { newProfiles: Array<{ id: string }>; relatedExistingProfiles: Array<{ id: string }> };
        expect(payload.newProfiles.map((item) => item.id)).toEqual(["a", "b"]);
        expect(payload.relatedExistingProfiles.map((item) => item.id)).toEqual(["old"]);
        return request.validate({ domains: [{ title: "控制与自动化", conversationIds: ["a", "b", "invented"], concepts: ["矩阵特征值", "系统极点", "虚构概念"], backbone: ["矩阵特征值", "系统极点"], bridgeCandidates: [
          { from: "矩阵特征值", to: "系统极点", text: "状态矩阵的特征值对应系统极点", conversationIds: ["a"] },
          { from: "虚构概念", to: "系统极点", text: "一个不存在的概念产生了联系", conversationIds: ["a"] },
        ], freeCardCandidates: [
          { type: "insight", title: "跨对话发现", body: "两个来源共同指向控制理论中的极点分析。", conversationIds: ["a", "b"] },
          { type: "insight", title: "单来源臆测", body: "缺少跨对话来源的总结无法被接受。", conversationIds: ["a"] },
        ] }] });
      },
    };
    const result = await planKnowledgeComposition({ profiles: [profile("a"), profile("b"), profile("old")], freshIds: new Set(["a", "b"]), existingDomainTitles: [], provider });
    expect(requestCount).toBe(2);
    expect(result.profiles.find((item) => item.conversationId === "old")?.domains).toEqual(["数学"]);
    expect(result.domains[0].concepts).toEqual(["矩阵特征值", "系统极点"]);
    expect(result.domains[0].bridgeCandidates).toHaveLength(1);
    expect(result.domains[0].freeCardCandidates).toHaveLength(1);
  });

  it("globally merges equivalent domains planned in different profile batches", async () => {
    const profiles = Array.from({ length: 25 }, (_, index) => profile(`p${index}`));
    let requests = 0;
    const provider: AtlasAIProvider = {
      testConnection: async () => ({ ok: true as const, model: "test" }),
      generateStructured: async <T>(request: StructuredAIRequest<T>) => {
        requests += 1;
        const payload = JSON.parse(request.prompt) as { newProfiles?: Array<{ id: string }>; domainCandidates?: unknown[] };
        if (payload.domainCandidates) return request.validate({ merges: [{ from: "自动控制", to: "控制理论" }] });
        return request.validate({ domains: [{ title: payload.newProfiles!.length > 1 ? "控制理论" : "自动控制", conversationIds: payload.newProfiles!.map((item) => item.id), concepts: ["矩阵特征值", "系统极点"], backbone: ["矩阵特征值", "系统极点"], bridgeCandidates: [], freeCardCandidates: [] }] });
      },
    };
    const result = await planKnowledgeComposition({ profiles, freshIds: new Set(profiles.map((item) => item.conversationId)), existingDomainTitles: [], provider });
    expect(requests).toBe(3);
    expect(result.domains).toHaveLength(1);
    expect(result.domains[0].conversationIds).toHaveLength(25);
    expect(result.profiles.every((item) => item.domains[0] === "控制理论")).toBe(true);
  });
});
