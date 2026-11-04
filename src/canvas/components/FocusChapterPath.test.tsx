import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusChapterPath } from "./FocusChapterPath";
import { ReaderGuide } from "./ReaderGuide";
import type { FocusSection } from "../../shared/focus-session";
import { projectSession } from "../../test/project-fixture";
import { projectStateSignature } from "../../shared/project-state";
afterEach(cleanup);
const section: FocusSection = { id: "a", title: "方案比较", body: "## 方案对比\n| 条件 | A | B |\n| --- | --- | --- |\n| 成本 | 低 | 高 |\n\n## 最终选择\n暂未选择，需要实物验证。", kind: "review", evidenceIds: ["e"], transition: "" };
it("renders a comparison only in the article, retaining its complete text and editable route", () => {
  const locate = vi.fn();
  render(<><FocusChapterPath editing section={section} project zh onSave={vi.fn()} onLocate={locate} /><ReaderGuide zh complete content={section.body} /></>);
  expect(screen.getAllByRole("table")).toHaveLength(1);
  expect(screen.getByRole("table")).toHaveTextContent("成本低高");
  expect(screen.queryByRole("heading", { name: "本章图解" })).toBeNull();
  fireEvent.click(screen.getByText("更多设置", { selector: ".chapter-understanding-settings > summary" }));
  fireEvent.click(screen.getByText("已有要点与顺序"));
  expect(screen.getByRole("button", { name: "最终选择" })).toBeVisible();
  expect(locate).not.toHaveBeenCalled();
});
it("keeps review personal-card maintenance through the same persistence callback", async () => {
  const mine = { ...section, title: "阅读要点", body: "", understandingPath: [{ id: "mine", title: "个人补充", body: "我的内容", transition: "", kind: "review" as const, evidenceIds: [], origin: "user" as const }] };
  const save = vi.fn(async () => undefined);
  render(<FocusChapterPath section={mine} zh onSave={save} onLocate={vi.fn()} />);
  fireEvent.click(screen.getByText("我的补充", { selector: "summary" }));
  fireEvent.click(screen.getByRole("button", { name: "个人补充 我的内容" }));
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "删除卡片" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith([]));
});

it("keeps the article uninterrupted without repeating its headings in a chapter guide", () => {
  const local = { ...section, title: "验证与采购", body: "## 实物验证\n亲自完成一个真实项目。\n## 采购范围\n只生成缺件清单。" };
  render(<><FocusChapterPath section={local} project zh onSave={vi.fn()} onLocate={vi.fn()} /><ReaderGuide content={local.body} zh complete /></>);
  expect(screen.queryByRole("region", { name: "本章导读" })).toBeNull();
  expect(screen.getAllByText("采购范围")).toHaveLength(1);
  expect(screen.getAllByText("只生成缺件清单。")).toHaveLength(1);
  expect(screen.queryByText("我的补充", { selector: "summary" })).toBeNull();
});

it("locates a uniquely sourced chapter module in the product instead of repeating its prose", () => {
  const session = projectSession(); session.sections[0].body = "## 需求采集\n需求采集提取目标与约束。";
  session.projectState!.signature = projectStateSignature(session);
  const onProjectModule = vi.fn();
  render(<FocusChapterPath section={session.sections[0]} session={session} project zh onSave={vi.fn()} onLocate={vi.fn()} onProjectModule={onProjectModule} />);
  const context = screen.getByRole("region", { name: "在产品中的位置" });
  expect(context).toHaveTextContent("输入层");
  expect(context).toHaveTextContent("目标与约束");
  fireEvent.click(screen.getByRole("button", { name: "方案生成" }));
  expect(onProjectModule).toHaveBeenCalledWith("module:plan");
  expect(screen.queryByRole("region", { name: "本章导读" })).toBeNull();
});

it("uses one local diagram instead of repeating product-location relationships", () => {
  const session = projectSession();
  session.sections[0].body = "## 需求采集\n职责：提取目标与约束。输出给方案生成。\n## 方案生成\n职责：组织候选方案。";
  session.projectState!.signature = projectStateSignature(session);
  render(<FocusChapterPath section={session.sections[0]} session={session} project zh onSave={vi.fn()} onLocate={vi.fn()} onProjectModule={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "本章图解" })).toBeVisible();
  expect(screen.queryByRole("region", { name: "在产品中的位置" })).toBeNull();
});
