import { expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import { understandingColumns, understandingEdges, understandingResponsibility, understandingRole, understandingTables } from "./understanding-model";
const step = (id: string, title: string, body = ""): FocusSection => ({ id, title, body, kind: "review", evidenceIds: [], transition: "" });

it("distinguishes explicit containment, prerequisites and examples without inferring them from reading order", () => {
  const steps = [step("a", "状态矩阵"), { ...step("b", "特征值", "基于状态矩阵，计算特征值。"), phase: "状态矩阵" }, step("c", "稳定条件", "检查响应。"), step("d", "示例", "以状态矩阵为例，计算响应。"), step("e", "另一方法", "无需依赖状态矩阵。"), step("f", "代码", "```txt\n基于状态矩阵，计算响应。\n```")];
  expect(understandingEdges(steps)).toEqual([
    { from: "a", to: "b", kind: "contains", excerpt: "状态矩阵" },
    { from: "a", to: "b", kind: "requires", excerpt: "基于状态矩阵，计算特征值。" },
    { from: "a", to: "d", kind: "example", excerpt: "以状态矩阵为例，计算响应。" },
  ]);
  expect(understandingRole(steps[3])).toBe("example");
  expect(understandingEdges([steps[0], step("g", "疑问", "是否依赖状态矩阵？"), step("h", "假设", "如果基于状态矩阵，是否成立？"), step("i", "修正", "不要继续依赖状态矩阵。")])).toEqual([]);
});

it("recognizes explicit formatted concepts and comparisons, rejecting speculation and authored facts", () => {
  const steps = [step("a", "完整更新"), step("b", "增量更新", "与**完整更新**相比，可以复用未变化的分析。"), step("c", "依赖", "基于**完整更新**，建立可信基线。"), step("d", "疑问", "如果与完整更新相比，会如何？"), step("e", "引用", "> 基于完整更新，建立可信基线。"), { ...step("f", "我的猜测", "基于完整更新，建立可信基线。"), origin: "user" as const }];
  expect(understandingEdges(steps).map(edge => [edge.from, edge.to, edge.kind])).toEqual([["a", "b", "comparison"], ["a", "c", "requires"]]);
});

it("keeps every node in bounded columns for long chains, disconnected concepts and cyclic references", () => {
  const steps = Array.from({ length: 30 }, (_, index) => step(String(index), `概念 ${index}`));
  const chain = steps.slice(1, 27).map((item, index) => ({ from: String(index), to: item.id, kind: "requires" as const, excerpt: "Explicit premise" }));
  const edges = [...chain, { from: "27", to: "28", kind: "requires" as const, excerpt: "Cycle" }, { from: "28", to: "27", kind: "requires" as const, excerpt: "Cycle" }];
  const columns = understandingColumns(steps, edges);
  expect(columns.length).toBeLessThanOrEqual(4); expect(new Set(columns.flat().map(item => item.id))).toEqual(new Set(steps.map(item => item.id)));
  expect(columns[0].map(item => item.id)).toEqual(expect.arrayContaining(["27", "28", "29"]));
});
it("leaves ambiguous repeated concepts unconnected and preserves full comparison cells", () => {
  expect(understandingEdges([step("a", "概念"), step("b", "概念"), step("c", "推导", "依赖概念。")])).toEqual([]);
  const table = "| 方案 | 优点 | 限制 |\n| --- | --- | --- |\n| A | 可复用分析 | 需要有效基线 |\n| B | 校验全文 | 增加等待 |";
  expect(understandingTables([step("a", "取舍", table)])).toEqual([{ stepId: "a", title: "取舍", markdown: table }]);
  expect(understandingTables([step("b", "代码", `\`\`\`md\n${table}\n\`\`\``)])).toEqual([]);
});

it("distinguishes authored relationships, overrides the same pair and ignores removed or self targets", () => {
  const steps = [{ ...step("a", "矩阵"), understandingLinks: [{ targetId: "b", kind: "comparison" as const }, { targetId: "a", kind: "requires" as const }, { targetId: "missing", kind: "requires" as const }] }, step("b", "极点", "基于矩阵，计算极点。")];
  expect(understandingEdges(steps)).toEqual([{ from: "a", to: "b", kind: "comparison", excerpt: "", authored: true }]);
});

it("keeps output and feedback directions separate from reading order and rejects unsupported relations", () => {
  const steps = [step("validate", "规则校验", "将问题反馈至方案生成。"), step("generate", "方案生成", "将候选方案输出给规则校验。"), step("intent", "需求理解", "输出给方案生成。"), step("unrelated", "不相关", "其他模块输出给方案生成。")];
  expect(understandingEdges(steps).map(edge => [edge.from, edge.to, edge.kind])).toEqual([["validate", "generate", "feedback"], ["generate", "validate", "flow"], ["intent", "generate", "flow"]]);
  for (const body of ["如果输出给方案生成，是否可行？", "不输出给方案生成。", "不必将问题反馈至方案生成。", "> 输出给方案生成。", "```txt\n输出给方案生成。\n```", "是否将问题反馈至方案生成？"]) expect(understandingEdges([steps[1], step("x", "输入", body)])).toEqual([]);
  expect(understandingEdges([steps[1], { ...step("x", "建议", "输出给方案生成。"), kind: "proposal" }])).toEqual([]);
  expect(understandingEdges([steps[1], step("x", "输入", "Outputs to 方案生成." )])[0]).toMatchObject({ from: "x", to: "generate", kind: "flow" });
});

it("extracts labelled responsibilities while keeping personal explanations and code distinct", () => {
  expect(understandingResponsibility(step("x", "模块", "**职责**：检查候选方案的边界条件。"))).toBe("检查候选方案的边界条件。");
  expect(understandingResponsibility(step("x", "模块", "Purpose: Validate constraints."))).toBe("Validate constraints.");
  expect(understandingResponsibility(step("x", "模块", "开头概况。\n```txt\n职责：代码里的文本\n```"))).toBe("");
  expect(understandingResponsibility({ ...step("x", "我的理解", "职责：我的猜测"), origin: "user" })).toBe("");
  expect(understandingResponsibility({ ...step("x", "我的理解"), origin: "user", responsibility: "我的职责说明" })).toBe("我的职责说明");
});
