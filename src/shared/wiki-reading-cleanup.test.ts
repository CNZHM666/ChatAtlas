import {expect,it} from "vitest";
import {wikiReadingCleanup} from "./wiki-reading-cleanup";

const generated={claims:[]};
const principle="Atlas 遵循 Human-readable, AI-ready 原则：首先让人看得懂、管得住，再让 AI 使用，避免信息不一致。";

it("keeps one introduction and hides further batch introductions before the first heading",()=>{
 const body="Atlas 以原始消息为事实来源，按消息级检索并按任务组装上下文。\n\n本章梳理 Atlas 的整体技术栈、数据流转与存储检索设计。\n\n## 存储\n\n本章节内容讨论索引如何重建，以及消息删除时如何同步删除对应文档。";
 expect(wikiReadingCleanup(body,generated)).toBe("Atlas 以原始消息为事实来源，按消息级检索并按任务组装上下文。\n\n## 存储\n\n本章节内容讨论索引如何重建，以及消息删除时如何同步删除对应文档。");
});

it("hides a paragraph whose every sentence an earlier paragraph already states",()=>{
 const body=`## 定位\n\n在信息呈现上，${principle}\n\n${principle}\n\n## 风险\n\n历史：早期曾将 Atlas 视为自动生成 Wiki 的工具，后修正为跨 AI 的持续项目工作区。另一个独有说明，讨论了后续的聚焦方向与范围。\n\n历史：早期曾将 Atlas 视为自动生成 Wiki 的工具，后修正为跨 AI 的持续项目工作区。`;
 const next=wikiReadingCleanup(body,generated);
 expect(next.match(/Human-readable/gu)).toHaveLength(1);expect(next.match(/历史：早期/gu)).toHaveLength(1);
 expect(next).toContain("另一个独有说明");
});

it("keeps status-only sentences, unique content, claims, lists, code and personal chapters",()=>{
 const status="Atlas 的功能规划围绕导入、提取、确认与复用的闭环展开，所有核心模块目前均为 AI建议，材料未显示用户已确认全面采用。";
 const body=`## 规划\n\n${status}\n\n${status.replace("闭环展开","闭环展开")}\n\n- ${principle}\n- ${principle}\n\n\`\`\`\n${principle}\n${principle}\n\`\`\``;
 // A paragraph whose only sentence carries a status phrase is never judged a repeat.
 expect(wikiReadingCleanup(body,generated)).toBe(body);
 const claim=`${principle}\n\n${principle}`;
 expect(wikiReadingCleanup(claim,{claims:[{text:"首先让人看得懂、管得住",quote:"q",evidenceIds:["e1"]}]})).toBe(wikiReadingCleanup(claim,generated));
 expect(wikiReadingCleanup(`${principle}\n\n${principle}`,{claims:[],userEdited:true})).toBe(`${principle}\n\n${principle}`);
});
