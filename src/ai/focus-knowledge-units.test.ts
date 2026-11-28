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
import { generateFocusUpdate } from "./focus-update";
import { WIKI_LEGACY_PIPELINE_FLAG } from "./wiki-ledger-document";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiTableSignature } from "../shared/wiki-table-source";
import { projectDocument } from "../export/project-document";

afterEach(() => { vi.unstubAllGlobals(); generateStructured.mockReset(); synthesizeCoveredFocus.mockReset(); });
const extractions = () => generateStructured.mock.calls.filter(([request]) => JSON.parse(request.prompt).presentation === "wiki_unit_extract").length;

it("reuses verified reading across separate runs without a previous session", async () => {
  const first = await generate("cross-task-reading");
  expect(first.wikiKnowledge?.batches[0].status).toBe("ok");
  expect(extractions()).toBeGreaterThan(0);
  generateStructured.mockClear();
  const repeated = await generate("cross-task-reading");
  expect(extractions()).toBe(0);
  expect(repeated.runId).not.toBe(first.runId);
  expect(repeated.wikiKnowledge?.batches[0].units).toEqual(first.wikiKnowledge?.batches[0].units);
});

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
  // The chapter keeps the proposal and the separate user reply that confirms it.
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0]).toMatchObject({ title: "检索", wikiQuestion: "如何检索？", wikiSubtopics: [{ title: "全文索引" }] });
  expect(result.sections[0].body).toContain("### 全文索引");
  expect(result.evidence).toEqual([
    expect.objectContaining({ id: "u1", conversationId: "ledger-doc", messageId: "ledger-doc-0", title: "硬件项目" }),
    expect.objectContaining({ id: "u2", conversationId: "ledger-doc", messageId: "ledger-doc-1", excerpt: "好，就这样。" }),
  ]);
  expect(result.sections[0].evidenceIds).toEqual(["u1", "u2"]);
  expect(result.sections[0].claims?.[0]).toMatchObject({ text: "全文索引使用 Orama。", evidenceIds: ["u1"] });
  expect(result).toMatchObject({ wikiEdition: "current-v2", wikiKnowledge: { draft: { status: "complete" } } });
  expect(result.title).toBe("硬件项目");
  expect(result.wikiKnowledge!.organization!.projectName).toBe("Orama 检索器");
  expect(units).toHaveLength(1);
});

async function firstWikiFixture(id: string, contents: string[]) {
  const db = await getDatabase();
  const source: Conversation = { id, title: "AI 硬件版 Cursor 调研", platform: "deepseek", url: "", messageCount: contents.length, updatedAt: 1,
    importState: "complete", hydrationState: "hydrated" };
  await db.put("conversations", source);
  const messages = contents.map((content, i): ConversationMessage => ({
    id: `${id}-${i}`, conversationId: id, messageIndex: i, role: i % 2 ? "assistant" : "user",
    content, preview: content, contentHash: sourceMessageSignature(content), createdAt: 1, updatedAt: 1,
  }));
  for (const message of messages) await db.put("messages", message);
  return { source, messages };
}

