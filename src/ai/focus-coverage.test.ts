import {singleOwnerPlan} from "../test/wiki-outline-fixture";
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { AtlasAI } from "./atlas-ai";
import type { StructuredAIRequest } from "./provider";
import { transcriptPassages } from "../search/transcript-index";
import { requestBudget } from "./request-policy";
import { coverageBatches, coverageMaterials, synthesizeCoveredFocus, joinedResults } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";

it("keeps one project introduction after partitioned synthesis without losing topic content, choices or sources", () => {
  const parts = ["ChatAtlas 管理跨 AI 历史。", "ChatAtlas 提供跨平台的历史记忆。", "ChatAtlas 帮助继续已有项目。"].map((summary,index)=>({ title: "ChatAtlas", brief: { summary, confirmed: [{text:`选择${index}`,evidenceIds:[`e${index}`]}], turningPoints: [], openQuestions: [] }, sections: [{ id:`part${index}`,title:`主题${index}`,body:`各主题必须保留的具体知识${index}`,kind:"finding" as const,transition:"",evidenceIds:[`e${index}`] }] }));
  const merged = joinedResults(parts,"zh-CN");
  expect(merged.brief?.summary).toBe(parts[0].brief.summary);
  expect(merged.sections).toHaveLength(3); expect(merged.brief?.confirmed).toHaveLength(3);
  expect(merged.sections.flatMap(section=>section.evidenceIds)).toEqual(["e0","e1","e2"]);
});

