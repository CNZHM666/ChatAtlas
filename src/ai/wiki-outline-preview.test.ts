import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { wikiOutlineSections, withWikiOutline } from "./wiki-outline-preview";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus, type CoverageResult } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import type { AISettings, Conversation } from "../shared/types";
import type { DirectoryPage } from "../shared/wiki-directory";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const plan: DirectoryPage[] = [
  { title: "数据存储", group: "架构", question: "原始消息存在哪里？", sectionIds: ["a"], ownerId: "a", subtopics: [{ title: "保存规则", question: "", sectionIds: ["a"] }, { title: "索引重建", question: "", sectionIds: ["a"] }] },
  { title: "侧栏职责", group: "界面", question: "侧栏做什么？", sectionIds: ["b"], ownerId: "b" },
];
const notes = [
  { id: "n1", wikiOwnerId: "a", text: "本地保存\n原始消息完整保存在 IndexedDB 中。索引层独立构建，可重建。" },
  { id: "n2", wikiOwnerId: "a", text: "user: 原始消息存在哪里？" },
  { id: "n3", wikiOwnerId: "b", text: "侧栏\n侧栏只做本地查找，不调用模型。" },
];

it("builds each chapter's outline from the plan and its own reading notes, without raw originals",()=>{
  const [storage, sidebar] = wikiOutlineSections(plan, notes, true);
  expect(storage).toMatchObject({ id: "outline:a", title: "数据存储", wikiOwnerId: "a", wikiOutline: true, evidenceIds: ["n1"], wikiSubtopics: [{ title: "保存规则", question: "" }, { title: "索引重建", question: "" }] });
  expect(storage.body).toBe("原始消息存在哪里？\n\n- 本地保存：原始消息完整保存在 IndexedDB 中。\n\n本章包括：保存规则 · 索引重建");
  expect(sidebar.body).toContain("- 侧栏只做本地查找，不调用模型。");
  expect(wikiOutlineSections(plan, notes, true, new Set(["a"])).map(section => section.wikiOwnerId)).toEqual(["b"]);
});

it("keeps written chapters and fills the rest with outline placeholders in plan order",()=>{
  const written = { id: "w", title: "侧栏职责", body: "正文", kind: "finding" as const, transition: "", evidenceIds: [], wikiOwnerId: "b" };
  const sections = withWikiOutline([written], plan, notes, true);
  expect(sections.map(section => [section.wikiOwnerId, Boolean(section.wikiOutline)])).toEqual([["a", true], ["b", false]]);
});

it("shows the outline before any chapter is written and writes the prioritized chapter first",async()=>{
  const runId = crypto.randomUUID();
  const sources: Conversation[] = Array.from({ length: 4 }, (_, index) => ({ id: `${runId}:${index}`, title: index % 2 ? "通知控制" : "消息检索", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 }));
  const passages = sources.flatMap(source => transcriptPassages(source, [{ id: source.id, conversationId: source.id, role: "user", messageIndex: 0, content: `${source.title}失败时保留原始消息，不覆盖已有材料。`, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }]));
  const writeOrder: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const sent = JSON.parse(String(init?.body)), wire = JSON.parse(sent.messages[1].content), data = wire.data ?? wire;
    let value: unknown;
    if (data.presentation === "wiki_topic_plan") {
      const groups = new Map<string, string[]>();
      for (const section of data.sections) groups.set(section.title, [...groups.get(section.title) ?? [], section.id]);
      value = {scope:[],  pages: [...groups].map(([title], index) => ({ title, group: "功能", question: `${title}如何工作？`, subtopics: [{ key: `t${index}`, title: "具体机制", question: "如何保留数据？" }] })), assignments: Object.fromEntries([...groups].flatMap(([, ids], index) => ids.map(id => [id, `t${index}`]))) };
    } else if (!data.coverage.final) {
      // Long notes make each chapter its own writing request, as with large material.
      value = { notes: [{ title: data.passages[0].title, text: `${data.passages[0].title}失败时保留原始消息，不覆盖已有材料。`.repeat(500), start: 0, phase: "讨论", transition: "" }] };
    } else {
      writeOrder.push(data.wikiTopics.map((topic: { title: string }) => topic.title).join("+"));
      value = { title: "项目", sections: data.wikiTopics.map((topic: { ownerId: string; title: string }) => ({ title: topic.title, wikiOwnerId: topic.ownerId, body: "## 具体机制\n\n失败时保留原始消息，不覆盖已有材料。", transition: "", kind: "finding", evidenceIds: data.passages.filter((passage: { wikiOwnerId: string }) => passage.wikiOwnerId === topic.ownerId).map((passage: { id: string }) => passage.id) })) };
    }
    return Response.json({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } });
  }));
  // One request at a time, so the order of writing requests is observable.
  const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", model: `outline-${runId}`, baseUrl: "https://outline.invalid/v1", apiKey: "synthetic", updatedAt: 1 };
  const ai = createAtlasAIFromProvider(createAIProvider(settings), settings, undefined, runId);
  Object.defineProperty(ai.capabilities, "maxConcurrency", { get: () => 1 });
  const previews: CoverageResult[] = [];let wanted: string | undefined;
  const result = await synthesizeCoveredFocus({ goal: "整理项目", mode: "work", locale: "zh-CN", sources, passages, ai, collectProjectKnowledge: true, signal: new AbortController().signal, validate: validateFocusResult,
    priorityOwner: () => wanted,
    onPartial: preview => { previews.push(preview); if (previews.length === 1) wanted = preview.sections.find(section => section.title === "通知控制")?.wikiOwnerId; } });
  // First preview: every planned chapter as key points with original sources.
  expect(previews[0].sections.map(section => [section.title, section.wikiOutline])).toEqual([["消息检索", true], ["通知控制", true]]);
  expect(previews[0].sections.every(section => section.evidenceIds.length && section.evidenceIds.every(id => result.evidence.some(ref => ref.id === id)))).toBe(true);
  expect(previews[0].sections[0].body).toContain("消息检索如何工作？");
  // The chapter chosen while reading the outline is written first; the result has no placeholders.
  expect(writeOrder[0]).toBe("通知控制");expect(writeOrder.lastIndexOf("通知控制")).toBeLessThan(writeOrder.indexOf("消息检索"));
  expect(previews.at(-1)!.sections.some(section => section.wikiOutline)).toBe(false);
  expect(result.result.sections.some(section => section.wikiOutline)).toBe(false);
});
