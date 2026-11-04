import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import * as exampleFixture from "../workspace-layout-example";
import { projectMatters } from "../../shared/project-matters";
import { linkMatterKnowledge, matterKnowledgeSignature } from "../../shared/project-knowledge-links";
import { WorkspaceLayoutExample } from "./WorkspaceLayoutExample";
const guards = vi.hoisted(() => ({ ai: vi.fn(), task: vi.fn(), db: vi.fn() }));
vi.mock("../../ai/project-history", () => ({ generateProjectHistory: guards.ai }));
vi.mock("../../storage/project-history-tasks", () => ({ readProjectHistoryTask: guards.task, markProjectHistoryReviewed: vi.fn() }));
vi.mock("../../storage/db", () => ({ getDatabase: guards.db }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.clearAllMocks(); });
const navigation = () => within(screen.getByRole("navigation", { name: "示例项目导航" }));
const noWork = () => { for (const guard of Object.values(guards)) expect(guard).not.toHaveBeenCalled(); };

it("shows the same document workflow as real projects without retired project modules", () => {
  const close = vi.fn(); render(<WorkspaceLayoutExample zh onClose={close}/>);
  expect(screen.getByRole("article", { name: "文档总览" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "Circuit Studio", level: 1 })).toBeVisible();
  for (const name of ["项目问答", "项目事项", "项目演进"]) expect(navigation().queryByRole("button", { name })).toBeNull();
  expect(screen.queryByLabelText("更多项目功能")).toBeNull();
  fireEvent.click(navigation().getByRole("button", { name: /产品定位$/ }));
  expect(screen.getByRole("article", { name: "Wiki 文档" })).toBeVisible();
  fireEvent.click(navigation().getByRole("button", { name: "文档总览" }));
  expect(screen.getByRole("article", { name: "文档总览" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "退出示例" })); expect(close).toHaveBeenCalledOnce(); noWork();
});

it("edits Wiki in memory without changing the fixture or reading real data", async () => {
  const before=structuredClone(exampleFixture.workspaceLayoutExample());
  const { unmount }=render(<WorkspaceLayoutExample zh onClose={vi.fn()}/>);
  fireEvent.click(navigation().getByRole("button", { name: /产品定位$/ }));
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  fireEvent.change(screen.getByRole("textbox", { name: "章节内容" }), { target: { value: "本次体验写下的说明" } });
  fireEvent.click(screen.getByRole("button", { name: "保存并结束编辑" }));
  expect(screen.getByText("本次体验写下的说明")).toBeVisible();
  expect(exampleFixture.workspaceLayoutExample()).toEqual(before);
  unmount(); render(<WorkspaceLayoutExample zh onClose={vi.fn()}/>);
  expect(screen.queryByText("本次体验写下的说明")).toBeNull(); noWork();
});

it("exports the document and traces its original discussion without AI calls", async () => {
  render(<WorkspaceLayoutExample zh onClose={vi.fn()}/>);
  fireEvent.click(screen.getByRole("button", { name: "导出" }));
  const dialog=await screen.findByRole("dialog", { name: "导出项目文件" });
  expect(within(dialog).getByRole("checkbox", { name: "项目总览" })).toBeChecked();
  expect(within(dialog).getByRole("checkbox", { name: "Wiki 章节" })).toBeChecked();
  expect(within(dialog).getByRole("combobox", { name: "文件格式" })).toHaveValue("md");
  fireEvent.click(within(dialog).getByRole("button", { name: "关闭导出" }));
  fireEvent.click(screen.getByRole("button", { name: "查看来源对话" }));
  fireEvent.click(screen.getByRole("button", { name: /^产品定位与首版范围/ }));
  await waitFor(()=>expect(screen.getByRole("dialog", { name: "原文依据" })).toHaveTextContent("我们想做 Circuit Studio")); noWork();
});

it("returns from chapter evidence to the current document", async () => {
  render(<WorkspaceLayoutExample zh onClose={vi.fn()}/>);
  fireEvent.click(navigation().getByRole("button", { name: /产品定位$/ }));
  fireEvent.click(within(screen.getByRole("article", { name: "Wiki 文档" })).getByRole("button", { name: /^(?:核对依据|原文已定位)/ }));
  await waitFor(()=>expect(screen.getByRole("dialog", { name: "原文依据" })).toHaveTextContent("我们想做 Circuit Studio"));
  fireEvent.click(screen.getByRole("button", { name: "关闭原文面板" }));
  expect(screen.getByRole("article", { name: "Wiki 文档" })).toBeVisible(); noWork();
});

it("preserves old linked conclusions and opens their original evidence without a matters workspace", async () => {
  const original=exampleFixture.workspaceLayoutExample(),matter=projectMatters(original).find(item=>item.text==="需求到操作计划的核心流程是否可用？")!;
  vi.spyOn(exampleFixture,"workspaceLayoutExample").mockImplementationOnce(()=>linkMatterKnowledge(original,matter,"example-architecture",matterKnowledgeSignature(matter)));
  render(<WorkspaceLayoutExample zh onClose={vi.fn()}/>);
  // Small Wikis expose chapters directly without group headings.
  fireEvent.click(navigation().getByRole("button", { name: /操作计划与校验$/ }));
  expect(screen.getByRole("heading", { name: "相关知识" })).toBeVisible();
  expect(screen.getByText(/已完成需求到操作计划的核心流程验证。/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "查看依据" }));
  await screen.findByRole("dialog", { name: "原文依据" });
  expect(navigation().queryByRole("button", { name: "项目事项" })).toBeNull(); noWork();
});