it("previews a single research answer in one request and exports its original six-row comparison and references", async () => {
  const table = [
    "| 公司/产品 | 目标领域 | 核心定位与模式 | 关键信号 |",
    "| :-- | :-- | :-- | :-- |",
    "| Schematik | 泛硬件 | 物料清单、购买链接和组装步骤 | 460 万美元 |",
    "| Flux | PCB | 浏览器端 eCAD | 3700 万美元 |",
    "| CopperPilot | PCB | KiCad、Altium、LTspice | 39 万美元 |",
    "| Hestus | 机械 CAD | 预测草图约束 | YC 孵化 |",
    "| Embedder | 嵌入式固件 | 真实板子烧录和测试 | 50 万美元 |",
    "| Phinity Labs | RTL/芯片 | 从提示设计芯片 | 520 万美元 |",
  ].join("\n");
  const { source, messages } = await firstWikiFixture("first-hardware-research", [
    "我想做 AI 硬件版 Cursor，有哪些竞品或开源项目值得参考？",
    ["硬件设计有多个相对独立的方向。", "### 赛道格局", "包括 PCB、机械 CAD、嵌入式固件和 RTL/芯片。",
      "### 商业竞品", table, "### 开源参考", "- **Copperhead** 用 KiCad CLI 验证 ERC 和 DRC。\n- **Forma** 提供 MCP 接口。\n- **SchGen** 以 Python 作为原理图中间表示。\n- **Reflow** 和 **circuit-agent** 约束生成。",
      "### 切入建议", "可以先比较 PCB 和嵌入式固件，方向还需要选择。"].join("\n\n"),
  ]);
  const partial = vi.fn(), writing = vi.fn();
  generateStructured.mockImplementation(async (request: StructuredAIRequest<unknown>) => {
    expect(JSON.parse(request.prompt).presentation).toBe("wiki_first_draft");
    return request.validate({ needsFull: false, selected: [9999] });
  });
  const runId = "test-first-hardware-research";
  const result = await generateFocusSession("研究竞品和开源项目", "work", [source], "zh-CN", new AbortController().signal,
    undefined, undefined, runId, undefined, { firstDocument: true, complete: true, initialWritingMode: "handoff",
      onPartial: partial, onWritingEvent: writing });

  expect(generateStructured).toHaveBeenCalledOnce();
  expect(result.sections.map(section => section.title)).toEqual(["赛道格局", "商业竞品", "开源参考", "切入建议"]);
  expect(partial).toHaveBeenCalledOnce();
  expect(writing).toHaveBeenCalledTimes(4);
  const ref = result.evidence.find(item => item.excerpt === table)!;
  expect(ref).toMatchObject({ messageId: messages[1].id, sourceSignature: sourceMessageSignature(messages[1].content), sourceVersionId: expect.any(String) });
  expect(result.sections[1].body).toContain(table);
  expect(result.sections[1].body).toContain(`/table/${wikiTableSignature(table)}`);
  expect(result.sections.flatMap(section => section.claims ?? []).some(claim => claim.userDecided || claim.holder === "decided")).toBe(false);
  const exported = projectDocument(result, { overview: true, wikiIds: result.sections.map(section => section.id),
    matters: false, history: false, sources: false, sourceMode: "locators" }, "md", true).text;
  for (const name of ["赛道格局", "Schematik", "Flux", "CopperPilot", "Hestus", "Embedder", "Phinity Labs", "Copperhead", "Forma", "SchGen", "Reflow", "circuit-agent"])
    expect(exported).toContain(name);
  const run = await (await getDatabase()).get("organizationRuns", runId);
  expect(run?.firstReadableAt).toBeGreaterThanOrEqual(run!.startedAt);
  const noChange = await generateFocusUpdate(result, [source], "zh-CN", new AbortController().signal);
  expect(noChange.sections).toEqual(result.sections);
  expect(generateStructured).toHaveBeenCalledOnce();
});

it("keeps a short first note flat and does not include messages outside the confirmed scope", async () => {
  const { source, messages: [message] } = await firstWikiFixture("first-short-note", ["先验证本地保存，再做同步。", "不要读到这个未选择的回复。"]);
  generateStructured.mockImplementation(async (request: StructuredAIRequest<unknown>) => {
    expect(request.prompt).not.toContain("未选择的回复");
    return request.validate({ needsFull: false, selected: [1] });
  });
  const result = await generateFocusSession("写首版", "work", [source], "zh-CN", new AbortController().signal,
    undefined, undefined, undefined, undefined, { firstDocument: true, scope: { kind: "goal", blocks: [{
      conversationId: source.id, title: "本地保存", messageIds: [message.id], messageSignatures: { [message.id]: sourceMessageSignature(message.content) },
    }] } });
  expect(result.sections).toHaveLength(1);
  expect(result.sections[0].body).toContain(message.content);
  expect(result.evidence.map(ref => ref.messageId)).toEqual([message.id]);
  expect(generateStructured).toHaveBeenCalledOnce();
});

