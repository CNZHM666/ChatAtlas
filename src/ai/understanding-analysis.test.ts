import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import type { FocusSession, SemanticStructure } from "../shared/focus-session";
import type { AtlasAI } from "./atlas-ai";
import { analyzeUnderstanding, UNDERSTANDING_VERSION, applyUnderstanding, reconcileOverview } from "./understanding-analysis";
import { validateFocusResult } from "./focus-session";
import { validateProviderOutput, requestMessages } from "./request-policy";
import { projectUnderstandingModel } from "../canvas/project-understanding";
import { chapterSteps } from "../canvas/chapter-understanding";
import { hasChapterDiagram } from "../canvas/wiki-diagram";
import { structureIsCurrent, structureSourceSignature } from "../shared/structure-signature";
import { sourceMessageSignature } from "../shared/source-signature";
import { analyzedProjectMarkdown } from "../shared/project-understanding-markdown";
import { mapSemanticEvidence, mergeSemanticStructures, semanticId, validateSemanticStructure } from "../shared/semantic-structure";
import { retainSourceVersions } from "../storage/source-versions";
import type { ConversationMessage } from "../shared/types";

const quote = "用户目标交给规划模块，由规划模块形成候选方案。";
const graph = (id: string): SemanticStructure => ({ nodes: [
  { key: "需求输入", title: "需求理解", description: "明确目标与限制", quote, status: "discussed", evidenceIds: [id] },
  { key: "方案规划", title: "方案规划", description: "形成候选方案", quote, status: "proposal", evidenceIds: [id] },
], relations: [{ from: "需求输入", to: "方案规划", kind: "flow", quote, evidenceIds: [id], status: "supported" }] });
const session = (): FocusSession => ({ id: "session", title: "项目", goal: "理解协作关系", mode: "work", locale: "zh-CN", sections: ["a", "b"].map((id, i) => ({ id, title: `阶段${i + 1}`, body: quote, transition: "", kind: "review", evidenceIds: [`e${i + 1}`] })), evidence: ["e1", "e2"].map(id => ({ id, conversationId: "source", messageId: `question-${id}`, title: "讨论", excerpt: quote })), activeSectionId: "a", completedSectionIds: [], notes: "我的笔记", sourceConversationIds: ["source"], createdAt: 1, updatedAt: 1 });

it("explicit chapter generation reruns a current but diagramless cache and retains the automatic reuse path",async()=>{
 const base=session();base.sections=[{...base.sections[0],semanticStructure:{...graph("e1"),relations:[]},semanticAnalysisVersion:UNDERSTANDING_VERSION}];base.evidence=[base.evidence[0]];
 const original:ConversationMessage={id:base.evidence[0].messageId,conversationId:"source",role:"user",content:quote,messageIndex:0,preview:quote,contentHash:"",createdAt:1,updatedAt:1};
 base.sourceVersionIds=await retainSourceVersions([original]);const before=structuredClone(base);
 const synthesize=vi.fn(async request=>{const data=JSON.parse(request.prompt);return request.validate(data.presentation==="structure_review"?{checks:data.facts.map((fact:{id:string})=>({id:fact.id,verdict:"supported"}))}:graph("p1"));});
 const ai={modelId:"fixture",synthesize} as unknown as AtlasAI;
 expect(hasChapterDiagram(base.sections[0],base)).toBe(false);
 await analyzeUnderstanding(base,ai,new AbortController().signal);expect(synthesize).not.toHaveBeenCalled();
 const result=await analyzeUnderstanding(base,ai,new AbortController().signal,undefined,{forceSectionIds:["a"]});
 expect(synthesize).toHaveBeenCalledTimes(2);expect(hasChapterDiagram(result.sections[0],base)).toBe(true);expect(base).toEqual(before);
});

it("reports missing chapter citations and separates request failures from review failures",async()=>{
 const base=session();base.sections=[base.sections[0]];
 const missing=await analyzeUnderstanding({...base,evidence:[]},{modelId:"fixture",synthesize:vi.fn()} as unknown as AtlasAI,new AbortController().signal);
 expect(missing.chapterIssues).toEqual({a:"no-sources"});
 const requestFailed=await analyzeUnderstanding(base,{modelId:"fixture",synthesize:vi.fn(async()=>{throw new Error("Service unavailable");})} as unknown as AtlasAI,new AbortController().signal);
 expect(requestFailed.chapterIssues).toEqual({a:"request-failed"});
 const reviewFailed=await analyzeUnderstanding(base,{modelId:"fixture",synthesize:vi.fn(async request=>{if(JSON.parse(request.prompt).presentation==="structure_review")throw new Error("Invalid review");return request.validate(graph("p1"));})} as unknown as AtlasAI,new AbortController().signal);
 expect(reviewFailed.chapterIssues).toEqual({a:"review-failed"});
});

