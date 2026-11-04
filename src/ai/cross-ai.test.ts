import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { colocateSameQuestions, keepSameQuestionsTogether, sameQuestionAnnotations, sameQuestionGroups, type CrossAIMaterial } from "./cross-ai";
import type { AISettings, Conversation, ConversationMessage } from "../shared/types";
import { aiRetryTiming } from "./atlas-ai";
// These cases drive many provider retries; their pauses need not pass in real time.
beforeAll(() => { aiRetryTiming.scale = 0; });
afterAll(() => { aiRetryTiming.scale = 1; });

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const material = (conversationId: string, platform: string | undefined, index: number, role: "user" | "assistant", text: string): CrossAIMaterial =>
  ({ id: `${conversationId}:${index}`, role, conversationId, messageId: `${conversationId}-m${index}`, messageIndex: index, platform, text: `${role}: ${text}`, rawEvidenceIds: [`${conversationId}:${index}`] });
const QUESTION = "导入框架应该怎样同时支持 ChatGPT、Claude 和 Gemini 的导出文件？";

describe("same-question detection", () => {
  it("groups one question asked on different AIs with each AI's answer", () => {
    const groups = sameQuestionGroups([
      material("a", "chatgpt", 0, "user", QUESTION), material("a", "chatgpt", 1, "assistant", "先定义统一接口。"),
      material("b", "claude", 0, "user", `${QUESTION}\n\n补充：我已经有 ChatGPT 的导入器。`), material("b", "claude", 1, "assistant", "按内容识别格式。"), material("b", "claude", 2, "assistant", "再写测试。"),
      material("b", "claude", 3, "user", "继续"), material("b", "claude", 4, "assistant", "好的。"),
    ]);
    expect(groups).toEqual([{ key: "q1", question: QUESTION, answers: [
      { platform: "chatgpt", conversationId: "a", rawIds: ["a:0", "a:1"] },
      { platform: "claude", conversationId: "b", rawIds: ["b:0", "b:1", "b:2"] },
    ] }]);
  });

  it("ignores single-platform scopes, same-platform repeats, short follow-ups and different questions", () => {
    expect(sameQuestionGroups([material("a", undefined, 0, "user", QUESTION), material("b", undefined, 0, "user", QUESTION)])).toEqual([]);
    expect(sameQuestionGroups([material("a", "chatgpt", 0, "user", QUESTION), material("b", "chatgpt", 0, "user", QUESTION), material("c", "claude", 0, "user", "Orama 的中文分词效果怎么样，需要额外的分词器吗？")])).toEqual([]);
    expect(sameQuestionGroups([material("a", "chatgpt", 0, "user", "继续说"), material("b", "claude", 0, "user", "继续说")])).toEqual([]);
  });

  it("marks only groups with at least two platforms present in the request", () => {
    const [group] = sameQuestionGroups([material("a", "chatgpt", 0, "user", QUESTION), material("b", "claude", 0, "user", QUESTION)]);
    const both = sameQuestionAnnotations([group], [{ id: "n1", rawEvidenceIds: ["a:0"] }, { id: "n2", rawEvidenceIds: ["b:0"] }, { id: "n3", rawEvidenceIds: ["c:0"] }]);
    expect(both.questions).toEqual([{ key: "q1", question: QUESTION, platforms: ["chatgpt", "claude"] }]);
    expect([...both.passageKeys]).toEqual([["n1", ["q1"]], ["n2", ["q1"]]]);
    expect(sameQuestionAnnotations([group], [{ id: "n1", rawEvidenceIds: ["a:0"] }]).questions).toEqual([]);
  });
});

