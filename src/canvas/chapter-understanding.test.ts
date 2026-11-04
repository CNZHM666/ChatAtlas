import { expect, it } from "vitest";
import { chapterSteps } from "./chapter-understanding";
import type { FocusSection } from "../shared/focus-session";
import { readingTitle } from "../shared/reading-title";
import { chapterPathRefresh } from "./chapter-understanding";
import { chapterConceptSteps } from "./chapter-understanding";
const section: FocusSection = { id: "chapter", title: "稳定性", body: "# 稳定性\n\n## 状态矩阵\n矩阵描述状态变化。\n### 特征值\n特征值决定响应。\n```js\n## Not a heading\n```\n## 系统极点\n联系特征值与稳定性。", kind: "review", evidenceIds: ["e1"], transition: "" };
it("keeps complete sentence labels and restores old shortened titles without changing edited cards or order", () => {
  const body = "当前市场缺乏能将线性 AI 对话转化为基于知识依赖关系而非聊天顺序的结构化图谱工具。\n\n保留原始讨论。";
  const steps = chapterSteps({ ...section, body });
  expect(steps[0].title).toBe(body.split("\n")[0]);
  const shortened = { ...steps[0], title: readingTitle(steps[0].title, 36) };
  expect(shortened.title).toContain("…");
  expect(chapterSteps({ ...section, body, understandingPath: [steps[1], shortened] }).map(item => item.title)).toEqual([steps[1].title, steps[0].title]);
  expect(chapterSteps({ ...section, body, understandingPath: [{ ...shortened, userEdited: true }] })[0].title).toBe(shortened.title);
  expect(chapterSteps({ ...section, body: "已修改正文。", understandingPath: [shortened] })[0]).toBe(shortened);
});
it("uses only current chapter headings and actual hierarchy, ignoring code", () => {
  const steps = chapterSteps(section);
  expect(steps.map(step => step.title)).toEqual(["状态矩阵", "特征值", "系统极点"]);
  expect(steps[1].phase).toBe("状态矩阵"); expect(steps[2].phase).toBeUndefined(); expect(steps[2].body).toBe("联系特征值与稳定性。");
  expect(steps.every(step => !step.transition)).toBe(true);
});
it("preserves local cards, user order and empty authored routes without calling AI", () => {
  const steps = chapterSteps(section).reverse();
  expect(chapterSteps({ ...section, understandingPath: steps })).toBe(steps);
  expect(chapterSteps({ ...section, understandingPath: [] })).toEqual([]);
  expect(chapterSteps({ ...section, body: "没有结构的正文。" })[0]).toMatchObject({ title: "没有结构的正文。", body: "没有结构的正文。" });
});

it("derives multiple local steps from labelled bullets and paragraphs without copying the project title", () => {
  const body = "先确认需要解决的问题。\n\n- **状态矩阵**：描述状态如何变化。\n- **特征值**：决定状态响应。\n- **稳定条件**：结合内部模态核对。";
  const steps = chapterSteps({ ...section, body });
  expect(steps.map(item => item.title)).toEqual(["先确认需要解决的问题。", "状态矩阵", "特征值", "稳定条件"]);
  expect(steps.flatMap(item => item.body).join("\n")).toContain("内部模态");
  expect(steps.every(item => item.title !== section.title && item.evidenceIds[0] === "e1")).toBe(true);
  expect(chapterConceptSteps(steps).map(step => step.title)).toEqual(["状态矩阵", "特征值", "稳定条件"]);
  expect(chapterConceptSteps([{ ...steps[0], userEdited: true }, ...steps.slice(1)])).toHaveLength(4);
  expect(chapterConceptSteps([{ ...steps[0], understandingLinks: [{ targetId: steps[1].id, kind: "requires" }] }, ...steps.slice(1)])).toHaveLength(4);
});

it("expands a legacy untouched placeholder, preserves authored cards and keeps fenced code intact", () => {
  const body = "输入矩阵。计算特征值。检查稳定性。", old = { ...section, id: `chapter-step:${section.id}:body`, body };
  const steps = chapterSteps({ ...section, body, understandingPath: [old] });
  expect(steps).toHaveLength(3);
  expect(chapterSteps({ ...section, body, understandingPath: [{ ...old, userEdited: true }] })).toHaveLength(1);
  const code = "```js\n// A sentence. Another sentence.\n## Not a heading\n```";
  const result = chapterSteps({ ...section, body: `背景。\n\n${code}\n\n结论。` });
  expect(result.some(item => item.body === code)).toBe(true);
});

