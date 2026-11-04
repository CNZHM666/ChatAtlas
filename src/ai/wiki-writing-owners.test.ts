import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { assignWikiOwners, wikiWritingOrder } from "./wiki-writing-batches";
import { enrichWikiWritingNotes } from "./wiki-writing-details";
import { createAIProvider } from "./provider";
import { createAtlasAIFromProvider } from "./atlas-ai";
import { synthesizeCoveredFocus, type CoverageMaterial } from "./focus-coverage";
import { validateFocusResult } from "./focus-session";
import { transcriptPassages } from "../search/transcript-index";
import { getDatabase } from "../storage/db";
import type { DirectoryPage } from "./wiki-directory";
import type { ProjectState } from "../shared/project-state";
import type { AISettings, Conversation } from "../shared/types";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const material = (id: string, rawEvidenceIds: string[], wikiOwnerId?: string): CoverageMaterial => ({ id, conversationId: "c", sourceConversationIds: ["c"], title: id, messageId: "m", text: id, rawEvidenceIds, ...(wikiOwnerId ? { wikiOwnerId } : {}) });
const pages: DirectoryPage[] = [
  { title: "检索", group: "", question: "?", sectionIds: ["n1", "n2"], subtopics: [{ title: "a", question: "?", sectionIds: ["n1"] }, { title: "b", question: "?", sectionIds: ["n2"] }], ownerId: "owner-search" },
  { title: "存储", group: "", question: "?", sectionIds: ["n3"], ownerId: "owner-storage" },
];

describe("assigning chapters before writing", () => {
  it("keeps valid owners and routes unowned materials by listing, ID prefix, shared messages, then first chapter", () => {
    const result = assignWikiOwners([
      material("n1", ["e1"], "owner-search"),
      material("n3", ["e3"]),
      material("n3:proof:9:abc", ["e1"]),
      material("x:proof:1:def", ["e3"]),
      material("lonely", ["e9"], "owner-removed"),
    ], pages);
    expect(result.map(item => [item.id, item.wikiOwnerId])).toEqual([
      ["n1", "owner-search"], ["n3", "owner-storage"], ["n3:proof:9:abc", "owner-storage"], ["x:proof:1:def", "owner-storage"], ["lonely", "owner-search"],
    ]);
  });

  it("returns the same array when every owner is valid", () => {
    const owned = [material("n1", ["e1"], "owner-search")];
    expect(assignWikiOwners(owned, pages)).toBe(owned);
  });

  it("places a Source detail note created at writing time in its base note's chapter (regression)", () => {
    const batch = [material("e1", ["e1"])].map(item => ({ ...item, text: "user: 索引按消息维护，失败时保留原始消息。" }));
    const notes = [{ ...material("n1", ["e1"]), text: "检索说明" }, { ...material("n2", ["e1"]), text: "存储说明" }];
    const facts = (quote: string) => ({ modules: [], relations: [], decisions: [{ id: quote, text: quote, quote, evidenceIds: ["e1"], status: "discussed" }], constraints: [], questions: [], history: [] }) as unknown as ProjectState;
    // The catalogue pass and the writing pass see different scoped facts, so the
    // second pass creates a new "Source detail" note the planner never assigned.
    const catalogue = enrichWikiWritingNotes(notes, facts("索引按消息维护"), batch);
    const owners = new Map(catalogue.map(note => [note.id, "owner-search"]));
    const writing = enrichWikiWritingNotes(catalogue, facts("失败时保留原始消息"), batch).map(note => ({ ...note, wikiOwnerId: owners.get(note.id) }));
    expect(writing.filter(note => !note.wikiOwnerId)).toHaveLength(1);
    const plan: DirectoryPage[] = [{ ...pages[0], sectionIds: catalogue.map(note => note.id), subtopics: undefined }];
    const groups = wikiWritingOrder(assignWikiOwners(writing, plan), plan);
    expect(groups).toHaveLength(1);
    expect(groups[0].every(note => note.wikiOwnerId === "owner-search")).toBe(true);
  });
});

