import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusUnderstandingPath } from "./FocusUnderstandingPath";
it("displays full chapter labels, retaining double-digit numbers and personal wording", async () => {
  const title = "当前市场缺乏能将线性 AI 对话转化为基于知识依赖关系而非聊天顺序的结构化图谱工具。";
  const items = Array.from({ length: 11 }, (_, index) => ({ id: String(index), title: index === 10 ? title : `步骤 ${index + 1}`, body: "", transition: "", evidenceIds: [], kind: "review" as const }));
  const { container } = render(<FocusUnderstandingPath sections={items} activeId="10" zh chapter onRead={vi.fn()} />);
  expect(await screen.findByRole("button", { name: `11 ${title}` }, { timeout: 5000 })).toBeInTheDocument();
  expect(container.querySelectorAll(".route-card-number")[10]).toHaveTextContent(/^11$/);
  expect(container.querySelectorAll(".route-card-label strong")[10]).toHaveTextContent(title);
});
import type { FocusSection } from "../../shared/focus-session";
afterEach(cleanup);
const sections: FocusSection[] = ["矩阵", "极点", "稳定性"].map((title, index) => ({ id: `${index}`, title, body: "", transition: "", evidenceIds: [], kind: "review" }));
it("numbers visible chapter concepts continuously while retaining the opening paragraph in the editor", async () => {
  const introduction = { ...sections[0], id: "chapter-step:chapter:body", title: "介绍段" };
  const read = vi.fn();
  const { container } = render(<FocusUnderstandingPath sections={[introduction, ...sections]} activeId="0" zh chapter onRead={read} onSave={vi.fn()} />);
  expect([...container.querySelectorAll(".route-card-number")].map(item => item.textContent)).toEqual(["1", "2", "3"]);
  fireEvent.click(await screen.findByRole("button", { name: "1 矩阵" }));
  expect(read).toHaveBeenCalledWith("0");
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  expect(await screen.findByRole("button", { name: "1 介绍段" })).toBeVisible();
});
it("enables drag only after adjustment and moves a card by dropping after another", async () => {
  const move = vi.fn(async () => undefined);
  const { container } = render(<FocusUnderstandingPath sections={sections} activeId="0" zh onRead={vi.fn()} onSave={vi.fn()} onMove={move} />);
  expect(container.querySelector("li")?.draggable).toBe(false);
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  const cards = container.querySelectorAll("li"), transfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
  fireEvent.dragStart(cards[0], { dataTransfer: transfer });
  fireEvent.dragOver(container.querySelector(".route-drop-end")!, { dataTransfer: transfer }); fireEvent.drop(container.querySelector(".route-drop-end")!, { dataTransfer: transfer });
  await waitFor(() => expect(move).toHaveBeenCalledWith("0", undefined));
  expect(screen.queryByRole("combobox", { name: "插入位置" })).toBeNull();
});
it("keeps a failed editor draft and supports keyboard reordering", async () => {
  const save = vi.fn(async () => { throw new Error("storage failure"); }), move = vi.fn(async () => undefined);
  render(<FocusUnderstandingPath sections={sections} activeId="0" zh onRead={vi.fn()} onSave={save} onMove={move} />);
  expect(screen.queryByRole("button", { name: "+ 理解卡片" })).not.toBeInTheDocument();
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  fireEvent.click(await screen.findByRole("button", { name: "+ 理解卡片" })); fireEvent.change(screen.getByRole("textbox", { name: "理解卡片标题" }), { target: { value: "自己的推理" } }); fireEvent.change(screen.getByRole("textbox", { name: "理解卡片内容" }), { target: { value: "自己的理解说明" } }); fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  expect(await screen.findByRole("alert")).toBeVisible(); expect(screen.getByRole("textbox", { name: "理解卡片标题" })).toHaveValue("自己的推理");
  fireEvent.click(await screen.findByRole("button", { name: "取消" }));
  fireEvent.keyDown(await screen.findByRole("button", { name: /1 矩阵/ }), { key: "ArrowRight", altKey: true });
  await waitFor(() => expect(move).toHaveBeenCalledWith("0", "2"));
});

