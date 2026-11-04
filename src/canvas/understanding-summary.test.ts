import { expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import { understandingSummary } from "./understanding-summary";
import { createDiagramGraph } from "./diagram-layout";

const point: FocusSection = { id: "ir", title: "Hardware IR", body: "## 职责\n\n记录统一的硬件方案。校验与交付物复用同一份数据。\n\n下一段保留细节。", kind: "finding", transition: "", evidenceIds: [] };
it("uses concrete existing explanations instead of dropping long summaries or echoing titles", () => {
  expect(understandingSummary(point)).toBe("记录统一的硬件方案。校验与交付物复用同一份数据。");
  expect(understandingSummary({ ...point, responsibility: point.title })).toBe(understandingSummary(point));
  expect(understandingSummary({ ...point, responsibility: "将方案提交校验；保留边界条件。" })).toBe("将方案提交校验；保留边界条件。");
  expect(understandingSummary({ ...point, body: "" })).toBe("");
});
it("allocates space for chapter explanations while preserving ordinary architecture boxes", () => {
  const base = { sections: [point], edges: [], zh: true };
  const original = createDiagramGraph(base).graph.children![0];
  const detailed = createDiagramGraph({ ...base, showDetails: true }).graph.children![0];
  expect(detailed.width).toBeGreaterThan(original.width!);
  expect(detailed.height).toBeGreaterThan(original.height!);
});
