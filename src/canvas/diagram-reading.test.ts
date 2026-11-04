import { describe, expect, it } from "vitest";
import { diagramReadingEdges } from "./diagram-reading";
import type { UnderstandingEdge } from "./understanding-model";
import { layoutDiagram } from "./diagram-layout";
import type { FocusSection } from "../shared/focus-session";

describe("readable diagram", () => {
  it("keeps supported connections, all nodes and original edges while taking loops out of the reading backbone", () => {
    const edges: UnderstandingEdge[] = [{ from: "a", to: "b", kind: "flow", excerpt: "ab" }, { from: "b", to: "c", kind: "requires", excerpt: "bc" }, { from: "c", to: "a", kind: "feedback", excerpt: "ca" }, { from: "a", to: "c", kind: "flow", excerpt: "ac" }, { from: "d", to: "e", kind: "comparison", excerpt: "de" }];
    const original = structuredClone(edges), reading = diagramReadingEdges(edges);
    expect(reading).toEqual([edges[0], edges[1], edges[3], edges[4]]);
    expect(edges).toEqual(original);
  });
  it("preserves parallel inputs and separates sibling comparisons from the reading hierarchy", () => {
    const edges: UnderstandingEdge[] = [
      { from: "root", to: "a", kind: "contains", excerpt: "分类" },
      { from: "root", to: "b", kind: "contains", excerpt: "分类" },
      { from: "a", to: "b", kind: "comparison", excerpt: "条件不同" },
      { from: "a", to: "result", kind: "flow", excerpt: "输入一" },
      { from: "b", to: "result", kind: "flow", excerpt: "输入二" },
      { from: "result", to: "root", kind: "requires", excerpt: "循环" },
    ];
    expect(diagramReadingEdges(edges)).toEqual([edges[0], edges[1], edges[3], edges[4]]);
  });
  it("lays out the entire hierarchy together without label clutter or routes through cards", async () => {
    const sections: FocusSection[] = ["需求", "规划", "Hardware IR", "校验", "工作台", "固件", "缺件", "实物验证"].map((title, i) => ({ id: String(i), title, body: "", kind: "review", transition: "", evidenceIds: [] }));
    const edges: UnderstandingEdge[] = [[0, 1], [1, 2], [2, 3], [3, 4], [2, 5], [2, 6], [4, 7]].map(([a, b]) => ({ from: String(a), to: String(b), kind: "flow", label: "传递方案", excerpt: "传递方案" }));
    const result = await layoutDiagram({ sections, edges, groups: [{ id: "p", title: "规划", items: sections.slice(0, 2) }, { id: "c", title: "处理", items: sections.slice(2, 4) }, { id: "d", title: "交付", items: sections.slice(4) }], simple: true, labels: false, zh: true });
    expect(result.nodes).toHaveLength(8); expect(result.links).toHaveLength(7);
    expect(result.width).toBeLessThan(1600);
    expect(result.height).toBeLessThan(780);
    expect(result.links.flatMap(link => link.labels)).toHaveLength(0);
    for (const link of result.links) for (const path of link.paths) {
      const points = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => [Number(match[1]), Number(match[2])]);
      points.slice(1).forEach((point, index) => result.nodes.forEach(node => {
        const previous = points[index], vertical = Math.abs(point[0] - previous[0]) < .001;
        const crosses = vertical ? point[0] > node.x + .001 && point[0] < node.x + node.width - .001 && Math.min(point[1], previous[1]) < node.y + node.height - .001 && Math.max(point[1], previous[1]) > node.y + .001 : point[1] > node.y + .001 && point[1] < node.y + node.height - .001 && Math.min(point[0], previous[0]) < node.x + node.width - .001 && Math.max(point[0], previous[0]) > node.x + .001;
        expect(crosses, `${path} intersects ${node.id}`).toBe(false);
      }));
    }
  });
});
