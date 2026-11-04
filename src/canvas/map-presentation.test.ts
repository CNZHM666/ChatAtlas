import { expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import { architectureGroups, mapPresentation, moduleRecords } from "./map-presentation";
const nodes: FocusSection[] = ["需求", "方案", "交付", "验证", "独立记录"].map((title, i) => ({ id: String(i), title, body: "", transition: "", kind: "review", evidenceIds: [] }));

it("does not invent product partitions from graph positions", () => {
  const before = structuredClone(nodes);
  const groups = architectureGroups(nodes);
  expect(groups).toEqual([]);
  expect(nodes).toEqual(before);
});

it("uses saved layers and phases without assigning unnamed nodes to a fabricated role", () => {
  const groups = architectureGroups([{ ...nodes[0], layer: "设计层" }, { ...nodes[1], phase: "交付与验证" }, nodes[2]]);
  expect(groups[0].title).toBe("设计层");
  expect(groups.flatMap(group => group.items).map(item => item.id)).toEqual(["0", "1"]);
  expect(groups[1].title).toBe("交付与验证");
  expect(groups.some(group => group.id === "start")).toBe(false);
  expect(mapPresentation([{ from: "0", to: "1", kind: "comparison", excerpt: "" }])).toBe("comparison");
  expect(mapPresentation([{ from: "0", to: "1", kind: "contains", excerpt: "" }, { from: "1", to: "2", kind: "flow", excerpt: "" }])).toBe("hierarchy");
});

it("associates decisions by explicit module names rather than shared sources or incidental substrings", () => {
  const records = ["保留缺件清单。", "采购功能暂时简化。", "The API is isolated.", "Use an APIClient module."].map((text, index) => ({ id: String(index), text, reason: "", quote: "", status: "documented" as const, evidenceIds: ["same-source"] }));
  expect(moduleRecords("缺件清单", records).map(item => item.id)).toEqual(["0"]);
  expect(moduleRecords("API", records).map(item => item.id)).toEqual(["2"]);
});

it("normalizes layer notation without merging different business areas or changing saved names", () => {
  const input = [{ ...nodes[0], layer: "核心处理" }, { ...nodes[1], layer: "核心处理层" }, { ...nodes[2], layer: "核心校验" }, { ...nodes[3], layer: "API Layer" }, { ...nodes[4], layer: "api" }];
  const before = structuredClone(input), groups = architectureGroups(input);
  expect(groups.map(group => [group.title, group.items.map(item => item.id)])).toEqual([["核心处理", ["0", "1"]], ["核心校验", ["2"]], ["API Layer", ["3", "4"]]]);
  expect(input).toEqual(before);
});
