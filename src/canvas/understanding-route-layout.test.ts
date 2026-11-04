import { expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import { conceptLevels, conceptTreeSlots, readingRouteGroups, overviewRouteGroups } from "./understanding-route-layout";
import { understandingEdges } from "./understanding-model";

const step = (id: string, phase?: string): FocusSection => ({ id, title: id, phase, body: "", transition: "", evidenceIds: [], kind: "review" });

it("bounds a large named overview group and retains every card, phase and original index", () => {
  const items = [...Array.from({ length: 14 }, (_, index) => step(String(index), "我的分组")), step("end", "结尾")];
  const groups = overviewRouteGroups(items);
  expect(groups.map(group => group.start)).toEqual([0, 4, 8, 12, 14]);
  expect(groups.map(group => group.title)).toEqual(["我的分组", "我的分组", "我的分组", "我的分组", "结尾"]);
  expect(groups.flatMap(group => group.items)).toEqual(items);
});

it("uses consecutive authored groups without regrouping the user's reading order", () => {
  const sections = [step("a", "基础"), step("b", "基础"), step("c", "实践"), step("d", "基础"), step("mine")];
  const groups = readingRouteGroups(sections, false);
  expect(groups.map(group => group.title)).toEqual(["基础", "实践", "基础", ""]);
  expect(groups.flatMap(group => group.items)).toEqual(sections);
  const long = Array.from({ length: 15 }, (_, index) => step(`${index}`));
  const neutral = readingRouteGroups(long, false);
  expect(neutral.map(group => group.items.length)).toEqual([4, 4, 4, 3]);
  expect(neutral.every(group => !group.title)).toBe(true);
  expect(neutral.flatMap(group => group.items)).toEqual(long);
});

it("lays out branching containment vertically and never treats adjacency or comparison as a prerequisite", () => {
  const sections = [step("连续系统"), step("连续条件", "连续系统"), step("例子", "连续条件"), step("离散系统"), step("离散条件", "离散系统"), step("独立要点")];
  const edges = understandingEdges(sections);
  expect(conceptLevels(sections, edges).map(level => level.map(item => item.id))).toEqual([["连续系统", "离散系统", "独立要点"], ["连续条件", "离散条件"], ["例子"]]);
  const placement = conceptTreeSlots(sections, edges);
  expect(placement.slots.get("例子")).toEqual(placement.slots.get("连续系统"));
  expect(placement.slots.get("离散条件")).toEqual(placement.slots.get("离散系统"));
  expect(placement.count).toBe(3);
  expect(conceptLevels(sections, [{ from: "连续系统", to: "离散系统", kind: "comparison", excerpt: "比较" }])).toEqual([sections]);
  expect(sections.map(item => item.id)).toEqual(["连续系统", "连续条件", "例子", "离散系统", "离散条件", "独立要点"]);
});

it("keeps cycles visible and retains all levels of a deep chain without fake ordering", () => {
  const sections = Array.from({ length: 10 }, (_, index) => step(`${index}`));
  const chain = sections.slice(1).map((item, index) => ({ from: `${index}`, to: item.id, kind: "requires" as const, excerpt: "前提" }));
  expect(conceptLevels(sections, chain)).toHaveLength(10);
  const cyclic = [{ from: "0", to: "1", kind: "requires" as const, excerpt: "" }, { from: "1", to: "0", kind: "requires" as const, excerpt: "" }];
  expect(conceptLevels(sections, cyclic).flat()).toEqual(sections);
});

it("does not let a feedback loop flatten the product flow or reorder the saved reading route", () => {
  const sections = [step("validate"), step("input"), step("generate")];
  const edges = [{ from: "input", to: "generate", kind: "flow" as const, excerpt: "" }, { from: "generate", to: "validate", kind: "flow" as const, excerpt: "" }, { from: "validate", to: "generate", kind: "feedback" as const, excerpt: "" }];
  expect(conceptLevels(sections, edges).map(level => level.map(item => item.id))).toEqual([["input"], ["generate"], ["validate"]]);
  expect(sections.map(item => item.id)).toEqual(["validate", "input", "generate"]);
});
