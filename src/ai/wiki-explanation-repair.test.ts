import {expect,it} from "vitest";
import {consolidateWikiExplanations} from "./wiki-explanation-repair";
import {projectSession} from "../test/project-fixture";
import {sourceMessageSignature} from "../shared/source-signature";
import {groundWikiClaims} from "../shared/wiki-claims";
import {WIKI_SEMANTIC_VERSION} from "../shared/wiki-explanations";
import type {StructuredAIRequest} from "./provider";
import type {FocusSection} from "../shared/focus-session";
import type {ConversationMessage} from "../shared/types";

const proposal="我建议采用 Orama 作为搜索引擎。",claimed="用户已确认采用 Orama 作为搜索引擎。";
function fixture(extra:FocusSection[]=[]){
 const session=projectSession();session.projectState=undefined;session.runId=undefined;
 const originals:ConversationMessage[]=[{id:"m0",conversationId:"source",messageIndex:0,role:"assistant",content:proposal,preview:"",contentHash:"",createdAt:0,updatedAt:0}];
 session.evidence=[{id:"e0",conversationId:"source",messageId:"m0",title:"搜索",excerpt:proposal,sourceSignature:sourceMessageSignature(proposal)}];
 session.sourceConversationIds=["source"];session.sourceRoles={source:{m0:"assistant"}};session.sourceSignatures={source:{m0:sourceMessageSignature(proposal)}};session.sourceMessageOrder={source:["m0"]};
 const sections=[{id:"search",title:"搜索",body:`${claimed}\n\n索引在后台构建。`,kind:"finding" as const,transition:"",evidenceIds:["e0"],claims:[{text:claimed,quote:proposal,evidenceIds:["e0"],workStatus:"proposed" as const}]},...extra];
 session.sections=groundWikiClaims(sections,session.evidence,originals,true);session.wikiOrder=session.sections.map(section=>section.id);
 return {session,originals};
}
/** A provider double: the reply passes through the request's own validator, as in production. */
const model=(reply:(blocks:Array<{id:string;text:string}>)=>unknown)=>{
 const requests:StructuredAIRequest<unknown>[]=[];
 return {requests,ai:{id:"test",generateStructured:async <T,>(request:StructuredAIRequest<T>):Promise<T>=>{requests.push(request as StructuredAIRequest<unknown>);return request.validate(reply(JSON.parse(request.prompt).blocks));}}};
};
const signal=new AbortController().signal;

it("T07: repairs a located confirmation claim the sources do not support, and records the semantics version",async()=>{
 const {session,originals}=fixture();
 const {ai,requests}=model(blocks=>({edits:[{block:blocks.find(block=>block.text===claimed)!.id,markdown:"AI 建议采用 Orama 作为搜索引擎。"}]}));
 const result=await consolidateWikiExplanations(session,ai,signal,originals);
 expect(requests).toHaveLength(1);
 expect(result.sections[0].body).toBe("AI 建议采用 Orama 作为搜索引擎。\n\n索引在后台构建。");
 expect(result.wikiQuality).toMatchObject({repaired:1,requests:1,issues:[]});
 expect(result.wikiSemanticVersion).toBe(WIKI_SEMANTIC_VERSION);
 expect(result.wikiVerification?.implementation).toBe("not_checked");
});

it("rejects a repair that keeps the unsupported status or adds a number, leaving the issue recorded",async()=>{
 for(const markdown of ["用户已确认采用 Orama 作为搜索引擎，并且已上线。","AI 建议采用 Orama 作为搜索引擎，延迟 20 毫秒。"]){
  const {session,originals}=fixture();
  const {ai}=model(blocks=>({edits:[{block:blocks[0].id,markdown}]}));
  const result=await consolidateWikiExplanations(session,ai,signal,originals);
  expect(result.sections[0].body).toContain(claimed);
  expect(result.wikiQuality?.issues).toEqual([expect.objectContaining({code:"unsupported_status",sectionId:"search"})]);
  expect(result.wikiVerification?.status).toBe("history_digest");
 }
});