it("does not mark a legacy chapter reviewed just because another chapter advanced the job version", async () => {
  const base = session(); base.sections = [base.sections[0]];
  base.sections[0].semanticStructure = graph("e1");
  base.structureAnalysis = { status: "partial", version: 4 };
  const synthesize = vi.fn(async request => {
    if (JSON.parse(request.prompt).presentation === "structure_review") throw new Error("review unavailable");
    return request.validate(graph("p1"));
  });
  const result = await analyzeUnderstanding(base, { synthesize, modelId: "fixture" } as unknown as AtlasAI, new AbortController().signal);
  expect(synthesize).toHaveBeenCalledTimes(2);
  expect(result.structureAnalysis.status).toBe("partial");
  expect(result.sections[0].semanticAnalysisVersion).toBeUndefined();
  expect(result.sections[0].semanticStructure).toEqual(base.sections[0].semanticStructure);
});

it("locates a whitespace-folded quotation deep in the original instead of reading the beginning again", async () => {
  const content = "Earlier unrelated discussion. ".repeat(200) + "\n## Stage 4\n已有\n  零件在库存阶段确认，之后生成缺件清单。";
  const original: ConversationMessage = { id: "window-raw", conversationId: "window-source", role: "assistant", content, messageIndex: 0, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 };
  const versions = await retainSourceVersions([original]);
  const base = session(); base.sections = [base.sections[0]]; base.sourceConversationIds = [original.conversationId]; base.sourceVersionIds = versions;
  base.evidence = [{ ...base.evidence[0], conversationId: original.conversationId, messageId: original.id, excerpt: "已有 零件在库存阶段确认，之后生成缺件清单。" }];
  const synthesize = vi.fn(async () => { throw new Error("inspection only"); });
  await analyzeUnderstanding(base, { synthesize, modelId: "fixture" } as unknown as AtlasAI, new AbortController().signal);
  const request = synthesize.mock.calls[0] as unknown as [{ prompt: string }];
  expect(JSON.parse(request[0].prompt).sources[0].text).toContain("## Stage 4");
  expect(JSON.parse(request[0].prompt).sources[0].text).toContain("库存阶段确认");
});

it("uses saved legacy structures in reading and stabilizes signatures against unrelated additions", async () => {
  const base = session(); base.sourceVersionIds = { source: "raw-version" }; base.sections = [base.sections[0]];
  const section = base.sections[0]; section.semanticStructure = graph("e1"); section.semanticAnalysisVersion = UNDERSTANDING_VERSION;
  section.semanticBodySignature = sourceMessageSignature(JSON.stringify([section.body, base.sourceVersionIds, section.evidenceIds]));
  expect(structureIsCurrent(section, base)).toBe(true);
  expect(chapterSteps(section, base).map(node => node.title)).toEqual(["需求理解", "方案规划"]);
  expect(projectUnderstandingModel(base).nodes).toHaveLength(2);
  const ai = { modelId: "fixture", synthesize: vi.fn(async request => request.validate(graph("e1"))) } as unknown as AtlasAI;
  const result = await analyzeUnderstanding(base, ai, new AbortController().signal);
  expect(result.sections[0].semanticBodySignature).toBe(sourceMessageSignature(section.body));
  expect(result.sections[0].semanticSourceSignature).toBe(structureSourceSignature(section, base));
  expect(structureIsCurrent(result.sections[0], { ...base, sourceVersionIds: { ...base.sourceVersionIds, unrelated: "added" } })).toBe(true);
  expect(structureIsCurrent({ ...result.sections[0], body: "changed" }, base)).toBe(false);
  const changedEvidence = base.evidence.map(ref => ref.id === "e1" ? { ...ref, excerpt: "changed raw source" } : ref);
  expect(structureIsCurrent(result.sections[0], { ...base, evidence: changedEvidence })).toBe(false);
});

it("does not publish a stale overview when cited sources changed during layout analysis", () => {
  const base = session(), result = { ...base, semanticOverview: graph("e1"), structureAnalysis: { status: "ready" as const, version: 3 } };
  const latest = { ...base, evidence: base.evidence.map(ref => ({ ...ref, sourceSignature: "new-raw" })) };
  expect(applyUnderstanding(latest, base, result).semanticOverview).toBeUndefined();
  expect(applyUnderstanding(latest, base, result).structureAnalysis?.status).toBe("partial");
});

