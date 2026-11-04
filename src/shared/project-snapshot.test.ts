import { expect, it } from "vitest";
import {projectSnapshot} from "./project-snapshot";
import {contextKnowledge} from "../test/context-fixture";
it("preserves maintained overviews and reuses old paid paragraphs only as unreviewed background",()=>{
 const session=contextKnowledge().session;session.sections[0].title="系统架构";session.sections[0].body="输入材料先建立来源身份和版本，再从完整讨论生成笔记；后续按任务复用已经保存的内容，来源改变时提示核对，不自动覆盖用户编辑，也不静默丢弃原文中的前置条件。";
 const before=structuredClone(session),blocks=projectSnapshot(session);
 expect(blocks[0].status).toBe("draft");expect(blocks[0].text).toContain(session.sections[0].body);expect(session).toEqual(before);
 session.projectMaintenance={overview:"用户维护的总览"};expect(projectSnapshot(session)).toEqual([]);
 session.projectMaintenance=undefined;session.briefUserEdited=true;expect(projectSnapshot(session)).toEqual([]);
});
it("labels a legacy stack paragraph as technical approach and retains actual process descriptions as workflow",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.title="系统架构";page.claims=[];page.body="V0.1版本定位为桌面Web App，技术栈选定为 Next.js + TypeScript。UI层采用 Tailwind CSS 配合 shadcn/ui 组件库，确保界面风格简洁、现代且轻量。";
 const before=structuredClone(session);
 expect(projectSnapshot(session).find(block=>block.text===page.body)?.role).toBe("architecture");
 expect(session).toEqual(before);
 page.claims=[{text:page.body,quote:"技术栈选定为 Next.js + TypeScript",evidenceIds:page.evidenceIds,overviewRole:"workflow"}];
 expect(projectSnapshot(session).find(block=>block.text===page.body)?.role).toBe("architecture");
 page.claims=[{text:"用户输入需求，经 Planner 转为计划，Next.js 展示确认后生成 IR。",quote:"输入需求",evidenceIds:page.evidenceIds,overviewRole:"workflow"}];
 expect(projectSnapshot(session).find(block=>block.text.includes("Planner"))?.role).toBe("workflow");
});

it("keeps the overview compact while retaining all detailed claims and personal text",()=>{
 const session=contextKnowledge().session,page=session.sections[0],before=structuredClone(session);
 page.claims=Array.from({length:8},(_,index)=>({text:`材料输入后生成流程结果${index}。`,quote:"输入材料",evidenceIds:page.evidenceIds,overviewRole:"workflow" as const}));
 const claims=structuredClone(page.claims);
 expect(projectSnapshot(session).filter(block=>block.role==="workflow")).toHaveLength(1);expect(page.claims).toEqual(claims);
 session.projectMaintenance={overview:"用户自己的完整说明。"};expect(projectSnapshot(session)).toEqual([]);expect(session.projectMaintenance.overview).toBe("用户自己的完整说明。");
 expect(before.sections).toHaveLength(session.sections.length);
});

it("does not lift a chapter's editorial introduction into the global project overview",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 const text="本章确立了项目的核心技术路线，利用本地存储生成多个不同的阅读视图。";
 page.title="系统架构";page.body=text;page.claims=[{text,quote:"本地存储",evidenceIds:page.evidenceIds,overviewRole:"workflow"}];
 const before=structuredClone(session);
 expect(projectSnapshot(session).some(block=>block.text===text)).toBe(false);
 expect(session).toEqual(before);
});
