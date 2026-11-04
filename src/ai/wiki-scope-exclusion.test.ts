import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { AISettings, Conversation } from "../shared/types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const TITLES = ["消息检索", "Mem0 公司背景"];

/** Organizes two single-message conversations. The planner marks the Mem0 note as
 * a reference; records what each planner request receives. */
async function organize(model: string, excludeKeys?: string[], kind = "reference", ignoredKeys?:string[]) {
  const runId = crypto.randomUUID();
  const sources: Conversation[] = TITLES.map((title, index) => ({ id: `scope-source:${index}`, title, platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 }));
  const passages = sources.flatMap((source, index) => transcriptPassages(source, [{ id: `${source.id}-m`, conversationId: source.id, messageIndex: 0, role: "user", content: index ? "Mem0 的创始团队和版本历史是什么？" : "检索按消息维护索引，失败时保留原始消息。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }]));
  const planned: Array<{ system: string; sections: string[] }> = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
    const parsed = JSON.parse(request.messages[1].content);
    let value: unknown;
    if (parsed.presentation === "wiki_topic_plan") {
      const sections = parsed.sections as Array<{ id: string }>;
      planned.push({ system: request.messages[0].content, sections: sections.map(section => JSON.stringify(section)) });
      const mem0 = sections.find(section => JSON.stringify(section).includes("Mem0"));
      value = { pages: [{ title: "消息检索", group: "功能", question: "消息检索如何工作？", subtopics: [{ key: "t0", title: "具体机制", question: "哪些机制？" }] }], assignments: Object.fromEntries(sections.map(section => [section.id, "t0"])),
        scope: mem0 ? [{ id: mem0.id, kind, reason: "外部产品背景", quote: "Mem0 公司背景" }] : [] };
    } else if (parsed.presentation === "wiki_title_edit") {
      value = {titles:parsed.titles.map((item:{id:string;title:string})=>({...item,keep:true}))};
    } else if (!parsed.data.coverage?.final) {
      const text = parsed.data.passages[0].text as string;
      value = { notes: [{ title: text.includes("Mem0") ? "Mem0 公司背景" : "消息检索", text, start: 0, phase: "讨论", transition: "" }] };
    } else {
      const data = parsed.data as { passages: Array<{ id: string; wikiOwnerId: string }>; wikiTopics: Array<{ ownerId: string; title: string; opening?: boolean }> };
      value = { title: "项目知识", sections: data.wikiTopics.map(topic => ({ title: topic.title, ...(topic.opening ? { chapterOverview: "本章说明消息检索的条件和失败时的数据边界。" } : {}), body: "## 具体机制\n\n检索按消息维护索引，失败时保留原始消息。", transition: "", kind: "review", evidenceIds: data.passages.filter(passage => passage.wikiOwnerId === topic.ownerId).map(passage => passage.id) })) };
    }
    return new Response(JSON.stringify({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "Content-Type": "application/json" } });
  }));
  const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", model, baseUrl: `https://${model}.invalid/v1`, apiKey: "fixture", updatedAt: 1 };
  const ai = createAtlasAIFromProvider(createAIProvider(settings), settings, undefined, runId);
  const result = await synthesizeCoveredFocus({ goal: "整理消息检索", mode: "work", locale: "zh-CN", sources, passages, ai, wikiScopeExcludeKeys: excludeKeys, wikiScopeIgnoredKeys:ignoredKeys, signal: new AbortController().signal, validate: validateFocusResult });
  return { result, planned };
}

it("keeps removed materials away from the planner and lists them so they can be restored", async () => {
  const first = await organize("scope-first");
  expect(first.planned[0].system).toContain("uncertain is ONLY about whether the material belongs to THIS project");
  const reference = first.result.wikiScopeReview!.materials.find(item => item.kind === "reference")!;
  expect(reference.title).toBe("Mem0 公司背景");

  const second = await organize("scope-second", [reference.key]);
  expect(second.planned.every(request => request.sections.every(section => !section.includes("Mem0")))).toBe(true);
  const review = second.result.wikiScopeReview!;
  expect(review.excludeKeys).toEqual([reference.key]);
  expect(review.materials).toEqual([expect.objectContaining({ key: reference.key, kind: "other", userExcluded: true, title: "Mem0 公司背景" })]);
  expect(second.result.result.sections.map(section => section.body).join("\n")).not.toContain("Mem0");
});

it("leaves out a material the planner both excludes and assigns, and lists it for the user to decide", async () => {
  // The planner marks Mem0 as unrelated AND files it under a subtopic. The
  // material does not silently stay in the Wiki: it waits for the user's review.
  const { result } = await organize("scope-conflict", undefined, "other");
  const owned = new Set(result.result.sections.flatMap(section => section.evidenceIds));
  expect(result.evidence.filter(ref => owned.has(ref.id)).map(ref => ref.excerpt).join(" ")).not.toContain("Mem0");
  expect(result.wikiScopeReview?.materials).toEqual([expect.objectContaining({ kind: "other", title: "Mem0 公司背景" })]);
});

it("honors project-only removal before planning on repeated updates, retaining the original source",async()=>{
 const first=await organize("ignored-first"),key=first.result.wikiScopeReview!.materials[0].key;
 for(const model of ["ignored-second","ignored-third"]){
  const next=await organize(model,[],"reference",[key]);
  expect(next.planned.every(request=>request.sections.every(section=>!section.includes("Mem0")))).toBe(true);
  expect(next.result.wikiScopeReview).toMatchObject({excludeKeys:[key],ignoredKeys:[key],materials:[expect.objectContaining({key,userExcluded:true})]});
  expect(next.result.sourceOutlines.some(outline=>outline.chapters.some(chapter=>chapter.summary.includes("Mem0")))).toBe(true);
  expect(next.result.result.sections.map(section=>section.body).join("\n")).not.toContain("Mem0");
 }
});
