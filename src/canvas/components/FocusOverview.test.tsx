import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FocusOverview } from "./FocusOverview";
import { getDatabase } from "../../storage/db";
import type { FocusSession } from "../../shared/focus-session";

const session: FocusSession = { id: "overview", goal: "Review", title: "Review", mode: "review", sourceConversationIds: ["c", "unused"], evidence: [{ id: "later", conversationId: "c", messageId: "later-message", title: "Source", excerpt: "Later correction" }, { id: "earlier", conversationId: "c", messageId: "earlier-message", title: "Source", excerpt: "Original question" }], sections: [{ id: "correct", title: "Start with the correction", body: "Latest qualification", transition: "Return to the original reasoning", kind: "review", evidenceIds: ["later"] }, { id: "original", title: "Revisit the original", body: "Original reasoning", transition: "", kind: "review", evidenceIds: ["earlier"] }], activeSectionId: "correct", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
beforeEach(async () => {
  const db = await getDatabase();
  await db.clear("messages");
  for (const [id, index] of [["later-message", 8], ["earlier-message", 1]] as const) await db.put("messages", { id, conversationId: "c", messageIndex: index, role: "user", content: "Source text", preview: "", contentHash: id, createdAt: 1, updatedAt: 1 });
});
afterEach(cleanup);

describe("reading overview", () => {
  it("continues an unresolved chapter, separates review panels and preserves local drafts across tabs", () => {
    const read = vi.fn();
    render(<FocusOverview session={{ ...session, activeSectionId: "correct", completedSectionIds: ["correct"], reviewNeeds: { original: "Recheck the condition" } }} conversations={[]} zh={false} onRead={read} onLocate={vi.fn()} onAnalyze={vi.fn()} route={<div>Knowledge map</div>}><textarea aria-label="Local summary draft" defaultValue="" /></FocusOverview>);
    expect(screen.getByRole("tab", { name: "Review overview" })).toHaveAttribute("aria-selected", "true");
    expect(screen.queryByRole("region", { name: "Reading path" })).toBeNull();
    expect(screen.getAllByText("Recheck the condition")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue reviewing" }));
    expect(read).toHaveBeenCalledWith("original");
    fireEvent.change(screen.getByRole("textbox", { name: "Local summary draft" }), { target: { value: "My own understanding" } });
    fireEvent.keyDown(screen.getByRole("tab", { name: "Review overview" }), { key: "ArrowRight" });
    expect(screen.getByRole("region", { name: "Reading path" })).toHaveTextContent("Knowledge map");
    fireEvent.click(screen.getByRole("tab", { name: "Review overview" }));
    expect(screen.getByRole("textbox", { name: "Local summary draft" })).toHaveValue("My own understanding");
  });
  it("hides leaked wire indices in summaries and routes while preserving original data and source actions", async () => {
    const original = { ...session, brief: { summary: "首先明确问题[e12]。然后验证方案【e3】。", turningPoints: [], confirmed: [], openQuestions: ["核对范围（e8）"] }, sections: [{ ...session.sections[0], title: "提出问题[e1]", body: "需求说明[e2]。", transition: "" }] };
    const locate = vi.fn();
    render(<FocusOverview session={original} conversations={[]} zh onRead={vi.fn()} onLocate={locate} onAnalyze={vi.fn()} />);
    expect(screen.getByRole("region", { name: "对话概况" })).toHaveTextContent("首先明确问题。然后验证方案。");
    expect(screen.getByRole("region", { name: "阅读总览" }).textContent).not.toMatch(/e(?:1|2|3|8|12)\b/u);
    expect(original.brief.summary).toContain("[e12]");
    expect(original.sections[0].evidenceIds).toEqual(["later"]);
    fireEvent.click(screen.getByText("来源对话 · 2"));
    fireEvent.click((await screen.findAllByRole("button", { name: "回看原文" }))[0]);
    expect(locate).toHaveBeenCalledWith(original.evidence[0]);
  });
  it("shows a source-grounded summary and discussion flow even with a custom chapter route", () => {
    const chapters = ["提出问题", "验证方案", "修正结论"].map((title, index) => ({ id: `${index}`, title, summary: ["首先明确需求。", "然后测试方案的适用条件。", "最后保留未解决的限制。 "][index], messageIds: [`m${index}`] }));
    render(<FocusOverview session={{ ...session, sourceConversationIds: ["c"], sourceOutlines: [{ conversationId: "c", chapters }] }} conversations={[]} zh onRead={vi.fn()} onLocate={vi.fn()} onAnalyze={vi.fn()} route={<div>理解路线卡片</div>} />);
    const summary = screen.getByRole("region", { name: "对话概况" });
    expect(summary).toHaveTextContent("首先明确需求。"); expect(summary).toHaveTextContent("最后保留未解决的限制。");
    fireEvent.click(screen.getByRole("tab", { name: "讨论过程" }));
    const timeline = document.querySelector(".overview-evolution")!;
    expect(screen.getByRole("button", { name: "逐步回顾" })).toBeInTheDocument();
    expect([...timeline.querySelectorAll("button")].map(button => button.textContent)).toEqual(["提出问题", "验证方案", "修正结论"]);
    expect(summary).not.toHaveTextContent("已确认决策");
  });
  it("keeps the reading route and original discussion order independent, with exact source links", async () => {
    const onRead = vi.fn();
    const onLocate = vi.fn();
    render(<FocusOverview session={session} conversations={[]} zh={false} onRead={onRead} onLocate={onLocate} onAnalyze={vi.fn()} />);
    const route = document.querySelector(".overview-route")!;
    expect(route.textContent!.indexOf("Start with the correction")).toBeLessThan(route.textContent!.indexOf("Revisit the original"));
    expect(route).toHaveTextContent("Return to the original reasoning");
    expect(document.querySelector(".overview-original-stages")).not.toHaveAttribute("open");
    expect(screen.queryByRole("button", { name: "Read original" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Source conversations · 2"));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Read original" })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Read original" })[0]);
    expect(onLocate).toHaveBeenCalledWith(session.evidence[0]);
    fireEvent.click(screen.getByRole("tab", { name: "Knowledge structure" }));
    fireEvent.click(within(route as HTMLElement).getByRole("button", { name: "Revisit the original" }));
    expect(onRead).toHaveBeenCalledWith("original");
    expect(session.completedSectionIds).toEqual([]);
  });
  it("keeps the overview concise without clipping sentences or repeating chapter bodies", () => {
    const body = "Original conditions and reasoning. ".repeat(45) + "Important final correction.";
    render(<FocusOverview session={{ ...session, sections: [{ ...session.sections[0], body }] }} conversations={[]} zh={false} onRead={vi.fn()} onLocate={vi.fn()} onAnalyze={vi.fn()} />);
    expect(document.querySelector(".overview-route")).toHaveTextContent("Original conditions and reasoning.");
    expect(document.querySelector(".overview-route")).not.toHaveTextContent("Important final correction.");
    expect(document.querySelector(".overview-route")?.textContent?.match(/Original conditions and reasoning\./g)).toHaveLength(1);
    expect(document.querySelector(".overview-route")?.textContent).not.toContain("…");
  });
  it("offers full analysis only when coverage is not complete", () => {
    render(<FocusOverview session={{ ...session, coverage: { method: "full_batched", sourceCount: 2, processedSegments: 3, totalSegments: 3 } }} conversations={[]} zh={false} onRead={vi.fn()} onLocate={vi.fn()} onAnalyze={vi.fn()} />);
    expect(screen.getByText("All sources analyzed")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Analyze all sources" })).not.toBeInTheDocument();
  });
});
