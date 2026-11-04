import { describe, expect, it } from "vitest";
import type { FocusSection } from "../shared/focus-session";
import type { UnderstandingEdge } from "./understanding-model";
import { createDiagramGraph, diagramTextLines, layoutDiagram } from "./diagram-layout";
import { routeSegments } from "./diagram-routing";

const sections: FocusSection[] = ["用户需求", "方案规划", "Hardware IR", "规则校验", "模块视图", "ESP32固件", "缺件清单", "真实硬件验证"].map((title, index) => ({ id: `node:${index}`, title, body: "说明", transition: "", evidenceIds: [], kind: "review" }));
const edge = (from: number, to: number, kind: UnderstandingEdge["kind"], label: string): UnderstandingEdge => ({ from: sections[from].id, to: sections[to].id, kind, label, excerpt: label });
const edges = [edge(0, 1, "flow", "明确目标与约束"), edge(1, 2, "flow", "形成结构化方案"), edge(2, 3, "flow", "提交方案"), edge(3, 1, "feedback", "问题与修正要求"), edge(3, 4, "flow", "通过校验的方案"), edge(2, 5, "flow", "生成程序"), edge(2, 6, "flow", "比对库存"), edge(4, 7, "flow", "连接与运行"), edge(5, 7, "flow", "烧录程序"), edge(7, 1, "feedback", "反馈现实中的问题")];
const groups = [{ id: "planning", title: "需求与规划", items: sections.slice(0, 2) }, { id: "core", title: "核心处理", items: sections.slice(2, 4) }, { id: "delivery", title: "交付与验证", items: sections.slice(4) }];
describe("compact diagram layout", () => {
  it("keeps return lines clear of forward branches and other return tracks", async () => {
    for (const direction of ["DOWN", "RIGHT"] as const) {
      const result = await layoutDiagram({ sections, edges, direction, labels: false, zh: true });
      const segments = result.links.map(link => ({ id: link.id, segments: link.paths.flatMap(path => routeSegments([...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => ({ x: Number(match[1]), y: Number(match[2]) })))) }));
      for (const returning of segments.filter(link => link.id.includes("feedback"))) {
        expect(returning.segments.length).toBeGreaterThan(0);
        for (const other of segments.filter(link => link !== returning)) for (const a of returning.segments) for (const b of other.segments) {
          const horizontal = a.from.y === a.to.y;
          if (horizontal !== (b.from.y === b.to.y)) continue;
          const distance = horizontal ? Math.abs(a.from.y - b.from.y) : Math.abs(a.from.x - b.from.x);
          const overlap = horizontal
            ? Math.min(Math.max(a.from.x, a.to.x), Math.max(b.from.x, b.to.x)) - Math.max(Math.min(a.from.x, a.to.x), Math.min(b.from.x, b.to.x))
            : Math.min(Math.max(a.from.y, a.to.y), Math.max(b.from.y, b.to.y)) - Math.max(Math.min(a.from.y, a.to.y), Math.min(b.from.y, b.to.y));
          expect(distance >= 10 || overlap <= 0, `${direction}: ${returning.id} shares a corridor with ${other.id}`).toBe(true);
        }
      }
    }
  });
  it("routes a saved cycle outside without turning its returning dependency into a forward rank", async () => {
    const forward = edge(0, 1, "flow", "生成方案"), returning = edge(1, 0, "requires", "再次核对需求");
    const main = await layoutDiagram({ sections: sections.slice(0, 2), edges: [forward], direction: "DOWN", labels: false, zh: true });
    const all = await layoutDiagram({ sections: sections.slice(0, 2), edges: [forward, returning], direction: "DOWN", labels: false, zh: true });
    expect(all.nodes).toEqual(main.nodes);
    expect(all.links).toHaveLength(2);
    expect(all.links.every(link => link.paths.length > 0)).toBe(true);
    expect(returning.kind).toBe("requires");
  });
  it("keeps forward positions and aligned card sizes when return connections are revealed", async () => {
    const readable = sections.map((node, i) => ({ ...node, purpose: i === 0 ? "提取设计条件" : "保留原文中的模块职责和边界条件。" }));
    for (const direction of ["RIGHT", "DOWN"] as const) {
      const main = await layoutDiagram({ sections: readable, edges: edges.filter(edge => edge.kind !== "feedback"), showDetails: true, labels: false, direction, zh: true });
      const all = await layoutDiagram({ sections: readable, edges, showDetails: true, labels: false, direction, zh: true });
      expect(new Set(main.nodes.map(node => `${node.width}:${node.height}`)).size).toBe(1);
      const anchor = main.nodes[0], expandedAnchor = all.nodes.find(node => node.id === anchor.id)!;
      for (const node of main.nodes) {
        const expanded = all.nodes.find(item => item.id === node.id)!;
        expect(expanded.x - expandedAnchor.x).toBeCloseTo(node.x - anchor.x);
        expect(expanded.y - expandedAnchor.y).toBeCloseTo(node.y - anchor.y);
      }
      expect(all.links).toHaveLength(edges.length);
      for (const link of all.links) for (const path of link.paths) {
        const points = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => [Number(match[1]), Number(match[2])]);
        for (const point of points) { expect(point[0]).toBeGreaterThanOrEqual(0); expect(point[1]).toBeGreaterThanOrEqual(0); expect(point[0]).toBeLessThanOrEqual(all.width); expect(point[1]).toBeLessThanOrEqual(all.height); }
      }
    }
  });
  it("respects direction for sparse diagrams without inventing connections between isolated cards", async () => {
    const sparse = [edge(6, 7, "flow", "补齐元件后验证")];
    for (const grouping of [undefined, [{ id: "standalone", title: "已有板块", items: sections.slice(0, 4) }]]) {
      const right = await layoutDiagram({ sections, edges: sparse, groups: grouping, zh: true, direction: "RIGHT" });
      const down = await layoutDiagram({ sections, edges: sparse, groups: grouping, zh: true, direction: "DOWN" });
      expect(right.width / right.height).toBeGreaterThan(down.width / down.height);
      expect(right.nodes).toHaveLength(8); expect(down.nodes).toHaveLength(8);
      expect(right.links).toHaveLength(1); expect(down.links).toHaveLength(1);
      const last = (layout: typeof right, id: string) => layout.nodes.find(node => node.id === id)!;
      expect(last(right, sections[7].id).x).toBeGreaterThan(last(right, sections[6].id).x);
      expect(last(down, sections[7].id).y).toBeGreaterThan(last(down, sections[6].id).y);
      expect(sections.map(section => section.id)).toEqual(Array.from({ length: 8 }, (_, index) => `node:${index}`));
    }
  });
  it("packs disconnected architecture modules without one tall column or fabricated connectors",async()=>{
    const nodes=Array.from({length:15},(_,index)=>({...sections[0],id:`isolated:${index}`,title:`模块 ${index+1}`}));
    const ordered=await layoutDiagram({sections:nodes,edges:[],zh:true,direction:"DOWN",showDetails:true});
    const compact=await layoutDiagram({sections:nodes,edges:[],zh:true,architecture:true,direction:"DOWN",showDetails:true});
    expect(compact.links).toEqual([]);expect(compact.nodes).toHaveLength(15);
    expect(compact.height).toBeLessThan(ordered.height);expect(new Set(compact.nodes.map(node=>node.x)).size).toBeGreaterThan(1);
    for(const [index,node]of compact.nodes.entries())for(const other of compact.nodes.slice(index+1))expect(node.x<other.x+other.width&&node.x+node.width>other.x&&node.y<other.y+other.height&&node.y+node.height>other.y).toBe(false);
  });
  it("lays out all modules in their compound group with orthogonal routes and full named relationships", async () => {
    const before = structuredClone({ sections, edges, groups });
    const result = await layoutDiagram({ sections, edges, groups, zh: true });
    expect(result.nodes).toHaveLength(8); expect(result.groups).toHaveLength(3); expect(result.links).toHaveLength(10);
    expect(result.width).toBeGreaterThan(result.height);
    for (const group of groups) {
      const box = result.groups.find(item => item.title === group.title)!;
      for (const member of group.items) {
        const node = result.nodes.find(item => item.id === member.id)!;
        expect(node.x).toBeGreaterThanOrEqual(box.x); expect(node.y).toBeGreaterThan(box.y);
        expect(node.x + node.width).toBeLessThanOrEqual(box.x + box.width + .01);
        expect(node.y + node.height).toBeLessThanOrEqual(box.y + box.height + .01);
      }
    }
    for (const link of result.links) {
      expect(link.paths.length).toBeGreaterThan(0); expect(link.labels[0].lines.join("")).not.toMatch(/^\d+$/u);
      for (const path of link.paths) {
        const points = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(match => [Number(match[1]), Number(match[2])]);
        points.slice(1).forEach((point, index) => expect(Math.min(Math.abs(point[0] - points[index][0]), Math.abs(point[1] - points[index][1])), path).toBeLessThan(.001));
        points.slice(1).forEach((point, index) => result.nodes.forEach(node => {
          const previous = points[index], vertical = Math.abs(point[0] - previous[0]) < .001;
          const crosses = vertical ? point[0] > node.x + .001 && point[0] < node.x + node.width - .001 && Math.min(point[1], previous[1]) < node.y + node.height - .001 && Math.max(point[1], previous[1]) > node.y + .001 : point[1] > node.y + .001 && point[1] < node.y + node.height - .001 && Math.min(point[0], previous[0]) < node.x + node.width - .001 && Math.max(point[0], previous[0]) > node.x + .001;
          expect(crosses, `${path} intersects ${node.id}`).toBe(false);
        }));
      }
    }
    expect({ sections, edges, groups }).toEqual(before);
  });
  it("keeps node and label bounds clear of each other", async () => {
    const result = await layoutDiagram({ sections, edges, groups, zh: true });
    const overlaps = (a: { x: number; y: number; width: number; height: number }, b: typeof a) => a.x < b.x + b.width - .01 && a.x + a.width > b.x + .01 && a.y < b.y + b.height - .01 && a.y + a.height > b.y + .01;
    result.nodes.forEach((node, index) => result.nodes.slice(index + 1).forEach(other => expect(overlaps(node, other)).toBe(false)));
    result.links.flatMap(link => link.labels).forEach(label => result.nodes.forEach(node => expect(overlaps(label, node)).toBe(false)));
  });
  it("lays out review containment and comparisons without inventing flow edges", async () => {
    const review = [edge(0, 1, "contains", "包含"), edge(0, 2, "contains", "包含"), edge(1, 2, "comparison", "条件不同"), edge(2, 3, "example", "举例")];
    const result = await layoutDiagram({ sections: sections.slice(0, 4), edges: review, zh: true, review: true });
    expect(result.nodes).toHaveLength(4); expect(result.links).toHaveLength(4);
    expect(result.nodes.find(node => node.id === sections[0].id)!.y).toBeLessThan(result.nodes.find(node => node.id === sections[1].id)!.y);
    expect(result.links.some(link => link.id.includes("comparison"))).toBe(true);
    const backbone = await layoutDiagram({ sections: sections.slice(0, 4), edges: review.filter(item => item.kind !== "comparison"), zh: true, review: true });
    // Exterior lanes may add canvas padding; they must not rearrange the graph.
    const dx = result.nodes[0].x - backbone.nodes[0].x, dy = result.nodes[0].y - backbone.nodes[0].y;
    expect(result.nodes.map(node => ({ ...node, x: node.x - dx, y: node.y - dy }))).toEqual(backbone.nodes);
    expect(result.links.find(link => link.id.includes("comparison"))!.paths.length).toBeGreaterThan(0);
    expect(review.map(edge => edge.kind)).toEqual(["contains", "contains", "comparison", "example"]);
  });
  it("keeps the entry before outputs when feedback returns across compound groups", async () => {
    const result = await layoutDiagram({ sections, edges, groups, zh: true, labels: false, direction: "RIGHT" });
    const positions = new Map(result.nodes.map(node => [node.id, node]));
    for (const edge of edges.filter(edge => edge.kind === "flow")) expect(positions.get(edge.from)!.x).toBeLessThan(positions.get(edge.to)!.x);
    const vertical = await layoutDiagram({ sections, edges, groups, zh: true, labels: false, direction: "DOWN" });
    expect(vertical.height).toBeGreaterThan(vertical.width);
    expect(vertical.links).toHaveLength(edges.length);
  });
  it("excludes uncertain and orphan relations and does not reuse another project's node IDs", async () => {
    const withInvalid = [...edges, { ...edges[0], uncertain: true as const }, { ...edges[0], to: "missing" }];
    const valid = createDiagramGraph({ sections, edges: withInvalid, zh: true });
    expect(valid.graph.edges).toHaveLength(8);
    expect(valid.feedback).toHaveLength(2);
    const first = await layoutDiagram({ sections: sections.slice(0, 2), edges: [], zh: true });
    const renamed = sections.slice(0, 2).map(node => ({ ...node, id: `other-${node.id}` }));
    const second = await layoutDiagram({ sections: renamed, edges: [], zh: true });
    expect(first.nodes.map(node => node.id)).toEqual(sections.slice(0, 2).map(node => node.id));
    expect(second.nodes.map(node => node.id)).toEqual(renamed.map(node => node.id));
    const flow = await layoutDiagram({ sections: sections.slice(0, 2), edges: [edge(0, 1, "flow", "关联")], zh: true });
    const prerequisite = await layoutDiagram({ sections: sections.slice(0, 2), edges: [edge(0, 1, "requires", "关联")], zh: true });
    expect(flow.links[0].id).not.toBe(prerequisite.links[0].id);
  });
  it("retains complete Chinese and technical labels when wrapping", () => {
    for (const text of ["前置条件与例外情况需要一起回顾", "Hardware IR / ESP32 Firmware"]) expect(diagramTextLines(text, 8).join("")).toBe(text);
    expect(diagramTextLines("从状态矩阵求特征值，对应系统极点。", 14)).toEqual(["从状态矩阵求特征值，", "对应系统极点。"]);
  });

  it("keeps parallel branches and feedback readable for shuffled, partially grouped project data", async () => {
    const shuffled = [sections[7], sections[4], sections[0], sections[6], sections[3], sections[2], sections[1], sections[5]];
    const partialGroups = groups.slice(0, 2);
    for (const direction of ["RIGHT", "DOWN"] as const) {
      const result = await layoutDiagram({ sections: shuffled, edges, groups: partialGroups, zh: true, labels: false, direction });
      expect(result.nodes).toHaveLength(sections.length);
      expect(result.links).toHaveLength(edges.length);
      const positions = new Map(result.nodes.map(node => [node.id, node]));
      for (const connection of edges.filter(item => item.kind === "flow")) {
        const from = positions.get(connection.from)!, to = positions.get(connection.to)!;
        expect(direction === "RIGHT" ? to.x > from.x : to.y > from.y).toBe(true);
      }
      for (const connection of edges.filter(item => item.kind === "feedback")) {
        const link = result.links.find(item => item.id.includes(connection.from) && item.id.includes(connection.to));
        expect(link).toBeDefined();
      }
    }
  });
});