it("removes a duplicate paragraph only after the kept explanation states all of its details",async()=>{
 const flow="首次分析时解析对话并为每条消息生成稳定 ID 与去重，然后建立全文索引，最后持久化到本地，以后只更新变化的消息。";
 const reworded="对话第一次被分析时，系统会解析内容、为消息分配稳定 ID 并去重，建立全文索引后持久化，之后仅处理 contentHash 变化的消息。";
 const extra:FocusSection[]=[{id:"index",title:"搜索与索引",body:flow,kind:"finding",transition:"",evidenceIds:["e0"],claims:[{text:flow,quote:"采用 Orama",evidenceIds:["e0"]}]},{id:"cache",title:"增量缓存",body:reworded,kind:"finding",transition:"",evidenceIds:["e0"],claims:[{text:reworded,quote:"采用 Orama",evidenceIds:["e0"]}]}];
 const folded=`${flow.slice(0,-1)}，仅处理 contentHash 变化的消息。`;
 const run=async(keep:string)=>{
  const {session,originals}=fixture(extra);
  const {ai}=model(blocks=>{const id=(text:string)=>blocks.find(block=>block.text===text)?.id;return {edits:[...id(reworded)?[{block:id(reworded),markdown:""}]:[],...id(flow)?[{block:id(flow),markdown:keep}]:[]]};});
  return consolidateWikiExplanations(session,ai,signal,originals);
 };
 const lost=await run(flow);
 expect(lost.sections.find(section=>section.id==="cache")?.body).toBe(reworded);
 const merged=await run(folded);
 expect(merged.sections.find(section=>section.id==="index")?.body).toBe(folded);
 expect(merged.sections.find(section=>section.id==="cache")?.body).toBe("> 这部分已在[「搜索与索引」](#atlas-chapter-index)中说明。");
});

it("keeps personal chapters and works locally when no model is available",async()=>{
 const personal:FocusSection={id:"mine",title:"我的笔记",body:`${claimed}这是我的理解。`,kind:"finding",transition:"",evidenceIds:[],userEdited:true};
 const {session,originals}=fixture([personal]);
 const result=await consolidateWikiExplanations(session,{},signal,originals);
 expect(result.sections.find(section=>section.id==="mine")).toEqual(personal);
 expect(result.wikiQuality).toMatchObject({requests:0,repaired:0});
 expect(result.wikiQuality?.issues.every(issue=>issue.sectionId!=="mine")).toBe(true);
});

it("keeps the valid edits of a reply when another edit in it is invalid",async()=>{
 const unbound="Atlas 的核心技术决策是不把原始对话直接交给大模型生成视图，而是先建立索引与结构化结果再生成。";
 const {session,originals}=fixture();
 // Both issues sit in one chapter, so they travel in one request.
 session.sections[0]={...session.sections[0],body:`${session.sections[0].body}\n\n${unbound}`};
 const {ai}=model(blocks=>({edits:[{block:blocks.find(block=>block.text===claimed)!.id,markdown:"AI 建议采用 Orama 作为搜索引擎。"},{block:blocks.find(block=>block.text===unbound)!.id,markdown:"最终决定先建立索引。"}]}));
 const result=await consolidateWikiExplanations(session,ai,signal,originals);
 expect(result.sections[0].body).toContain("AI 建议采用 Orama 作为搜索引擎。");
 expect(result.sections[0].body).toContain(unbound);
 expect(result.wikiQuality?.issues).toEqual([expect.objectContaining({code:"unbound_decision",sectionId:"search"})]);
});

it("gives each repair request enough output for the paragraphs it may rewrite, four issues at a time",async()=>{
 const {repairOutputBudget}=await import("./wiki-explanation-repair");
 expect(repairOutputBudget(["短段落。"])).toBe(1200);
 // Eight 900-character paragraphs no longer fit the old fixed 1800-token reply.
 expect(repairOutputBudget(Array.from({length:8},()=>"长".repeat(900)))).toBe(6000);
 expect(repairOutputBudget(["长".repeat(1000),"长".repeat(1000)])).toBe(2840);
 const long="Atlas 的核心技术决策是先建立索引与结构化结果再生成视图，".repeat(12);
 const extra=Array.from({length:6},(_,index)=>({id:`arch${index}`,title:`架构${index}`,body:`${long}${index}`,kind:"finding" as const,transition:"",evidenceIds:[]}));
 const {session,originals}=fixture(extra);
 const {ai,requests}=model(()=>({edits:[]}));
 await consolidateWikiExplanations(session,ai,signal,originals).catch(()=>undefined);
 expect(requests.length).toBeGreaterThan(1);
 expect(requests.some(request=>request.maxOutputTokens!>1800)).toBe(true);
 for(const request of requests){
  expect(JSON.parse(request.prompt).issues.length).toBeLessThanOrEqual(4);
  const blocks:Array<{text:string}>=JSON.parse(request.prompt).blocks;
  expect(request.maxOutputTokens).toBe(repairOutputBudget(blocks.map(block=>block.text)));
  expect(request.maxOutputTokens!).toBeGreaterThanOrEqual(Math.min(6000,blocks.reduce((sum,block)=>sum+block.text.length,0)));
 }
});
