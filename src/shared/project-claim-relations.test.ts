import {expect,it} from "vitest";
import {currentWikiFacts,type WikiFactSource} from "./wiki-current-facts";
import {resolveHistoryRelations,historyClaimId} from "./project-claim-relations";
import {historyReplacementTargets} from "./project-history-links";
import {wikiGuideCatalogue} from "../ai/wiki-current-guide";
import {projectSession} from "../test/project-fixture";
import type {ProjectState,ProjectHistoryEvent} from "./project-state";

const source=(id:string,text:string,index:number,role="user",conversationId="chat"):WikiFactSource=>({id,text,role,conversationId,messageId:id,messageIndex:index});
const event=(id:string,after:string,quote:string,extra:Partial<ProjectHistoryEvent>={}):ProjectHistoryEvent=>({id,title:"导出入口",area:"导出",version:"",before:"",after,reason:"",status:"documented",decisionStatus:"confirmed",changeKind:"adopt",quote,evidenceIds:[id],beforeQuote:"",beforeEvidenceIds:[],...extra});
const state=(history:ProjectHistoryEvent[]):ProjectState=>({...projectSession().projectState!,modules:[],relations:[],decisions:[],constraints:[],questions:[],history});
const oldQuote="我决定采用独立的 Context Pack 入口。",newQuote="我决定取消独立的 Context Pack 入口，改为导出 Wiki。";

it("T09: links a reworded prior state by claim ID and retires only it",()=>{
 const old=event("old","采用独立的 Context Pack 入口",oldQuote);
 const sources=[source("old",oldQuote,0),source("new",newQuote,1)];
 for(const before of ["采用独立的 Context Pack 入口","提供一个单独的 Context Pack 入口"]){
  const later=event("new","导出 Wiki",newQuote,{changeKind:"change",before});
  const result=currentWikiFacts([state([old,later])],sources);
  expect(result.retired.map(item=>item.reason)).toEqual(["replaced"]);
  expect(result.states[0]?.history?.map(item=>item.id)).toEqual(["new"]);
  expect(result.changes).toEqual([expect.objectContaining({kind:"replaces",resolution:"supported",fromClaimId:historyClaimId(later,sources),toClaimId:historyClaimId(old,sources),confirmationEvidenceIds:["new"]})]);
  expect(result.history.map(item=>item.id)).toEqual(["old"]);
 }
});

it("T13: resolves a cross-batch pointer even when batches reuse model IDs",()=>{
 const first=event("history:entry","采用独立的 Context Pack 入口",oldQuote,{evidenceIds:["e1"]});
 const second=event("history:entry","导出 Wiki",newQuote,{evidenceIds:["e2"],changeKind:"change",pendingRelation:{kind:"replaces",hint:"单独的 Context Pack 入口"}});
 const sources=[source("e1",oldQuote,0),source("e2",newQuote,4)];
 const result=currentWikiFacts([state([first]),state([second])],sources);
 expect(result.states[0]?.history).toEqual([]);expect(result.states[1]?.history?.map(item=>item.after)).toEqual(["导出 Wiki"]);
 // Claim identity is derived from the original message and quote, so a later reading keeps it.
 expect(historyClaimId({...first,id:"history:other"},sources)).toBe(historyClaimId(first,sources));
 const catalogue=wikiGuideCatalogue(result.states,sources,result.history);
 expect(catalogue.facts.find(fact=>(fact.value as {text:string}).text==="导出 Wiki")?.value).toMatchObject({relations:[{kind:"replaces",resolution:"supported",earlier:"采用独立的 Context Pack 入口",earlierStatus:"history_only"}]});
});

it("T10: a user declining an unadopted AI suggestion rejects it, never as an implemented design",()=>{
 const advice="建议提供独立的 Context Pack 入口。",decline="我不要独立的 Context Pack 入口，改为导出 Wiki。";
 const proposal=event("p","提供独立的 Context Pack 入口",advice,{status:"proposal",decisionStatus:"proposed"});
 const later=event("d","导出 Wiki",decline,{changeKind:"change",before:"独立的 Context Pack 入口"});
 const result=currentWikiFacts([state([proposal,later])],[source("p",advice,0,"assistant"),source("d",decline,1)]);
 expect(result.retired).toEqual([expect.objectContaining({reason:"rejected"})]);
 expect(result.changes[0]).toMatchObject({kind:"rejects",resolution:"supported"});
});

