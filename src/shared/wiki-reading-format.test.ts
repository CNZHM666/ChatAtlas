import {expect,it} from "vitest";
import {wikiReadingFormat} from "./wiki-reading-format";
import {wikiChapterLinks,wikiChapterLinksAsText} from "./wiki-chapter-links";
import {readingEmphasisMarkdown} from "./reading-emphasis";
import {distinctNotes} from "./wiki-history";

it("keeps the fuller of two restated opening paragraphs and drops near-verbatim repeats",()=>{
 const short="ChatAtlas 的整体架构建议采用本地优先路线，数据主要保存在本地，用户自行配置模型接口。";
 const full="ChatAtlas 的整体架构建议采用本地优先路线，数据主要保存在本地，用户自行配置模型接口，以降低后端成本并保护隐私，核心是四层架构。";
 const other="第二段讲完全不同的内容：检索引擎使用全文索引和向量索引的组合方式。";
 expect(wikiReadingFormat(`${short}\n\n${full}\n\n## 模块\n\n${other}`,{})).toBe(`${full}\n\n## 模块\n\n${other}`);
 // A later paragraph that repeats an earlier one almost word for word goes; distinct openings stay.
 const intro="Atlas 帮助用户找回过去在多个 AI 平台中讨论过的项目知识。";
 expect(wikiReadingFormat(`${intro}\n\n${other}\n\n## 小结\n\n${other}`,{})).toBe(`${intro}\n\n${other}\n\n## 小结`);
 // Lists, quotes and personal chapters are never touched.
 expect(wikiReadingFormat(`${short}\n\n${full}`,{userEdited:true})).toBe(`${short}\n\n${full}`);
});

it("turns a bare label line glued to its paragraph or list into a sub-heading",()=>{
 const body="## 核心价值\n\n用户痛点与市场空白\n当前，重度 AI 用户面临三个问题：\n\n差异化竞争策略\n\n- 定位为记忆层\n- 服务重度用户\n\n这是一句普通的结论，不是标题。";
 expect(wikiReadingFormat(body,{})).toBe("## 核心价值\n\n### 用户痛点与市场空白\n\n当前，重度 AI 用户面临三个问题：\n\n### 差异化竞争策略\n\n- 定位为记忆层\n- 服务重度用户\n\n这是一句普通的结论，不是标题。");
 // A short standalone line before ordinary prose, or a line with punctuation, stays prose.
 expect(wikiReadingFormat("## 节\n\n短句结论\n\n后面是正文。",{})).toBe("## 节\n\n短句结论\n\n后面是正文。");
});

it("keeps one telling of a history note told twice, preferring the fuller one",()=>{
 const brief="早期讨论曾考虑将产品定位为“AI Wiki 生成器”，经过竞品分析后确认定位为“所有 AI 对话管家”。";
 const fuller="早期讨论曾考虑将产品定位为“AI Wiki 生成器”，经过竞品分析（如 LLM Wiki、Obsidian）后确认定位为“所有 AI 对话管家”。";
 expect(distinctNotes([{text:brief,heading:"定位"},{text:fuller},{text:"检索从全文搜索调整为混合检索。"}])).toEqual([{text:fuller,heading:"定位"},{text:"检索从全文搜索调整为混合检索。"}]);
});

it("moves history paragraphs, in any label form, out of the prose",()=>{
 const body="## 定位\n\n当前定位是跨 AI 的项目工作区。\n\n历史：早期曾视为 Wiki 生成器。\n\n第一版聚焦消息级搜索。\n\n**历史**：后来修正为对话管家。\n\n**历史：**早期 AI 讨论中曾提出 MCP Adapter。\n\n## 风险\n\n长上下文不能完全解决问题。";
 const output=wikiReadingFormat(body,{});
 expect(output).toBe("## 定位\n\n当前定位是跨 AI 的项目工作区。\n\n第一版聚焦消息级搜索。\n\n## 风险\n\n长上下文不能完全解决问题。");
 expect(output).not.toContain("**");
});

