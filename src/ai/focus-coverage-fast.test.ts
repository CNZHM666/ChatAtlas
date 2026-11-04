import "fake-indexeddb/auto";
import { describe, expect, it, vi } from "vitest";
import type { Conversation, ConversationMessage, AISettings } from "../shared/types";
import type { StructuredAIRequest } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { coverageMaterials, synthesizeCoveredFocus } from "./focus-coverage";
import { transcriptPassages } from "../search/transcript-index";
import { validateFocusResult } from "./focus-session";
import type { FocusAnalysisProgress } from "../shared/focus-progress";
import { requestBudget } from "./request-policy";
import { AIProviderValidationError,AIProviderResponseError } from "./provider-errors";

const source = (): Conversation => ({ id: crypto.randomUUID(), title: "Discussion", platform: "chatgpt", url: "", messageCount: 49, updatedAt: 1 });
const messages = (s: Conversation, count: number, content = "short"): ConversationMessage[] => Array.from({ length: count }, (_, index) => ({ id: `${s.id}-m${index}`, conversationId: s.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content: `${content} ${index}`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 }));
const resultFor = async <T>(request: StructuredAIRequest<T>): Promise<T> => {
  const payload = JSON.parse(request.prompt) as { passages: Array<{ id: string }> };
  return request.validate({ title: "Reading", sections: [{ title: "Conditions and corrections", body: "Source-grounded notes", kind: "review", transition: "", evidenceIds: payload.passages.map((item) => item.id) }] });
};
const run = (s: Conversation, ms: ConversationMessage[], ai: Parameters<typeof synthesizeCoveredFocus>[0]["ai"], goal = "复习") => synthesizeCoveredFocus({ sources: [s], passages: transcriptPassages(s, ms), ai, goal, mode: "review", locale: "zh-CN", modelId: "qwen-plus", signal: new AbortController().signal, validate: validateFocusResult });

