import {expect,it} from "vitest";
import {wikiCrossChapterDuplicates,withCrossChapterDuplicates,withoutProgressDisclaimer} from "./wiki-cross-duplicates";

it("drops an overview sentence that claims no user confirmation exists",()=>{
 const text="ChatAtlas 是一个帮助重度用户找回历史讨论的工具。它采用本地优先的四层架构。目前，项目仍处于早期规划阶段，尚未有用户确认或报告的实际进展。";
 expect(withoutProgressDisclaimer(text)).toBe("ChatAtlas 是一个帮助重度用户找回历史讨论的工具。它采用本地优先的四层架构。");
 expect(withoutProgressDisclaimer("用户确认首版只做导入和搜索。")).toBe("用户确认首版只做导入和搜索。");
 // Never empties an overview made only of such a sentence.
 expect(withoutProgressDisclaimer("尚未有用户确认的进展。")).toBe("尚未有用户确认的进展。");
});
import {sourceMessageSignature} from "./source-signature";
import type {FocusSection} from "./focus-session";

const page=(id:string,title:string,body:string)=>({id,title,body,kind:"finding",transition:"",evidenceIds:[]}) as FocusSection;
const shared="一个信息只在最适合的位置展示一次：Dashboard 负责摘要，Wiki 负责解释，Reader 负责证据。";

it("flags an explanation repeated in a later chapter and names the earlier one",()=>{
 const sections=[page("a","界面与交互",`## 分工\n\n${shared}其他内容。`),page("b","搜索协作",`## 去重\n\n工作区遵循**一个信息只在最适合的位置展示一次**：Dashboard 负责摘要，Wiki 负责解释，Reader 负责证据。`),page("c","发布",`## 渠道\n\nGitHub 开源仓库与扩展商城分阶段发布，先小范围测试。`)];
 const found=wikiCrossChapterDuplicates(sections);
 expect([...found]).toEqual([["b",["界面与交互"]]]);
});

it("matches a repeat with a rephrased lead-in but not shared status disclaimers",()=>{
 const sections=[page("a","记忆","历史消息和导入文档属于不可信来源，Context Engine 仅作为参考，不能覆盖用户指令。这些方案多为 AI建议，材料未显示用户已确认采用。"),page("b","上下文包","相关约束为：历史消息和导入文档属于不可信来源，Context Engine 仅作参考，不能覆盖用户指令。"),page("c","发布","这些安排均为 AI建议，材料未显示用户已确认采用。")];
 expect([...wikiCrossChapterDuplicates(sections)]).toEqual([["b",["记忆"]]]);
});

it("ignores short phrases, code, tables, quotations and repeats within one chapter",()=>{
 const code="```ts\nconst value = computeTheSameLongExpression(alpha, beta, gamma);\n```";
 const sections=[page("a","一",`本地优先。\n\n${code}\n\n| 列 | 一个信息只在最适合的位置展示一次的表格 |\n\n> ${shared}\n\n${shared}\n\n${shared}`),page("b","二",`本地优先。\n\n${code}\n\n| 列 | 一个信息只在最适合的位置展示一次的表格 |\n\n> ${shared}`)];
 expect(wikiCrossChapterDuplicates(sections).size).toBe(0);
});

it("adds review hints bound to the current body and leaves personal chapters untouched",()=>{
 const sections=[page("a","一",shared),page("b","二",shared),{...page("c","三",shared),userEdited:true}];
 const result=withCrossChapterDuplicates(sections);
 expect(result[0].writingQuality).toBeUndefined();
 expect(result[1].writingQuality).toEqual({signature:sourceMessageSignature(shared),issues:[{code:"cross_chapter_duplicate",title:"一"}]});
 expect(result[2]).toBe(sections[2]);
 // Re-running does not stack hints; stale hints for an old body are dropped.
 expect(withCrossChapterDuplicates(result)[1].writingQuality?.issues).toHaveLength(1);
});