describe("keeping same-question answers together", () => {
  const groups = sameQuestionGroups([material("a", "chatgpt", 0, "user", QUESTION), material("a", "chatgpt", 1, "assistant", "A"), material("b", "claude", 0, "user", QUESTION), material("b", "claude", 1, "assistant", "B")]);
  const notes = [{ id: "n1", rawEvidenceIds: ["a:0", "a:1"], platform: "chatgpt" }, { id: "n2", rawEvidenceIds: ["b:1"], platform: "claude" }, { id: "n3", rawEvidenceIds: ["c:0"], platform: "chatgpt" }];

  it("moves notes into the chapter and subtopic holding most of the group, keeping every note once", () => {
    const pages = [
      { title: "接口", group: "", question: "接口？", sectionIds: ["n1", "n3"], subtopics: [{ title: "定义", question: "?", sectionIds: ["n1"] }, { title: "其他", question: "?", sectionIds: ["n3"] }] },
      { title: "识别", group: "", question: "识别？", sectionIds: ["n2"] },
    ];
    const { pages: next, moved } = colocateSameQuestions(pages, notes, groups);
    expect(moved).toBe(1);
    expect(next).toEqual([{ ...pages[0], sectionIds: ["n1", "n3", "n2"], subtopics: [{ title: "定义", question: "?", sectionIds: ["n1", "n2"] }, { title: "其他", question: "?", sectionIds: ["n3"] }] }]);
    expect(pages[1].sectionIds).toEqual(["n2"]);
  });

  it("adds a subtopic when the target chapter had a single note, and leaves unplanned notes alone", () => {
    const pages = [{ title: "接口", group: "", question: "接口？", sectionIds: ["n1"] }, { title: "识别", group: "", question: "识别？", sectionIds: ["n2", "n3"], subtopics: [{ title: "识别方式", question: "?", sectionIds: ["n2"] }, { title: "其他", question: "?", sectionIds: ["n3"] }] }];
    expect(colocateSameQuestions(pages, notes, groups).pages[0]).toMatchObject({ title: "接口", sectionIds: ["n1", "n2"], subtopics: [{ title: "接口", sectionIds: ["n1", "n2"] }] });
    const planned = [{ title: "接口", group: "", question: "接口？", sectionIds: ["n1", "n3"], subtopics: [{ title: "定义", question: "?", sectionIds: ["n1", "n3"] }] }];
    expect(colocateSameQuestions(planned, notes, groups)).toEqual({ pages: planned, moved: 0 });
  });

  it("pulls stray notes into one writing request only when it still fits", () => {
    const batches = [[{ ...notes[0], wikiOwnerId: "o" }, { ...notes[2], wikiOwnerId: "o" }], [{ ...notes[1], wikiOwnerId: "o" }]];
    expect(keepSameQuestionsTogether(batches, groups, () => true).map(batch => batch.map(item => item.id))).toEqual([["n1", "n3", "n2"]]);
    expect(keepSameQuestionsTogether(batches, groups, () => false).map(batch => batch.map(item => item.id))).toEqual([["n1", "n3"], ["n2"]]);
  });
});

