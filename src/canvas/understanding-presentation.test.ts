import { expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import { comparisonTable, diagramConceptIds, understandingPresentation, understandingSequence, hasUsefulUnderstandingDiagram } from "./understanding-presentation";
import type { UnderstandingEdge } from "./understanding-model";

const points: FocusSection[] = Array.from({ length: 9 }, (_, i) => ({ id: String(i), title: `模块 ${i}`, body: "原文内容", transition: "", kind: "review", evidenceIds: [] }));
const edge = (from: string, to: string, kind: UnderstandingEdge["kind"] = "flow"): UnderstandingEdge => ({ from, to, kind, excerpt: "有依据的关系" });

it("requires a concrete transfer or a meaningful composition before adding a reading diagram", () => {
  expect(hasUsefulUnderstandingDiagram(points, [edge("0", "1", "contains")])).toBe(false);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1"), label: "传递" }])).toBe(false);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1"), label: "候选方案" }])).toBe(true);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1"), label: "候选方案", uncertain: true }])).toBe(false);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1", "contains"), authored: true }])).toBe(true);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1", "contains"), label: "输入适配" }, { ...edge("0", "2", "contains"), label: "规则引擎" }])).toBe(true);
});

it("chooses explained steps for a path, modules for interfaces, and a canvas for actual branching", () => {
  const nodes = points.slice(0, 3), path = [edge("2", "0"), edge("0", "1")];
  expect(understandingPresentation(nodes, path)).toBe("process");
  expect(understandingSequence(nodes, path)?.map(node => node.id)).toEqual(["2", "0", "1"]);
  expect(understandingPresentation(nodes, [edge("0", "1"), edge("0", "2")])).toBe("diagram");
  expect(understandingSequence(nodes, [edge("0", "1"), edge("0", "2")])).toBeUndefined();
  expect(understandingPresentation([{ ...nodes[0], outputs: ["方案"] }, nodes[1]], [])).toBe("modules");
  expect(understandingSequence(nodes, [edge("0", "1"), edge("1", "0")])).toBeUndefined();
});

it("preserves local diagrams and uses hierarchy for containment without accepting uncertain links", () => {
  expect(understandingPresentation(points, [edge("0", "1"), edge("2", "3"), edge("4", "5")])).toBe("diagram");
  expect(understandingPresentation(points.slice(0, 3), [edge("0", "1", "contains"), edge("0", "2", "contains")])).toBe("hierarchy");
  expect(understandingPresentation(points, [edge("0", "1"), edge("1", "2")])).toBe("process");
  expect(diagramConceptIds(points, [edge("0", "1"), edge("1", "2")])).toEqual(new Set(["0", "1", "2"]));
  expect(understandingPresentation(points.slice(0, 2), [{ ...edge("0", "1"), uncertain: true }])).toBe("points");
  expect(diagramConceptIds(points, [edge("0", "missing")])).toEqual(new Set());
});

it("keeps a supported flow and feedback diagram, and respects personal relationships", () => {
  expect(understandingPresentation(points.slice(0, 3), [edge("0", "1"), edge("1", "2"), edge("2", "0", "feedback")])).toBe("diagram");
  expect(understandingPresentation(points, [{ ...edge("0", "1"), authored: true }])).toBe("diagram");
  expect(diagramConceptIds(points, [{ ...edge("0", "1", "comparison"), authored: true }])).toEqual(new Set(["0", "1"]));
});

it("only displays comparisons from real tables, excluding fenced examples", () => {
  const table = "| 条件 | A | B |\n| --- | --- | --- |\n| 成本 | 低 | 高 |";
  expect(comparisonTable(`背景\n\n${table}\n\n结论`)).toBe(table);
  expect(understandingPresentation(points, [], "方案比较", table)).toBe("comparison");
  expect(comparisonTable(`~~~md\n${table}\n~~~`)).toBeUndefined();
  expect(comparisonTable("| A | B |\n| --- | --- |\n")).toBeUndefined();
});

it("requires actual version headings for a chronological presentation", () => {
  expect(understandingPresentation(points, [], "版本变迁")).toBe("points");
  const versions = [{ ...points[0], title: "V0.1 核心流程" }, { ...points[1], title: "V0.2 库存识别" }];
  expect(understandingPresentation(versions, [], "版本变迁")).toBe("timeline");
  expect(understandingPresentation(versions, [], "API 调用规范")).toBe("points");
});

it("preserves legacy source-backed transfer diagrams even without optional edge labels", () => {
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1"), excerpt: "模块 0 输出给模块 1 进行规则校验。" }])).toBe(true);
  expect(hasUsefulUnderstandingDiagram(points, [{ ...edge("0", "1", "requires"), excerpt: "模块 1 依赖模块 0 提供的数据。", uncertain: true }])).toBe(false);
  expect(hasUsefulUnderstandingDiagram(points, [edge("0", "1", "contains")])).toBe(false);
});
it("recognizes a supported named arrow flow without accepting reverse, indirect or unrelated arrows",()=>{
 const nodes=[{...points[0],title:"Requirement Spec"},{...points[1],title:"Hardware Operation Plan"}];
 const flow={...edge("0","1"),label:"传递",excerpt:"Requirement Spec -> Hardware Operation Plan -> Deterministic Executor"};
 expect(hasUsefulUnderstandingDiagram(nodes,[flow])).toBe(true);
 expect(hasUsefulUnderstandingDiagram(nodes,[{...flow,uncertain:true}])).toBe(false);
 expect(hasUsefulUnderstandingDiagram(nodes,[{...flow,excerpt:"Hardware Operation Plan -> Requirement Spec"}])).toBe(false);
 expect(hasUsefulUnderstandingDiagram(nodes,[{...flow,excerpt:"Requirement Spec -> Intermediate -> Hardware Operation Plan"}])).toBe(false);
 expect(hasUsefulUnderstandingDiagram(nodes,[{...flow,excerpt:"Requirement Spec 与 Hardware Operation Plan。Other -> Else。"}])).toBe(false);
});
