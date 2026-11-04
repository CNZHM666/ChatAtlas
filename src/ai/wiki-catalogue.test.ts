import {expect,it} from "vitest";
import {wikiCatalogueSummary,wikiScopeCatalogue} from "./wiki-catalogue";
import {createWikiTopicPlanner,type WikiPlanReceipt} from "./wiki-topic-plan";
import type {FocusSection} from "../shared/focus-session";
import type {StructuredAIRequest} from "./provider";

const section=(body:string):FocusSection=>({id:"original",title:"项目讨论",body,kind:"finding",transition:"",evidenceIds:["e1"]});
const marker="\n\nSOURCE DETAIL INVENTORY (evidence for prose/claims, not separate chapters or adoption proof):\n";

it("retains late ownership, conditions, statuses and literal quotes that navigation summaries hide",()=>{
 const late="另一个产品的整理功能不属于硬件项目。",lead="Hardware project context. ".repeat(14)+late;
 const inventory={details:[...Array.from({length:7},(_,i)=>({kind:"module",title:`组件${i}`,purpose:"项目内的接口",status:"proposal"})),{kind:"decisions",text:"sessionStorage 仅为早期方案，是否改为内存仍未决定",reason:late,status:"uncertain"}],originals:{q1:{role:"assistant",text:late,sourceIds:["e1"]}}};
 const note=section(lead+marker+JSON.stringify(inventory)),before=structuredClone(note);
 expect(wikiCatalogueSummary(note)).not.toContain(late);
 const catalogue=wikiScopeCatalogue(note);
 expect(catalogue.lead).toBe(lead);expect(catalogue.scopeDetails).toEqual(inventory.details);
 expect(catalogue.scopeQuotes).toEqual([{role:"assistant",text:late}]);expect(catalogue.scopeContext.complete).toBe(true);
 expect(note).toEqual(before);
});

it("reports omitted whole rows and malformed inventories rather than certifying complete scope context",()=>{
 const inventory={details:[{text:"short"},{text:"long".repeat(2000)}],originals:{q:{text:"later quote"}}};
 const result=wikiScopeCatalogue(section("lead"+marker+JSON.stringify(inventory)));
 expect(result.scopeDetails).toEqual([inventory.details[0]]);expect(result.scopeContext).toMatchObject({complete:false,omittedDetails:1});
 expect(wikiScopeCatalogue(section("lead"+marker+"{broken")).scopeContext.complete).toBe(false);
 expect(wikiScopeCatalogue(section("x".repeat(7000))).scopeContext.complete).toBe(false);
});

it("sends the full scope context to planning, including the seventh inventory subject and its proof",async()=>{
 const quote="另一个产品的 ProjectEvent 方案",inventory={details:Array.from({length:7},(_,i)=>({kind:"module",title:i===6?quote:`组件${i}`})),originals:{q:{role:"assistant",text:quote}}};
 const note=section("硬件项目的背景。"+marker+JSON.stringify(inventory));let calls=0;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const data=JSON.parse(request.prompt);expect(data.sections[0].scopeDetails).toHaveLength(7);expect(data.sections[0].scopeQuotes[0].text).toBe(quote);
  return request.validate({pages:[{title:"项目范围",subtopics:[{title:"保留条件"}]}],routes:[{chapter:0,subtopics:[0]}],scope:[]});
 }},new AbortController().signal,undefined,{goal:"整理硬件平台",project:{name:"硬件平台"}});
 planner.append([note]);await planner.finish();expect(calls).toBe(1);expect(planner.scopeReview()?.status).toBe("complete");
});

it("keeps an oversized note and its originals, but records incomplete scope review even for scope:[]",async()=>{
 const note=section("note ".repeat(1500)),before=structuredClone(note);let receipt:WikiPlanReceipt|undefined;
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);expect(data.sections[0].scopeContext.complete).toBe(false);
  return request.validate({pages:[{title:"项目范围",subtopics:[{title:"原始条件"}]}],routes:[{chapter:0,subtopics:[0]}],scope:[]});
 }},new AbortController().signal,value=>{receipt=value;},{goal:"核对项目"});
 planner.append([note]);expect((await planner.finish())[0].sectionIds).toEqual([note.id]);
 expect(planner.scopeReview()).toMatchObject({status:"incomplete",materials:[]});expect(receipt?.scope?.contextOmitted).toBe(1);expect(note).toEqual(before);
});

it("does not mark a complete sibling unreviewed when another material omits context",async()=>{
 const complete={...section("本项目要求保留深浅色模式和架构约束。"),id:"complete"};
 const omitted={...section("背景条件。".repeat(1600)),id:"omitted"};
 const planner=createWikiTopicPlanner("zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  return request.validate({pages:[{title:"项目要求",subtopics:[{title:"使用条件",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}],scope:[]});
 }},new AbortController().signal,undefined,{goal:"整理项目"});
 planner.append([complete,omitted]);await planner.finish();
 expect(planner.scopeReview()?.unreviewed).toEqual([expect.objectContaining({id:"omitted",reason:"context_omitted"})]);
});
