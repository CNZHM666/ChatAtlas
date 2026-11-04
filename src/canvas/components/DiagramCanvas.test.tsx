import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DiagramCanvas } from "./DiagramCanvas";
import { layoutDiagram, type DiagramLayout } from "../diagram-layout";
import { DiagramWorkspaceContext, DiagramHeaderContext } from "../diagram-workspace-context";

vi.mock("../diagram-layout", () => ({ layoutDiagram: vi.fn() }));
afterEach(() => { cleanup(); vi.mocked(layoutDiagram).mockReset(); });
it("consolidates architecture controls and uses the scale button to fit instead of duplicating fit icons",async()=>{
  vi.mocked(layoutDiagram).mockResolvedValue({width:1200,height:900,nodes:[],groups:[],links:[]});
  const sections=["a","b"].map(id=>({id,title:id,body:"",transition:"",evidenceIds:[],kind:"review" as const}));
  const update=vi.fn(),edges=[{from:"a",to:"b",kind:"flow" as const,excerpt:"传递"},{from:"b",to:"a",kind:"feedback" as const,excerpt:"返回"}];
  render(<DiagramHeaderContext.Provider value={{heading:null,toolbar:null,settingsActions:<button onClick={update}>更新结构图</button>}}><DiagramCanvas compactControls completeArchitecture showDetails sections={sections} edges={edges} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={()=>null}/></DiagramHeaderContext.Provider>);
  await act(async()=>{});expect(screen.getAllByRole("button",{name:"适配全图"})).toHaveLength(1);expect(screen.queryByRole("button",{name:"恢复原始大小"})).toBeNull();expect(screen.queryByRole("button",{name:"全部"})).toBeNull();
  const fit=screen.getByRole("button",{name:"适配全图"});fireEvent.click(screen.getByRole("button",{name:"放大图表"}));fireEvent.click(fit);expect(parseInt(fit.textContent!)).toBeLessThan(80);
  fireEvent.click(screen.getByRole("button",{name:"图表设置"}));expect(screen.queryByRole("checkbox",{name:"模块详情"})).toBeNull();expect(screen.queryByRole("checkbox",{name:"输入输出"})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:"更新结构图"}));expect(update).toHaveBeenCalledOnce();expect(screen.queryByRole("dialog")).toBeNull();
});
it("hides stale and temporary layouts during a graph switch and discards late results", async () => {
  const jobs: Array<(layout: DiagramLayout) => void> = [];
  vi.mocked(layoutDiagram).mockImplementation(() => new Promise(resolve => { jobs.push(resolve); }));
  const node = (id: string) => ({ id, title: id, body: "", transition: "", evidenceIds: [], kind: "review" as const });
  const graph = (id: string) => <DiagramCanvas sections={[node(id)]} edges={[]} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={item => <li data-route-id={item.id}><button>{item.title}</button></li>} />;
  const shape = (id: string): DiagramLayout => ({ width: 300, height: 120, nodes: [{ id, x: 20, y: 20, width: 160, height: 80 }], groups: [], links: [] });
  const { container, rerender } = render(graph("旧章节"));
  expect(container.querySelector(".diagram-stage")).not.toBeVisible();
  rerender(graph("新章节"));
  await act(async () => { jobs[0](shape("旧章节")); });
  expect(container.querySelector(".diagram-stage")).not.toBeVisible();
  await act(async () => { jobs[1](shape("新章节")); });
  expect(screen.getByRole("button", { name: "新章节" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "旧章节" })).toBeNull();
});