it("resumes a saved writing checkpoint whose materials lost their chapter instead of failing every retry", async () => {
  const sources: Conversation[] = ["消息检索", "通知控制"].map((title, index) => ({ id: `owner-resume:${index}`, title, platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 }));
  const passages = sources.flatMap((source, index) => transcriptPassages(source, [{ id: `${source.id}-m`, conversationId: source.id, messageIndex: 0, role: "user", content: index ? "通知只有在用户开启后发送。" : "检索按消息维护索引。", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }]));
  let failWriting = true, writes = 0;
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init?: RequestInit) => {
    const parsed = JSON.parse((JSON.parse(String(init?.body)) as { messages: Array<{ content: string }> }).messages[1].content);
    let value: unknown;
    if (parsed.presentation === "wiki_topic_plan") {
      const sections = parsed.sections as Array<{ id: string }>;
      value = {scope:[],  pages: [{ title: "消息检索", group: "功能", question: "检索如何工作？", subtopics: [{ key: "t0", title: "具体机制", question: "哪些机制？" }] }, { title: "通知控制", group: "功能", question: "通知如何控制？", subtopics: [{ key: "t1", title: "触发条件", question: "何时发送？" }] }],
        assignments: Object.fromEntries(sections.map(section => [section.id, JSON.stringify(section).includes("通知") ? "t1" : "t0"])) };
    } else if (!parsed.data.coverage?.final) {
      const text = parsed.data.passages[0].text as string;
      value = { notes: [{ title: text.includes("通知") ? "通知控制" : "消息检索", text, start: 0, phase: "讨论", transition: "" }] };
    } else {
      writes++;
      if (failWriting) return new Response("unavailable", { status: 400 });
      const data = parsed.data as { passages: Array<{ id: string; wikiOwnerId: string }>; wikiTopics: Array<{ ownerId: string; title: string; opening?: boolean; subtopics?: Array<{ title: string }> }> };
      expect(data.wikiTopics.length).toBeGreaterThan(0);
      value = { title: "项目知识", sections: data.wikiTopics.map(topic => ({ title: topic.title, ...(topic.opening ? { chapterOverview: "本章说明适用条件和边界。" } : {}), body: (topic.subtopics ?? []).map(subtopic => `## ${subtopic.title}\n\n依据原始讨论说明条件。`).join("\n\n"), transition: "", kind: "review", evidenceIds: data.passages.filter(passage => passage.wikiOwnerId === topic.ownerId).map(passage => passage.id) })) };
    }
    return new Response(JSON.stringify({ id: crypto.randomUUID(), choices: [{ finish_reason: "stop", message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "Content-Type": "application/json" } });
  }));
  const settings: AISettings = { id: "ai-settings", provider: "openai-compatible", model: "owner-resume", baseUrl: "https://owner-resume.invalid/v1", apiKey: "fixture", updatedAt: 1 };
  const run = () => synthesizeCoveredFocus({ goal: "整理项目", mode: "work", locale: "zh-CN", sources, passages, ai: createAtlasAIFromProvider(createAIProvider(settings), settings, undefined, crypto.randomUUID()), signal: new AbortController().signal, validate: validateFocusResult });
  await expect(run()).rejects.toThrow();

  // Strip every chapter from the saved composition checkpoint, as an older run could have stored.
  const db = await getDatabase();
  const saved = (await db.getAll("semanticDecisionCache")).filter(entry => entry.id.includes(":composition-editorial-v16:"));
  expect(saved).toHaveLength(1);
  const checkpoint = saved[0].result as { current: CoverageMaterial[] };
  await db.put("semanticDecisionCache", { ...saved[0], result: { ...checkpoint, current: checkpoint.current.map(item => { const copy = { ...item }; delete copy.wikiOwnerId; return copy; }) } });

  failWriting = false;
  const before = writes;
  const result = await run();
  expect(writes).toBeGreaterThan(before);
  expect(result.result.sections.map(section => section.title).sort()).toEqual(["消息检索", "通知控制"]);
});
