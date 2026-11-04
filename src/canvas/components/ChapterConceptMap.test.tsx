import { cleanup, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { FocusSection } from "../../shared/focus-session";
import { ChapterConceptMap } from "./ChapterConceptMap";
afterEach(cleanup);
const sections: FocusSection[] = ["方案", "校验"].map((title, i) => ({ id: String(i), title, body: "", transition: "", kind: "review", evidenceIds: ["e"] }));
const ref = { id: "e", conversationId: "c", messageId: "m", title: "架构选择", excerpt: "方案进入校验" };

it("explains a relationship and opens its cited discussion without changing the chapter", () => {
  const read = vi.fn(), locate = vi.fn();
  const { container } = render(<ChapterConceptMap sections={sections} zh activeId="" onRead={read} onLocate={locate} evidence={[ref]} relations={[{ from: "0", to: "1", kind: "flow", excerpt: "方案提交规则校验。", evidenceIds: ["e"] }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  expect(container.querySelector(".map-flow")).toBeInTheDocument();
  const before = [...container.querySelectorAll("[data-route-id]")];
  fireEvent.click(screen.getByText("关系与依据 · 1"));
  fireEvent.click(screen.getByRole("button", { name: "解释关系 1" }));
  expect(screen.getByRole("button", { name: "解释关系 1" })).toHaveAttribute("aria-expanded", "true");
  expect(screen.getByText("方案提交规则校验。", { selector: ".relation-evidence p" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "阅读讨论 · 架构选择" }));
  expect(locate).toHaveBeenCalledWith(ref);
  expect(read).not.toHaveBeenCalled();
  expect([...container.querySelectorAll("[data-route-id]")]).toEqual(before);
  fireEvent.click(within(screen.getByRole("region", { name: "要点关系" })).getByRole("button", { name: "校验" }));
  expect(read).toHaveBeenCalledWith("1");
});

it("uses a comparison presentation for comparison-only relations and retains containment as hierarchy", () => {
  const props = { sections, zh: true, activeId: "", onRead: vi.fn(), renderCard: (item: FocusSection) => <li key={item.id} data-route-id={item.id}>{item.title}</li> };
  const { container, rerender } = render(<ChapterConceptMap {...props} relations={[{ from: "0", to: "1", kind: "comparison", excerpt: "对比两种方案" }]} />);
  expect(container.querySelector(".map-comparison")).toBeInTheDocument();
  rerender(<ChapterConceptMap {...props} relations={[{ from: "0", to: "1", kind: "contains", excerpt: "层级" }]} />);
  expect(container.querySelector(".map-hierarchy")).toBeInTheDocument();
  fireEvent.click(screen.getByText("关系与依据 · 1"));
  expect(screen.getByText("包含", { selector: ".relation-contains" })).toBeVisible();
});

it("uses real compact routes, keeps zoom on selection, and exposes keyboard relationship details", async () => {
  const { container, rerender } = render(<ChapterConceptMap sections={sections} zh activeId="" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "flow", label: "提交方案", excerpt: "将方案提交给校验。" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  const target = await screen.findByRole("button", { name: "查看关系 1: 方案 → 校验" });
  expect(container.querySelector(".diagram-edge.flow > path")).toHaveAttribute("marker-end");
  const stage = container.querySelector(".diagram-stage")!, nodes = [...container.querySelectorAll(".diagram-node")].map(node => node.getAttribute("style"));
  fireEvent.click(screen.getByRole("button", { name: "放大图表" })); const zoomed = stage.getAttribute("style");
  fireEvent.keyDown(target, { key: "Enter" });
  expect(screen.getByRole("region", { name: "关系解释" })).toHaveTextContent("将方案提交给校验。");
  expect(stage.getAttribute("style")).toBe(zoomed);
  fireEvent.keyDown(screen.getByRole("button", { name: "关闭关系解释" }), { key: "Escape" });
  expect(screen.queryByRole("region", { name: "关系解释" })).toBeNull();
  rerender(<ChapterConceptMap sections={sections} zh activeId="1" focusId="1" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "flow", label: "提交方案", excerpt: "将方案提交给校验。" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  expect(stage.getAttribute("style")).toBe(zoomed);
  expect([...container.querySelectorAll(".diagram-node")].map(node => node.getAttribute("style"))).toEqual(nodes);
  fireEvent.click(screen.getByRole("button", { name: "适配全图" })); expect(stage.getAttribute("style")).not.toBe(zoomed);
});

it("renders containment without an arrow and review comparisons in both directions", async () => {
  const { container } = render(<ChapterConceptMap sections={sections} zh activeId="" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "contains", excerpt: "分类包含" }, { from: "1", to: "0", kind: "comparison", label: "条件不同", excerpt: "两者条件不同" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  await waitFor(() => expect(container.querySelector(".diagram-edge.comparison > path")).toBeInTheDocument());
  expect(container.querySelector(".diagram-review")).toBeInTheDocument();
  expect(container.querySelector(".diagram-edge.contains > path")).not.toHaveAttribute("marker-end");
  expect(container.querySelector(".diagram-edge.comparison > path")).toHaveAttribute("marker-start");
  expect(container.querySelector(".diagram-edge.comparison > path")).toHaveAttribute("marker-end");
});

it("starts a large graph with a readable backbone while keeping feedback and every relationship available", async () => {
  const nodes = [...sections, ...Array.from({ length: 11 }, (_, i) => ({ ...sections[0], id: String(i + 2), title: `模块 ${i + 2}` }))];
  const relations = [["0", "1", "flow"], ["1", "2", "flow"], ["2", "3", "flow"], ["3", "4", "flow"], ["4", "0", "feedback"], ["0", "2", "flow"]].map(([from, to, kind]) => ({ from, to, kind: kind as "flow" | "feedback", label: "传递方案", excerpt: "传递方案" }));
  const { container } = render(<ChapterConceptMap sections={nodes} zh project activeId="" onRead={vi.fn()} relations={relations} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(5));
  expect(container.querySelectorAll(".diagram-node")).toHaveLength(13);
  expect(screen.getByRole("button", { name: "主线" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(6));
  expect(container.querySelector(".diagram-edge.feedback > path")).toHaveAttribute("marker-end");
  expect(screen.getByRole("region", { name: "要点关系" }).querySelectorAll("li")).toHaveLength(6);
  fireEvent.click(screen.getByRole("button", { name: "主线" }));
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(5));
});

it("reveals the complete feedback loop on demand on ordinary project architectures", async () => {
  const nodes = [...sections, ...["输出", "验证"].map((title, i) => ({ ...sections[0], id: String(i + 2), title }))];
  const relations = [["0", "1", "flow"], ["1", "2", "flow"], ["2", "3", "flow"], ["3", "0", "feedback"]].map(([from, to, kind]) => ({ from, to, kind: kind as "flow" | "feedback", label: "校验反馈", excerpt: "校验反馈" }));
  const { container } = render(<ChapterConceptMap sections={nodes} zh project activeId="" onRead={vi.fn()} relations={relations} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(3));
  expect(screen.getByRole("button", { name: "主线" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(4));
  expect(container.querySelector(".diagram-edge.feedback > path")).toHaveAttribute("marker-end");
  expect(screen.getByRole("button", { name: "全部" })).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByRole("button", { name: "主线" }));
  await waitFor(() => expect(container.querySelectorAll(".diagram-edge")).toHaveLength(3));
});

it("keeps compact connectors, reveals transfer labels on demand and supports explicit vertical layout", async () => {
  const { container } = render(<ChapterConceptMap sections={sections} zh project activeId="" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "flow", label: "提交方案并核对约束", excerpt: "将方案提交给校验。" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  await screen.findByRole("button", { name: "查看关系 1: 方案 → 校验" });
  expect(container.querySelectorAll(".diagram-edge-label")).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "图表设置" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "连线标签" }));
  await waitFor(() => expect(container.querySelector(".diagram-edge-label")).toHaveTextContent("提交方案并核对约束"));
  fireEvent.change(screen.getByRole("combobox", { name: "图表方向" }), { target: { value: "DOWN" } });
  await waitFor(() => {
    const boxes = [...container.querySelectorAll<HTMLElement>(".diagram-node")];
    expect(parseFloat(boxes[1].style.top)).toBeGreaterThan(parseFloat(boxes[0].style.top));
  });
});

it("keeps optional controls behind settings, closes with Escape without leaving the map, and resets to readable 100%", async () => {
  const outerEscape = vi.fn();
  const { container } = render(<div onKeyDown={outerEscape}><ChapterConceptMap sections={sections} zh activeId="" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "flow", excerpt: "方案提交校验" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} /></div>);
  await screen.findByRole("button", { name: "查看关系 1: 方案 → 校验" });
  expect(screen.queryByRole("combobox", { name: "图表方向" })).toBeNull();
  expect(screen.queryByText(/拖动空白处|点击节点可突出/u)).toBeNull();
  const opener = screen.getByRole("button", { name: "图表设置" });
  fireEvent.click(opener);
  const direction = screen.getByRole("combobox", { name: "图表方向" });
  expect(direction).toHaveFocus();
  fireEvent.keyDown(direction, { key: "Escape" });
  expect(screen.queryByRole("dialog", { name: "图表设置" })).toBeNull();
  expect(opener).toHaveFocus();
  expect(outerEscape).not.toHaveBeenCalled();
  fireEvent.click(opener);
  fireEvent.pointerDown(document.body);
  expect(screen.queryByRole("dialog", { name: "图表设置" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "放大图表" }));
  fireEvent.click(screen.getByRole("button", { name: "恢复原始大小" }));
  expect(container.querySelector(".diagram-stage")!.getAttribute("style")).toContain("scale(1)");
});

it("preserves complete relation conditions and authored containment alongside data flow", async () => {
  const label = "通过校验且全部电源约束满足后将方案交付给可视化工作台";
  const { container } = render(<ChapterConceptMap sections={sections} zh project activeId="" onRead={vi.fn()} relations={[{ from: "0", to: "1", kind: "flow", label, excerpt: "不满足约束时应返回修改。" }, { from: "0", to: "1", kind: "contains", authored: true, excerpt: "" }]} renderCard={item => <li key={item.id} data-route-id={item.id}><button>{item.title}</button></li>} />);
  const edge = await screen.findByRole("button", { name: "查看关系 1: 方案 → 校验" });
  expect(container.querySelector(".diagram-edge.flow title")).toHaveTextContent(label);
  expect(container.querySelector(".diagram-edge.contains > path")).not.toHaveAttribute("marker-end");
  fireEvent.click(edge);
  expect(screen.getByRole("region", { name: "关系解释" }).querySelector("header strong")).toHaveTextContent(label);
  expect(screen.getByRole("region", { name: "关系解释" })).toHaveTextContent("不满足约束时应返回修改。");
});

it("keeps relationship prose and sources hidden until requested", () => {
  render(<ChapterConceptMap showDetails sections={sections} zh activeId="" onRead={vi.fn()} onLocate={vi.fn()} evidence={[ref]} relations={[{ from: "0", to: "1", kind: "flow", label: "提交方案", excerpt: "方案提交规则校验，发现边界问题后重新调整。", evidenceIds: ["e"] }]} renderCard={item => <li key={item.id}>{item.title}</li>} />);
  expect(screen.queryByText("方案提交规则校验，发现边界问题后重新调整。")).toBeNull();
  fireEvent.click(screen.getByText("关系与依据 · 1"));
  const relationships = screen.getByRole("region", { name: "要点关系" });
  expect(within(relationships).queryByText("方案提交规则校验，发现边界问题后重新调整。")).toBeNull();
  expect(within(relationships).queryByRole("button", { name: "阅读讨论 · 架构选择" })).toBeNull();
  fireEvent.click(within(relationships).getByRole("button", { name: "解释关系 1" }));
  expect(within(relationships).getByText("方案提交规则校验，发现边界问题后重新调整。")).toBeVisible();
  expect(within(relationships).getByRole("button", { name: "阅读讨论 · 架构选择" })).toBeVisible();
});