it("fits the initial compact graph and retains readable original-size zoom", async () => {
  vi.mocked(layoutDiagram).mockResolvedValue({ width: 3000, height: 1000, nodes: [{ id: "ir", x: 800, y: 360, width: 180, height: 80 }], groups: [], links: [] });
  const node = { id: "ir", title: "Hardware IR", body: "", transition: "", evidenceIds: [], kind: "review" as const };
  const { container } = render(<DiagramWorkspaceContext.Provider value={true}><DiagramCanvas sections={[node]} edges={[]} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={item => <li data-route-id={item.id}><button>{item.title}</button></li>} /></DiagramWorkspaceContext.Provider>);
  await act(async () => {});
  expect(parseInt(screen.getByRole("button", { name: "恢复原始大小" }).textContent!)).toBeLessThan(90);
  fireEvent.click(screen.getByRole("button", { name: "恢复原始大小" }));
  expect(screen.getByRole("button", { name: "恢复原始大小" })).toHaveTextContent("100%");
  expect(container.querySelector(".diagram-stage")).toBeVisible();
  expect(screen.getByRole("button", { name: "适配全图" })).toBeEnabled();
  const stage = container.querySelector<HTMLElement>(".diagram-stage")!;
  const before = stage.style.transform;
  fireEvent.wheel(screen.getByRole("region", { name: "结构图" }), { deltaY: 100 });
  expect(stage.style.transform).not.toBe(before);
});

it("starts with forward connections and reveals even a small project's return on demand", async () => {
  vi.mocked(layoutDiagram).mockResolvedValue({ width: 500, height: 300, nodes: [], groups: [], links: [] });
  const sections = ["a", "b"].map(id => ({ id, title: id, body: "", transition: "", evidenceIds: [], kind: "review" as const }));
  const forward = { from: "a", to: "b", kind: "flow" as const, excerpt: "传递" };
  const feedback = { from: "b", to: "a", kind: "feedback" as const, excerpt: "反馈" };
  render(<DiagramCanvas sections={sections} edges={[forward, feedback]} groups={[{ id: "g", title: "分组", items: sections }]} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={() => null} />);
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].edges).toEqual([forward]);
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].groups).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "全部" }));
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].edges).toEqual([forward, feedback]);
  fireEvent.click(screen.getByRole("button", { name: "图表设置" }));
  fireEvent.change(screen.getByRole("combobox", { name: "图表方向" }), { target: { value: "DOWN" } });
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].direction).toBe("DOWN");
});

it("shows all product modules and feedback, with optional group boundaries", async () => {
  vi.mocked(layoutDiagram).mockResolvedValue({ width: 500, height: 300, nodes: [], groups: [], links: [] });
  const sections = ["a", "b", "independent"].map(id => ({ id, title: id, body: "", transition: "", evidenceIds: [], kind: "review" as const }));
  const edges = [{ from: "a", to: "b", kind: "flow" as const, excerpt: "传递", label: "结果" }, { from: "b", to: "a", kind: "feedback" as const, excerpt: "反馈", label: "修正" }];
  const groups = [{ id: "g", title: "处理层", items: sections }];
  render(<DiagramCanvas completeArchitecture showDetails sections={sections} edges={edges} groups={groups} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={() => null} />);
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0]).toMatchObject({ sections, edges, showDetails: true, labels: true });
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].groups).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "图表设置" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "分组边框" }));
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].groups).toEqual(groups);
});

it("keeps a large architecture readable without expanding the article and offers an explicit full fit", async () => {
  vi.mocked(layoutDiagram).mockResolvedValue({ width: 1200, height: 3000, nodes: [], groups: [], links: [] });
  const node = { id: "ir", title: "IR", responsibility: "统一事实", inputs: ["需求"], outputs: ["描述"], body: "", transition: "", evidenceIds: [], kind: "review" as const };
  render(<DiagramCanvas completeArchitecture showDetails sections={[node]} edges={[]} zh onNode={vi.fn()} onRelation={vi.fn()} renderCard={() => null} />);
  await act(async () => {});
  expect(screen.getByRole("button", { name: "恢复原始大小" })).toHaveTextContent("80%");
  expect(screen.getByRole("region", { name: "结构图" })).toHaveStyle({ height: "1100px" });
  fireEvent.click(screen.getByRole("button", { name: "适配全图" }));
  expect(parseInt(screen.getByRole("button", { name: "恢复原始大小" }).textContent!)).toBeLessThan(80);
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].sections[0].inputs).toBeUndefined();
  fireEvent.click(screen.getByRole("button", { name: "图表设置" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "输入输出" }));
  await act(async () => {});
  expect(vi.mocked(layoutDiagram).mock.lastCall![0].sections[0].inputs).toEqual(["需求"]);
});
