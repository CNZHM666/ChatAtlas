import "fake-indexeddb/auto";
import { afterEach, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { StructuredAIRequest } from "./provider";
const { generateStructured, synthesizeCoveredFocus } = vi.hoisted(() => ({ generateStructured: vi.fn(), synthesizeCoveredFocus: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: () => ({ modelId: "fixture", canReuseProjectKnowledge: true, synthesize: vi.fn(), generateStructured }) }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ mode: "byok", provider: "qwen", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", model: "fixture" }) }));
vi.mock("./provider", async original => ({ ...await original<typeof import("./provider")>(), hasProviderPermission: async () => true }));
// The document pipeline has its own tests; here it returns a fixed Wiki so only the switch is observed.
vi.mock("./focus-coverage", async original => ({ ...await original<typeof import("./focus-coverage")>(), synthesizeCoveredFocus }));
import { generateFocusSession } from "./focus-session";
import { WIKI_LEGACY_PIPELINE_FLAG } from "./wiki-ledger-document";
import { sourceMessageSignature } from "../shared/source-signature";

afterEach(() => { vi.unstubAllGlobals(); generateStructured.mockReset(); synthesizeCoveredFocus.mockReset(); });
const extractions = () => generateStructured.mock.calls.filter(([request]) => JSON.parse(request.prompt).presentation === "wiki_unit_extract").length;

async function generate(id: string, extra: Parameters<typeof generateFocusSession>[9] = {}, onProgress?: Parameters<typeof generateFocusSession>[8]) {
  const db = await getDatabase(), conversation: Conversation = { id, title: "硬件项目", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
  const originals: ConversationMessage[] = ["我建议先做浏览器产品，用 Orama 做全文索引。", "好，就这样。"].map((content, i) => ({ id: `${id}-${i}`, conversationId: id, messageIndex: i, role: i ? "user" : "assistant", content, preview: content, contentHash: String(i), createdAt: 1, updatedAt: 1 }));
  await db.put("conversations", conversation); for (const message of originals) await db.put("messages", message);
  synthesizeCoveredFocus.mockResolvedValue({ result: { title: "硬件平台", sections: [{ id: "s1", title: "核心流程", body: "先做浏览器产品，用 Orama 做全文索引。", kind: "finding", evidenceIds: [] }] }, evidence: [], sourceOutlines: [{ conversationId: id, chapters: [], messageSignatures: Object.fromEntries(originals.map(message => [message.id, sourceMessageSignature(message.content)])) }], segmentCount: 2, method: "full_direct", batchCount: 1, sourceCharacters: 30 });
  generateStructured.mockImplementation(async (request: StructuredAIRequest<unknown>) => {
    const data = JSON.parse(request.prompt);
    // P2 after the ledger: one subject, one chapter.
    if (data.presentation === "wiki_subject_merge") return request.validate({ subjects: [{ name: "检索", names: data.names.map((entry: { id: string }) => entry.id) }] });
    if (data.presentation === "wiki_subject_plan") return request.validate({ projectName: "Orama 检索器", chapters: [{ title: "检索", question: "如何检索？", group: "", subtopics: [{ title: "全文索引", subjectIds: [data.subjects[0].id] }] }] });
    if (data.presentation === "wiki_chapter_write") return request.validate({ opening: "全文索引使用 Orama。", subtopics: data.subtopics.map((topic: { title: string; units: Array<{ id: string; statement: string }> }) => ({ title: topic.title, paragraphs: [{ text: topic.units.map(item => item.statement).join(""), unitIds: topic.units.map(item => item.id) }] })) });
    if (data.presentation !== "wiki_unit_extract") throw new Error("not available in this test");
    const proposal = data.passages.find((passage: { role: string }) => passage.role === "assistant"), reply = data.passages.find((passage: { role: string }) => passage.role === "user");
    return request.validate({ units: [{ subject: "全文索引", statement: "全文索引使用 Orama。", kind: "decision", details: ["Orama"], quoteKey: `${proposal.id}:1`, adoption: "user_adopted", confirmationQuoteKey: `${reply.id}:1`, delivery: "unknown" }] });
  });
  return generateFocusSession("把全部已选对话整理成一个项目", "work", [conversation], "zh-CN", new AbortController().signal, undefined, undefined, undefined, onProgress, { complete: true, skipProjectState: true, ...extra });
}

// The earlier pipeline, kept as a developer fallback.
const flags = (...on: string[]) => vi.stubGlobal("localStorage", { getItem: (key: string) => on.includes(key) ? "1" : null, setItem: () => undefined, removeItem: () => undefined });

it("writes a new project document from the knowledge-unit ledger, keeping the ledger with it", async () => {
  const result = await generate("ledger-doc");
  expect(synthesizeCoveredFocus).not.toHaveBeenCalled();
  const units = result.wikiKnowledge!.batches.flatMap(batch => batch.units);
  // One chapter from the ledger's directory; its paragraph cites the unit's message as evidence, with a claim.
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0]).toMatchObject({ title: "检索", wikiQuestion: "如何检索？", wikiSubtopics: [{ title: "全文索引" }] });
  expect(result.sections[0].body).toContain("### 全文索引");
  expect(result.evidence).toEqual([expect.objectContaining({ id: "u1", conversationId: "ledger-doc", messageId: "ledger-doc-0", title: "硬件项目" })]);
  expect(result.sections[0].evidenceIds).toEqual(["u1"]);
  expect(result.sections[0].claims?.[0]).toMatchObject({ text: "全文索引使用 Orama。", evidenceIds: ["u1"] });
  expect(result).toMatchObject({ wikiEdition: "current-v2", wikiKnowledge: { draft: { status: "complete" } } });
  // No one named the project: the directory plan names it, not the request text.
  expect(result.title).toBe("Orama 检索器");
  expect(result.wikiKnowledge!.organization!.projectName).toBe("Orama 检索器");
  expect(units).toHaveLength(1);
});

it("writes with the earlier pipeline behind the fallback switch, reading no ledger", async () => {
  flags(WIKI_LEGACY_PIPELINE_FLAG);
  const result = await generate("legacy-fallback");
  expect(synthesizeCoveredFocus).toHaveBeenCalledOnce();
  expect(result.sections[0].body).toBe("先做浏览器产品，用 Orama 做全文索引。");
  expect(result.wikiKnowledge).toBeUndefined();
  expect(extractions()).toBe(0);
});

it("shows the planned directory first, then each chapter as a preview once it is written", async () => {
  const previews: Array<{ id: string; status?: string; titles: string[]; outline: boolean[]; body: string }> = [];
  const result = await generate("ledger-preview", { onPartial: session => previews.push({ id: session.id, status: session.status, titles: session.sections.map(section => section.title), outline: session.sections.map(section => Boolean(section.wikiOutline)), body: session.sections[0].body }) });
  // The planned directory shows first, each chapter's question and parts; the written chapter replaces it.
  expect(previews.map(({ id, status, titles, outline }) => ({ id, status, titles, outline }))).toEqual([
    { id: `partial:${result.runId}`, status: "preview", titles: ["检索"], outline: [true] },
    { id: `partial:${result.runId}`, status: "preview", titles: ["检索"], outline: [false] },
  ]);
  expect(previews[0].body).toBe("如何检索？\n\n本章包括：全文索引");
});

it("reports each ledger step to the progress view, from extraction to writing", async () => {
  const stages: string[] = [];
  await generate("ledger-progress", {}, (_done, _total, _stage, detail) => { if (detail?.ledger && stages.at(-1) !== detail.ledger.stage) stages.push(detail.ledger.stage); });
  expect(stages[0]).toBe("extract");
  expect(stages).toContain("plan");
  expect(stages.at(-1)).toBe("write");
});

it("puts the key decisions to the user after planning the directory, and writes from their verdicts", async () => {
  const seen: number[] = [];
  const result = await generate("ledger-decide", { onKeyDecisions: async ledger => {
    const units = ledger.batches.flatMap(batch => batch.units);
    seen.push(units.length);
    // The directory is planned before the user is asked, and nothing is written yet.
    expect(ledger.organization?.chapters.length).toBeGreaterThan(0);
    expect(ledger.draft).toBeUndefined();
    return { ...ledger, decisions: { [units[0].id]: { verdict: "confirmed" as const, at: Date.now() } } };
  } });
  expect(seen).toEqual([1]);
  const written = generateStructured.mock.calls.map(([request]) => JSON.parse(request.prompt)).find(data => data.presentation === "wiki_chapter_write");
  expect(written.subtopics[0].units[0].status).toBe("confirmed");
  expect(Object.values(result.wikiKnowledge!.decisions ?? {})[0]).toMatchObject({ verdict: "confirmed" });
});