describe("complete goal reading", () => {
  it("does not collect unrequested diagrams or project facts in first-generation work",async()=>{
    const source:Conversation={id:"economical-work",title:"ChatAtlas",platform:"chatgpt",url:"",messageCount:1,updatedAt:1};
    const passages=transcriptPassages(source,[{id:"first",conversationId:source.id,messageIndex:0,role:"user",content:"先实现关键词检索，再讨论语义检索。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
    const synthesize=vi.fn(async<T>(request:StructuredAIRequest<T>)=>{
      const data=JSON.parse(request.prompt);expect(data.semanticStructure).toBe(false);expect(data.overviewFromWiki).toBe(true);expect(data.projectKnowledge).toBeUndefined();
      return request.validate({title:"ChatAtlas",brief:{summary:"实现本地搜索并逐步扩展。",confirmed:[],turningPoints:[],openQuestions:[]},sections:[{title:"搜索",body:"先实现关键词检索。",transition:"",kind:"finding",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
    });
    const result=await synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources:[source],passages,modelId:"fixture",ai:{canReuseProjectKnowledge:true,synthesize:synthesize as AtlasAI["synthesize"]},signal:new AbortController().signal,validate:validateFocusResult});
    expect(synthesize).toHaveBeenCalledOnce();expect(result.result.brief).toBeUndefined();expect(result.result.sections[0].body).toContain("先实现关键词检索");expect(result.knowledgeBatches).toBeUndefined();
    expect(result.sourceCharacters).toBeGreaterThanOrEqual(passages[0].text.length);
  });
  it("uses the safe input budget in fast/deep while preserving every character and citation in order", () => {
    const source: Conversation = { id: "mode-source", title: "Mode", platform: "chatgpt", url: "", messageCount: 25, updatedAt: 1 };
    const passages = transcriptPassages(source, Array.from({ length: 25 }, (_, index): ConversationMessage => ({ id: `mode-${index}`, conversationId: source.id, messageIndex: index, role: "assistant", content: `原始证据 ${index}。${"推导与约束。".repeat(200)}更正：B 条件才适用。`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 })));
    const { materials } = coverageMaterials(passages, [source]);
    const fast = coverageBatches(materials, "Read sources", "review", "zh-CN", 1, materials.length, "reading", "qwen3.8-flash", "fast");
    const deep = coverageBatches(materials, "Read sources", "review", "zh-CN", 1, materials.length, "reading", "qwen3.8-flash", "deep");
    expect(fast.length).toBeLessThanOrEqual(deep.length);
    expect(fast.flat()).toEqual(materials); expect(deep.flat()).toEqual(materials);
  });

  it("keeps explicit deep source analysis before composing a short-source review", async () => {
    const source: Conversation = { id: "short-latency", title: "Short", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 };
    const passages = transcriptPassages(source, [{ id: "short-message", conversationId: source.id, messageIndex: 0, role: "user", content: "更正：仅在条件 B 下适用。", preview: "", contentHash: "1", createdAt: 1, updatedAt: 1 }]);
    let calls = 0;
    const synthesize = async <T>(request: StructuredAIRequest<T>) => {
      calls++;
      const data = JSON.parse(request.prompt);
      expect(data.analysisMode).toBe("deep"); expect(data.coverage.final).toBe(calls === 2);
      if (data.coverage.final) expect(requestBudget(request, "qwen3.8-flash").maxOutputTokens).toBe(8000 + 1200);
      expect(request.coveragePlan).toMatchObject({ method: "full_batched", materialBlocks: 1, plannedBatches: calls });
      return request.validate({ title: "条件", sections: [{ title: "更正", body: "仅在 B 条件下适用。", transition: "", kind: "review", evidenceIds: [data.passages[0].id] }] });
    };
    await synthesizeCoveredFocus({ goal: "复习", mode: "review", analysisMode: "deep", locale: "zh-CN", sources: [source], passages, modelId: "qwen3.8-flash", ai: { synthesize }, signal: new AbortController().signal, validate: validateFocusResult });
    expect(calls).toBe(2);
  });
  it("refills a free slot before the slow first batch finishes and preserves source order", async () => {
    const source: Conversation = { id: "s", title: "Source", platform: "chatgpt", url: "", messageCount: 49, updatedAt: 1 };
    const passages = transcriptPassages(source, Array.from({ length: 49 }, (_, index): ConversationMessage => ({ id: `m${index}`, conversationId: source.id, messageIndex: index, role: "assistant", content: `Evidence ${index}. ${"推导与约束。".repeat(400)}`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 })));
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let started = 0;
    let firstDone = false;
    let refilledBeforeFirst = false;
    const ai = { capabilities: { maxConcurrency: 2 }, synthesize: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt) as { coverage: { final: boolean }; passages: Array<{ id: string; text: string }> };
      if (!payload.coverage.final) {
        const index = ++started;
        if (index === 1) { await first; firstDone = true; }
        if (index === 3) refilledBeforeFirst = !firstDone;
      }
      return request.validate({ title: "Review", sections: [{ title: "Note", body: "Grounded", transition: "", kind: "review", evidenceIds: payload.passages.map((item) => item.id) }] });
    } };
    const pending = synthesizeCoveredFocus({ goal: "复习", mode: "review", locale: "zh-CN", sources: [source], passages, modelId: "qwen-plus", ai, signal: new AbortController().signal, validate: validateFocusResult });
    try { await vi.waitFor(() => expect(refilledBeforeFirst).toBe(true)); }
    finally { releaseFirst(); }
    const result = await pending;
    expect(result.result.sections.flatMap(section => section.evidenceIds).map((id) => result.evidence.find((item) => item.id === id)?.messageId)).toEqual(Array.from({ length: 49 }, (_, index) => `m${index}`));
  });

  it("reads all eleven selected conversations in bounded batches and traces the final result to original messages", async () => {
    const sources: Conversation[] = Array.from({ length: 11 }, (_, index) => ({ id: `source-${index}`, title: `项目 ${index}`, platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 }));
    const messages = (source: Conversation): ConversationMessage[] => [
      { id: `${source.id}-question`, conversationId: source.id, messageIndex: 0, role: "user", content: `问题 ${source.id}：为什么先这样设计？`, preview: "", contentHash: "q", createdAt: 1, updatedAt: 1 },
      { id: `${source.id}-answer`, conversationId: source.id, messageIndex: 1, role: "assistant", content: `${source.id} 的初步方案。${"推导与约束。".repeat(230)}更正：后来放弃初步方案。`, preview: "", contentHash: "a", createdAt: 1, updatedAt: 1 },
    ];
    const passages = sources.flatMap((source) => transcriptPassages(source, messages(source)));
    const readIds: string[] = [];
    const readText: string[] = [];
    let requests = 0;
    let activeReading = 0;
    let maxActiveReading = 0;
    const ai: Pick<AtlasAI, "synthesize"|"generateStructured"> & { capabilities: Pick<AtlasAI["capabilities"], "maxConcurrency"> } = { generateStructured:singleOwnerPlan, capabilities: { maxConcurrency: 3 }, synthesize: async <T>(request: StructuredAIRequest<T>) => {
      requests++;
      const call = requests;
      const payload = JSON.parse(request.prompt) as { coverage: { stage: string }; passages: Array<{ id: string; text: string }> };
      const budget = requestBudget(request, "qwen-plus");
      expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
      if (payload.coverage.stage === "reading") {
        readIds.push(...payload.passages.map((item) => item.id)); readText.push(...payload.passages.map((item) => item.text));
        maxActiveReading = Math.max(maxActiveReading, ++activeReading);
        await new Promise((resolve) => setTimeout(resolve, call % 3 === 1 ? 20 : 5));
        activeReading--;
      }
      const content = payload.passages.map((item) => item.text.slice(0, 70)).join("\n");
      return request.validate({ title: "项目回顾", sections: [{ title: "过程", body: `## 具体机制\n\n${content}`, transition: "", kind: "finding", evidenceIds: payload.passages.map((item) => item.id) }] });
    } };
    const result = await synthesizeCoveredFocus({ goal: "回顾项目设计过程", mode: "work", locale: "zh-CN", sources, passages, modelId: "qwen-plus", ai, signal: new AbortController().signal, validate: validateFocusResult });
    expect(requests).toBeGreaterThan(1);
    expect(maxActiveReading).toBe(3);
    expect(readIds).toEqual(coverageMaterials(passages, sources).materials.map((item) => item.id));
    expect(result.segmentCount).toBe(coverageMaterials(passages, sources).materials.length);
    const evidenceById = new Map(result.evidence.map((item) => [item.id, item]));
    expect(result.result.sections[0].evidenceIds.map((id) => `${evidenceById.get(id)?.conversationId}:${evidenceById.get(id)?.messageId}`)).toEqual(sources.flatMap((source) => messages(source).map((message) => `${source.id}:${message.id}`)));
    expect(new Set(result.evidence.map((item) => item.conversationId))).toEqual(new Set(sources.map((source) => source.id)));
    expect(readText.filter((text) => text.includes("更正：后来放弃初步方案"))).toHaveLength(11);
  });

  it("carries an uncited raw segment forward across all final chapters instead of silently dropping it", async () => {
    const sources: Conversation[] = Array.from({ length: 3 }, (_, index) => ({ id: `miss-${index}`, title: `Source ${index}`, platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 }));
    const passages = sources.flatMap((source) => transcriptPassages(source, Array.from({ length: 2 }, (_, index) => ({ id: `${source.id}-message-${index}`, conversationId: source.id, messageIndex: index, role: "assistant" as const, content: `Important ${source.id}. ${"详细过程。".repeat(400)}`, preview: "", contentHash: "1", createdAt: 1, updatedAt: 1 }))));
    const ai: Pick<AtlasAI, "synthesize"> = { synthesize: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt) as { coverage: { stage: string }; passages: Array<{ id: string; text: string }> };
      const cited = payload.coverage.stage === "reading" ? [payload.passages[0].id] : payload.passages.map((item) => item.id);
      return request.validate({ title: "Summary", sections: [{ title: "Evidence", body: payload.passages.map((item) => item.text.slice(0, 25)).join(" "), transition: "", kind: "review", evidenceIds: cited }] });
    } };
    const result = await synthesizeCoveredFocus({ goal: "复习全部资料", mode: "review", locale: "zh-CN", sources, passages, modelId: "qwen-plus", ai, signal: new AbortController().signal, validate: validateFocusResult });
    const references = new Set(result.result.sections[0].evidenceIds.map((id) => result.evidence.find((item) => item.id === id)?.conversationId));
    expect(references).toEqual(new Set(sources.map((source) => source.id)));
    expect(new Set(result.result.sections.flatMap(section => section.evidenceIds).map((id) => result.evidence.find((item) => item.id === id)?.messageId))).toEqual(new Set(passages.map((item) => item.evidence.messageId)));
  });

  it("carries original formula transformations into final review even when the neutral note is terse", async () => {
    const source: Conversation = { id: "math-source", title: "链式法则", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 };
    const content = String.raw`已知 $x=\sqrt{1+t}$。先平方 $x^2=1+t$，于是 $\frac{d(x^2)}{dt}=1$；需检查 $t>-1$。`;
    const passages = transcriptPassages(source, [{ id: "math-message", conversationId: source.id, messageIndex: 0, role: "assistant", content, preview: "", contentHash: "math", createdAt: 1, updatedAt: 1 }]);
    let finalText = "";
    const ai: Pick<AtlasAI, "synthesize"> = { synthesize: async <T>(request: StructuredAIRequest<T>) => {
      const payload = JSON.parse(request.prompt);
      if (payload.coverage.final) {
        finalText = payload.passages.map((item: { text: string }) => item.text).join("\n");
        expect(request.system).toContain("reasoning step by step");
      }
      return request.validate({ title: "链式法则", sections: [{ title: "复合求导", body: "应用链式法则，检查条件。", transition: "", kind: "review", evidenceIds: payload.passages.map((item: { id: string }) => item.id) }] });
    } };
    const result = await synthesizeCoveredFocus({ goal: "详细复习求导", mode: "review", locale: "zh-CN", sources: [source], passages, modelId: "qwen-plus", analysisMode: "deep", ai, signal: new AbortController().signal, validate: validateFocusResult });
    expect(finalText).toContain(content);
    expect(result.evidence).toHaveLength(1);
    expect(new Set(result.result.sections.flatMap(section => section.evidenceIds))).toEqual(new Set([result.evidence[0].id]));
  });

  it("stops scheduling new batches after a failure and waits for work already in flight", async () => {
    const source: Conversation = { id: "failure-source", title: "Failure", platform: "chatgpt", url: "", messageCount: 65, updatedAt: 1 };
    const passages = transcriptPassages(source, Array.from({ length: 65 }, (_, index): ConversationMessage => ({ id: `m${index}`, conversationId: source.id, messageIndex: index, role: "assistant", content: `Evidence ${index}. ${"推导与约束。".repeat(400)}`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 })));
    let started = 0;
    let settled = 0;
    const ai: Pick<AtlasAI, "synthesize"> & { capabilities: Pick<AtlasAI["capabilities"], "maxConcurrency"> } = { capabilities: { maxConcurrency: 2 }, synthesize: async <T>(request: StructuredAIRequest<T>) => {
      const call = ++started;
      try {
        if (call === 1) throw new Error("invalid batch");
        await new Promise((resolve) => setTimeout(resolve, 10));
        const payload = JSON.parse(request.prompt) as { passages: Array<{ id: string }> };
        return request.validate({ title: "Review", sections: [{ title: "Note", body: "Grounded", transition: "", kind: "review", evidenceIds: payload.passages.map((item) => item.id) }] });
      } finally { settled++; }
    } };
    await expect(synthesizeCoveredFocus({ goal: "复习", mode: "review", locale: "zh-CN", sources: [source], passages, modelId: "qwen-plus", ai, signal: new AbortController().signal, validate: validateFocusResult })).rejects.toThrow("invalid batch");
    expect(started).toBe(2);
    expect(settled).toBe(2);
  });
});
