import {expect,it} from "vitest";
import {wikiScopeConflictChapters} from "./wiki-scope-conflicts";
import {contextKnowledge} from "../test/context-fixture";

it("checks explicit directory contradictions without classifying quoted source text or deleting content",()=>{
 const base=contextKnowledge().session.sections[0];
 const sections=[{...base,id:"outside",title:"知识管理与参考",wikiQuestion:"哪些内容属于项目之外的参考或背景讨论？"},{...base,id:"normal",title:"外部参考",wikiQuestion:"竞品的导出设计如何帮助本项目？",body:"来源里讨论了项目之外的事情。"},{...base,id:"personal",title:"旁支与参考",userEdited:true},{...base,id:"confirmed",title:"零件盒",wikiQuestion:"库存如何保存？"}];
 const before=structuredClone(sections);expect(wikiScopeConflictChapters(sections).map(section=>section.id)).toEqual(["outside"]);expect(sections).toEqual(before);
});
