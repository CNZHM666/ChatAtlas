import {expect,it} from "vitest";
import {currentWikiFacts,retiredWikiClaim,type WikiFactSource} from "./wiki-current-facts";
import {projectSession} from "../test/project-fixture";
import type {ProjectState,ProjectHistoryEvent} from "./project-state";
const source=(id:string,text:string,index:number,role="user"):WikiFactSource=>({id,text,role,conversationId:"chat",messageId:id,messageIndex:index});
const event=(id:string,after:string,quote:string,extra:Partial<ProjectHistoryEvent>={}):ProjectHistoryEvent=>({id,title:"检索方案",area:"检索",version:"",before:"",after,reason:"",status:"documented",decisionStatus:"confirmed",changeKind:"adopt",quote,evidenceIds:[id],beforeQuote:"",beforeEvidenceIds:[],...extra});
const state=(history:ProjectHistoryEvent[]):ProjectState=>({...projectSession().projectState!,modules:[],relations:[],decisions:[],constraints:[],questions:[],history});
it("retains platform AI and BYOK requirements under their own subjects rather than retiring one by recency",()=>{
 const platform=event("platform","平台密钥仅用于平台 AI，保存在服务器端。","我决定平台 AI 的密钥由平台保存在服务器端。",{title:"平台 AI 密钥",area:"平台 AI"});
 const byok=event("byok","BYOK 使用用户提供的密钥。","同时支持 BYOK，用户提供自己的密钥。",{title:"BYOK 密钥",area:"用户 BYOK"});
 const value=state([platform,byok]),before=structuredClone(value);
 const result=currentWikiFacts([value],[source(platform.id,platform.quote,0),source(byok.id,byok.quote,1)]);
 expect(result.retired).toEqual([]);expect(result.states[0]?.history?.map(item=>item.after)).toEqual([platform.after,byok.after]);expect(value).toEqual(before);
});
it("keeps the confirmed design when a newer AI proposal has no user approval",()=>{
 const a=event("a","A","我决定采用A。"),b=event("b","B","建议改用B。",{before:"A",status:"proposal",decisionStatus:"proposed",changeKind:"change"}),value=state([a,b]);
 const result=currentWikiFacts([value],[source("a",a.quote,0),source("b",b.quote,1,"assistant")]);
 expect(result.states[0]?.history).toHaveLength(2);expect(result.retired).toEqual([]);expect(result.states[0]?.history?.[1].decisionStatus).toBe("proposed");
 const refusal=event("no","B","先不改，继续沿用A。",{before:"A",changeKind:"change"});
 const declined=currentWikiFacts([state([a,refusal])],[source("a",a.quote,0),source("no",refusal.quote,2)]);expect(declined.retired).toEqual([]);expect(declined.states[0]?.history?.[1].decisionStatus).toBe("unknown");
});
it("projects only the later explicitly confirmed replacement and retains the original ledger",()=>{
 const a=event("a","A","我决定采用A。"),b=event("b","B","我决定改用B。",{before:"A",changeKind:"change"}),value=state([a,b]),before=structuredClone(value);
 value.decisions=[{id:"choiceA",text:"采用A",reason:"",status:"documented",quote:a.quote,evidenceIds:["a"]}];
 const result=currentWikiFacts([value],[source("a",a.quote,1),source("b",b.quote,3)]);
 expect(result.states[0]?.history?.map(item=>item.after)).toEqual(["B"]);expect(result.states[0]?.decisions).toEqual([]);expect(retiredWikiClaim({quote:"采用A",evidenceIds:["a"]},result.retired)).toBe(true);expect(retiredWikiClaim({quote:"改用B",evidenceIds:["b"]},result.retired)).toBe(false);expect(value.history).toEqual(before.history);
});
it("resolves a short assent using its actual adjacent proposal, not role alone",()=>{
 const a=event("a","A","我决定采用A。"),b=event("b","B","建议改用B。",{before:"A",changeKind:"change",confirmationQuote:"可以",confirmationEvidenceIds:["ok"]});
 const sources=[source("a",a.quote,0),source("b",b.quote,1,"assistant"),source("ok","可以",2)];
 expect(currentWikiFacts([state([a,b])],sources).states[0]?.history?.map(item=>item.after)).toEqual(["B"]);
 expect(currentWikiFacts([state([a,b])],sources.map(item=>item.id==="ok"?{...item,messageIndex:7}:item)).retired).toEqual([]);
});
it("does not invent cross-conversation chronology or trust assistant confirmation",()=>{
 const a=event("a","A","我决定采用A。"),b=event("b","B","我决定改用B。",{before:"A",changeKind:"change"});
 expect(currentWikiFacts([state([a,b])],[source("a",a.quote,0),{...source("b",b.quote,3),conversationId:"other"}]).retired).toEqual([]);
 expect(currentWikiFacts([state([a,b])],[source("a",a.quote,0),source("b",b.quote,3,"assistant")]).retired).toEqual([]);
 expect(currentWikiFacts([state([{...a,area:undefined},{...b,area:undefined}])],[source("a",a.quote,0),source("b",b.quote,3)]).retired).toEqual([]);
 expect(currentWikiFacts([state([a,{...b,area:"通知"}])],[source("a",a.quote,0),source("b",b.quote,3)]).retired).toEqual([]);
});
it("excludes evidenced cancellation, downgrades unsupported superseded labels and preserves reports",()=>{
 const value=state([]);value.decisions=[{id:"retire",text:"废弃A",reason:"",status:"superseded",quote:"我决定取消A。",evidenceIds:["cancel"]},{id:"ai",text:"旧方案失效",reason:"",status:"superseded",quote:"旧方案已废弃。",evidenceIds:["ai"]}];
 value.history=[event("done","已完成检索功能","已经完成检索功能。",{decisionStatus:"unknown",workStatus:"reported_complete"})];
 const result=currentWikiFacts([value],[source("cancel","我决定取消A。",1),source("ai","旧方案已废弃。",2,"assistant"),source("done","已经完成检索功能。",3)]);
 expect(result.states[0]?.decisions.map(item=>item.status)).toEqual(["uncertain"]);expect(result.states[0]?.history?.[0].workStatus).toBe("reported_complete");expect(value.decisions).toHaveLength(2);
});

