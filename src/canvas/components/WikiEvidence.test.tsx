import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSection } from "../../shared/focus-session";
import { WikiEvidence } from "./WikiEvidence";
import { wikiApproximatePoints, wikiEvidenceItems } from "../wiki-evidence";
import { readSessionSource } from "../../storage/source-versions";
import { projectSession } from "../../test/project-fixture";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";

vi.mock("../../storage/source-versions", () => ({ readSessionSource: vi.fn() }));

afterEach(() => { cleanup(); vi.mocked(readSessionSource).mockReset(); });
it("keeps incomplete verification visible in a collapsed evidence panel", () => {
  render(<WikiEvidence zh section={{ ...section, claims: [], evidenceReview: { status: "unanchored", totalClaims: 0, invalidClaims: 0, checkedClaims: 0 } }} evidence={[ref]} onLocate={vi.fn()} />);
  expect(screen.getByText("暂缺可定位依据")).toBeVisible();
  expect(screen.getByText(/这页尚未保存/)).not.toBeVisible();
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.getByText(/这页尚未保存/)).toBeVisible();
});
const ref = { id: "e1", conversationId: "c", messageId: "m1", title: "硬件AI方向推荐", excerpt: "没有完全相同的产品。", sourceVersionId: "v1", sourceSignature: "sig1" };
const section: FocusSection = { id: "s", title: "市场分析", body: "", transition: "", kind: "finding", evidenceIds: ["e1", "e2", "e3"], claims: [{ text: "市场空位", quote: "没有完全相同的产品。", evidenceIds: ["e1", "e2", "e3"] }] };

it("collapses duplicate message aliases and repeated claims into one source button", async () => {
  const locate = vi.fn();
  render(<WikiEvidence zh section={{ ...section, claims: [...section.claims!, section.claims![0]] }} evidence={[ref, { ...ref, id: "e2" }]} onLocate={locate} />);
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.getAllByText("市场空位")).toHaveLength(1);
  fireEvent.click(screen.getByText("市场空位"));
  const source = await screen.findByRole("button", { name: "阅读原始讨论" });
  fireEvent.click(source); expect(locate).toHaveBeenCalledWith(ref);
});

it("groups distinct messages from one conversation, preserving each original locator", async () => {
  const second = { ...ref, id: "e2", messageId: "m2", excerpt: "需要验证相似产品的用户流程。", sourceSignature: "sig2" }, locate = vi.fn();
  render(<WikiEvidence zh section={section} evidence={[ref, second]} onLocate={locate} />);
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.queryByText(second.excerpt)).toBeNull();
  fireEvent.click(screen.getByText("市场空位"));
  const buttons = await screen.findAllByRole("button", { name: "阅读原始讨论" });
  fireEvent.click(buttons[1]);
  expect(locate).toHaveBeenCalledWith(second);
});

it("keeps distinct source versions and changed message fingerprints separate", () => {
  const items = wikiEvidenceItems(section, [ref, { ...ref, id: "e2", sourceVersionId: "v2" }, { ...ref, id: "e3", sourceSignature: "changed" }]);
  expect(items[0].sources).toHaveLength(1);
  expect(items[0].sources[0].refs).toHaveLength(3);
  expect(items[0].sources[0].refs[1].sourceVersionId).toBe("v2");
});

it("shows individual verdicts, marks only updated discussions, and never upgrades missing proof", () => {
  const supported = { text: "明确的采购范围", quote: "只列出缺件。", evidenceIds: ["e1"], verification: "supported" as const };
  const uncertain = { text: "是否需要完整采购接口", quote: "需要进一步验证。", evidenceIds: ["e2"], verification: "uncertain" as const };
  render(<WikiEvidence zh section={{ ...section, claims: [supported, uncertain, { ...supported, text: "来源缺失的结论", evidenceIds: ["missing"] }] }} evidence={[ref, { ...ref, id: "e2", conversationId: "other" }]} updatedConversationIds={["other"]} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.getByText("原文支持")).toBeVisible();
  expect(screen.getByText("来源有更新")).toBeVisible();
  expect(screen.getByText("缺少来源")).toBeVisible();
  expect(screen.getByText("2 条未经原文校验")).toBeVisible();
  const items = wikiEvidenceItems({ ...section, claims: [supported, { ...supported, verification: "uncertain" }] }, [ref]);
  expect(items[0].verification).toBe("uncertain");
});

