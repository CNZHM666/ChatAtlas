import {expect,it} from "vitest";
import {aiAdvicePresentation} from "./ai-advice-presentation";
import {knowledgeBodyPresentation} from "./wiki-knowledge-prose";
import {projectKnowledgeSection} from "./project-knowledge-view";
import {contextKnowledge} from "../test/context-fixture";

it("keeps AI建议 for proposals but restores a plain actor before other acts",()=>{
 const input=["AI建议发现了一个严重隐患。","AI建议对导出的上下文文件进行了多轮评估。","AI建议提出三项优化重点。","AI建议起草了详细的优化指令。","AI建议了三种交付通道。","AI建议采用混合检索。","AI建议将事项分为三类。","原话是“AI建议发现了问题”。"].join("\n\n");
 expect(aiAdvicePresentation(input)).toBe(["AI发现了一个严重隐患。","AI对导出的上下文文件进行了多轮评估。","AI提出三项优化重点。","AI起草了详细的优化指令。","AI提出了三种交付通道。","AI建议采用混合检索。","AI建议将事项分为三类。","原话是“AI建议发现了问题”。"].join("\n\n"));
});

it("uses AI建议 in generated prose while preserving code, quotations, links and retained source text",()=>{
 const original='助手建议采用本地索引。\n\n**助手建议**保留原文。\n\n> 助手建议保留这段引用。\n\n`助手建议`\n\n```txt\n助手建议\n```\n\n原话是“助手建议先核对”。\n\n[助手建议](https://example.com)';
 const output=aiAdvicePresentation(original);
 expect(output).toContain("AI建议采用本地索引。");expect(output).toContain("**AI建议**保留原文。");expect(output).toContain("> 助手建议保留这段引用。");expect(output).toContain("`助手建议`");expect(output).toContain("```txt\n助手建议\n```");expect(output).toContain("“助手建议先核对”");expect(output).toContain("[助手建议](https://example.com)");expect(aiAdvicePresentation(output)).toBe(output);
 expect(aiAdvicePresentation("助手建议保存原文。",["助手建议保存原文。"]) ).toBe("助手建议保存原文。");
});
it("shares the wording with generated Wiki/export presentation and leaves personal edits and evidence untouched",()=>{
 const {session}=contextKnowledge(),body="助手建议保留原文，未提供实现报告。",section={...session.sections[0],body};
 const before=structuredClone(session);
 expect(knowledgeBodyPresentation(body)).toBe("AI建议保留原文，未提供实现报告。");expect(projectKnowledgeSection(section,session).body).toContain("AI建议保留原文");
 expect(projectKnowledgeSection({...section,userEdited:true},session).body).toBe(body);expect(session).toEqual(before);
});

it("unifies narrator roles across Markdown without changing product names, source attribution or split quotations",()=>{
 const body='助手认为先整理，再导出。AI助手提出新方案。人工智能助手说明边界。助手 **建议**本地保存。AI 建议先核对。用户决定保留记录。智能助手建议显示入口。客服助手回答用户问题。原话“助手**建议**本地保存”。';
 const output=aiAdvicePresentation(body);
 expect(output).toBe('AI认为先整理，再导出。AI提出新方案。AI说明边界。AI**建议**本地保存。AI建议先核对。用户决定保留记录。智能助手建议显示入口。客服助手回答用户问题。原话“助手**建议**本地保存”。');
 expect(aiAdvicePresentation(output)).toBe(output);
});