describe("cross-AI organization requests", () => {
  const conversation = (id: string, platform: string): Conversation => ({ id, title: "导入框架", platform, url: "", messageCount: 2, updatedAt: 1 });
  const messages = (source: Conversation, answer: string): ConversationMessage[] => [
    { id: `${source.id}-q`, conversationId: source.id, messageIndex: 0, role: "user", content: QUESTION, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 },
    { id: `${source.id}-a`, conversationId: source.id, messageIndex: 1, role: "assistant", content: answer, preview: "", contentHash: "", createdAt: 2, updatedAt: 2 },
  ];
  type Passage = { id: string; text: string; platform?: string; sameQuestion?: string[]; wikiOwnerId?: string };
  type Topic = { ownerId: string; title: string; opening?: boolean };

  async function organize(platforms: [string, string], splitChapters = false) {
    const sources = platforms.map((platform, index) => conversation(`${crypto.randomUUID()}:${index}`, platform));
    const passages = sources.flatMap((source, index) => transcriptPassages(source, messages(source, index ? "按内容识别格式，再补测试。" : "先定义统一导入接口。")));
    const seen = { reading: [] as Array<{ system: string; passages: Passage[] }>, writing: [] as Array<{ system: string; passages: Passage[]; crossAIQuestions?: unknown }> };
    vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      const system = request.messages[0].content, parsed = JSON.parse(request.messages[1].content);
      let value: unknown;
      if (parsed.presentation === "wiki_topic_plan" && splitChapters) {
        // The planner files the two AIs' answers under different subjects.
        const sections = parsed.sections as Array<{ id: string }>;
        value = {scope:[],  pages: [
          { title: "导入接口", group: "功能", question: "导入接口如何定义？", subtopics: [{ key: "t0", title: "接口定义", question: "接口包含什么？" }] },
          { title: "格式识别", group: "功能", question: "格式如何识别？", subtopics: [{ key: "t1", title: "识别方式", question: "怎样识别？" }] },
        ], assignments: Object.fromEntries(sections.map(section => [section.id, JSON.stringify(section).includes("按内容识别") ? "t1" : "t0"])) };
      } else if (parsed.presentation === "wiki_topic_plan") {
        value = {scope:[],  pages: [{ title: "导入框架", group: "功能", question: "导入框架如何工作？", subtopics: [{ key: "t0", title: "具体机制", question: "哪些机制？" }] }], assignments: Object.fromEntries((parsed.sections as Array<{ id: string }>).map(section => [section.id, "t0"])) };
      } else if (!parsed.data.coverage?.final) {
        seen.reading.push({ system, passages: parsed.data.passages });
        value = { notes: [{ title: "导入框架", text: (parsed.data.passages as Passage[]).map(passage => passage.text).join("\n"), start: 0, phase: "方案讨论", transition: "" }] };
      } else {
        const data = parsed.data as { passages: Passage[]; wikiTopics: Topic[]; crossAIQuestions?: unknown };
        seen.writing.push({ system, passages: data.passages, crossAIQuestions: data.crossAIQuestions });
        value = { title: "项目知识", sections: data.wikiTopics.map(topic => ({ title: topic.title, ...(topic.opening ? { chapterOverview: "本章比较两个 AI 对导入框架的建议，保留用户尚未确认的选择。" } : {}), body: "## 具体机制\n\nChatGPT 建议先定义统一接口，Claude 建议按内容识别格式；没有记录用户的最终选择。", transition: "", kind: "review", evidenceIds: data.passages.filter(passage => passage.wikiOwnerId === topic.ownerId).map(passage => passage.id) })) };
      }
      return new Response(JSON.stringify({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "Content-Type": "application/json" } });
    }));
    const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", model: `fixture-${platforms.join("-")}-${splitChapters}`, baseUrl: `https://cross-ai-${platforms.join("-")}-${splitChapters}.invalid/v1`, apiKey: "fixture", updatedAt: 1 };
    const ai = createAtlasAIFromProvider(createAIProvider(settings), settings, undefined, crypto.randomUUID());
    const result = await synthesizeCoveredFocus({ goal: "整理导入框架", mode: "work", locale: "zh-CN", sources, passages, ai, signal: new AbortController().signal, validate: validateFocusResult });
    return { result, seen };
  }

  it("tells the model which AI each passage came from and asks for one comparison", async () => {
    const { result, seen } = await organize(["chatgpt", "claude"]);
    expect(seen.reading).toHaveLength(2);
    expect(seen.reading.map(request => request.passages[0].platform)).toEqual(["chatgpt", "claude"]);
    expect(seen.reading.every(request => request.system.includes("CROSS-AI SOURCES"))).toBe(true);
    const [writing] = seen.writing;
    expect(writing.system).toContain("CROSS-AI SOURCES");
    expect(writing.crossAIQuestions).toEqual([{ key: "q1", question: QUESTION, platforms: ["chatgpt", "claude"] }]);
    expect(new Set(writing.passages.map(passage => passage.platform))).toEqual(new Set(["chatgpt", "claude"]));
    expect(writing.passages.every(passage => passage.sameQuestion?.includes("q1"))).toBe(true);
    expect(result.result.sections).toHaveLength(1);
  });

  it("moves answers the planner split across chapters into one chapter so they are compared", async () => {
    const { result, seen } = await organize(["chatgpt", "claude"], true);
    expect(seen.writing).toHaveLength(1);
    expect(seen.writing[0].crossAIQuestions).toEqual([{ key: "q1", question: QUESTION, platforms: ["chatgpt", "claude"] }]);
    expect(new Set(seen.writing[0].passages.map(passage => passage.platform))).toEqual(new Set(["chatgpt", "claude"]));
    expect(result.result.sections.map(section => section.title)).toEqual(["导入接口"]);
  });

  it("leaves single-platform requests unchanged", async () => {
    const { seen } = await organize(["chatgpt", "chatgpt"]);
    const requests = [...seen.reading, ...seen.writing];
    expect(requests.every(request => !request.system.includes("CROSS-AI") && request.passages.every(passage => !("platform" in passage) && !("sameQuestion" in passage)))).toBe(true);
    expect(seen.writing[0]).not.toHaveProperty("crossAIQuestions", expect.anything());
  });
});
