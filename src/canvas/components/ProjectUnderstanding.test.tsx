import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSession } from "../../shared/focus-session";
import { ProjectUnderstanding } from "./ProjectUnderstanding";
import { projectSession } from "../../test/project-fixture";
afterEach(cleanup);
it("shows newly written personal explanations without requiring a second responsibility field", async () => {
  const local = { ...projectSession(), projectState: undefined, sections: [], projectUnderstanding: { order: [], nodes: [{ id: "personal-concept:new", title: "先验证实物", responsibility: "", personalExplanation: "记录软件方案与真实硬件的差异。", sectionIds: [], links: [] }] } };
  render(<ProjectUnderstanding adaptive complete session={local} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={vi.fn()} />);
  expect(screen.getByRole("button", { name: /先验证实物 记录软件方案与真实硬件的差异/ })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: /先验证实物 记录软件方案与真实硬件的差异/ }));
  fireEvent.click(within(screen.getByRole("region", { name: "结构详情" })).getByRole("button", { name: "编辑" }));
  expect(screen.getAllByRole("textbox")).toHaveLength(2);
  expect(screen.getByRole("textbox", { name: "详细说明" })).toHaveValue("记录软件方案与真实硬件的差异。");
});
it("prefills the visible explanation and keeps personal prose separate from original text", async () => {
  const save = vi.fn(async () => undefined);
  const item = { ...projectSession(), projectState: undefined, projectUnderstanding: { nodes: [{ id: "personal-concept:explanation", title: "方案草稿", responsibility: "", sectionIds: ["one"], links: [] }], order: [] } };
  // A source-backed node without an explicit responsibility still has its body.
  item.sections = [{ ...item.sections[0], title: "方案草稿", body: "已有说明：展示方案生成的输入和结果。" }];
  render(<ProjectUnderstanding session={item} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={save} />);
  fireEvent.click(screen.getByRole("button", { name: "调整结构" }));
  fireEvent.click(await screen.findByRole("button", { name: /^方案草稿 已有说明/ }));
  expect(screen.queryByRole("textbox", { name: "职责说明" })).toBeNull();
  expect(screen.getByRole("textbox", { name: "详细说明" })).toHaveValue("已有说明：展示方案生成的输入和结果。");
  fireEvent.change(screen.getByRole("textbox", { name: "详细说明" }), { target: { value: "我的额外理解" } });
  fireEvent.click(screen.getByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ nodes: expect.arrayContaining([expect.objectContaining({ personalExplanation: "我的额外理解" })]) })));
  expect(item.sections[0].body).toBe("已有说明：展示方案生成的输入和结果。");
});
const session: FocusSession = { id: "s", title: "产品设计", goal: "理解产品如何运作", mode: "work", sourceConversationIds: ["c"], evidence: [{ id: "e", conversationId: "c", messageId: "question", title: "方案讨论", excerpt: "当时如何生成方案？" }], sections: [
  { id: "one", title: "需求与方案", body: "## 需求理解\n职责：提取目标与约束。\n输出给方案生成。\n## 方案生成\n职责：组织候选方案。", kind: "review", evidenceIds: ["e"], transition: "" },
  { id: "two", title: "方案校验", body: "## 方案生成\n职责：组织候选方案。\n输出给规则校验。\n## 规则校验\n职责：核对限制。", kind: "review", evidenceIds: ["e"], transition: "" },
], activeSectionId: "one", completedSectionIds: [], notes: "", createdAt: 0, updatedAt: 0 };

it("removes the duplicate Wiki index without inventing a product architecture", () => {
  const sparse = { ...session, sections: Array.from({ length: 8 }, (_, i) => ({ ...session.sections[0], id: `s${i}`, title: `主题 ${i}`, body: `## 要点 ${i}\n说明第 ${i} 个主题。` })) };
  const read = vi.fn();
  const { container } = render(<ProjectUnderstanding adaptive complete session={sparse} zh onRead={read} onLocate={vi.fn()} />);
  expect(screen.queryByRole("heading", { name: "项目理解" })).toBeNull();
  expect(container.querySelectorAll("[data-point-id]")).toHaveLength(0);
  expect(container.querySelector(".diagram-shell")).toBeNull();
  expect(screen.queryByRole("button", { name: "查看结构" })).toBeNull();
  expect(screen.queryByText("说明第 0 个主题。")).toBeNull();
  expect(screen.queryByText(/Wiki 主题/)).toBeNull();
  expect(screen.queryByRole("button", { name: /主题 7/ })).toBeNull();
  expect(screen.getByText(/尚未形成可核对的产品架构/)).toBeVisible();
  expect(read).not.toHaveBeenCalled();
});

