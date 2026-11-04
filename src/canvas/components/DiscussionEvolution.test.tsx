import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiscussionEvolution } from "./DiscussionEvolution";
import { overviewModel } from "../overview-model";
import type { FocusSession } from "../../shared/focus-session";
afterEach(cleanup);
const source = { id: "e", conversationId: "c", messageId: "m7", title: "原始讨论", excerpt: "修正方案" };
const session: FocusSession = { id: "s", goal: "复习", title: "讨论", mode: "review", sections: [], sourceConversationIds: ["c"], evidence: [source], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 0, updatedAt: 0, brief: { summary: "讨论经过。", turningPoints: [{ text: "预算变化后修正方案[e1]。", evidenceIds: ["e"] }], confirmed: [], openQuestions: [] }, sourceOutlines: [{ conversationId: "c", chapters: Array.from({ length: 61 }, (_, index) => ({ id: `stage-${index}`, title: `阶段内容 ${index}`, summary: `讨论第 ${index} 项。`, messageIds: [`m${index}`] })) }] };

it("attaches sourced turns to their actual stage and preserves the entire discussion order", () => {
  const model = overviewModel(session, true), read = vi.fn(), locate = vi.fn();
  expect(model.milestones).toEqual([{ stageId: "stage-7", kind: "turn", text: "预算变化后修正方案。", evidence: source }]);
  render(<DiscussionEvolution orientation={model} zh onRead={read} onLocate={locate} />);
  expect(screen.getAllByText("转折")).toHaveLength(1);
  expect(document.querySelectorAll(".overview-evolution > li")).toHaveLength(61);
  expect(screen.queryByRole("region", { name: "阶段详情" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "逐步回顾" }));
  for (let index = 0; index < 7; index++) fireEvent.click(screen.getByRole("button", { name: "下一步" }));
  expect(screen.getByRole("region", { name: "阶段详情" })).toHaveTextContent("预算变化后修正方案。");
  expect(within(screen.getByRole("region", { name: "阶段详情" })).getByText("讨论第 7 项。")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "收起讨论依据" }));
  expect(screen.getByRole("region", { name: "阶段详情", hidden: true })).not.toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "展开讨论依据" }));
  expect(screen.getByRole("region", { name: "阶段详情" })).toHaveTextContent("讨论第 7 项。");
  expect(screen.queryByText("阶段详情")).toBeNull();
  expect(locate).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "回看讨论" })); expect(locate).toHaveBeenCalledWith(source);
  fireEvent.click(screen.getByRole("button", { name: "查看全程" }));
  const list = document.querySelector(".overview-evolution")!;
  expect(within(list as HTMLElement).getAllByRole("button", { hidden: true }).map(button => button.textContent)).toEqual(session.sourceOutlines![0].chapters.map(chapter => chapter.title));
});

it("opens any stage directly with its complete text, without a duplicate preview card", () => {
  const long = { ...session, sourceOutlines: [{ ...session.sourceOutlines![0], chapters: session.sourceOutlines![0].chapters.map((chapter, index) => index === 60 ? { ...chapter, summary: "阶段开头。\n\n" + "完整条件保留。".repeat(180) } : chapter) }] };
  render(<DiscussionEvolution orientation={overviewModel(long, true)} zh onRead={vi.fn()} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "阶段内容 60" }));
  expect(screen.getByText("61 / 61")).toBeVisible();
  const detail = screen.getByRole("region", { name: "阶段详情" });
  expect(detail).toHaveTextContent("完整条件保留。".repeat(180));
  expect(within(detail).getAllByText("阶段开头。")).toHaveLength(1);
  expect(within(detail).queryByText("阶段详情")).toBeNull();
  expect(screen.queryByRole("button", { name: "展开完整导读" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "查看全程" }));
  expect(screen.queryByRole("region", { name: "阶段详情" })).toBeNull();
});

it("does not assign a turn to a guessed chapter when its citation covers several chapters", () => {
  const ambiguous: FocusSession = { ...session, sourceOutlines: [{ conversationId: "c", chapters: session.sourceOutlines![0].chapters.map(chapter => ({ ...chapter, messageIds: ["m7"] })) }] };
  expect(overviewModel(ambiguous, true).milestones).toEqual([]);
  expect(ambiguous.brief?.turningPoints).toHaveLength(1);
});