it("T08: a later AI suggestion keeps its link unresolved and cannot displace the user's decision",()=>{
 const advice="建议取消独立的 Context Pack 入口，改为导出 Wiki。";
 const old=event("old","采用独立的 Context Pack 入口",oldQuote),later=event("ai","导出 Wiki",advice,{changeKind:"change",before:"独立的 Context Pack 入口",status:"proposal",decisionStatus:"proposed"});
 const result=currentWikiFacts([state([old,later])],[source("old",oldQuote,0),source("ai",advice,1,"assistant")]);
 expect(result.retired).toEqual([]);expect(result.states[0]?.history).toHaveLength(2);
 expect(result.unresolved).toEqual([expect.objectContaining({reason:"not_user_decision",toClaimId:historyClaimId(old,[source("old",oldQuote,0)])})]);
});

it("T11/T12: different operating modes or versions coexist instead of being replaced by recency",()=>{
 const builtin=event("b","内置模型使用平台提供的密钥","我决定内置模式使用平台提供的密钥。",{area:"模型密钥"});
 const byok=event("k","BYOK 使用用户自己的密钥","我决定 BYOK 模式改为使用用户自己的密钥。",{area:"模型密钥",changeKind:"change",before:"使用平台提供的密钥"});
 const modes=currentWikiFacts([state([builtin,byok])],[source("b",builtin.quote,0),source("k",byok.quote,1)]);
 expect(modes.retired).toEqual([]);expect(modes.unresolved[0]?.reason).toBe("no_candidate");
 const v1=event("v1","导入 ChatGPT 对话","我决定 V1 导入 ChatGPT 对话。",{version:"V1",area:"导入"});
 const v2=event("v2","导入多个平台对话","我决定 V2 改为导入多个平台对话。",{version:"V2",area:"导入",changeKind:"change",before:"导入 ChatGPT 对话"});
 expect(currentWikiFacts([state([v1,v2])],[source("v1",v1.quote,0),source("v2",v2.quote,1)]).retired).toEqual([]);
});

it("keeps unknown cross-conversation order and several named prior states unresolved",()=>{
 const old=event("old","采用独立的 Context Pack 入口",oldQuote),later=event("new","导出 Wiki",newQuote,{changeKind:"change",before:"单独的 Context Pack 入口"});
 const elsewhere=currentWikiFacts([state([old,later])],[source("old",oldQuote,0,"user","a"),source("new",newQuote,1,"user","b")]);
 expect(elsewhere.retired).toEqual([]);expect(elsewhere.unresolved[0]?.reason).toBe("order_unknown");
 const sibling=event("old2","采用独立的 Context Pack 入口按钮","我决定采用独立的 Context Pack 入口按钮。");
 const two=currentWikiFacts([state([old,sibling,later])],[source("old",oldQuote,0),source("old2",sibling.quote,1),source("new",newQuote,2)]);
 expect(two.retired).toEqual([]);expect(two.unresolved[0]?.reason).toBe("ambiguous");
});

it("requires the user's own change language before a reworded state is retired",()=>{
 const old=event("old","采用独立的 Context Pack 入口",oldQuote),addition="我决定在独立的 Context Pack 入口旁边增加导出 Wiki。";
 const later=event("new","增加导出 Wiki",addition,{changeKind:"change",before:"单独的 Context Pack 入口"});
 const result=currentWikiFacts([state([old,later])],[source("old",oldQuote,0),source("new",addition,1)]);
 expect(result.retired).toEqual([]);expect(result.unresolved[0]?.reason).toBe("no_change_language");
});

it("lets downstream replacement lookups follow a resolved relation",()=>{
 const sources=[source("old",oldQuote,0),source("new",newQuote,1)];
 const resolved=resolveHistoryRelations([state([event("old","采用独立的 Context Pack 入口",oldQuote),event("new","导出 Wiki",newQuote,{changeKind:"change",before:"提供一个单独的 Context Pack 入口"})])],sources);
 const [old,later]=resolved.states[0]!.history!;
 expect(historyReplacementTargets(later,[old,later])).toEqual([old]);
 // Without a resolved relation the literal rule is unchanged.
 expect(historyReplacementTargets({...later,relations:undefined},[old,later])).toEqual([]);
});
