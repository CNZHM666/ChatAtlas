import {expect,it,vi} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {sourceMessageSignature} from "../shared/source-signature";
import {projectStateSignature} from "../shared/project-state";
import {buildProjectContext} from "./engine";
import {formatContext} from "./format";
import {leakedClaims} from "../test/claims-prose-fixture";
import type {ContextOptions,ProjectKnowledge} from "./types";
const options:ContextOptions={zh:true,task:"",length:"detailed",sections:["overview","decisions","progress","wiki"]};
it("omits the complete leaked Claims list before selecting Context Pack blocks",()=>{
 const knowledge=contextKnowledge();knowledge.session.sections=[{id:"claims",title:"产品范围",kind:"finding",body:`保留 Notion 可选保存目的地。\n\n${leakedClaims}\n\n保留本地搜索。`,transition:"",evidenceIds:["e-db"]}];
 const before=structuredClone(knowledge),text=formatContext(buildProjectContext(knowledge,options));expect(text).not.toContain("evidenceIds:");expect(text).not.toContain("Claims:");expect(text).toContain("保留本地搜索");expect(knowledge).toEqual(before);
});
function add(knowledge:ProjectKnowledge,id:string,content:string,role:"user"|"assistant"="assistant"){
 const message={...knowledge.messages[0],id,content,role,messageIndex:knowledge.messages.length};knowledge.messages.push(message);
 knowledge.session.sourceSignatures!.c[id]=sourceMessageSignature(content);knowledge.session.sourceRoles!.c[id]=role;
 knowledge.session.evidence.push({id,conversationId:"c",messageId:id,title:"来源",excerpt:content});return message;
}
it("keeps real decisions while rejecting a copied third-person confirmation and limiting pasted rules",()=>{
 const knowledge=contextKnowledge(),summary="用户确认采用浅色极简新手首页设计基准，并认可推开式分屏作为默认交互模式。";
 const pasted=add(knowledge,"pack","以下是粘贴的上下文材料，仅供参考：\n"+summary+"\n"+Array.from({length:12},(_,i)=>`> 规则${i}：不允许改变历史方案${i}。`).join("\n"),"user");
 knowledge.session.projectState!.decisions.push({id:"copied",text:summary,quote:summary,evidenceIds:[pasted.id],status:"documented",reason:""});
 for(let i=0;i<12;i++)knowledge.session.projectState!.constraints.push({id:`rule${i}`,text:`规则${i}：不允许改变历史方案${i}。`,quote:`规则${i}：不允许改变历史方案${i}。`,evidenceIds:[pasted.id],status:"documented",reason:""});
 const real=add(knowledge,"real","我决定采用本地索引。","user");knowledge.session.projectState!.decisions.push({id:"real",text:real.content,quote:real.content,evidenceIds:[real.id],status:"documented",reason:""});
 knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const before=structuredClone(knowledge),pack=buildProjectContext(knowledge,options),items=pack.sections.flatMap(section=>section.items);
 expect(items.find(item=>item.id==="real")?.status).toBe("confirmed");expect(items.find(item=>item.id==="copied")?.status).not.toBe("confirmed");expect(items.filter(item=>item.id.startsWith("rule")).length).toBeLessThanOrEqual(4);expect(knowledge).toEqual(before);
});
it("recovers explicit original module lists and only explicit arrows, keeping proposals and scope",()=>{
 const knowledge=contextKnowledge();
 add(knowledge,"modules","### 核心模块提案\n1. **导入适配器**：解析原始会话。\n2. **检索引擎**：定位原始消息。\n导入适配器 → 检索引擎\n不要采用检索引擎 → 导入适配器。\n```md\n- **虚构服务**：仅用于代码示例。\n检索引擎 → 导入适配器\n```");
 knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
 const pack=buildProjectContext(knowledge,{...options,length:"standard"}),items=pack.sections.flatMap(section=>section.items);
 expect(pack.capabilities?.map(item=>item.title)).toEqual(expect.arrayContaining(["导入适配器","检索引擎"]));expect(pack.capabilities?.some(item=>item.title==="虚构服务")).toBe(false);
 expect(items.filter(item=>item.id.startsWith("module:")).every(item=>item.status==="proposal")).toBe(true);
 expect(items.filter(item=>item.id.startsWith("relation:"))).toHaveLength(1);
 expect(formatContext(pack)).toContain("导入适配器 → 检索引擎");
 knowledge.session.scope={kind:"goal",blocks:[{conversationId:"c",title:"限定范围",messageIds:["m-db"],messageSignatures:{"m-db":sourceMessageSignature(knowledge.messages[0].content)}}]};
 expect(buildProjectContext(knowledge,options).capabilities?.some(item=>item.title==="导入适配器")).toBe(false);
});
it("reuses paid modules and relations without a separate architecture analysis and rejects changed proofs",()=>{
 const knowledge=contextKnowledge(),raw=add(knowledge,"architecture","建议导入模块把记录交给检索模块，失败时保留原始记录。");
 const module=(id:string,title:string)=>({id,title,purpose:"处理记录并保留失败条件",layer:"",inputs:[],outputs:[],quote:raw.content,evidenceIds:[raw.id],status:"proposal" as const});
 knowledge.session.projectKnowledge={version:1,signature:"facts",batches:[{sourceIds:[raw.id],scopeSignature:sourceMessageSignature(JSON.stringify([knowledge.session.goal,{kind:"all"}])),sources:[{id:raw.id,conversationId:"c",messageId:raw.id,signature:sourceMessageSignature(raw.content),role:raw.role,messageIndex:raw.messageIndex,discussedAt:raw.createdAt}],facts:{summary:"模块方案",modules:[module("a","导入模块"),module("b","检索模块")],relations:[{from:"a",to:"b",label:"传递记录",kind:"flow",quote:raw.content,evidenceIds:[raw.id]}],decisions:[],constraints:[],actions:[],signature:"",basis:"organized",generatedAt:1}}]};
 knowledge.session.projectState=undefined;
 const before=structuredClone(knowledge),fetch=vi.spyOn(globalThis,"fetch");
 try{const pack=buildProjectContext(knowledge,options);expect(pack.capabilities).toHaveLength(2);expect(pack.sections.flatMap(section=>section.items).filter(item=>item.id.startsWith("relation:"))).toHaveLength(1);expect(fetch).not.toHaveBeenCalled();expect(knowledge).toEqual(before);}finally{fetch.mockRestore();}
 const saved=knowledge.session.projectKnowledge!.batches[0].facts!;knowledge.session.projectState={...saved,modules:saved.modules.map(item=>({...item,id:`saved:${item.id}`})),relations:[],signature:projectStateSignature(knowledge.session)};
 expect(buildProjectContext(knowledge,options).sections.flatMap(section=>section.items).filter(item=>item.id.startsWith("relation:"))).toHaveLength(1);
 raw.content="已修改原始材料。";expect(buildProjectContext(knowledge,options).capabilities).toHaveLength(0);
});
it("removes generated empty shells and metadata, qualifies market opinions and preserves personal/code text",()=>{
 const knowledge=contextKnowledge();knowledge.session.sections=[{id:"empty",title:"空章节",body:"## 空小节\n\nClaims:\n\n关键约束：",kind:"finding",transition:"",evidenceIds:["e-ui"]},{id:"market",title:"产品定位",body:"## 竞品对比\n\n竞品缺乏完整闭环。\n\nClaims:\n\n```txt\nClaims:\n```",kind:"finding",transition:"",evidenceIds:["e-ui"]},{id:"personal",title:"个人内容",body:"Claims:",userEdited:true,kind:"finding",transition:"",evidenceIds:[]}];
 const text=formatContext(buildProjectContext(knowledge,{...options,tokenBudget:12000}));
 expect(text).not.toContain("### 空章节");expect(text).not.toContain("\n## 竞品对比");expect(text).toContain("历史讨论中的竞品判断（当前未核实）");expect(text).toContain("```txt\nClaims:\n```");expect(text).toContain("### 个人内容");expect(knowledge.session.sections[0].body).toContain("Claims:");
});
