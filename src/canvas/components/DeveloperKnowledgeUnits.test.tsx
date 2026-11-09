import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { getDatabase } from "../../storage/db";
import { saveOrganizationRun } from "../../storage/organization-runs";
import { recordAIUsage } from "../../storage/ai-usage";
import type { FocusSession } from "../../shared/focus-session";
const { generateStructured } = vi.hoisted(() => ({ generateStructured: vi.fn() }));
vi.mock("../../ai/atlas-ai", () => ({ createAtlasAI: () => ({ generateStructured }) }));
// The three steps, recorded in order; each returns the ledger with its own part added.
const { steps } = vi.hoisted(() => ({ steps: [] as string[] }));
vi.mock("../../ai/wiki-knowledge-session", () => ({ updateSessionKnowledge: vi.fn(), withStoredSections: async (ledger: object) => ledger, reextractSessionKnowledge: async () => { steps.push("extract"); return { version: 1, generatedAt: 2, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [], rejected: {} }] }; } }));
vi.mock("../../ai/wiki-knowledge-organize", () => ({ organizeLedger: async (ledger: object) => { steps.push("organize"); return { ...ledger, organization: { version: 1, generatedAt: 2, status: "complete", subjects: [{ id: "s", name: "检索", aliases: [], unitIds: [] }], merged: [], relations: [], chapters: [{ id: "a", title: "检索", question: "?", group: "", subtopics: [] }], report: {} } }; } }));
vi.mock("../../ai/wiki-knowledge-write", () => ({ writeLedgerDraft: async (ledger: object) => { steps.push("write"); return { ...ledger, draft: { version: 1, generatedAt: 2, status: "complete", report: {}, chapters: [] } }; } }));
vi.mock("../../storage/knowledge-graph", () => ({ getAISettings: async () => ({ mode: "byok", provider: "qwen", apiKey: "fixture", baseUrl: "https://fixture.invalid/v1", model: "fixture" }) }));
import { DeveloperKnowledgeUnits } from "./DeveloperKnowledgeUnits";

const session = { id: "session-units", runId: "run-units", title: "Atlas 项目知识管理", goal: "Atlas", mode: "work", locale: "zh-CN", sections: [], evidence: [], sourceConversationIds: ["c"], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1,
  wikiKnowledge: { version: 1, generatedAt: 1, status: "complete", materials: 1, batches: [{ sourceIds: [], status: "ok", units: [], rejected: {} }],
    draft: { version: 1, generatedAt: 1, status: "complete", report: {}, chapters: [{ id: "a", title: "检索", question: "?", group: "", body: "全文索引使用 Orama。", paragraphs: [], problems: [] }] } } } as unknown as FocusSession;
const downloads: string[] = [];
beforeEach(async () => {
  const db = await getDatabase(); await db.clear("focusSessions"); await db.clear("organizationRuns"); await db.clear("aiUsageEvents");
  await db.put("focusSessions", session);
  await saveOrganizationRun({ id: "run-units", title: "Atlas", targetType: "conversation", targetIds: ["c"], startedAt: 1, updatedAt: 2, status: "completed", stage: "completed", progress: 1, events: [] } as never);
  await recordAIUsage({ id: "usage-units", runId: "run-units", createdAt: 2, durationMs: 1, taskType: "other", feature: "wiki", operation: "wiki:knowledge-write", providerId: "qwen", modelId: "fixture", conversationIds: ["c"], inputTokens: 10, outputTokens: 5, tokenSource: "provider", status: "completed", attempt: 1 });
  downloads.length = 0;
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:fixture", revokeObjectURL: () => undefined }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { downloads.push(this.download); });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); generateStructured.mockReset(); });

it("exports the draft, the ledger and this document's run CSV with one click", async () => {
  render(<DeveloperKnowledgeUnits zh />);
  fireEvent.click(await screen.findByRole("button", { name: "导出“Atlas 项目知识管理”的草稿、账本和任务 CSV" }));
  await waitFor(() => expect(downloads).toEqual(["knowledge-draft-session-.md", "knowledge-units-session-.json", "ai-organization-analysis-session-.csv"]));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("asks before extracting again and calls no model when declined", async () => {
  vi.spyOn(window, "confirm").mockReturnValue(false);
  render(<DeveloperKnowledgeUnits zh />);
  fireEvent.click(await screen.findByRole("button", { name: "重新抽取“Atlas 项目知识管理”的知识点" }));
  expect(window.confirm).toHaveBeenCalledOnce();
  expect(generateStructured).not.toHaveBeenCalled();
  expect(screen.getByText(/0 个知识点 · 有草稿/u)).toBeTruthy();
});

it("runs extraction, organizing and writing in turn with one click, after asking", async () => {
  steps.length = 0;
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<DeveloperKnowledgeUnits zh />);
  fireEvent.click(await screen.findByRole("button", { name: "一键抽取、整理并写作“Atlas 项目知识管理”" }));
  await waitFor(() => expect(screen.getByText(/1 个主题 · 1 章 · 有草稿/u)).toBeTruthy());
  expect(steps).toEqual(["extract", "organize", "write"]);
  expect(window.confirm).toHaveBeenCalledOnce();
  // The separate step buttons stay.
  expect(screen.getByRole("button", { name: "重新抽取“Atlas 项目知识管理”的知识点" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "按目录写“Atlas 项目知识管理”的草稿" })).toBeTruthy();
});

it("turns the earlier pipeline on and off as the one fallback switch", async () => {
  localStorage.removeItem("atlas-dev-wiki-legacy-pipeline");
  render(<DeveloperKnowledgeUnits zh />);
  const fallback = await screen.findByRole("switch", { name: "新建文档改用旧生成流程" });
  expect(screen.getAllByRole("switch")).toHaveLength(1);
  expect(fallback.getAttribute("aria-checked")).toBe("false");
  fireEvent.click(fallback);
  expect(localStorage.getItem("atlas-dev-wiki-legacy-pipeline")).toBe("1");
  expect(screen.getByText("已开启：新建的项目文档改用旧流程生成")).toBeTruthy();
  fireEvent.click(fallback);
  expect(localStorage.getItem("atlas-dev-wiki-legacy-pipeline")).toBeNull();
});