it("retains subpoint relationships under one Markdown heading", () => {
  const steps = chapterSteps({ ...section, body: "## 判断稳定性\n- **状态矩阵**：描述状态变化。\n- **特征值**：决定响应。\n- **内部模态**：核对隐藏条件。" });
  expect(steps.map(item => item.title)).toEqual(["判断稳定性", "状态矩阵", "特征值", "内部模态"]);
  expect(steps.slice(1).every(item => item.phase === "判断稳定性")).toBe(true);
  expect(steps[1].body).toBe("描述状态变化。");
});
it("refreshes changed points explicitly without losing personal cards, order or colliding with old IDs", () => {
  const saved = chapterSteps(section);
  const personal = { ...saved[1], title: "我的解释", body: "我的理解", userEdited: true };
  const changed = { ...section, body: "## 新增概念\n新内容。\n## 状态矩阵\n新的说明。\n## 系统极点\n新的极点说明。", understandingPath: [saved[2], personal, saved[0]] };
  const refreshed = chapterPathRefresh(changed)!;
  expect(refreshed.map(step => step.title)).toEqual(["系统极点", "我的解释", "状态矩阵", "新增概念"]);
  expect(refreshed[1]).toBe(personal);
  expect(refreshed[2].body).toBe("新的说明。");
  expect(new Set(refreshed.map(step => step.id)).size).toBe(refreshed.length);
  expect(chapterPathRefresh({ ...changed, understandingPath: refreshed })).toBeUndefined();
  expect(changed.understandingPath[2].body).toBe(saved[0].body);
  expect(chapterPathRefresh({ ...section, understandingPath: [] })).toBeUndefined();
});

it("refreshes original text while keeping a personal responsibility and relation", () => {
  const steps = chapterSteps(section);
  const old = { ...steps[0], responsibility: "我的解释", structureEdited: true, understandingLinks: [{ targetId: steps[2].id, kind: "flow" as const }] };
  const changed = { ...section, body: section.body.replace("矩阵描述状态变化。", "新的矩阵说明。"), understandingPath: [old, ...steps.slice(1)] };
  expect(chapterPathRefresh(changed)?.[0]).toMatchObject({ body: "新的矩阵说明。", responsibility: "我的解释", structureEdited: true, understandingLinks: old.understandingLinks });
});

it("fills a title-only legacy point from a unique actual heading without inventing a description", () => {
  const page = { id: "legacy", title: "UI规范", body: "## 布局\n侧边栏承接目录。\n## 配色\n正文使用中性背景。", kind: "review" as const, transition: "", evidenceIds: ["e"], semanticStructure: { nodes: [{ key: "layout", title: "布局", quote: "", description: "", status: "proposal" as const, evidenceIds: ["e"] }], relations: [] } };
  const result = chapterSteps(page)[0];
  expect(result.body).toBe("侧边栏承接目录。");
  expect(result.kind).toBe("proposal");
  expect(result.semanticStructure?.nodes[0].quote).toBe("");
  expect(result.evidenceIds).toEqual(["e"]);
  expect(chapterSteps({ ...page, body: "## 其他标题\n不匹配的正文。" })[0].body).toBe("");
});

it("uses article content when a legacy node quote merely repeats its title, preserving raw provenance", () => {
  const page = { id: "legacy-title", title: "方案", body: "## Hardware IR\n统一记录硬件描述，校验与交付物复用同一数据。", kind: "review" as const, transition: "", evidenceIds: ["e"], semanticStructure: { nodes: [{ key: "ir", title: "Hardware IR", quote: "Hardware IR", description: "Hardware IR", status: "discussed" as const, evidenceIds: ["e"] }], relations: [] } };
  const point = chapterSteps(page)[0];
  expect(point.body).toBe("统一记录硬件描述，校验与交付物复用同一数据。");
  expect(point.semanticStructure?.nodes[0].quote).toBe("Hardware IR");
  expect(chapterSteps({ ...page, body: page.body + "\n## Hardware IR\n另一个方案。" })[0].body).toBe("Hardware IR");
});