it("uses full organization when the existing dialogue already contains a proposal and an adoption", async () => {
  const result = await generate("first-full-adoption", { firstDocument: true });
  expect(extractions()).toBeGreaterThan(0);
  expect(result.wikiKnowledge?.draft?.status).toBe("complete");
  expect(generateStructured.mock.calls.some(([request]) => JSON.parse(request.prompt).presentation === "wiki_first_draft")).toBe(false);
});

it("regenerates a document with zero extraction requests when its saved batches still match", async () => {
  const first = await generate("ledger-regenerate");
  expect(extractions()).toBe(1);
  generateStructured.mockClear();
  const second = await generate("ledger-regenerate", { wikiPreviousLedger: first.wikiKnowledge });
  expect(extractions()).toBe(0);
  expect(second.wikiKnowledge?.batches.map(batch => batch.units.map(unit => unit.id))).toEqual(first.wikiKnowledge?.batches.map(batch => batch.units.map(unit => unit.id)));
  expect(second.wikiKnowledge?.draft?.status).toBe("complete");
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
  const previews: Array<{ id: string; status?: string; title: string; titles: string[]; outline: boolean[]; body: string }> = [];
  const result = await generate("ledger-preview", { wikiProjectBoundary: { name: "我的项目名" }, onPartial: session => previews.push({ id: session.id, status: session.status, title: session.title, titles: session.sections.map(section => section.title), outline: session.sections.map(section => Boolean(section.wikiOutline)), body: session.sections[0].body }) });
  // The planned directory shows first, each chapter's question and parts; the written chapter replaces it.
  expect(previews.map(({ id, status, titles, outline }) => ({ id, status, titles, outline }))).toEqual([
    { id: `partial:${result.runId}`, status: "preview", titles: ["检索"], outline: [true] },
    { id: `partial:${result.runId}`, status: "preview", titles: ["检索"], outline: [false] },
  ]);
  expect(previews.map(item => item.title)).toEqual(["我的项目名", "我的项目名"]);
  expect(result.title).toBe("我的项目名");
  expect(previews[0].body).toBe("如何检索？\n\n本章包括：全文索引");
});

it("applies the user's scope to the writing outline and finished chapters", async () => {
  const previews: string[][] = [];
  const result = await generate("ledger-excluded-outline", {
    onKeyDecisions: async ledger => {
      const organization = ledger.organization!;
      return { ...ledger, scopeAnswers: { sideproject: "exclude" }, organization: {
        ...organization,
        subjects: [...organization.subjects, { id: "side", name: "SideProject", aliases: [], unitIds: [] }],
        chapters: [...organization.chapters, { id: "side", title: "Related project: SideProject", question: "", group: "", subtopics: [{ title: "SideProject", subjectIds: ["side"] }] }],
      } };
    },
    onPartial: session => previews.push(session.sections.map(section => section.title)),
  });
  expect(previews.length).toBeGreaterThan(1);
  expect(previews.every(titles => titles.length === 1 && titles[0] === "检索")).toBe(true);
  expect(result.sections.map(section => section.title)).toEqual(["检索"]);
  expect(result.wikiKnowledge?.scopeAnswers?.sideproject).toBe("exclude");
});

it("reports each ledger step to the progress view, from extraction through proofreading", async () => {
  const stages: string[] = [];
  await generate("ledger-progress", {}, (_done, _total, _stage, detail) => { if (detail?.ledger && stages.at(-1) !== detail.ledger.stage) stages.push(detail.ledger.stage); });
  expect(stages[0]).toBe("extract");
  expect(stages).toContain("plan");
  expect(stages).toContain("write");
  expect(stages.at(-1)).toBe("proofread");
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
