import {expect,it,vi} from "vitest";
import {assignGuideOwners,wikiChapterGuide,wikiChapterGuideAllowance,wikiCurrentGuide,wikiGuideCatalogue,WIKI_SHARED_FACT_INSTRUCTIONS} from "./wiki-current-guide";
import {projectSession,projectText} from "../test/project-fixture";

it("carries server-only and historical context with short quotes rather than universalizing a credential rule",()=>{
 const state=projectSession().projectState!,quote="密钥只能在当前请求内存中存在";
 state.modules=[];state.relations=[];state.decisions=[];state.questions=[];state.history=[];
 state.constraints=[{id:"proxy-key",text:quote,quote,reason:"",status:"proposal",evidenceIds:["proxy"]}];
 const source={id:"proxy",text:"## 历史代理提案\n\n如果经过服务器代理，密钥只能在当前请求内存中存在，客户端策略另行确认。",role:"assistant",conversationId:"source",messageId:"m",messageIndex:0};
 const guide=wikiCurrentGuide([state],[source]);
 expect(guide).toContain("历史代理提案");expect(guide).toContain("如果经过服务器代理");expect(guide).toContain('"reading":"assistant_discussion"');
});

it("preserves the original speaker, order and conditional modes rather than treating an AI milestone assessment as a user report",()=>{
 const state=projectSession().projectState!,assistant="项目已达到 M5。",user="我已完成 M2。",proxy="如果使用服务器代理，用户密钥仅在当前请求中存在。",browser="浏览器 BYOK 的 sessionStorage 是早期提案。";
 state.modules=[];state.relations=[];state.decisions=[];state.history=[];state.questions=[];
 const texts=[assistant,user,proxy,browser];state.constraints=texts.map((quote,index)=>({id:`fact-${index}`,text:quote,reason:"",status:"documented",quote,evidenceIds:[`e${index}`]}));
 const sources=texts.map((text,index)=>({id:`e${index}`,text,role:index===1?"user":"assistant",conversationId:"chat",messageId:`m${index}`,messageIndex:index,...(index===1?{discussedAt:100}: {})}));
 const catalogue=wikiGuideCatalogue([state],sources);
 const rows=catalogue.facts.map(fact=>fact.value as {text:string;reading:string;order:Array<{role:string;index:number;discussedAt?:number}>});
 expect(rows.find(row=>row.text===assistant)).toMatchObject({reading:"assistant_discussion",order:[{role:"assistant",index:0}]});
 expect(rows.find(row=>row.text===user)).toMatchObject({reading:"user_report",order:[{role:"user",index:1,discussedAt:100}]});
 expect(rows.some(row=>row.text===proxy)).toBe(true);expect(rows.some(row=>row.text===browser)).toBe(true);
 const unknown=wikiGuideCatalogue([state],[{...sources[0],role:undefined}]);expect((unknown.facts[0].value as {reading:string}).reading).toBe("unknown");
});

it("routes different facts from a shared message by their literal quotes rather than citation frequency",()=>{
 const hardware="BYOK 模式使用内存密钥，不写入磁盘。",other="另一产品使用 ProjectEvent。";
 const catalogue={facts:[{value:{text:hardware,quote:hardware},evidenceIds:["same"]},{value:{text:other,quote:other},evidenceIds:["same"]}],omitted:0};
 const owned=assignGuideOwners(catalogue,[{text:hardware,rawEvidenceIds:["same"],wikiOwnerId:"hardware"},...Array.from({length:3},()=>({text:other,rawEvidenceIds:["same"],wikiOwnerId:"other"}))],["other","hardware"]);
 expect(owned.facts.map(fact=>fact.ownerId)).toEqual(["hardware","other"]);
 const ambiguous=assignGuideOwners(catalogue,[{text:hardware,rawEvidenceIds:["same"],wikiOwnerId:"a"},{text:hardware,rawEvidenceIds:["same"],wikiOwnerId:"b"}],["b","a"]);
 expect(ambiguous.facts.every(fact=>!fact.ownerId)).toBe(true);
});

it("reuses saved grounded reading as a bounded shared writing guide, without new analysis calls",()=>{
 const state=projectSession().projectState!,before=structuredClone(state),network=vi.spyOn(globalThis,"fetch");
 try{
  const guide=wikiCurrentGuide([state],[{id:"e1",text:projectText,role:"user",conversationId:"source",messageId:"message",messageIndex:0}]);
  expect(guide).toContain("需求采集");expect(guide).toContain("方案生成");expect(guide).toContain("source");expect(guide.length).toBeLessThan(6200);
  expect(wikiCurrentGuide([state],[{id:"e1",text:"Unrelated original",role:"user",conversationId:"source",messageId:"message",messageIndex:0}])).toBe("");
  expect(WIKI_SHARED_FACT_INSTRUCTIONS).toContain("A later assistant suggestion never replaces a user choice");expect(WIKI_SHARED_FACT_INSTRUCTIONS).toContain("not new evidence");
  expect(state).toEqual(before);expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();}
});

