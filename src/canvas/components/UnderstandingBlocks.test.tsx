import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { UnderstandingBlocks } from "./UnderstandingBlocks";
afterEach(cleanup);
const points = [{ id: "a", title: "安全边界", body: "只接受受支持的模块。", responsibility: "校验输入与电气边界。", transition: "", evidenceIds: ["e"], kind: "proposal" as const, phase: "技术架构" }];
it("keeps proposal status, original grouping and the source selection callback", () => {
  const read = vi.fn();
  render(<UnderstandingBlocks points={points} zh onRead={read} />);
  expect(screen.getByRole("heading", { name: "技术架构" })).toBeVisible();
  expect(screen.getByText("建议")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /安全边界/ }));
  expect(read).toHaveBeenCalledWith("a");
});
it("reveals review points only after recalling, without generating an invented answer", () => {
  render(<UnderstandingBlocks points={points} review zh onRead={vi.fn()} />);
  expect(screen.getByText("安全边界")).not.toBeVisible();
  fireEvent.click(screen.getByText("回想后查看要点"));
  expect(screen.getByText("安全边界")).toBeVisible();
});

it("does not style an ordinary explanation as a product version", () => {
  const { container } = render(<UnderstandingBlocks points={[{ ...points[0], title: "V0.1 核心流程" }, { ...points[0], id: "b", title: "实现原因" }]} kind="timeline" zh onRead={vi.fn()} />);
  expect(container.querySelectorAll(".understanding-version-points > .understanding-point-group > ol > li")).toHaveLength(1);
  expect(screen.getByText("实现原因")).not.toBeVisible();
  fireEvent.click(screen.getByText("补充要点 · 1"));
  expect(screen.getByText("实现原因")).toBeVisible();
});