it("withdraws an explicitly rejected assistant proposal only within its known scope and order",()=>{
 const a=event("a","独立页面","建议新增独立页面。",{status:"proposal",decisionStatus:"proposed",version:"V1"});
 const b=event("b","沿用现有导出","我决定去掉独立页面，沿用现有导出。",{before:a.after,changeKind:"retire",version:"V1",beforeQuote:a.quote,beforeEvidenceIds:["a"]});
 const sources=[source("a",a.quote,0,"assistant"),source("b",b.quote,1)];
 const ledger=state([a,b]),before=structuredClone(ledger);
 const shown=currentWikiFacts([ledger],sources);
 expect(shown.states[0]?.history?.map(item=>item.after)).toEqual([b.after]);expect(shown.retired).toEqual([{quote:a.quote,evidenceIds:["a"],reason:"rejected"}]);expect(ledger).toEqual(before);
 for(const altered of [{...b,version:"V2"},{...b,version:""},{...b,decisionStatus:"proposed" as const}])expect(currentWikiFacts([state([a,altered])],sources).retired).toEqual([]);
 // The user's own withdrawal names the suggestion in the same subject, version and order;
 // a literal before-quote link is no longer required to resolve that relation.
 for(const altered of [{...b,beforeEvidenceIds:[]},{...b,beforeQuote:"不相关的引用"}])expect(currentWikiFacts([state([a,altered])],sources).retired).toEqual([{quote:a.quote,evidenceIds:["a"],reason:"rejected"}]);
 expect(currentWikiFacts([ledger],sources.map(item=>item.id==="b"?{...item,conversationId:"unknown"}:item)).retired).toEqual([]);
});

it("does not retire a confirmed design belonging to another release",()=>{
 const a=event("a","A","我决定采用A。",{version:"V1"}),b=event("b","B","我决定改用B。",{before:"A",changeKind:"change",version:"V2"});
 expect(currentWikiFacts([state([a,b])],[source("a",a.quote,0),source("b",b.quote,1)]).retired).toEqual([]);
});
