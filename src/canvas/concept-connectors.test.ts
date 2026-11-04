import { expect, it } from "vitest";
import { conceptConnectors, connectorKey, type ConceptBox } from "./concept-connectors";
import type { UnderstandingEdge } from "./understanding-model";
const box = (left: number, top: number, width = 100, height = 70): ConceptBox => ({ left, right: left + width, top, bottom: top + height });
const edge = (from: string, to: string, kind: UnderstandingEdge["kind"] = "flow"): UnderstandingEdge => ({ from, to, kind, excerpt: "" });

it("never wraps decorative root branches around rows of independent cards", () => {
  const boxes = new Map([["a", box(20, 100)], ["b", box(160, 100)], ["c", box(90, 200)]]);
  const paths = conceptConnectors(boxes, [], new Map([["a", 0], ["b", 0], ["c", 0]]), 400, box(100, 10));
  expect(paths.map(path => path.to)).toEqual(["a", "b"]);
  expect(paths.every(path => path.root && !path.path.includes("200"))).toBe(true);
});

it("keeps short branches and leaves cross-layer links available for the relation list", () => {
  const boxes = new Map([["a", box(100, 20)], ["b", box(20, 140)], ["c", box(200, 140)], ["d", box(100, 260)]]);
  const edges = [edge("a", "b"), edge("a", "c"), edge("b", "d"), edge("a", "d")];
  const paths = conceptConnectors(boxes, edges, new Map([["a", 0], ["b", 1], ["c", 1], ["d", 2]]), 420);
  expect(paths.map(path => path.id)).toContain(connectorKey(edges[0]));
  expect(paths.map(path => path.id)).toContain(connectorKey(edges[1]));
  expect(paths.map(path => path.id)).not.toContain(connectorKey(edges[3]));
  expect(edges).toHaveLength(4);
});

it("does not draw through another card or cross a different parent's bus", () => {
  const boxes = new Map([["a", box(20, 20)], ["b", box(200, 20)], ["c", box(200, 140)], ["d", box(20, 140)], ["obstacle", box(45, 65, 30, 25)]]);
  const edges = [edge("a", "c"), edge("b", "d")];
  const paths = conceptConnectors(boxes, edges, new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]), 400);
  expect(paths).toHaveLength(1);
  expect(paths[0].from).toBe("b");
  boxes.delete("obstacle");
  expect(conceptConnectors(boxes, edges, new Map([["a", 0], ["b", 0], ["c", 1], ["d", 1]]), 400)).toHaveLength(1);
});

it("reserves an outside feedback channel and falls back when its label cannot fit", () => {
  const boxes = new Map([["a", box(80, 20)], ["b", box(80, 140)]]), edges = [edge("a", "b"), edge("b", "a", "feedback")], rank = new Map([["a", 0], ["b", 1]]);
  const roomy = conceptConnectors(boxes, edges, rank, 400);
  expect(roomy.some(path => path.feedback)).toBe(true);
  expect(roomy.find(path => path.feedback)!.x - 42).toBeGreaterThan(boxes.get("a")!.right);
  expect(conceptConnectors(boxes, edges, rank, 230).some(path => path.feedback)).toBe(false);
  const labels = new Map([[connectorKey(edges[1]), 140]]);
  const expanded = conceptConnectors(boxes, edges, rank, 400, undefined, labels).find(path => path.feedback)!;
  expect(expanded.labelWidth).toBe(140);
  expect(expanded.x - expanded.labelWidth / 2).toBeGreaterThan(boxes.get("a")!.right);
  expect(conceptConnectors(boxes, edges, rank, 300, undefined, labels).some(path => path.feedback)).toBe(false);
});
