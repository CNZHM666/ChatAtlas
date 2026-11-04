import {expect,it} from "vitest";
import {withWikiOutline} from "../test/wiki-outline-fixture";
import {contextKnowledge} from "../test/context-fixture";
import {planWikiTopics} from "./wiki-topic-plan";
import {WIKI_DIRECTORY_EDITING_INSTRUCTIONS,WIKI_SCOPED_DIRECTORY_EDITING_INSTRUCTIONS} from "./wiki-directory-editing";
import {WIKI_COMPOSITION_INSTRUCTIONS,CURRENT_WIKI_READER_STATUS_INSTRUCTIONS,WIKI_READER_STATUS_INSTRUCTIONS,WIKI_CLAIM_LIMIT_INSTRUCTIONS} from "./wiki-composition-instructions";
import type {StructuredAIRequest} from "./provider";

it("sends the directory editing rules with every directory request",async()=>{
 const systems:string[]=[];
 const sections=contextKnowledge().session.sections.map(section=>({...section,kind:"finding" as const}));
 await planWikiTopics(sections,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  systems.push(request.system);const data=JSON.parse(request.prompt);
  return request.validate(withWikiOutline({pages:[{title:"数据保存",group:"技术",question:"如何保存消息",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}));
 }},new AbortController().signal);
 expect(systems.length).toBeGreaterThan(0);
 for(const system of systems)expect(system).toContain(WIKI_DIRECTORY_EDITING_INSTRUCTIONS);
});

it("names shared subjects and sends side material to scope review before chapter placement",()=>{
 expect(WIKI_DIRECTORY_EDITING_INSTRUCTIONS).toContain("统一搜索+智能书签 -> 找回历史消息");
 expect(WIKI_DIRECTORY_EDITING_INSTRUCTIONS).toContain("Keep 与/and for an inseparable pair");
 expect(WIKI_SCOPED_DIRECTORY_EDITING_INSTRUCTIONS).toContain("propose unrelated material as other for user review");
 expect(WIKI_SCOPED_DIRECTORY_EDITING_INSTRUCTIONS).toContain("Ambiguous ownership is uncertain: retain its route");
 expect(WIKI_SCOPED_DIRECTORY_EDITING_INSTRUCTIONS).toContain("Assign chapter responsibilities BEFORE deduplication");
 expect(WIKI_SCOPED_DIRECTORY_EDITING_INSTRUCTIONS).toContain("Neither case deletes originals");
});

it("writes current understanding first, states status once and dates superseded designs in the current edition",()=>{
 expect(WIKI_COMPOSITION_INSTRUCTIONS.endsWith(WIKI_CLAIM_LIMIT_INSTRUCTIONS+CURRENT_WIKI_READER_STATUS_INSTRUCTIONS)).toBe(true);
 for(const rule of ["Current first","历史：","workStatus:proposed","材料未显示用户已确认采用","Never invent a replacement","这一阶段之后"])expect(WIKI_READER_STATUS_INSTRUCTIONS).toContain(rule);
});