it("deletes a personal concept through the editor and keeps the draft when saving fails", async () => {
  const save = vi.fn(async () => { throw new Error("storage failed"); });
  const personal = { ...session, projectUnderstanding: { order: [], nodes: [{ id: "personal-concept:mine", title: "我的测试卡片", responsibility: "我的说明", sectionIds: [], links: [] }] } };
  render(<ProjectUnderstanding adaptive complete session={personal} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={save} />);
  fireEvent.click(await screen.findByRole("button", { name: /我的测试卡片/ }));
  fireEvent.click(within(screen.getByRole("region", { name: "结构详情" })).getByRole("button", { name: "编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "删除卡片" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith({ order: [], nodes: [] }));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "要点标题" })).toHaveValue("我的测试卡片");
});

it("opens the same concept's multiple chapters and cited discussions without silently navigating on selection", async () => {
  const read = vi.fn(), locate = vi.fn();
  render(<ProjectUnderstanding session={session} zh onRead={read} onLocate={locate} onSave={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^方案生成 组织候选方案/ }));
  expect(read).not.toHaveBeenCalled();
  const detail = screen.getByRole("region", { name: "结构详情" });
  expect(detail).toHaveTextContent("输出给");
  fireEvent.click(await within(detail).findByRole("button", { name: "方案校验 阅读章节 →" }));
  expect(read).toHaveBeenCalledWith("two");
  fireEvent.click(within(detail).getByText("相关讨论 · 1"));
  fireEvent.click(await within(detail).findByRole("button", { name: "方案讨论 · 当时如何生成方案？" }));
  expect(locate).toHaveBeenCalledWith(session.evidence[0]);
});

it("shows a long project's core modules first and makes every nested concept reachable", async () => {
  const long = { ...session, sections: Array.from({ length: 12 }, (_, i) => ({ ...session.sections[0], id: `s${i}`, title: `章节 ${i}`, phase: i < 6 ? "产品模块" : "验证模块", body: `## 概念 ${i}\n职责：解决第 ${i} 个问题。` })) };
  const { container } = render(<ProjectUnderstanding session={long} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={vi.fn()} />);
  expect(container.querySelectorAll("[data-route-id]")).toHaveLength(2);
  fireEvent.click(await screen.findByRole("button", { name: /^产品模块/ }));
  expect(container.querySelectorAll("[data-route-id]")).toHaveLength(8);
  expect(await within(screen.getByRole("region", { name: "结构图" })).findByRole("button", { name: /^概念 5/ })).toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "返回整体" }));
  fireEvent.click(await screen.findByRole("button", { name: /^验证模块/ }));
  expect(await within(screen.getByRole("region", { name: "结构图" })).findByRole("button", { name: /^概念 11/ })).toBeInTheDocument();
  expect(long.sections.map(section => section.id)).toEqual(Array.from({ length: 12 }, (_, i) => `s${i}`));
});

it("keeps personal drafts on save failure, with chapter associations and labelled relation targets", async () => {
  const save = vi.fn(async () => { throw new Error("storage failed"); });
  render(<ProjectUnderstanding session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "调整结构" }));
  fireEvent.click(await screen.findByRole("button", { name: /^方案生成 组织候选方案/ }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "编辑理解" })).getByText("更多设置"));
  fireEvent.change(screen.getByRole("textbox", { name: "职责说明" }), { target: { value: "我的职责" } });
  fireEvent.click(screen.getByText("关联章节", { selector: "summary" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "需求与方案" }));
  fireEvent.click(screen.getByText("个人添加的关系", { selector: "summary" }));
  fireEvent.click(await screen.findByRole("button", { name: "+ 关系" }));
  fireEvent.change(screen.getByRole("combobox", { name: "关系 1" }), { target: { value: "feedback" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ nodes: [expect.objectContaining({ responsibility: "我的职责", sectionIds: ["two"], links: [expect.objectContaining({ targetTitle: "需求理解", kind: "feedback" })] })] })));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "职责说明" })).toHaveValue("我的职责");
});

it("shows all branches immediately in complete architecture mode", async () => {
  const long = { ...session, sections: Array.from({ length: 12 }, (_, i) => ({ ...session.sections[0], id: `s${i}`, title: `章节 ${i}`, phase: i < 6 ? "产品模块" : "验证模块", body: `## 概念 ${i}\n职责：解决第 ${i} 个问题。` })) };
  const before = structuredClone(long);
  const { container } = render(<ProjectUnderstanding complete session={long} zh onRead={vi.fn()} onLocate={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "项目主题结构" })).toBeVisible();
  expect(container.querySelectorAll("[data-route-id]")).toHaveLength(14);
  expect(await within(screen.getByRole("region", { name: "结构图" })).findByRole("button", { name: /^概念 11/ })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "调整结构" })).not.toBeInTheDocument();
  expect(long).toEqual(before);
});

