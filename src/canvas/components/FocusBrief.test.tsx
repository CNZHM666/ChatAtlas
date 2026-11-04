import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusBrief } from "./FocusBrief";
import type { FocusSession } from "../../shared/focus-session";
afterEach(cleanup);
it("shows concise claim groups without collapse controls and keeps every remaining item accessible", () => {
  const confirmed = Array.from({ length: 5 }, (_, index) => ({ text: `Confirmed ${index + 1}`, evidenceIds: [] }));
  const session: FocusSession = { id: "concise", title: "Summary", goal: "Review", mode: "work", sourceConversationIds: [], evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1, brief: { summary: "Summary", confirmed, turningPoints: [], openQuestions: [] } };
  const { container } = render(<FocusBrief session={session} zh={false} onOpenEvidence={vi.fn()} onChange={vi.fn()} />);
  expect(container.querySelector(".focus-brief-grid details")).toBeNull();
  expect(screen.getByText("Confirmed 3")).toBeVisible(); expect(screen.queryByText("Confirmed 5")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "View all items" }));
  expect(screen.getByText("Confirmed 5")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Edit overview" }));
  expect(screen.getByRole("textbox", { name: "Confirmed 5" })).toHaveValue("Confirmed 5");
});
it("hides citation annotations in the brief while keeping source buttons and editable content", () => {
  const source = { id: "e1", conversationId: "c", messageId: "m1", title: "原始讨论", excerpt: "原始确认" };
  const brief = { summary: "项目概况[e12]。", turningPoints: [{ text: "调整方向【e2】", evidenceIds: [source.id] }], confirmed: [{ text: "确认范围（来源：e1）", evidenceIds: [source.id] }], openQuestions: ["核对成本[e9]"] };
  const session: FocusSession = { id: "brief", title: "概况", goal: "复习", mode: "work", sourceConversationIds: ["c"], evidence: [source], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1, brief };
  const open = vi.fn(); const { container } = render(<FocusBrief session={session} zh onOpenEvidence={open} onChange={vi.fn()} />);
  expect(container.textContent).not.toMatch(/e\d+/u);
  fireEvent.click(screen.getByRole("button", { name: "编辑概况" }));
  expect(screen.getByRole("textbox", { name: "项目概况" })).toHaveValue(brief.summary);
  fireEvent.click(screen.getByRole("button", { name: "完成编辑" }));
  expect(screen.getByRole("heading", { name: /关键转折/ })).toBeInTheDocument();
  fireEvent.click(screen.getAllByText("回看讨论")[0]);
  expect(open).toHaveBeenCalledWith(source);
});
it("groups repeated source links per claim while retaining distinct discussions", () => {
  const evidence = ["a", "b", "duplicate"].map((id, index) => ({ id, conversationId: "source", messageId: index === 2 ? "a" : id, title: "控制理论", excerpt: id }));
  const session: FocusSession = { id: "s", title: "回顾", goal: "复习", mode: "work", sourceConversationIds: ["source"], evidence, sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1, brief: { summary: "概况", turningPoints: [{ text: "转到控制理论", evidenceIds: evidence.map(item => item.id) }], confirmed: [], openQuestions: [] } };
  const open = vi.fn(); render(<FocusBrief session={session} zh onOpenEvidence={open} onChange={vi.fn()} />);
  expect(screen.getByText("回看讨论 · 2")).toBeInTheDocument(); expect(screen.queryByText("回看当时讨论")).toBeNull();
  fireEvent.click(screen.getByText("回看讨论 · 2")); fireEvent.click(screen.getByRole("button", { name: /2\. 控制理论/ })); expect(open).toHaveBeenCalledWith(evidence[1]);
});