describe("adaptive complete reading", () => {
  it("attaches recovery ancestry and preserves all source IDs after output truncation",async()=>{
    const s=source(),ms=messages(s,8,"完整条件。".repeat(350));const traces:Array<StructuredAIRequest<unknown>["trace"]>=[];let fail=true;
    const result=await run(s,ms,{synthesize:async<T,>(request:StructuredAIRequest<T>)=>{traces.push(request.trace);if(fail){fail=false;throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED");}return resultFor(request);}});
    const children=traces.filter(trace=>trace?.recoveryDepth===1);expect(children.length).toBeGreaterThanOrEqual(2);expect(children[0]).toMatchObject({parentOperationId:traces[0]?.operationId,recoveryReason:"output_truncation",schedulingMs:expect.any(Number)});
    expect(new Set(result.result.sections.flatMap(section=>section.evidenceIds))).toEqual(new Set(result.evidence.map(ref=>ref.id)));
  });

  it("publishes checked final batches in source order while later composition continues",async()=>{
    const s=source(),ms=messages(s,32,"原始条件和后续修正。".repeat(170)),previews:number[]=[];let finalCalls=0;
    const result=await synthesizeCoveredFocus({sources:[s],passages:transcriptPassages(s,ms),goal:"复习",mode:"review",locale:"zh-CN",signal:new AbortController().signal,validate:validateFocusResult,
      onPartial:(partial)=>{previews.push(partial.sections.length);},
      ai:{synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
        const data=JSON.parse(request.prompt);if(data.coverage.final){finalCalls++;return resultFor(request);}
        return request.validate({title:"完整笔记",sections:[{title:"条件",body:data.passages.map((item:{text:string})=>item.text).join("\n"),transition:"",kind:"review",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
      }}});
    expect(finalCalls).toBeGreaterThan(1);expect(previews).toHaveLength(finalCalls);expect(previews).toEqual([...previews].sort((a,b)=>a-b));expect(previews.at(-1)).toBe(result.result.sections.length);
  });
  it("recovers missing chapter text locally and reuses every successful note on the next run", async () => {
    const s = source(), ms = messages(s, 8, "原始条件与完整推导。".repeat(350));
    const settings: AISettings = { id: "ai-settings", provider: "deepseek", model: "qwen-plus", baseUrl: "https://schema-recovery.invalid", apiKey: "test", updatedAt: 1 };
    let fail = true, readingCalls = 0;
    const ai = createAtlasAIFromProvider({ id: "test", modelId: "qwen-plus", testConnection: async () => ({ ok: true, model: "qwen-plus" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => {
      if (!JSON.parse(request.prompt).coverage.final) { readingCalls++; if (fail) { fail = false; throw new AIProviderValidationError("missing_section_text"); } }
      return resultFor(request);
    } }, settings);
    const result = await run(s, ms, ai);
    expect(result.segmentCount).toBe(8);
    expect(result.result.sections.flatMap(section => section.evidenceIds).map(id => result.evidence.find(ref => ref.id === id)?.messageId)).toEqual(expect.arrayContaining(ms.map(message => message.id)));
    const before = readingCalls;
    await run(s, ms, ai, "换个目标复习");
    expect(readingCalls).toBe(before);
  });
  it("does not recover invented citations as a missing-text error", async () => {
    const s = source(), ms = messages(s, 8, "来源。".repeat(900));
    const synthesize = vi.fn(async () => { throw new AIProviderValidationError("unknown_evidence_id"); });
    await expect(run(s, ms, { synthesize })).rejects.toThrow("本次材料之外");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
  it("sends every short-source character and later correction in one complete request", async () => {
    const s = source(), ms = messages(s, 4, "Original condition");
    ms[3].content = "Correction: only under the stated boundary. Earlier AI advice was not confirmed.";
    const synthesize = vi.fn().mockImplementation(resultFor);
    const result = await run(s, ms, { synthesize });
    expect(synthesize).toHaveBeenCalledOnce();
    const payload = JSON.parse(synthesize.mock.calls[0][0].prompt);
    expect(payload.coverage).toMatchObject({ final: true, sampled: false });
    expect(payload.passages.map((p: { text: string }) => p.text)).toEqual(ms.map(m => `${m.role}: ${m.content}`));
    expect(result).toMatchObject({ method: "full_direct", segmentCount: 4, batchCount: 1 });
    expect(result.result.sections[0].evidenceIds).toHaveLength(4);
    expect(result.sourceOutlines[0].chapters).toEqual([]); // Goal wording is not promoted to neutral source analysis.
  });
  it("prefers existing neutral notes over rereading a short source and keeps deep analysis separate", async () => {
    const s = source(), ms = messages(s, 4);
    const hasCachedSynthesis = vi.fn(async () => true);
    const synthesize = vi.fn().mockImplementation(resultFor);
    await run(s, ms, { synthesize, hasCachedSynthesis });
    expect(hasCachedSynthesis).toHaveBeenCalledOnce();
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(JSON.parse(synthesize.mock.calls[0][0].prompt).coverage.final).toBe(false);
    synthesize.mockClear();
    await synthesizeCoveredFocus({ sources: [s], passages: transcriptPassages(s, ms), ai: { synthesize }, goal: "Review", mode: "review", analysisMode: "deep", locale: "en", modelId: "fixture", signal: new AbortController().signal, validate: validateFocusResult });
    expect(synthesize).toHaveBeenCalledTimes(2);
  });
  it("finishes long uncompressed notes in two rounds, composing ordered final parts within budget", async () => {
    const s = source(), ms = messages(s, 154, "原始条件和后续修正。".repeat(150));
    const progress: FocusAnalysisProgress[] = [];
    const payloads: Array<{ coverage: { final: boolean; stage: string }; passages: Array<{ id: string; text: string }> }> = [];
    const result = await synthesizeCoveredFocus({ sources: [s], passages: transcriptPassages(s, ms), goal: "回顾全部讨论", mode: "review", locale: "zh-CN", modelId: "deepseek-v4.1-flash", signal: new AbortController().signal, validate: validateFocusResult,
      onProgress: (_completed, _total, _stage, detail) => { if (detail) progress.push(detail); },
      ai: { synthesize: async <T>(request: StructuredAIRequest<T>) => {
        const payload = JSON.parse(request.prompt); payloads.push(payload);
        const budget = requestBudget(request, "deepseek-v4.1-flash");
        expect(budget.inputTokens).toBeLessThanOrEqual(budget.maxInputTokens);
        // A poor compression ratio used to trigger up to eight rounds.
        return payload.coverage.final ? resultFor(request) : request.validate({ title: "Notes", sections: [{ title: "Full conditions", kind: "review", transition: "", body: payload.passages.map((p: { text: string }) => p.text).join("\n"), evidenceIds: payload.passages.map((p: { id: string }) => p.id) }] });
      } } });
    expect(payloads.filter(p => p.coverage.final).length).toBeGreaterThan(1);
    expect(payloads.filter(p => p.coverage.stage === "synthesis").every(p => p.coverage.final)).toBe(true);
    expect(Math.max(...progress.map(p => p.round))).toBe(2);
    expect(progress.at(-1)).toMatchObject({ remainingSteps: 0, stepsEstimated: false, processedSegments: 154 });
    const evidenceIds = [...new Set(result.result.sections.flatMap(section => section.evidenceIds))];
    expect(evidenceIds.map(id => result.evidence.find(e => e.id === id)?.messageId)).toEqual(ms.map(m => m.id));
    expect(result.sourceOutlines[0].chapters.flatMap(chapter => chapter.messageIds)).toEqual(ms.map(m => m.id));
  });
  it("merges repeated batch provenance once while retaining every note and correction", async () => {
    const s = source(), ms = messages(s, 12);
    let composition: Array<{ text: string }> = [];
    await run(s, ms, { synthesize: async <T>(request: StructuredAIRequest<T>) => {
      const p = JSON.parse(request.prompt);
      if (p.coverage.final) { composition = p.passages; return resultFor(request); }
      return request.validate({ title: "Notes", sections: ["Initial condition", "Later correction", "Unresolved disagreement"].map((body) => ({ title: body, body, kind: "review", transition: "", evidenceIds: p.passages.map((item: { id: string }) => item.id) })) });
    } });
    expect(composition).toHaveLength(1);
    for (const note of ["Initial condition", "Later correction", "Unresolved disagreement"]) expect(composition[0].text).toContain(note);
  });
  it("analyzes 49 short messages in one source batch and retains every reference after composition", async () => {
    const s = source(), ms = messages(s, 49);
    const synthesize = vi.fn().mockImplementation(resultFor);
    const prepareFocus = vi.fn();
    const result = await run(s, ms, { synthesize, prepareFocus });
    expect(synthesize).toHaveBeenCalledTimes(2);
    expect(JSON.parse(synthesize.mock.calls[0][0].prompt)).toMatchObject({ coverage: { final: false, sampled: false } });
    expect(JSON.parse(synthesize.mock.calls[1][0].prompt)).toMatchObject({ presentation: "reading_route", coverage: { final: true } });
    expect(prepareFocus).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ method: "full_batched", batchCount: 2, segmentCount: 49 });
    expect(result.result.sections[0].evidenceIds.map((id) => result.evidence.find((item) => item.id === id)?.messageId)).toEqual(ms.map((m) => m.id));
  });

  it("removes search overlap losslessly, keeps roles and corrections, and retains long-message evidence", async () => {
    const s = source();
    const content = "前提条件。".repeat(799) + "😀更正：之前的 AI 建议没有被用户确认。" + "完整原文。".repeat(150);
    const ms = messages(s, 1); ms[0].content = content;
    const passages = transcriptPassages(s, ms);
    const { materials, evidence } = coverageMaterials(passages, [s]);
    expect(materials.map((m) => m.text.replace(/^user: /u, "")).join("")).toBe(content);
    expect(materials.every((m) => !/[\uD800-\uDBFF]$/u.test(m.text))).toBe(true);
    expect(materials.filter((m) => m.text.includes("更正："))).toHaveLength(1);
    expect(evidence[1].excerpt).not.toBe(evidence[0].excerpt);
    const result = await run(s, ms, { synthesize: resultFor });
    expect(result.result.sections[0].evidenceIds).toHaveLength(materials.length);
  });

  it("carries evidence cited only by an omitted open-question section into final synthesis", async () => {
    const s = source(), ms = messages(s, 8, "详细条件。".repeat(350));
    let missing = "";
    let finalText = "";
    const synthesize = async <T>(request: StructuredAIRequest<T>) => {
      const p = JSON.parse(request.prompt) as { coverage: { final: boolean }; passages: Array<{ id: string; text: string }> };
      if (p.coverage.final) { finalText = p.passages.map((x) => x.text).join("\n"); return resultFor(request); }
      const omitted = p.passages.at(-1)!; missing = omitted.text;
      return request.validate({ title: "Notes", sections: [
        { title: "Finding", body: "Compact note", transition: "", kind: "review", evidenceIds: p.passages.slice(0, -1).map((x) => x.id) },
        { title: "Unresolved", body: omitted.text, transition: "", kind: "open_question", evidenceIds: [omitted.id] },
      ] });
    };
    await run(s, ms, { synthesize });
    expect(finalText).toContain(missing);
  });

  it("checks a long plan before any generation and preserves the quota error", async () => {
    const s = source(), ms = messages(s, 8, "详细条件。".repeat(500));
    const synthesize = vi.fn().mockImplementation(resultFor);
    const prepareFocus = vi.fn(async () => { throw new Error("budget exhausted"); });
    await expect(run(s, ms, { synthesize, prepareFocus })).rejects.toThrow("budget exhausted");
    expect(prepareFocus).toHaveBeenCalledOnce();
    expect(synthesize).not.toHaveBeenCalled();
  });

  it("reuses reading notes across goals and after appending messages, but rereads changed evidence", async () => {
    const s = source(), ms = messages(s, 8, "推导与条件。".repeat(450));
    const settings: AISettings = { id: "ai-settings", provider: "deepseek", model: "qwen-plus", baseUrl: "https://test.invalid", apiKey: "test", updatedAt: 1 };
    const payloads: Array<{ intent: string; coverage: { final: boolean }; passages: Array<{ text: string }> }> = [];
    const ai = createAtlasAIFromProvider({ id: "test", modelId: "qwen-plus", testConnection: async () => ({ ok: true, model: "qwen-plus" }), generateStructured: async <T>(request: StructuredAIRequest<T>) => { payloads.push(JSON.parse(request.prompt)); return resultFor(request); } }, settings);
    await run(s, ms, ai);
    const initialReading = payloads.filter((p) => !p.coverage.final).length;
    expect(initialReading).toBeGreaterThan(1);
    payloads.length = 0;
    await run(s, ms, ai, "整理后续纠正");
    expect(payloads).toHaveLength(1);
    expect(payloads[0].coverage.final).toBe(true);
    payloads.length = 0;
    const appended = [...ms, ...messages(s, 9, "新增条件。".repeat(450)).slice(8)];
    await run(s, appended, ai, "回顾新增讨论");
    expect(payloads.filter((p) => !p.coverage.final)).toHaveLength(1);
    payloads.length = 0;
    const changed = ms.map((m, i) => i === 2 ? { ...m, content: m.content.replace("推导", "更正") } : m);
    await run(s, changed, ai, "复习修改后的内容");
    expect(payloads.some((p) => !p.coverage.final && p.passages.some((m) => m.text.includes("更正")))).toBe(true);
    expect(payloads.filter((p) => !p.coverage.final).length).toBeLessThan(initialReading);
  });
});
