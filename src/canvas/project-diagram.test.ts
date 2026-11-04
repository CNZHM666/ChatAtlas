import { expect, it } from "vitest";
import { projectDiagram } from "./project-diagram";
import { projectSession } from "../test/project-fixture";
it("presents sourced subsystems as an overview even for a small project and restores every child", () => {
 const state=projectSession().projectState!,modules=Array.from({length:6},(_,i)=>({...state.modules[0],id:`m${i}`,layer:""}));
 const relations=[1,2,3,4].map(i=>({...state.relations[0],kind:"contains" as const,from:"m0",to:`m${i}`}));
 const overview=projectDiagram(modules,relations,new Set());
 expect(overview.nodes.map(node=>node.id)).toEqual(["m5","diagram-group:subsystem:m0"]);
 const detail=projectDiagram(modules,relations,new Set(["subsystem:m0"]));
 expect(detail.nodes).toHaveLength(6); expect(detail.links).toEqual(relations);
});
it("retains all provenance on aggregated connections and expands explicit containment",()=>{
 const state=projectSession().projectState!,modules=Array.from({length:15},(_,i)=>({...state.modules[0],id:`m${i}`,layer:i<7?"交互":"服务"}));
 const grouped=projectDiagram(modules,[{...state.relations[0],from:"m0",to:"m8",quote:"甲原句",evidenceIds:["a"]},{...state.relations[0],from:"m1",to:"m9",quote:"乙原句",evidenceIds:["b"]}],new Set());
 expect(grouped.links[0]).toMatchObject({quote:"甲原句\n\n乙原句",evidenceIds:["a","b"]});
 const relations=[1,2,3,4].map(i=>({...state.relations[0],kind:"contains" as const,from:"m0",to:`m${i}`}));
 expect(projectDiagram(modules,relations,new Set()).groupIds).toContain("subsystem:m0");
 expect(projectDiagram(modules,relations,new Set(),"m2").nodes.some(item=>item.id==="m2")).toBe(true);
});

it("folds only real layers, retaining sourced external edges and restoring internal ones on expansion", () => {
  const state = projectSession().projectState!;
  const modules = Array.from({length: 15}, (_, i) => ({...state.modules[0], id:`module:${i}`, layer:i<7?"交互层":"服务层"}));
  const relations = [{...state.relations[0], from:"module:0", to:"module:1"}, {...state.relations[0], from:"module:1", to:"module:9"}];
  const before = structuredClone({modules, relations});
  const folded = projectDiagram(modules, relations, new Set());
  expect(folded.nodes).toHaveLength(2);
  expect(folded.links).toHaveLength(1);
  expect(folded.links[0].quote).toBe(relations[1].quote);
  expect(folded.links[0].from).toMatch(/^diagram-group:/);
  const expanded = projectDiagram(modules, relations, new Set(folded.groupIds));
  expect(expanded.nodes).toHaveLength(15);
  expect(expanded.links).toEqual(relations);
  expect({modules,relations}).toEqual(before);
});

it("does not invent a layer or connection for ungrouped modules", () => {
  const modules = Array.from({length:15},(_,i)=>({...projectSession().projectState!.modules[0],id:`module:${i}`,layer:""}));
  const diagram = projectDiagram(modules, [], new Set());
  expect(diagram.nodes).toHaveLength(15);
  expect(diagram.links).toEqual([]);
});