it("keeps original versions distinct when analyzing citations of one edited message", async () => {
  const original = (content: string): ConversationMessage => ({ id: "same-message", conversationId: "source", role: "user", content, messageIndex: 0, preview: content, contentHash: "", createdAt: 1, updatedAt: 1 });
  const old = await retainSourceVersions([original(`旧讨论：${quote}`)]), latest = await retainSourceVersions([original(`新讨论：${quote}`)]);
  const base = session(); base.sections = [{ ...base.sections[0], evidenceIds: ["e1", "e2"] }]; base.sourceVersionIds = latest;
  base.evidence = base.evidence.map((ref, i) => ({ ...ref, messageId: "same-message", sourceVersionId: i ? latest.source : old.source }));
  const synthesize = vi.fn().mockImplementation(async request => request.validate(graph("p1")));
  await analyzeUnderstanding(base, { synthesize, modelId: "fixture" } as unknown as AtlasAI, new AbortController().signal);
  expect(JSON.parse(synthesize.mock.calls[0][0].prompt).sources.map((source: { text: string }) => source.text)).toEqual([`旧讨论：${quote}`, `新讨论：${quote}`]);
});

it("keeps usable reading text when optional AI structure has forged citations or invented quotations", () => {
  const source = [{ id: "e1", text: quote }, { id: "e2", text: "无关来源" }];
  const value = graph("e1");
  expect(validateSemanticStructure({ ...value, nodes: [{ ...value.nodes[0], evidenceIds: ["missing"] }] }, source)).toBeUndefined();
  expect(validateSemanticStructure({ ...value, nodes: [{ ...value.nodes[0], evidenceIds: ["e2"] }] }, source)).toBeUndefined();
  expect(validateSemanticStructure({ ...value, relations: [{ ...value.relations[0], quote: "凭空产生的架构关系" }] }, source)?.relations).toEqual([]);
  const validated = validateFocusResult({ title: "正文", sections: [{ title: "章节", body: "完整正文", transition: "", kind: "review", evidenceIds: ["e1"], structure: { nodes: "broken", relations: [] } }] }, session().evidence);
  expect(validated.sections[0].body).toBe("完整正文");
  expect(validated.sections[0].semanticStructure).toBeUndefined();
});

it("restores nested provider citation IDs and binds neutral-note structures only to their chronological range", () => {
  const data = { intent: "理解结构", mode: "work", locale: "zh-CN", semanticStructure: true, coverage: { stage: "reading", final: true }, passages: [{ id: "internal:one", text: quote }, { id: "internal:two", text: "另一段讨论" }] };
  const request = { taskType: "focus_session" as const, system: "", prompt: JSON.stringify(data), validate: (value: unknown) => validateFocusResult(value, [{ ...session().evidence[0], id: "internal:one" }, { ...session().evidence[1], id: "internal:two" }], [{ id: "internal:one", text: quote }]) };
  expect(requestMessages(request)[0].content).toContain("semantic relationships");
  const result = validateProviderOutput(request, { title: "结果", sections: [{ title: "章节", body: quote, transition: "", kind: "review", evidenceIds: ["e1"], structure: graph("e1") }] });
  expect(result.sections[0].semanticStructure?.nodes[0].evidenceIds).toEqual(["internal:one"]);
  const note = { ...request, prompt: JSON.stringify({ ...data, coverage: { stage: "reading", final: false } }) };
  const notes = validateProviderOutput(note, { notes: [{ title: "阶段", text: quote, start: 0, structure: graph("not-a-model-citation") }, { title: "后续", text: "另一段讨论", start: 1 }] });
  expect(notes.sections[0].semanticStructure?.relations[0].evidenceIds).toEqual(["internal:one"]);
});

it("uses generated semantic relationships across differently worded chapters, preserving uncertainty and personal overrides", () => {
  const base = session();
  base.sections[0].semanticStructure = graph("e1");
  base.sections[1].semanticStructure = { ...graph("e2"), nodes: graph("e2").nodes.map(node => ({ ...node, title: node.key === "方案规划" ? "候选方案组织" : node.title })), relations: [{ ...graph("e2").relations[0], kind: "requires", status: "uncertain" }] };
  base.projectUnderstanding = { nodes: [{ id: semanticId("方案规划"), title: "我的方案模块", responsibility: "自己整理的解释", sectionIds: ["a", "b"], links: [] }], order: [semanticId("方案规划")] };
  const model = projectUnderstandingModel(base);
  expect(model.nodes).toHaveLength(2);
  expect(model.nodes[0]).toMatchObject({ title: "我的方案模块", sectionIds: ["a", "b"], userEdited: true });
  expect(model.edges.find(edge => edge.kind === "requires")).toMatchObject({ uncertain: true, excerpt: quote });
  expect(chapterSteps(base.sections[0]).map(step => step.title)).toEqual(["需求理解", "方案规划"]);
  expect(analyzedProjectMarkdown(base, true)).not.toMatch(/ai-concept|\be1\b|\be2\b/);
  expect(analyzedProjectMarkdown(base, true)).toContain("AI 分析");
});