it("supports direct pointer dragging from the visible grip", async () => {
  const move = vi.fn(async () => undefined);
  const { container } = render(<FocusUnderstandingPath sections={sections} activeId="0" zh onRead={vi.fn()} onSave={vi.fn()} onMove={move} />);
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  const grip = await screen.findByRole("button", { name: "拖动 矩阵" });
  const previous = Object.getOwnPropertyDescriptor(document, "elementFromPoint");
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: () => container.querySelector(".route-drop-end") });
  try {
    fireEvent(grip, new MouseEvent("pointerdown", { bubbles: true, button: 0 }));
    fireEvent(grip, new MouseEvent("pointermove", { bubbles: true, clientX: 20, clientY: 20 }));
    fireEvent(grip, new MouseEvent("pointerup", { bubbles: true, clientX: 20, clientY: 20 }));
    await waitFor(() => expect(move).toHaveBeenCalledWith("0", undefined));
  } finally { if (previous) Object.defineProperty(document, "elementFromPoint", previous); else Reflect.deleteProperty(document, "elementFromPoint"); }
});

it("separates the grouped reading order from vertical concept relationships", async () => {
  const read = vi.fn();
  const items = [{ ...sections[0], phase: "基础" }, { ...sections[1], phase: "基础" }, { ...sections[2], phase: "实践" }];
  const { container, rerender } = render(<FocusUnderstandingPath sections={items} activeId="0" zh onRead={read} />);
  expect(screen.getByText("基础")).toBeInTheDocument();
  expect(container.querySelector(".understanding-arrow")).toBeNull();
  const chapter = [{ ...sections[0], phase: undefined }, { ...sections[1], phase: "矩阵", body: "基于矩阵，计算特征值。" }, { ...sections[2], phase: "极点" }];
  rerender(<FocusUnderstandingPath sections={chapter} activeId="0" zh chapter rootTitle="如何判断稳定性？" onRead={read} />);
  expect(screen.queryByText("如何判断稳定性？")).not.toBeInTheDocument();
  expect(container.querySelectorAll(".concept-map-level")).toHaveLength(3);
  expect(container.querySelectorAll(".route-card-main")).toHaveLength(3);
  fireEvent.click(await screen.findByRole("button", { name: /2 极点/ }));
  expect(read).toHaveBeenCalledWith("1");
});

it("allows opening every group of a long route and switches to the complete editable order", async () => {
  const items = Array.from({ length: 12 }, (_, index) => ({ ...sections[0], id: `${index}`, title: `章节 ${index + 1}` }));
  const { container } = render(<FocusUnderstandingPath sections={items} activeId="0" zh onRead={vi.fn()} onSave={vi.fn()} />);
  const groups = container.querySelectorAll<HTMLDetailsElement>(".route-reading-group");
  expect(groups).toHaveLength(3);
  expect(groups[1].open).toBe(false);
  fireEvent.click(groups[1].querySelector("summary")!);
  expect(groups[1].open).toBe(true);
  expect(await within(groups[1]).findByRole("button", { name: "8 章节 8" })).toBeVisible();
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  expect(container.querySelectorAll(".route-adjusting li")).toHaveLength(12);
});

