import "fake-indexeddb/auto";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { projectSession } from "../../test/project-fixture";
import { HomeRecallAnswer } from "./HomeRecallAnswer";
afterEach(cleanup);
it("reuses a citation number and expands its source alongside the selected section", () => {
  const answer = { ...projectSession(), sections: ["one", "two"].map(id => ({ id, title: id, body: "结论。", kind: "finding" as const, transition: "", evidenceIds: ["e"] })), evidence: [{ id: "e", title: "讨论", conversationId: "c", messageId: "m", excerpt: "**原始依据**" }] };
  render(<HomeRecallAnswer answer={answer} zh onLocate={vi.fn()} />);
  fireEvent.click(screen.getAllByRole("button", {name:"展开依据 1"})[0]);
  const first = screen.getByRole("heading", {name:"one"}).closest("section")!;
  expect(within(first).getByRole("complementary", {name:"依据预览"})).toBeInTheDocument();
  expect(screen.getByRole("heading", {name:"two"}).closest("section")?.querySelector("aside")).toBeNull();
  expect(screen.queryByRole("button", {name:"展开依据 2"})).not.toBeInTheDocument();
});
it("keeps different retained versions of the same message as distinct sources", () => {
  const answer = { ...projectSession(), sections: [{ id: "one", title: "版本变化", body: "历史方案不同。", kind: "finding" as const, transition: "", evidenceIds: ["old", "new"] }], evidence: ["old", "new"].map(id => ({ id, title: id, conversationId: "c", messageId: "m", excerpt: id, sourceVersionId: id })) };
  render(<HomeRecallAnswer answer={answer} zh onLocate={vi.fn()} />);
  expect(screen.getByRole("button", {name:"展开依据 1"})).toHaveAttribute("title", "old"); expect(screen.getByRole("button", {name:"展开依据 2"})).toHaveAttribute("title", "new");
});