it("does not merge a historical proposal, an uncertain interpretation and a superseded version into a decision", () => {
  const values = ["proposal", "superseded", "uncertain"].map((status, i) => ({ nodes: [{ ...graph(`e${i}`).nodes[1], status: status as "proposal" | "superseded" | "uncertain", sectionIds: [`s${i}`] }], relations: [] }));
  const combined = mergeSemanticStructures([...values, values[1]]);
  expect(combined.nodes).toHaveLength(3);
  expect(new Set(combined.nodes.map(node => node.status))).toEqual(new Set(["proposal", "superseded", "uncertain"]));
  expect(mapSemanticEvidence(combined, () => [])).toBeUndefined();
});

it("continues unfinished chapters without rereading successful ones, and a failed overview keeps all completed structure", async () => {
  const base = session();
  base.sections[0].semanticStructure = graph("e1"); base.sections[0].semanticAnalysisVersion = UNDERSTANDING_VERSION;
  const synthesize = vi.fn().mockImplementation(async request => {
    const data = JSON.parse(request.prompt);
    if (data.presentation === "structure_review") return request.validate({ checks: data.facts.map((fact: { id: string }) => ({ id: fact.id, verdict: "supported" })) });
    if (data.structure) throw new Error("model busy");
    return request.validate(graph("p1"));
  });
  const partial = vi.fn(async () => undefined);
  const result = await analyzeUnderstanding(base, { synthesize, modelId: "fixture" } as unknown as AtlasAI, new AbortController().signal, partial);
  expect(synthesize).toHaveBeenCalledTimes(3);
  expect(JSON.parse(synthesize.mock.calls[0][0].prompt).title).toBe("阶段2");
  expect(JSON.parse(synthesize.mock.calls[1][0].prompt).fragment).toBeUndefined();
  expect(result.structureAnalysis.status).toBe("partial");
  expect(result.semanticOverview?.nodes[0].sectionIds).toEqual(["a", "b"]);
  expect(partial).toHaveBeenCalledOnce();
  const resumed = vi.fn().mockImplementation(async request => { throw new Error(request.prompt); });
  await analyzeUnderstanding({ ...base, sections: result.sections }, { synthesize: resumed, modelId: "fixture" } as unknown as AtlasAI, new AbortController().signal);
  expect(resumed).toHaveBeenCalledOnce(); // only compact overview reconciliation
});

it("a late analysis result cannot overwrite a concurrent edit, note or reading position", () => {
  const base = session();
  const generated = { sections: base.sections.map(section => ({ ...section, semanticStructure: graph(section.evidenceIds[0]) })), semanticOverview: { ...graph("e1"), nodes: graph("e1").nodes.map(node => ({ ...node, sectionIds: ["a"] })) }, structureAnalysis: { status: "ready" as const, version: 1 } };
  const latest = { ...base, activeSectionId: "b", notes: "刚更新的笔记", sections: base.sections.map(section => section.id === "a" ? { ...section, body: "我的新正文", userEdited: true } : section) };
  const applied = applyUnderstanding(latest, base, generated);
  expect(applied.sections[0].body).toBe("我的新正文");
  expect(applied.sections[0].semanticStructure).toBeUndefined();
  expect(applied.sections[1].semanticStructure).toBeDefined();
  expect(applied).toMatchObject({ activeSectionId: "b", notes: "刚更新的笔记", structureAnalysis: { status: "partial" } });
  expect(applied.semanticOverview).toBeUndefined();
});

it("compact reconciliation merges equivalent meanings without reprinting nodes or losing chapter and source associations", () => {
  const first = { ...graph("p1").nodes[0], sectionIds: ["a"] };
  const second = { ...first, key: "输入约束", title: "目标与约束", evidenceIds: ["p2"], sectionIds: ["b"] };
  const source = { nodes: [first, second], relations: [] };
  const merged = reconcileOverview({ groups: [{ keys: [first.key, second.key], title: "需求理解", description: "明确目标与约束" }], relations: [] }, source, [{ id: "p1", text: quote }, { id: "p2", text: quote }], [second.key]);
  expect(merged.nodes[0]).toMatchObject({ key: second.key, sectionIds: ["a", "b"], evidenceIds: ["p1", "p2"], status: "discussed" });
  expect(() => reconcileOverview({ groups: [{ keys: [first.key, second.key], title: "需求", description: "目标" }], relations: [] }, source, [{ id: "p1", text: quote }, { id: "p2", text: quote }], [first.key, second.key])).toThrow(/personal/);
  expect(source.nodes).toHaveLength(2);
});