it("edits a personal group and relation locally, keeping them on retry", async () => {
  const save = vi.fn(async () => undefined);
  render(<FocusUnderstandingPath sections={sections} activeId="0" zh chapter onRead={vi.fn()} onSave={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑 矩阵" }));
  fireEvent.click(screen.getByText("更多设置", { selector: "summary" }));
  fireEvent.change(screen.getByRole("textbox", { name: "所属分组" }), { target: { value: "系统基础" } });
  fireEvent.click(await screen.findByRole("button", { name: "+ 关系" }));
  fireEvent.change(screen.getByRole("combobox", { name: "关系 1" }), { target: { value: "comparison" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: "0", phase: "系统基础", links: [{ targetId: "1", kind: "comparison" }] })));
});

it("explains project flows without changing the reading order and opens only cited discussions", async () => {
  const read = vi.fn(), locate = vi.fn();
  const evidence = [{ id: "e1", conversationId: "source", messageId: "question", title: "讨论来源", excerpt: "原始问题" }];
  const items = [{ ...sections[0], title: "规则校验", body: "职责：检查边界条件。\n将问题反馈至方案生成。", evidenceIds: ["e1"] }, { ...sections[1], title: "需求理解", body: "输出给方案生成。" }, { ...sections[2], title: "方案生成", body: "将候选方案输出给规则校验。" }];
  const { container } = render(<FocusUnderstandingPath projectStructure rootTitle="硬件平台" sections={items} activeId="0" zh onRead={read} evidence={evidence} onLocate={locate} completedIds={["0"]} />);
  expect(container.querySelector(".concept-map-canvas")).toBeInTheDocument();
  fireEvent.click(container.querySelector('[data-route-id="0"] .route-card-main')!);
  expect(read).toHaveBeenCalledWith("0"); read.mockClear();
  fireEvent.click(await screen.findByRole("button", { name: "查看关系" }));
  expect(container.querySelectorAll(".concept-map-level .route-card-label strong")[0]).toHaveTextContent("需求理解");
  fireEvent.click(container.querySelector('[data-route-id="0"] .route-card-main')!);
  expect(read).not.toHaveBeenCalled();
  const detail = screen.getByRole("region", { name: "结构详情" });
  expect(within(detail).getByText("正文职责")).toBeVisible();
  expect(within(detail).getByText("将问题反馈至方案生成。")).toBeVisible();
  expect(within(detail).queryByText("已确认")).toBeNull();
  fireEvent.click(within(detail).getByText(/相关讨论/));
  fireEvent.click(await within(detail).findByRole("button", { name: /讨论来源/ }));
  expect(locate).toHaveBeenCalledWith(evidence[0]);
  fireEvent.click(await within(detail).findByRole("button", { name: "阅读章节" }));
  expect(read).toHaveBeenCalledWith("0");
  fireEvent.click(await within(detail).findByRole("button", { name: "取消聚焦" }));
  expect(screen.queryByRole("region", { name: "结构详情" })).toBeNull();
  fireEvent.click(await screen.findByRole("button", { name: "返回路线" }));
  expect(items.map(item => item.title)).toEqual(["规则校验", "需求理解", "方案生成"]);
  expect(container.querySelector('[data-route-id="0"] .route-card-number')).toHaveTextContent("1");
  expect(container.querySelector('[data-route-id="1"] .route-card-number')).toHaveTextContent("2");
  expect(screen.queryByRole("region", { name: "结构详情" })).toBeNull();
});

it("shows a long overview as a compact skeleton and opens chapters directly without changing personal edits", async () => {
  const read = vi.fn();
  const items = Array.from({ length: 13 }, (_, index) => ({ ...sections[0], id: String(index), title: `章节 ${index + 1}`, phase: "我的学习路径", origin: "user" as const }));
  const { container } = render(<FocusUnderstandingPath projectStructure rootTitle="学习计划" sections={items} activeId="10" zh onRead={read} onSave={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "整体理解路线" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "查看关系" })).toBeNull();
  expect(container.querySelectorAll(".concept-map-canvas")).toHaveLength(0);
  const groups = container.querySelectorAll<HTMLDetailsElement>(".overview-map-group");
  expect(groups).toHaveLength(4);
  expect([...groups].every(group => !group.open)).toBe(true);
  fireEvent.click(groups[2].querySelector("summary")!);
  expect(await within(groups[2]).findByRole("button", { name: "11 章节 11 我的理解" })).toBeVisible();
  fireEvent.click(await within(groups[2]).findByRole("button", { name: "11 章节 11 我的理解" }));
  expect(read).toHaveBeenCalledWith("10");
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  expect([...container.querySelectorAll(".route-adjusting [data-route-id]")].map(item => item.getAttribute("data-route-id"))).toEqual(items.map(item => item.id));
});

