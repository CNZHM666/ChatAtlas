import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { sourceMessageSignature } from "../shared/source-signature";
import { projectStateSignature } from "../shared/project-state";
import { buildProjectContext } from "./engine";
import { formatContext } from "./format";
import type { ContextOptions, ProjectKnowledge } from "./types";

const options:ContextOptions={zh:true,task:"",length:"detailed",mode:"full",sections:["overview","decisions","progress","next","wiki","history"]};
function report(knowledge:ProjectKnowledge,index:number,role:"user"|"assistant",workStatus:"reported"|"planned"|"proposed") {
  const id=`report-${index}`,text=`Milestone ${index} ${workStatus==="reported"?"已完成初步 Demo":workStatus==="planned"?"计划开发视觉识别":"建议增加需求门控"}`;
  const message={...knowledge.messages[0],id,role,messageIndex:index+10,content:text};
  knowledge.messages.push(message);
  knowledge.session.evidence.push({id,conversationId:message.conversationId,messageId:id,title:"相同的项目标题",excerpt:text});
  knowledge.session.sourceSignatures!.c[id]=sourceMessageSignature(text);
  knowledge.session.sourceRoles!.c[id]=role;
  knowledge.session.sections.push({id,title:`开发阶段 ${index}`,body:text,kind:"finding",transition:"",evidenceIds:[id],claims:[{text,quote:text,evidenceIds:[id],verification:"supported",overviewRole:"progress",workStatus}]});
  knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
}
it("includes more than the Brief's three user progress reports without claiming code verification",()=>{
  const knowledge=contextKnowledge();for(let i=1;i<=5;i++)report(knowledge,i,"user","reported");
  const bundle=buildProjectContext(knowledge,options),reports=bundle.sections.find(section=>section.kind==="progress")!.items.filter(item=>item.id.startsWith("wiki-brief:"));
  expect(reports).toHaveLength(5);expect(reports.every(item=>item.status==="reported")).toBe(true);
  expect(formatContext(bundle)).toContain("用户报告");expect(formatContext(bundle)).not.toContain("未验证代码或测试");
  expect(reports.every(item=>item.quotes?.length===1)).toBe(true);
});
it("never treats an assistant's completion claim as a user's progress report",()=>{
  const knowledge=contextKnowledge();report(knowledge,2,"assistant","reported");
  const item=buildProjectContext(knowledge,options).sections.flatMap(section=>section.items).find(item=>item.id==="wiki-brief:report-2:0")!;
  expect(item.status).toBe("recorded");expect(item.text).not.toContain("未核对实际代码和测试");
});
it("uses a literal user work report without requiring paid semantic review or certifying implementation",()=>{
  const knowledge=contextKnowledge();report(knowledge,2,"user","reported");
  const section=knowledge.session.sections.at(-1)!;
  section.claims![0].verification=undefined;
  section.evidenceReview={mode:"manual",status:"anchored",invalidClaims:0,checkedClaims:0,totalClaims:1};
  const bundle=buildProjectContext(knowledge,{...options,task:"Milestone 2",sections:["progress"]});
  expect(bundle.sections.flatMap(section=>section.items).find(item=>item.id==="wiki-brief:report-2:0")).toMatchObject({status:"reported",quotes:[{text:section.claims![0].quote}]});
  expect(bundle.taskEvidenceMatched).toBe(true);
  expect(formatContext(bundle)).toContain("用户报告");
  expect(formatContext(bundle)).not.toContain("测试已通过");
});
it("distinguishes development plans from AI proposals and completion",()=>{
  const knowledge=contextKnowledge();report(knowledge,4,"user","planned");report(knowledge,5,"assistant","proposed");
  const bundle=buildProjectContext(knowledge,options),items=bundle.sections.flatMap(section=>section.items);
  expect(items.find(item=>item.id==="wiki-brief:report-4:0")!.status).toBe("planned");
  expect(items.find(item=>item.id==="wiki-brief:report-5:0")!.status).toBe("proposal");
  expect(formatContext(bundle)).toContain("开发计划（不代表完成）");
});
it("keeps a paraphrased Wiki as background without assigning the entire chapter's citations to every block",()=>{
  const knowledge=contextKnowledge();knowledge.session.sections=[{id:"architecture",title:"Hardware IR",body:"Hardware IR 是统一数据源。\n\nLLM 输出 HardwareOperation。\n\n确定性执行器执行并验证。\n\n## 空的计划小节",kind:"finding",transition:"",evidenceIds:["e-db","e-ui"]}];
  knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
  const bundle=buildProjectContext(knowledge,{...options,sections:["wiki"]}),text=formatContext(bundle);
  expect(text.match(/Wiki 背景/gu)).toHaveLength(1);
  expect(bundle.sections.flatMap(section=>section.items).every(item=>!item.sourceIds.length)).toBe(true);
  expect(bundle.sources).toHaveLength(2);expect(text).toContain("章节相关原文（非逐项证明）");expect(text).not.toContain("空的计划小节");
  expect(text).toContain("HardwareOperation");expect(text).toContain("确定性执行器");
});
it("uses independently grounded claim sources instead of all chapter references",()=>{
  const knowledge=contextKnowledge();report(knowledge,2,"user","reported");
  knowledge.session.sections.at(-1)!.evidenceIds.push("e-db","e-ui");
  knowledge.session.projectState!.signature=projectStateSignature(knowledge.session);
  const bundle=buildProjectContext(knowledge,{...options,sections:["wiki"]}),item=bundle.sections.flatMap(section=>section.items).find(item=>item.id.startsWith("report-2:"))!;
  expect(item.sourceIds).toEqual([JSON.stringify(["c","report-2"])]);expect(item.status).toBe("reported");
});
it("keeps original IDs inside the structured pack but excludes them and sync dates from portable text",()=>{
  const knowledge=contextKnowledge(),bundle=buildProjectContext(knowledge,options),text=formatContext(bundle);
  expect(bundle.sources.some(source=>source.messageId==="m-db")).toBe(true);
  expect(bundle.sources.every(source=>source.question===knowledge.messages[0].content)).toBe(true);
  expect(text).not.toContain("conversationId:");expect(text).not.toContain("messageId:");expect(text).not.toContain("1970-01");
  expect(text.match(/https:\/\/chatgpt.com\/c\/example/gu)).toHaveLength(1);
});
it("states missing task and progress instead of deriving them from technical background",()=>{
  const knowledge=contextKnowledge();knowledge.session.projectMaintenance={};knowledge.session.projectState=undefined;
  const bundle=buildProjectContext(knowledge,options),text=formatContext(bundle);
  expect(text).toContain("当前任务未指定");expect(text).toContain("未找到可用的当前进度记录");
  expect(text).toContain("本稿未纳入经用户确认的当前方案");
});
it("narrows technical context to the requested feature while retaining explicit project boundaries",()=>{
  const knowledge=contextKnowledge();report(knowledge,4,"user","planned");
  const text=formatContext(buildProjectContext(knowledge,{...options,mode:"task",task:"继续开发视觉识别"}));
  expect(text).toContain("计划开发视觉识别");expect(text).not.toContain("const action");
  expect(text).not.toContain("用户报告（未验证代码或测试）");
});
