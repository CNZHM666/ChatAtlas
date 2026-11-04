import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {projectOverviewContent,projectOverviewText} from "./project-overview";
it("prefers an evidenced product definition over a legacy arrow-loop slogan",()=>{
 const session=projectSession(),definition="这是面向持续学习者的知识工具，帮助恢复已经形成的理解。";
 session.brief={summary:"核心闭环被概括为找回历史 → 理解内容 → 继续使用。",confirmed:[],turningPoints:[],openQuestions:[]};
 session.sections[0]={...session.sections[0],title:"产品定位",body:definition};
 expect(projectOverviewText(session)).toBe(definition);
 expect(projectOverviewContent(session).text).toContain(definition);
});
it.each(["我的短总览", "", "第一段\n\n第二段\n\n第三段\n\n个人补充"])("retains an edited legacy overview exactly, including short or empty text",summary=>{
 const session=projectSession();session.brief={summary,confirmed:[],turningPoints:[],openQuestions:[]};session.briefUserEdited=true;
 expect(projectOverviewText(session)).toBe(summary);expect(projectOverviewContent(session).text).toBe(summary);
});