it("keeps cross-group personal relations and rejects dependencies ambiguous in the full project", async () => {
  const read = vi.fn();
  const items = [
    { ...sections[0], title: "基础", phase: "起点", understandingLinks: [{ targetId: "2", kind: "comparison" as const }] },
    { ...sections[1], title: "方案", phase: "起点", body: "基于基础，制定方案。" },
    { ...sections[2], title: "基础", phase: "实践" },
  ];
  const { container } = render(<FocusUnderstandingPath projectStructure sections={items} activeId="0" zh onRead={read} />);
  const group = container.querySelector(".overview-map-group")!;
  fireEvent.click(group.querySelector("summary")!);
  expect(group.querySelector(".concept-map-accessible-relations")).toBeEmptyDOMElement();
  fireEvent.click(container.querySelector(".overview-map-crossings summary")!);
  const relation = container.querySelector(".overview-map-crossings li")!;
  expect(relation).toHaveTextContent("比较"); expect(relation).toHaveTextContent("我的关系");
  fireEvent.click(within(relation as HTMLElement).getAllByRole("button")[1]);
  expect(read).toHaveBeenCalledWith("2");
});

it("saves personal module responsibilities and feedback at project level, retaining a failed draft", async () => {
  const save = vi.fn(async () => { throw new Error("save failed"); });
  render(<FocusUnderstandingPath projectStructure sections={sections} activeId="0" zh onRead={vi.fn()} onSave={save} />);
  fireEvent.click(await screen.findByRole("button", { name: "调整路线" }));
  fireEvent.click(await screen.findByRole("button", { name: "编辑 矩阵" }));
  fireEvent.click(screen.getByText("更多设置", { selector: "summary" }));
  fireEvent.change(screen.getByRole("textbox", { name: "职责说明" }), { target: { value: "描述系统状态" } });
  fireEvent.click(await screen.findByRole("button", { name: "+ 关系" }));
  fireEvent.change(screen.getByRole("combobox", { name: "关系 1" }), { target: { value: "feedback" } });
  fireEvent.click(await screen.findByRole("button", { name: "保存" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ responsibility: "描述系统状态", links: [{ targetId: "1", kind: "feedback" }] })));
  expect(await screen.findByRole("alert")).toBeVisible();
  expect(screen.getByRole("textbox", { name: "职责说明" })).toHaveValue("描述系统状态");
});


it("opens a full chapter diagram, saves personal edits there, and returns when locating a point", async () => {
 const save = vi.fn(async () => undefined), read = vi.fn();
 render(<FocusUnderstandingPath sections={sections} activeId="" zh chapter rootTitle="稳定性复习" onRead={read} onSave={save} />);
 fireEvent.click(await screen.findByRole("button", { name: "打开完整图" }));
 const full = screen.getByRole("dialog", { name: "稳定性复习" });
 fireEvent.click(await within(full).findByRole("button", { name: "调整路线" }));
 fireEvent.click(await within(full).findByRole("button", { name: "编辑 矩阵" }));
 fireEvent.change(screen.getByRole("textbox", { name: "理解卡片标题" }), { target: { value: "我的矩阵要点" } });
 fireEvent.click(await screen.findByRole("button", { name: "保存" }));
 await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ title: "我的矩阵要点" })));
 await waitFor(() => expect(screen.queryByRole("textbox", { name: "理解卡片标题" })).toBeNull());
 fireEvent.click(await screen.findByRole("button", { name: "完成调整" }));
 fireEvent.click(await within(screen.getByRole("dialog")).findByRole("button", { name: "1 矩阵" }));
 expect(read).toHaveBeenCalledWith("0");
 expect(screen.queryByRole("dialog")).toBeNull();
});
