import { expect, it } from "vitest";
import { moveRouteCard, removePersonalRouteCard, saveRouteCard } from "./focus-route";
import type { FocusSection } from "../shared/focus-session";
import { understandingEdges } from "./understanding-model";
const sections: FocusSection[] = ["one", "two", "three"].map(id => ({ id, title: id, body: id, transition: `Next after ${id}`, kind: "finding", evidenceIds: [`e-${id}`] }));
it("edits a route card without changing its evidence or historical kind", () => {
  const saved = saveRouteCard(sections, { id: "two", title: "My heading", body: "My correction", transition: "Next topic" });
  expect(saved[1]).toMatchObject({ kind: "finding", evidenceIds: ["e-two"], userEdited: true });
  expect(saved[0]).toBe(sections[0]); expect(sections[1].body).toBe("two");
});
it("inserts personal understanding and invalidates transitions after ordering changes", () => {
  const saved = saveRouteCard(sections, { id: "mine", title: "My card", body: "My understanding", transition: "", before: "two" });
  expect(saved.map(s => s.id)).toEqual(["one", "mine", "two", "three"]);
  expect(saved[1]).toMatchObject({ origin: "user", evidenceIds: [] });
  expect(saved[0].transition).toBe("");
  const moved = moveRouteCard(saved, "three", "one");
  expect(moved.map(s => s.id)).toEqual(["three", "one", "mine", "two"]);
  expect(moved.at(-1)?.transition).toBe("");
});

it("retains personal grouping and relationships when reordering or editing a legacy card", () => {
  const saved = saveRouteCard(sections, { id: "two", title: "My heading", body: "My correction", transition: "", phase: "Foundations", links: [{ targetId: "one", kind: "comparison" }, { targetId: "missing", kind: "contains" }] });
  expect(saved[1]).toMatchObject({ phase: "Foundations", understandingLinks: [{ targetId: "one", kind: "comparison" }] });
  const moved = moveRouteCard(saved, "two", undefined);
  expect(moved.at(-1)?.understandingLinks).toEqual(saved[1].understandingLinks);
  expect(saveRouteCard(moved, { id: "two", title: "Second edit", body: "My correction", transition: "" }).at(-1)?.phase).toBe("Foundations");
});

it("preserves responsibilities and feedback across reorder, legacy editing and explicit clearing", () => {
  const saved = saveRouteCard(sections, { id: "two", title: "校验", body: "核对条件", transition: "", responsibility: "检查候选方案", links: [{ targetId: "one", kind: "feedback" }] });
  const moved = moveRouteCard(saved, "two", undefined);
  const edited = saveRouteCard(moved, { id: "two", title: "校验模块", body: "核对条件", transition: "" }).at(-1)!;
  expect(edited).toMatchObject({ responsibility: "检查候选方案", understandingLinks: [{ targetId: "one", kind: "feedback" }], evidenceIds: ["e-two"], userEdited: true });
  expect(saveRouteCard([edited], { id: "two", title: edited.title, body: edited.body, transition: "", responsibility: "", links: [] })[0]).toMatchObject({ responsibility: undefined, understandingLinks: [] });
});

it("keeps unchanged generated flow when editing only personal structure", () => {
  const input = [{ ...sections[0], title: "生成", body: "输出给校验。" }, { ...sections[1], title: "校验", body: "核对条件。" }];
  const saved = saveRouteCard(input, { id: "one", title: "生成", body: "输出给校验。", transition: input[0].transition, responsibility: "我的说明" });
  expect(saved[0]).toMatchObject({ structureEdited: true, userEdited: false, responsibility: "我的说明" });
  expect(understandingEdges(saved)[0]).toMatchObject({ from: "one", to: "two", kind: "flow" });
});

it("deletes personal cards and inbound links while protecting source-derived cards", () => {
  const personal = saveRouteCard(sections, { id: "user-mine", title: "我的理解", body: "内容", transition: "" });
  const linked = personal.map(section => section.id === "one" ? { ...section, understandingLinks: [{ targetId: "user-mine", kind: "requires" as const }] } : section);
  const result = removePersonalRouteCard(linked, "user-mine");
  expect(result.map(section => section.id)).toEqual(sections.map(section => section.id));
  expect(result[0].understandingLinks).toEqual([]);
  expect(linked[0].understandingLinks).toHaveLength(1);
  expect(() => removePersonalRouteCard(linked, "one")).toThrow();
});