it("limits the initial list without discarding other claims and keeps context optional", () => {
  render(<WikiEvidence zh section={{ ...section, claims: Array.from({ length: 5 }, (_, i) => ({ text: `结论 ${i + 1}`, quote: "原句", evidenceIds: ["e1"], verification: "supported" })) }} evidence={[ref]} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.queryByText("结论 4")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看其余 2 条" }));
  expect(screen.getByText("结论 5")).toBeVisible();
  expect(screen.queryByText("原句")).toBeNull();
});

it("loads the exact retained version only on expansion, displays its date and role, and locates the precise quote", async () => {
  const session = projectSession(), quote = "初期只生成缺件清单。";
  // Local noon: the displayed local date is 2026/9/14 in every timezone.
  const original = { id: "m1", conversationId: "c", role: "assistant" as const, messageIndex: 1, content: `${"较早的讨论。".repeat(70)}${quote}这仍然是一个建议。`, contentHash: "hash", preview: "", createdAt: new Date(2026, 8, 14, 12).getTime(), updatedAt: 1 };
  vi.mocked(readSessionSource).mockResolvedValue([original]);
  const locate = vi.fn();
  render(<WikiEvidence zh session={session} section={{ ...section, claims: [{ text: "采购采用轻量方案", quote, evidenceIds: ["e1"], verification: "supported" }] }} evidence={[ref]} onLocate={locate} />);
  expect(readSessionSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(readSessionSource).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("采购采用轻量方案"));
  expect(await screen.findByText("AI 回复")).toBeVisible();
  expect(screen.getByText("2026/9/14")).toBeVisible();
  expect(screen.getByText(/这仍然是一个建议/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "阅读原始讨论" }));
  expect(locate).toHaveBeenCalledWith({ ...ref, excerpt: quote });
  expect(readSessionSource).toHaveBeenCalledWith(session, "c", "m1", "v1");
  expect(ref.excerpt).toBe("没有完全相同的产品。");
});

it("keeps history excerpts when a retained original is missing instead of using today's message", async () => {
  vi.mocked(readSessionSource).mockResolvedValue([]);
  render(<WikiEvidence zh session={projectSession()} section={section} evidence={[ref]} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByText("关键结论依据"));
  fireEvent.click(screen.getByText("市场空位"));
  expect(await screen.findByText("原文暂不可定位，以上保留历史摘录。")).toBeVisible();
  expect(screen.getByText(ref.excerpt)).toBeVisible();
});

it("labels who said a claim and opens a decision at the user's confirming message",()=>{
  const proposal={ ...ref, id: "e1", messageId: "ai", excerpt: "可以先做静态导出。" }, approval={ ...ref, id: "e9", messageId: "user", excerpt: "就按第一种。" };
  const reading={ signature: "", status: "confirmed" as const, reported: false, currentStage: false, sources: [
    { id: "e1", signature: "", role: "assistant", conversationId: "c", messageId: "ai", messageIndex: 1, discussedAt: 0 },
    { id: "e9", signature: "", role: "user", conversationId: "c", messageId: "user", messageIndex: 2, discussedAt: 0 } ] };
  const open=vi.fn();
  render(<WorkspaceEvidenceContext.Provider value={{ open }}><WikiEvidence zh section={{ ...section, claims: [{ text: "先做静态导出", quote: "可以先做静态导出。", evidenceIds: ["e1"], sourceReading: reading, verification: "supported" }] }} evidence={[proposal, approval]} onLocate={vi.fn()} /></WorkspaceEvidenceContext.Provider>);
  fireEvent.click(screen.getByText("关键结论依据"));
  expect(screen.getByText("用户决定 · 原文支持")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /先做静态导出/ }));
  expect(open).toHaveBeenCalledWith(approval, expect.objectContaining({ quote: undefined, references: [proposal, approval] }));
});

it("falls back to locally matched sentences, labelled approximate, when a chapter has no claims",()=>{
  const source={ ...ref, id: "a1", messageId: "m-a", excerpt: "我们决定先用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。其他无关的话。" };
  const chapter={ ...section, claims: [], evidenceIds: ["a1"] };
  const body="## 存储\n\n系统先用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。这一句和原文没有关系，也不该被标记。\n\n```\n用 IndexedDB 保存原始消息\n```";
  const points=wikiApproximatePoints(chapter,[source],body,true);
  expect(points).toEqual([expect.objectContaining({claim:"系统先用 IndexedDB 保存原始消息，再用 Orama 建立检索索引",quote:"我们决定先用 IndexedDB 保存原始消息，再用 Orama 建立检索索引。",approximate:true,label:"相似原文（未确认对应）",references:[source]})]);
  expect(wikiApproximatePoints({...chapter,userEdited:true},[source],body,true)).toEqual([]);
});
