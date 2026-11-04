import {expect,it} from "vitest";
import {wikiExistingExplanations,wikiWritingJobs} from "./wiki-writing-context";
import {contextKnowledge} from "../test/context-fixture";

it("keeps complete qualified explanations, prioritizing the current subject without converting code or quotes into guidance",()=>{
 const opening="项目用于恢复已经形成的理解，首版来源仅限 ChatGPT。";
 const old="服务器模式曾计划统一分析消息，这仍是建议，尚未证明实现。";
 const current="只有用户明确配置 BYOK 时才调用用户服务商；失败时保留原文，不能覆盖已有草稿。";
 const page={...contextKnowledge().session.sections[0],kind:"review" as const,phase:"方案讨论",body:`${opening}\n\n## 历史\n\n${old}\n\n## BYOK\n\n${current}\n\n> PRIVATE QUOTE SHOULD NOT BECOME NAVIGATION\n\n\`\`\`ts\n// PRIVATE CODE SHOULD NOT BECOME NAVIGATION\n\`\`\``};
 const before=structuredClone(page);
 const result=wikiExistingExplanations([page],["BYOK"]);
 expect(result.map(item=>item.text)).toEqual([current,opening,old]);
 expect(result[0]).toMatchObject({title:"BYOK",kind:"review",phase:"方案讨论"});
 expect(wikiExistingExplanations([page],["BYOK"],current.length)).toEqual([result[0]]);
 expect(wikiExistingExplanations([page,page],["BYOK"])).toEqual(result);
 expect(page).toEqual(before);
});

it("serializes dependent chunks per owner while keeping separate chapters and direct requests independent",()=>{
 const batches=[[{wikiOwnerId:"a"}],[{wikiOwnerId:"b"}],[{wikiOwnerId:"a"}],[{wikiOwnerId:"b"}],[{wikiOwnerId:"a"},{wikiOwnerId:"b"}],[]];
 expect(wikiWritingJobs(batches)).toEqual([[0,2],[1,3],[4],[5]]);
 expect(wikiWritingJobs([])).toEqual([]);
});

it("keeps parent conditions with identical prose and retains the legacy request shape on resume",()=>{
 const sentence="必须获得对应模式的授权；不能因为其他模式已配置就复用密钥。";
 const page={...contextKnowledge().session.sections[0],body:`## 模型接入\n\n### 平台服务\n\n${sentence}\n\n### 用户 BYOK\n\n${sentence}\n\n**离线模式**\n\n离线模式只读取已经保存的本地资料，不会调用用户服务商。`};
 const scoped=wikiExistingExplanations([page],["模型接入"]);
 expect(scoped.slice(0,2).map(item=>item.path)).toEqual([["模型接入","平台服务"],["模型接入","用户 BYOK"]]);
 expect(scoped.slice(0,2).every(item=>item.text===sentence)).toBe(true);
 expect(scoped[2].path).toEqual(["模型接入","用户 BYOK","离线模式"]);
 const legacy=wikiExistingExplanations([page],["模型接入"],1800,false);
 expect(legacy.every(item=>item.path===undefined)).toBe(true);expect(legacy.filter(item=>item.text===sentence)).toHaveLength(1);
});

it("shares the bounded context across modes and includes later qualifications without treating them as evidence",()=>{
 const early=Array.from({length:10},(_,index)=>`这是较早的解释${index}，仍需保留原始记录中各项约束和采用状态。`);
 const latest="后续补充：只在用户明确授权后保存，失败时保留旧数据，仍未确认实现。";
 const other="用户 BYOK 模式需要独立的密钥，不能复用平台服务器凭据。";
 const page={...contextKnowledge().session.sections[0],body:`## 模型接入\n\n### 平台模式\n\n${[...early,latest].join("\n\n")}\n\n### 用户 BYOK\n\n${other}`};
 const shown=wikiExistingExplanations([page],["模型接入"],1800,true,true);
 expect(shown[0].text).toBe(latest);expect(shown[1].text).toBe(other);expect(shown[1].path).toEqual(["模型接入","用户 BYOK"]);
 expect(shown.length).toBeLessThanOrEqual(8);expect(shown.reduce((size,item)=>size+item.text.length,0)).toBeLessThanOrEqual(1800);
 expect(wikiExistingExplanations([page],["模型接入"],1800,true,false)[0].text).toBe(early[0]);
});
