import "fake-indexeddb/auto";
import { expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { StructuredAIRequest } from "./provider";
const { generateStructured } = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: () => ({ modelId: "fixture", canReuseProjectKnowledge: true, synthesize: vi.fn(), generateStructured }) }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ mode: "byok", provider: "qwen", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", model: "fixture" }) }));
vi.mock("./provider", async original => ({ ...await original<typeof import("./provider")>(), hasProviderPermission: async () => true }));
import { generateFocusSession } from "./focus-session";
import { generateFocusUpdate } from "./focus-update";

// Each passage becomes one unit stating its own text; one subject per passage, one chapter per subject.
generateStructured.mockImplementation(async (request: StructuredAIRequest<unknown>) => {
  const data = JSON.parse(request.prompt);
  if (data.presentation === "wiki_unit_extract") return request.validate({ units: data.passages.filter((passage: { context?: boolean }) => !passage.context).map((passage: { id: string; text: string; role: string }) => ({ subject: passage.text.includes("导出") ? "导出" : "检索", statement: passage.text.replace(/^\[[^\]]+\]/u, ""), kind: "decision", details: [], quoteKey: `${passage.id}:1`, adoption: passage.role === "user" ? "user_decision" : "proposal", delivery: "unknown" })) });
  if (data.presentation === "wiki_subject_merge") return request.validate({ subjects: data.names.map((entry: { id: string; name: string }) => ({ name: entry.name, names: [entry.id] })) });
  if (data.presentation === "wiki_subject_plan") return request.validate({ chapters: data.subjects.map((subject: { id: string; name: string }) => ({ title: subject.name, question: `${subject.name}怎么做？`, group: "", subtopics: [{ title: subject.name, subjectIds: [subject.id] }] })) });
  if (data.presentation === "wiki_subject_place") return request.validate({ placements: data.subjects.map((subject: { id: string }) => ({ id: subject.id, chapter: 0, subtopic: 0 })) });
  if (data.presentation === "wiki_chapter_write") return request.validate({ opening: `${data.chapter.title}的做法。`, subtopics: data.subtopics.map((topic: { title: string; units: Array<{ id: string; statement: string }> }) => ({ title: topic.title, paragraphs: [{ text: topic.units.map(item => item.statement).join(""), unitIds: topic.units.map(item => item.id) }] })) });
  throw new Error(`not available in this test: ${data.presentation}`);
});

it("updates a ledger document through its ledger, keeping a chapter the user edited and flagging it", async () => {
  const db = await getDatabase(), id = "ledger-update", conversation: Conversation = { id, title: "检索项目", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
  const message = (index: number, role: "user" | "assistant", content: string): ConversationMessage => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role, content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 });
  await db.put("conversations", conversation);
  for (const item of [message(0, "assistant", "建议全文索引使用 Orama。"), message(1, "user", "我决定索引就用 Orama。")]) await db.put("messages", item);
  const first = await generateFocusSession("把全部已选对话整理成一个项目", "work", [conversation], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, { complete: true, skipProjectState: true });
  expect(first.sections.map(section => section.title)).toEqual(["检索"]);
  // The user rewrites the chapter; then the discussion goes on about export.
  const edited = { ...first, sections: first.sections.map(section => ({ ...section, body: "我自己整理的检索说明。", userEdited: true })) };
  for (const item of [message(2, "assistant", "建议导出提供 Markdown 文件。"), message(3, "user", "我决定导出就用 Markdown。")]) await db.put("messages", item);
  const grown = { ...conversation, messageCount: 4, updatedAt: 2 };
  await db.put("conversations", grown);
  generateStructured.mockClear();
  const updated = await generateFocusUpdate(edited, [grown], "zh-CN", new AbortController().signal);
  // Too few subjects to plan the directory again: export joins the edited chapter. The chapter keeps the user's
  // text and asks for a check; the ledger's new version of it, with export, is offered beside it, not added again.
  expect(updated.sections.map(section => section.title)).toEqual(["检索"]);
  const chapter = updated.sections[0];
  expect(chapter.body).toBe("我自己整理的检索说明。");
  expect(updated.reviewNeeds?.[chapter.id]).toBe("来源已更新，保留了你的修改，请核对");
  expect(updated.wikiSuggestions?.[chapter.id]?.body).toContain("Markdown");
  expect(updated.wikiSuggestions![chapter.id].evidenceIds.every(id => updated.evidence.some(ref => ref.id === id))).toBe(true);
  // The ledger carries all four messages' units; the old pipeline was not asked.
  expect(updated.wikiKnowledge!.batches.flatMap(batch => batch.units).map(unit => unit.evidence.messageId).sort()).toEqual([0, 1, 2, 3].map(index => `${id}-${index}`));
  expect(generateStructured.mock.calls.every(([request]) => JSON.parse(request.prompt).presentation?.startsWith("wiki_"))).toBe(true);
  expect(updated.previousSessionId).toBe(edited.id);
});

