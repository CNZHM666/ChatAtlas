import {expect,it} from "vitest";
import {wikiQualityMetrics,wikiQualityCsvMetrics} from "./wiki-quality-metrics";

import fixture from "../test/fixtures/wiki-quality.md?raw";
it("measures titles, emphasis, meta prose, duplicates, overview overlap and repeated terminology",()=>{
 const result=wikiQualityMetrics(fixture);
 expect(result).toMatchObject({chapter_count:3,subtopic_count:2,paired_title_rate:3/5,bold_count:2,bold_avg_chars:9,bold_max_chars:10,meta_overview_count:1,overview_verbatim_overlap:1});
 expect(result.sibling_suffix_pairs).toEqual([{first:"检索与上下文引擎",second:"记忆与上下文引擎",suffix:"与上下文引擎"}]);
 expect(result.cross_chapter_duplicates).toHaveLength(2);
 expect(result.cross_chapter_duplicates).toContainEqual(expect.objectContaining({first:"原始消息保存在本地",second:"原始消息保存在本地",similarity:1}));
 expect(result.cross_chapter_duplicates).toContainEqual(expect.objectContaining({similarity:expect.any(Number),second:expect.stringContaining("理解吧")}));
 const visible="原始消息保存在本地。独立的概况。本章说明检索。原始消息保存在本地。IndexedDB保存数据，IndexedDB保留顺序。保留所有原始讨论。AI建议先阅读。Orama服务检索，本地优先，BYOK，不得自动发送。系统必须完整保留用户确认的原始消息和个人笔记以便以后恢复此前形成的完整理解。原始消息保存在本地。IndexedDB和Orama。系统必须完整保留用户确认的原始消息和个人笔记以便以后恢复此前形成的完整理解吧。不要自动覆盖个人编辑。AI建议核对BYOK。";
 expect(result.ai_advice_density).toBeCloseTo(2000/visible.length);
 expect(result.repeated_terms).toEqual([{term:"IndexedDB",chapters:2,occurrences:3},{term:"Orama",chapters:2,occurrences:2},{term:"本地优先",chapters:1,occurrences:1},{term:"BYOK",chapters:2,occurrences:2},{term:"不得自动发送",chapters:1,occurrences:1}]);
 const csv=wikiQualityCsvMetrics(fixture);expect(csv.cross_chapter_duplicates).toBe(2);expect(JSON.stringify(csv)).not.toContain("原始消息保存在本地");
});
it("handles empty exports, repeated sentences within one chapter and custom terms",()=>{
 expect(wikiQualityMetrics("")).toMatchObject({chapter_count:0,paired_title_rate:0,bold_avg_chars:0,bold_max_chars:0,ai_advice_density:0,cross_chapter_duplicates:[]});
 const result=wikiQualityMetrics("## 独立\n\n重复句。重复句。",["重复"]);
 expect(wikiQualityMetrics("## 一\n\n甲乙。\n\n## 二\n\n甲乙。").cross_chapter_duplicates).toEqual([]);
 expect(result.cross_chapter_duplicates).toEqual([]);expect(result.repeated_terms).toEqual([{term:"重复",chapters:1,occurrences:2}]);
});
it("excludes repeated source captions, tables and locator sections from prose duplication",()=>{
 const boilerplate="**本章来源对话**：ChatGPT 1、ChatGPT 2\n\n**界面草图**\n\n```text\nUI\n```\n\n| 方案 | 建议价格 |\n| --- | --- |\n| 体验 | 免费开放七天体验 |";
 const markdown=`## 界面\n\n${boilerplate}\n\n## 商业化\n\n${boilerplate}\n\n## 引用定位\n\n本章来源对话：ChatGPT 1、ChatGPT 2`;
 expect(wikiQualityMetrics(markdown)).toMatchObject({chapter_count:2,cross_chapter_duplicates:[]});
});
it("counts repeats within a chapter, surviving wire IDs, actorless proposals and double openings",()=>{
 const markdown=[
  "## 定位","",
  "ChatAtlas 的核心定位是所有 AI 对话管家，帮助重度用户找回历史。","",
  "ChatAtlas 的核心定位是所有 AI 对话管家，帮助重度用户找回历史与项目状态。","",
  "它不是归档工具。<e2> 另见【e3】与 [e4]。","",
  "## 评估","",
  "建议发现了一个严重隐患。建议对导出文件进行了多轮评估。AI建议先做导出。建议采用混合检索。","",
  "```text","<e9> [e9]","```","",
  "`<e1>` 是示例。",
 ].join("\n");
 const result=wikiQualityMetrics(markdown);
 expect(result.intra_chapter_duplicates).toEqual([expect.objectContaining({chapter:"定位",second:expect.stringContaining("项目状态")})]);
 expect(result.raw_citation_markers).toBe(3);
 expect(result.orphan_advice_subjects).toBe(2);
 expect(result.double_openings).toBe(1);
 expect(wikiQualityCsvMetrics(markdown)).toMatchObject({intra_chapter_duplicates:1,raw_citation_markers:3,orphan_advice_subjects:2,double_openings:1});
});
it("leaves listed key conclusions out of the repeat counts, reads AI 建议 with its space and counts fragment conclusions",()=>{
 const conclusions=(fragment:string)=>["**关键结论与来源**","","*AI 建议 · 所选来源中未发现用户确认*","",`- 本地持久化存储采用 IndexedDB 配合 Dexie.js 的方案，用于保存所有历史对话及消息。〔来源 1〕`,`- ${fragment}〔来源 2〕`];
 const markdown=[
  "## 存储","","本地持久化存储采用 IndexedDB 配合 Dexie.js 的方案，用于保存所有历史对话及消息。下一阶段要求历史知识定位成功率≥80%，并减少人工准备时间。","",...conclusions("历史知识定位成功率≥80%"),"",
  "## 检索","","检索以消息为单位建立索引，展示时再聚合到所属对话中。","",...conclusions("用于保存所有历史对话及消息"),
 ].join("\n");
 const result=wikiQualityMetrics(markdown);
 expect(result.intra_chapter_duplicates).toEqual([]);
 expect(result.cross_chapter_duplicates).toEqual([]);
 expect(result.ai_advice_density).toBeGreaterThan(0);
 // Whole sentences pass; the first chapter's mid-sentence fragment and the second's subjectless clause do not.
 expect(result.orphan_advice_subjects).toBe(2);
});
it("measures fragmentation and counts paraphrased openings stacked before the first subtopic",()=>{
 const markdown=[
  "## 架构","","系统以本地优先为原则。","","整体设计围绕跨平台复用展开，基础是持久化存储。","",
  "### 存储","",`${"甲".repeat(400)}。`,"","### 片段","","很短。","","### 另一段","","也短。","",
  "## 单页","","只有一段正文。",
 ].join("\n");
 const result=wikiQualityMetrics(markdown);
 expect(result.double_openings).toBe(1);
 expect(result.subtopic_avg_chars).toBeCloseTo((401+3+3)/3);
 expect(result.short_subtopics).toBe(2);
 expect(result.over_budget_chapters).toBe(1);
 expect(wikiQualityCsvMetrics(markdown)).toMatchObject({short_subtopics:2,over_budget_chapters:1});
});


it("excludes export metadata from chapter, subtopic and prose-quality counts",()=>{
 const body="## 搜索\n\n### 本地查找\n\n关键词查找不调用模型。";
 const notes="\n\n## 文档信息与核对说明\n\n### 状态说明\n\nAI 建议、用户确认和实现核验不能混同。";
 expect(wikiQualityMetrics(body+notes)).toEqual(wikiQualityMetrics(body));
});
