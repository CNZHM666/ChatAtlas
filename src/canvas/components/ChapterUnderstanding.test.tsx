import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSection } from "../../shared/focus-session";
import { ChapterUnderstanding } from "./ChapterUnderstanding";
import { saveRouteCard } from "../focus-route";

afterEach(cleanup);
const point: FocusSection = { id: "old", title: "原有要点", body: "完整说明。\n第二段包含条件。", transition: "已有衔接", phase: "原有分组", responsibility: "简短职责", evidenceIds: ["e1"], kind: "review", origin: "user", understandingLinks: [{ targetId: "other", kind: "comparison" }] };
const other = { ...point, id: "other", title: "另一个要点", origin: undefined, understandingLinks: [], body: "" };
const props = { zh: true, project: true, evidence: [], onRead: vi.fn() };
it("replaces the old chapter wall with collapsed notes and hides empty derived cards", () => {
  const { container } = render(<ChapterUnderstanding {...props} sections={[{ ...point, understandingLinks: [] }, other]} onSave={vi.fn()} />);
  expect(container.querySelector(".route-adjusting")).toBeNull();
  expect(container.querySelector(".route-card-editor")).toBeNull();
  expect(container.querySelector(".chapter-personal-notes")).not.toHaveAttribute("open");
  expect(screen.queryByRole("button", { name: /另一个要点/ })).toBeNull();
  expect(screen.queryByText("拖动调整阅读顺序")).toBeNull();
});
it("adds a note using explanation alone, with only two fields initially and no empty new card", async () => {
  const save = vi.fn(async () => undefined);
  render(<ChapterUnderstanding {...props} sections={[other]} onSave={save} />);
  fireEvent.click(screen.getByText("我的补充", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "+ 补充理解" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "仅标题" } });
  expect(screen.getByRole("button", { name: "保存" })).toBeDisabled();
  fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "" } });
  fireEvent.change(screen.getByRole("textbox", { name: "说明" }), { target: { value: "先验证实物闭环。再记录偏差。" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "先验证实物闭环。", body: "先验证实物闭环。再记录偏差。", transition: "" })));
});
it("prefills the complete text and preserves hidden metadata and source ids on a simple edit", async () => {
  const before = structuredClone(point), save = vi.fn(async draft => { const result = saveRouteCard([point, other], draft); expect(result[0]).toMatchObject({ transition: point.transition, phase: point.phase, responsibility: point.responsibility, understandingLinks: point.understandingLinks, evidenceIds: ["e1"] }); });
  render(<ChapterUnderstanding {...props} sections={[point, other]} onSave={save} />);
  fireEvent.click(screen.getByText("我的补充", { selector: "summary" }));
  fireEvent.click(within(document.querySelector(".chapter-personal-notes")! as HTMLElement).getByRole("button", { name: /^原有要点/ }));
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  expect(screen.getByRole("textbox", { name: "说明" })).toHaveValue(point.body);
  expect(screen.queryByRole("textbox", { name: "职责说明" })).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "名称" }), { target: { value: "我的新名称" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  expect(point).toEqual(before);
});
it("keeps failed drafts and exposes personal relationships only on demand", async () => {
  const save = vi.fn(async () => { throw new Error("storage failed"); });
  render(<ChapterUnderstanding {...props} sections={[point, other]} onSave={save} />);
  fireEvent.click(screen.getByText("我的补充", { selector: "summary" }));
  fireEvent.click(within(document.querySelector(".chapter-personal-notes")! as HTMLElement).getByRole("button", { name: /^原有要点/ })); fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "说明" }), { target: { value: "我的修改" } });
  fireEvent.click(within(screen.getByRole("dialog")).getByText("更多设置"));
  expect(screen.getByRole("combobox", { name: "关系 1" })).toHaveValue("comparison");
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "说明" })).toHaveValue("我的修改");
});
it("preserves every old point and supports explicit ordering without creating relations", async () => {
  const move = vi.fn(async () => undefined), before = structuredClone([point, other]);
  render(<ChapterUnderstanding {...props} sections={[point, other]} onSave={vi.fn()} onMove={move} />);
  fireEvent.click(screen.getByText("更多设置", { selector: ".chapter-understanding-settings > summary" }));
  fireEvent.click(screen.getByText("已有要点与顺序"));
  fireEvent.click(screen.getByRole("button", { name: "下移 原有要点" }));
  await waitFor(() => expect(move).toHaveBeenCalledWith("old", undefined));
  expect([point, other]).toEqual(before);
});