it("splits a paragraph over 250 characters at a sentence end, never inside quotes or bold",()=>{
 const sentence=(word:string)=>`${word}方案需要在本地完成检索并保留原始消息位置，避免把全部历史交给模型重新阅读，从而控制成本与延迟。`;
 const long=["甲","乙","丙","丁","戊","己","庚"].map(sentence).join("");
 const parts=wikiReadingFormat(long,{}).split("\n\n");
 expect(parts.length).toBeGreaterThan(1);expect(parts.join("")).toBe(long);for(const part of parts)expect(part.length).toBeLessThanOrEqual(250);
 const quoted=`“${long}”`;expect(wikiReadingFormat(quoted,{})).toBe(quoted);
 const bold=`**${long}**`;expect(wikiReadingFormat(bold,{})).toBe(bold);
 expect(wikiReadingFormat(long,{userEdited:true})).toBe(long);
});

it("drops paragraphs an earlier chapter already explains and closes the subsection with a see-also link",()=>{
 const shared="Chrome MV3 Service Worker 可能在空闲后终止，内存中的状态会丢失，因此必须把索引数据持久化到 IndexedDB 并支持中断恢复。";
 const chapters=[{id:"a",title:"系统架构",body:`## 约束\n\n${shared}`},{id:"b",title:"设计约束",body:`## 安全\n\n${shared}\n\n${shared.replace("Chrome","浏览器 Chrome")}\n\n独有的说明：侧栏只覆盖已经导入的对话，没有索引的数据不能假装能被找到。`}];
 const linked=wikiChapterLinks(chapters[1].body,{id:"b",claims:[]},chapters);
 // Fold the exact copy and leave the reworded, ungrounded technical statement in place.
 expect(linked).toBe(`## 安全\n\n${shared.replace("Chrome","浏览器 Chrome")}\n\n独有的说明：侧栏只覆盖已经导入的对话，没有索引的数据不能假装能被找到。\n\n> 相关内容另见[「系统架构」](#atlas-chapter-a)。`);
 expect(wikiChapterLinks(chapters[0].body,{id:"a",claims:[]},chapters)).toBe(chapters[0].body);
 expect(wikiChapterLinksAsText(linked)).toContain("> 相关内容另见「系统架构」。");
 // A subsection that only repeats one earlier chapter keeps its heading and becomes one pointer.
 const repeated=wikiChapterLinks(`## 安全\n\n${shared}\n\n## 范围\n\n独有的说明：侧栏只覆盖已经导入的对话，没有索引的数据不能假装能被找到。`,{id:"b",claims:[]},chapters);
 expect(repeated).toBe("## 安全\n\n> 这部分已在[「系统架构」](#atlas-chapter-a)中说明。\n\n## 范围\n\n独有的说明：侧栏只覆盖已经导入的对话，没有索引的数据不能假装能被找到。");
});

it("keeps structural bold labels while re-selecting emphasis",()=>{
 const body="## 规划\n\n**智能书签与混合检索**\n\n书签备注可以在全文检索中更容易匹配实际词汇，也能减少需要分析的长篇原文。\n\n**记忆层借鉴**。建议借鉴事实提取与去重机制，但不直接引入整个框架。";
 const result=readingEmphasisMarkdown(body,{sectioned:true});
 expect(result).toContain("**智能书签与混合检索**");expect(result).toContain("**记忆层借鉴**。");
});

it("leaves no empty block where a generated chapter copied a block's summary as a fence; a chapter edited by hand keeps its text",()=>{
 const body="仓库首页列出最近的构建。\n\n```text, 2 lines\n```\n点击一行查看日志。\n\n*讨论中的原文代码 · AI 建议，未确认*\n\n```text\n构建 #12  通过\n构建 #11  失败\n```";
 const shown=wikiReadingFormat(body,{});
 expect(shown).not.toMatch(/```text, 2 lines|```\n```/u);expect(shown).toContain("点击一行查看日志。");expect(shown).toContain("构建 #12  通过");
 expect(wikiReadingFormat(body,{userEdited:true})).toContain("```text, 2 lines");
});