it("shows explicit module decisions in place and preserves the diagram when a module is selected", async () => {
  const item = projectSession(), locate = vi.fn();
  item.projectState!.decisions.push({ id: "input-choice", text: "需求采集先保留明确约束。", reason: "避免在方案生成时丢失用户边界。", quote: "需求采集先保留明确约束。", status: "documented", evidenceIds: ["e1"] });
  const { container } = render(<ProjectUnderstanding complete session={item} zh onRead={vi.fn()} onLocate={locate} />);
  const before = [...container.querySelectorAll("[data-route-id]")];
  fireEvent.click(await within(screen.getByRole("region", { name: "结构图" })).findByRole("button", { name: /^需求采集/ }));
  const detail = screen.getByRole("region", { name: "结构详情" });
  expect(within(detail).getByRole("heading", { name: "为什么这样设计" })).toBeVisible();
  expect(detail).toHaveTextContent("避免在方案生成时丢失用户边界");
  // A shared source does not make every project decision belong to this module.
  expect(detail).not.toHaveTextContent("降低验证成本");
  expect([...container.querySelectorAll("[data-route-id]")]).toEqual(before);
  fireEvent.click(await within(detail).findByRole("button", { name: "阅读依据 · 规划讨论" }));
  expect(locate).toHaveBeenCalledWith(item.evidence[0]);
});


it("edits concepts and relationships in the full workspace and retains a failed draft after returning", async () => {
 const save = vi.fn(async () => { throw new Error("storage failed"); });
 render(<ProjectUnderstanding session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={save} />);
 const opener = await screen.findByRole("button", { name: "打开完整图" });
 fireEvent.click(opener);
 const full = screen.getByRole("dialog", { name: "项目结构图" });
 fireEvent.click(await within(full).findByRole("button", { name: "调整结构" }));
 fireEvent.click(await within(full).findByRole("button", { name: /^方案生成 组织候选方案/ }));
 fireEvent.click(within(screen.getByRole("dialog", { name: "编辑理解" })).getByText("更多设置"));
 fireEvent.change(screen.getByRole("textbox", { name: "职责说明" }), { target: { value: "保留我的方案职责" } });
 fireEvent.click(screen.getByText("个人添加的关系", { selector: "summary" }));
 fireEvent.click(await screen.findByRole("button", { name: "+ 关系" }));
 fireEvent.change(screen.getByRole("combobox", { name: "关系 1" }), { target: { value: "feedback" } });
 fireEvent.click(await screen.findByRole("button", { name: "保存" }));
 expect(await screen.findByRole("alert")).toBeVisible();
 fireEvent.click(await within(full).findByRole("button", { name: "返回阅读" }));
 expect(screen.queryByRole("dialog")).toBeNull();
 expect(screen.queryByRole("textbox", { name: "职责说明" })).toBeNull();
 fireEvent.click(opener);
 fireEvent.click(await within(screen.getByRole("dialog", { name: "项目结构图" })).findByRole("button", { name: "调整结构" }));
 fireEvent.click(within(screen.getByRole("dialog", { name: "编辑理解" })).getByText("更多设置"));
 expect(screen.getByRole("textbox", { name: "职责说明" })).toHaveValue("保留我的方案职责");
 expect(screen.getByRole("combobox", { name: "关系 1" })).toHaveValue("feedback");
 fireEvent.keyDown(screen.getByRole("dialog", { name: "项目结构图" }), { key: "Escape" });
 expect(screen.queryByRole("dialog")).toBeNull();
 await waitFor(() => expect(opener).toHaveFocus());
});

it("shows every concept in a long full diagram then returns to the compact branch preview", async () => {
 const long = { ...session, sections: Array.from({ length: 12 }, (_, i) => ({ ...session.sections[0], id: `s${i}`, title: `章节 ${i}`, phase: i < 6 ? "产品模块" : "验证模块", body: `## 概念 ${i}\n职责：解决第 ${i} 个问题。` })) };
 const { container } = render(<ProjectUnderstanding session={long} zh onRead={vi.fn()} onLocate={vi.fn()} />);
 expect(container.querySelectorAll("[data-route-id]")).toHaveLength(2);
 fireEvent.click(await screen.findByRole("button", { name: "打开完整图" }));
 expect(screen.getByRole("dialog").querySelectorAll("[data-route-id]")).toHaveLength(14);
 fireEvent.click(await screen.findByRole("button", { name: "返回阅读" }));
 expect(container.querySelectorAll("[data-route-id]")).toHaveLength(2);
});

it("edits the selected concept directly while keeping the diagram visible and retaining a closed draft", async () => {
  const { container } = render(<ProjectUnderstanding session={session} zh onRead={vi.fn()} onLocate={vi.fn()} onSave={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /^方案生成 组织候选方案/ }));
  const nodes = [...container.querySelectorAll("[data-route-id]")];
  fireEvent.click(within(screen.getByRole("region", { name: "结构详情" })).getByRole("button", { name: "编辑" }));
  expect([...container.querySelectorAll("[data-route-id]")]).toEqual(nodes);
  fireEvent.click(within(screen.getByRole("dialog", { name: "编辑理解" })).getByText("更多设置"));
  fireEvent.change(screen.getByRole("textbox", { name: "职责说明" }), { target: { value: "暂存我的说明" } });
  fireEvent.click(screen.getByRole("button", { name: "关闭理解编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "调整结构" }));
  fireEvent.click(within(screen.getByRole("dialog", { name: "编辑理解" })).getByText("更多设置"));
  expect(screen.getByRole("textbox", { name: "职责说明" })).toHaveValue("暂存我的说明");
});