it("reserves room for unresolved questions even when many modules compete for the shared budget",()=>{
 const state=projectSession().projectState!;state.modules=Array.from({length:30},(_,index)=>({...state.modules[0],id:`module:${index}`,title:`模块${index}`,purpose:"描述足够具体的组件输入输出和处理职责。".repeat(3)}));
 state.questions=[{id:"question",text:"是否保留离线模式？",reason:"",status:"uncertain",quote:"是否保留离线模式？",evidenceIds:["e1"]}];
 const guide=wikiCurrentGuide([state],[{id:"e1",text:projectText+"是否保留离线模式？",role:"user",conversationId:"source",messageId:"message",messageIndex:0}]);
 expect(guide).toContain("是否保留离线模式？");expect(guide).toContain('"omitted":');expect(guide.length).toBeLessThan(6200);
});

it("reserves explicit user choices before many progress reports consume the navigation budget",()=>{
 const state=projectSession().projectState!;
 state.history=Array.from({length:35},(_,index)=>({id:`report:${index}`,title:"进展",before:"",after:`完成模块${index}`,reason:"",version:"",status:"documented" as const,decisionStatus:"unknown" as const,quote:`我已经完成模块${index}。`,evidenceIds:[`r${index}`],beforeQuote:"",beforeEvidenceIds:[]}));
 state.decisions=[{id:"choice",text:"去掉独立页面，统一导出",reason:"",status:"documented",quote:"我决定去掉独立页面，统一使用现有导出。",evidenceIds:["choice"]}];
 const sources=[...state.history.map((item,index)=>({id:`r${index}`,text:item.quote,role:"user",conversationId:"chat",messageId:`r${index}`,messageIndex:index})),{id:"choice",text:state.decisions[0].quote,role:"user",conversationId:"chat",messageId:"choice",messageIndex:36}];
 const guide=wikiCurrentGuide([state],sources);expect(guide).toContain(state.decisions[0].quote);expect(guide.length).toBeLessThan(6200);expect(guide).toContain('"omitted":');
});

it("explains each shared fact once: its owning chapter gets it in full, others only a named pointer",()=>{
 const state=projectSession().projectState!,sources=[{id:"e1",text:projectText,role:"user" as const,conversationId:"source",messageId:"message",messageIndex:0}];
 const catalogue=wikiGuideCatalogue([state],sources);
 expect(catalogue.facts.length).toBeGreaterThan(1);expect(catalogue.facts.every(fact=>fact.evidenceIds.includes("e1"))).toBe(true);
 // Rendering the whole catalogue is byte-identical to the previous shared guide.
 expect(wikiChapterGuide(catalogue,new Set(),new Map())).toBe(wikiCurrentGuide([state],sources));
 // Material for e1 is cited twice by chapter b and once by a: b owns every fact; ties go to the earlier chapter.
 const owned=assignGuideOwners(catalogue,[{rawEvidenceIds:["e1"],wikiOwnerId:"a"},{rawEvidenceIds:["e1"],wikiOwnerId:"b"},{rawEvidenceIds:["e1"],wikiOwnerId:"b"}],["a","b"]);
 expect(owned.facts.every(fact=>fact.ownerId==="b")).toBe(true);
 expect(assignGuideOwners(catalogue,[{rawEvidenceIds:["e1"],wikiOwnerId:"b"},{rawEvidenceIds:["e1"],wikiOwnerId:"a"}],["a","b"]).facts.every(fact=>fact.ownerId==="a")).toBe(true);
 expect(assignGuideOwners(catalogue,[{rawEvidenceIds:["other"],wikiOwnerId:"a"}],["a"]).facts.every(fact=>fact.ownerId===undefined)).toBe(true);
 const titles=new Map([["a","搜索"],["b","上下文引擎"]]);
 const own=wikiChapterGuide(owned,new Set(["b"]),titles),elsewhere=wikiChapterGuide(owned,new Set(["a"]),titles);
 expect(own).toContain("SHARED PROJECT FACT CATALOGUE");expect(own).not.toContain("OWNED BY OTHER CHAPTERS");
 expect(elsewhere).not.toContain("SHARED PROJECT FACT CATALOGUE");expect(elsewhere).toContain("OWNED BY OTHER CHAPTERS");expect(elsewhere).toContain("上下文引擎");
 expect(elsewhere).not.toContain((catalogue.facts[0].value as {quote:string}).quote);
 // The sizing allowance covers any per-request rendering beyond the full guide.
 const full=wikiCurrentGuide([state],sources).length,allowance=wikiChapterGuideAllowance(owned,titles);
 for(const ids of [new Set<string>(),new Set(["a"]),new Set(["b"])])expect(wikiChapterGuide(owned,ids,titles).length).toBeLessThanOrEqual(full+allowance);
});