it("rewrites an unedited chapter in place on an update, with no duplicate and no suggestion", async () => {
  const db = await getDatabase(), id = "ledger-plain", conversation: Conversation = { id, title: "检索项目", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
  const message = (index: number, role: "user" | "assistant", content: string): ConversationMessage => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role, content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 });
  await db.put("conversations", conversation);
  for (const item of [message(0, "assistant", "建议全文索引使用 Orama。"), message(1, "user", "我决定索引就用 Orama。")]) await db.put("messages", item);
  const first = await generateFocusSession("把全部已选对话整理成一个项目", "work", [conversation], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, { complete: true, skipProjectState: true });
  for (const item of [message(2, "assistant", "建议索引在后台增量更新。")]) await db.put("messages", item);
  const grown = { ...conversation, messageCount: 3, updatedAt: 2 };
  await db.put("conversations", grown);
  const updated = await generateFocusUpdate(first, [grown], "zh-CN", new AbortController().signal);
  expect(updated.sections.map(section => section.id)).toEqual(first.sections.map(section => section.id));
  expect(updated.sections[0].body).toContain("增量更新");
  expect(updated.wikiSuggestions ?? {}).toEqual({});
  expect(updated.sections[0].evidenceIds.every(ref => updated.evidence.some(item => item.id === ref))).toBe(true);
});

it("rewrites the document around the user's confirmed decision, without reading the sources again", async () => {
  const { wikiDecisionCandidates, withDecision, ledgerDecisionsPending } = await import("./wiki-key-decisions");
  const db = await getDatabase(), id = "ledger-decide", conversation: Conversation = { id, title: "导出项目", platform: "chatgpt", url: "", messageCount: 1, updatedAt: 1 };
  await db.put("conversations", conversation);
  await db.put("messages", { id: `${id}-0`, conversationId: id, messageIndex: 0, role: "assistant", content: "建议导出提供 Markdown 文件。", preview: "", contentHash: "0", createdAt: 1, updatedAt: 1 } as ConversationMessage);
  const first = await generateFocusSession("把全部已选对话整理成一个项目", "work", [conversation], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, { complete: true, skipProjectState: true });
  const [candidate] = wikiDecisionCandidates(first.wikiKnowledge);
  expect(candidate).toMatchObject({ statement: "建议导出提供 Markdown 文件。", status: "proposal" });
  // Nothing new in the sources, but the user confirmed the point: only writing runs, and the unit is now decided.
  const decided = { ...first, wikiKnowledge: withDecision(first.wikiKnowledge!, candidate.unitIds, "confirmed") };
  expect(ledgerDecisionsPending(decided.wikiKnowledge)).toBe(true);
  generateStructured.mockClear();
  const updated = await generateFocusUpdate(decided, [conversation], "zh-CN", new AbortController().signal);
  const kinds = generateStructured.mock.calls.map(([request]) => JSON.parse(request.prompt).presentation);
  expect(kinds).not.toContain("wiki_unit_extract");
  expect(kinds).toContain("wiki_chapter_write");
  const written = generateStructured.mock.calls.map(([request]) => JSON.parse(request.prompt)).find(data => data.presentation === "wiki_chapter_write");
  expect(written.subtopics[0].units[0].status).toBe("confirmed");
  expect(updated.wikiKnowledge!.decisions?.[candidate.unitIds[0]]?.verdict).toBe("confirmed");
  expect(ledgerDecisionsPending(updated.wikiKnowledge)).toBe(false);
  // The document counts it as the user's decision, as its header and key conclusions read it.
  expect(updated.sections.flatMap(section => section.claims ?? []).some(claim => claim.userDecided)).toBe(true);
  expect(wikiDecisionCandidates(updated.wikiKnowledge)[0]).toMatchObject({ verdict: "confirmed" });
});
