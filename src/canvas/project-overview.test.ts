import { expect,it } from "vitest";
import { projectOverviewText,projectOverviewContent } from "./project-overview";
import { projectSession } from "../test/project-fixture";
it("selects a product introduction rather than a marketing paragraph in the same saved Wiki",()=>{
 const session=projectSession();session.knowledgeViewVersion=1;
 session.sections[0].title="产品定位";session.sections[0].claims=[];
 session.sections[0].body="宣传重点在于制造 Wow Moment，用户只需拍照就能生成方案，旨在降低使用门槛。\n\n本项目是面向大学生和创客的可视化硬件工作台，通过自然语言把需求转成模块设计，帮助初学者理解硬件结构。";
 const before=structuredClone(session),text=projectOverviewText(session);
 expect(text).toContain("面向大学生和创客");expect(text).not.toContain("Wow Moment");expect(session).toEqual(before);
});
it("prefers the useful brief and never repeats the generic input task as the project description",()=>{
  const session=projectSession();session.goal="把全部已选对话整理成一个项目";
  session.brief={summary:"先验证核心流程并控制采购范围。",confirmed:[],turningPoints:[],openQuestions:[]};
  expect(projectOverviewText(session)).toBe(session.brief.summary);
  session.brief.summary=session.goal;session.projectState=undefined;session.sections[0].body=session.goal;
  expect(projectOverviewText(session)).toBe("");
  session.projectMaintenance={overview:"我编辑的项目简介"};expect(projectOverviewText(session)).toBe("我编辑的项目简介");
  session.projectMaintenance.overview="";expect(projectOverviewText(session)).toBe("");
});
it("keeps substantive saved knowledge in natural paragraphs without headings and leaves edits intact",()=>{
 const session=projectSession();session.knowledgeViewVersion=1;
 session.sections[0].claims=[{text:"面向学习者的任务规划工具，帮助把需求变成可验证的计划。",quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose"},{text:"输入需求，经规划器输出候选计划，再经规则校验。",quote:"方案生成输出候选计划",evidenceIds:["e1"],overviewRole:"workflow"}];
 const before=structuredClone(session),content=projectOverviewContent(session);
 expect(content.text).toContain("面向学习者");expect(content.text).toContain("经规划器输出候选计划");expect(content.text.split("\n\n")).toHaveLength(2);expect(content.text).not.toMatch(/^#/mu);expect(content.evidenceIds).toEqual(["e1"]);expect(session).toEqual(before);
 session.projectMaintenance={overview:"我保留的第一段。\n\n第二段也不覆盖。"};expect(projectOverviewContent(session).text).toBe(session.projectMaintenance.overview);
});
it("keeps detailed decision records in their owning Wiki rather than expanding the overview",()=>{
 const session=projectSession();session.knowledgeViewVersion=1;
 const details=["数据保存","执行事务","输入校验","来源追踪"].map(subject=>({text:subject+"："+"讨论中的设计保留输入、处理结果和失败条件，供后续开发时对照。".repeat(9),quote:"先验证核心流程，再扩展功能",evidenceIds:["e1"],overviewRole:"decision" as const}));
 session.sections[0].claims=[{text:"面向学习者的任务规划工具，把需求转为可验证的计划。",quote:"需求采集提取目标与约束",evidenceIds:["e1"],overviewRole:"purpose"},...details];
 const content=projectOverviewContent(session);
 expect(content.text.length).toBeLessThan(900);for(const detail of details)expect(content.text).not.toContain(detail.text);expect(session.sections[0].claims).toEqual(expect.arrayContaining(details));
 expect(content.text).not.toMatch(/^#{1,6}\s/mu);expect(content.text).toContain("面向学习者");
});
