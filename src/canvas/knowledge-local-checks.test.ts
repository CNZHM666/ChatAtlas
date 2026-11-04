import {expect,it,vi} from "vitest";
import {knowledgeCheckScenario,runKnowledgeLocalChecks} from "./knowledge-local-checks";
import {checkProjectKnowledge,knowledgeCheckExport} from "./project-knowledge-checks";
import {projectKnowledgeView,projectKnowledgeSection} from "../shared/project-knowledge-view";
import {validateWikiClaims} from "../shared/wiki-claims";

it("executes cross-domain production checks without network or project writes",()=>{
 const fetch=vi.spyOn(globalThis,"fetch");try{const results=runKnowledgeLocalChecks();expect(results).toHaveLength(6);expect(results.filter(result=>!result.passed)).toEqual([]);expect(fetch).not.toHaveBeenCalled();}finally{fetch.mockRestore();}
});
it("validates relations with source receipts, matching scope and chronological order",()=>{
 const first="我决定使用 React 渲染界面。";
 const make=(text:string,scope="V1",role:"user"|"assistant"="user")=>knowledgeCheckScenario([{text:first,subject:"界面框架",scope:"V1",kind:"decision"},{text,subject:"UI框架",scope,role,kind:"decision",relation:{kind:"replaces",targetQuote:first}}]).session;
 for(const session of [make("建议改用 Svelte 渲染界面。","V1","assistant"),make("我决定改用 Svelte 渲染界面。","V2")])expect(projectKnowledgeView(session).facts[0].historical).toBe(false);
 const session=make("我最终决定改用 Svelte 渲染界面。");session.sourceSignatures!["knowledge-check"].m1="changed";expect(projectKnowledgeView(session).facts[0].historical).toBe(false);
});
it("qualifies bound paraphrases without discarding their details, and leaves personal prose untouched",()=>{
 const first="我决定使用 React 渲染界面。",body="界面使用 React 组织页面，保留分组、键盘导航和快捷操作。";
 const {session}=knowledgeCheckScenario([{text:first,scope:"V1",subject:"界面框架",kind:"decision",body,formulations:[body]},{text:"我最终决定改用 Svelte 渲染界面。",scope:"V1",subject:"界面框架",kind:"decision"}]);
 const output=projectKnowledgeSection(session.sections[0],session).body;expect(output).toBe("此前记录："+body);
 session.sections[0].userEdited=true;expect(projectKnowledgeSection(session.sections[0],session).body).toBe(body);
 const parsed=validateWikiClaims([{text:"正文结论",quote:"原文",evidenceIds:["e"],relation:{kind:"invented",targetQuote:"unknown"},formulations:["完整句。",12]}],["e"])![0];expect(parsed.relation).toBeUndefined();expect(parsed.formulations).toEqual(["完整句。"]);
});
it("audits saved content without mutation and exports signals rather than private article bodies",()=>{
 const {session}=knowledgeCheckScenario([{text:"全部功能已经实现。",role:"assistant",kind:"progress",body:"PRIVATE_ARTICLE\n\n全部功能已经实现。"}]);
 const before=structuredClone(session),report=checkProjectKnowledge(session);expect(report.findings.some(finding=>finding.kind==="delivery")).toBe(true);expect(session).toEqual(before);expect(JSON.stringify(knowledgeCheckExport(report))).not.toContain("PRIVATE_ARTICLE");
});
