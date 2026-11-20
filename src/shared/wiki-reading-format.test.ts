import {expect,it} from "vitest";
import {wikiReadingFormat} from "./wiki-reading-format";
import {wikiChapterLinks,wikiChapterLinksAsText} from "./wiki-chapter-links";
import {readingEmphasisMarkdown} from "./reading-emphasis";
import {distinctNotes} from "./wiki-history";

it("qualifies generated compatibility and key lifecycle prose without changing literal examples or personal writing",()=>{
 const claims="规则引擎 + 数据库保证电气兼容性。\n\nKey 存储（sessionStorage），关闭浏览器后消失。";
 const literal=`\n\n\`\`\`text\n${claims}\n\`\`\``;
 const result=wikiReadingFormat(claims+literal,{});
 expect(result.split("```text")[0]).toContain("目录提供元件参数，由规则引擎检查已知电气约束");
 expect(result.split("```text")[0]).toContain("刷新和恢复会话时需单独核对保留行为");
 expect(result).toContain(literal.trim());
 expect(wikiReadingFormat(claims,{userEdited:true})).toBe(claims);
 const range="### 学习路线规划\n\nV1 第一版功能边界包括识别范围。";
 expect(wikiReadingFormat(range,{})).toContain("### 第一版范围与识别边界");
 expect(wikiReadingFormat("### 学习路线规划\n\n先学习 Python，再学习电路。",{})).toContain("### 学习路线规划");
});

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

it("keeps one grounded explanation and filters illustrative proposal fragments from generated prose",()=>{
 const explanation="校验器报错时，画布高亮冲突元件，用户可以修复并重新验证。";
 const flows="Validator → Canvas visualization → Fix → Revalidate（AI 建议，未确认）\n\nESP32 → DHT22（AI 建议，未确认）";
 expect(wikiReadingFormat(`${explanation}\n\n${flows}`,{})).toBe(explanation);
 expect(wikiReadingFormat(flows,{userEdited:true})).toBe(flows);
});

it("keeps a proposed flow when the prose explicitly denies one of its steps",()=>{
 const proposed="Validator → Canvas visualization → Fix → Revalidate（AI 建议，未确认）";
 const limitation="校验器报错时，画布高亮冲突元件，系统不提供修复及重新验证。";
 expect(wikiReadingFormat(`${limitation}\n\n${proposed}`,{})).toContain("Revalidate〔建议〕");
});

it("leaves no empty block where a generated chapter copied a block's summary as a fence; a chapter edited by hand keeps its text",()=>{
 const body="仓库首页列出最近的构建。\n\n```text, 2 lines\n```\n点击一行查看日志。\n\n*讨论中的原文代码 · AI 建议，未确认*\n\n```text\n构建 #12  通过\n构建 #11  失败\n```";
 const shown=wikiReadingFormat(body,{});
 expect(shown).not.toMatch(/```text, 2 lines|```\n```/u);expect(shown).toContain("点击一行查看日志。");expect(shown).toContain("构建 #12  通过");
 expect(wikiReadingFormat(body,{userEdited:true})).toContain("```text, 2 lines");
});
it("combines planning tables without mixing their milestone numbering and keeps the originals accessible",()=>{
 const context="**对照表 · 第一版**\n\n| 阶段 | 实现内容 |\n| --- | --- |\n| M1 | 手动复制 |\n| M2 | 侧栏插入 |";
 const search="| 阶段 | 开发内容 |\n| --- | --- |\n| M1 | 全文搜索 |\n| M2 | 混合检索 |";
 const priority="| 优先级 | 功能 |\n| --- | --- |\n| P0 | 消息定位 |\n| P2 | 批量导出 |";
 const input=[context,search,priority].join("\n\n");
 const actual=wikiReadingFormat(input,{});
 const [summary,originals]=actual.split("<summary>原始规划表</summary>");
 expect(summary).toContain("手动复制 → 侧栏插入");
 expect(summary).toContain("全文搜索 → 混合检索");
 expect(summary).toContain("优先级 | P0 消息定位");
 expect(summary).not.toContain("M2");
 expect(originals).toContain(search);
 expect(originals).toContain(priority);
 expect(wikiReadingFormat(input,{userEdited:true})).toBe(input);
});

it("repairs tool link placeholders and generated shape descriptions while preserving code",()=>{
 const code="```ts\nconst raw = '<Link url={turn1view0.url.uri} title=\"原稿\"/>';\n```";
 const actual=wikiReadingFormat(`索引采用 Provider Adapter（涉及 table, 5 rows）。\n\n| 产品 | 功能 |\n|---|---|\n| <Link url={turn1view0.url.uri} title="ContextVolt"/> | 保存对话 |\n| <Link url="https://example.com/docs" title="文档"/> | 搜索 |\n\n${code}`,{});
 expect(actual).toContain("ContextVolt（来源链接待核验）");
 expect(actual).toContain("[文档](<https://example.com/docs>)");
 expect(actual).not.toContain("5 rows");
 expect(actual).toContain(code);
});

it("explains useful tables in place and drops orphan captions and repeated rows",()=>{
 const useful="| 内容 | 第一版处理方式 |\n|---|---|\n| 图表 | 有数据则重新绘制 |\n| 地图 | 有地点信息即可重新展示 |";
 const code='```ts\nconst label = "对照表";\n```';
 const body=`### 渲染\n\n对照表 · 第一版\n\n${useful}\n\n对照表 · 第一版\n\n${useful}\n\n*对照表*\n\n先用 1～3 条相关对话生成草稿。\n\n| 项目 | 说明 |\n|---|---|\n| 预留 | — |\n\n${code}`;
 const actual=wikiReadingFormat(body,{});
 expect(actual).toContain("下表说明第一版如何处理不同类型的内容。");
 expect(actual.match(/有数据则重新绘制/gu)).toHaveLength(1);
 expect(actual).not.toContain("*对照表*");
 expect(actual).not.toContain("| 预留 |");
 expect(actual).toContain("先用 1～3 条相关对话生成草稿。");
 expect(actual).toContain(code);
 expect(wikiReadingFormat(body,{userEdited:true})).toBe(body);
});

it("merges overlapping Context Pack rows and preserves which source adds a Brief or optional model pass",()=>{
 const body=[
  "### Context Engine",
  "| 用途场景 | 打包范围 | 是否调用 LLM |\n|---|---|---|\n| 快速介绍 | Brief + 核心章节 | 否 |\n| 具体任务 | 精简 Brief + 相关章节 | 否 |\n| 完整迁移 | 全部选定章节 | 否 |",
  "原文来源 [S-a]",
  "| 场景 | 打包内容 | 需要 LLM 吗 |\n|---|---|---|\n| 快速介绍项目 | Brief + Wiki 核心章节 | 不需要 |\n| 继续具体任务 | Brief 精简版 + 任务相关 Wiki 章节 | 不需要 |\n| 完整迁移项目知识 | Brief + 用户选择的全部 Wiki 章节 | 不需要 |\n| 需要更短、更连贯的交接文档 | 上述内容经 LLM 精炼 | 可选 |",
  "原文来源 [S-b]",
 ].join("\n\n");
 const result=wikiReadingFormat(body,{});
 expect(result.match(/^\| ---/gmu)).toHaveLength(1);
 expect(result).toContain("| 快速介绍 | Brief + Wiki 核心章节 | 否 | [S-a] [S-b] |");
 expect(result).toContain("| 完整迁移 | 全部选定 Wiki 章节（另有方案同时包含 Brief [S-b]） | 否 | [S-a] [S-b] |");
 expect(result).toContain("讨论中还提出，可选用 LLM 精炼交接文档。 [S-b]");
 expect(wikiReadingFormat(body,{userEdited:true})).toBe(body);
});

it("merges repeated rows with matching headers without mixing source-specific rows or incompatible options",()=>{
 const first="| 组件 | 职责 |\n|---|---|\n| Reader | 查看原话 |\n| IndexedDB | 保存原始数据 |";
 const second="| 组件 | 职责 |\n|---|---|\n| Orama | 全文索引 |\n| **Reader** | 查看原话 |";
 const body=[first,"原文来源 [S-a]",second,"原文来源 [S-b]"].join("\n\n");
 const merged=wikiReadingFormat(body,{});
 expect(merged).toContain("| Reader | 查看原话 | [S-a] [S-b] |");
 expect(merged).toContain("| IndexedDB | 保存原始数据 | [S-a] |");
 expect(merged).toContain("| Orama | 全文索引 | [S-b] |");
 expect(merged.match(/查看原话/gu)).toHaveLength(1);
 const conflict=second.replace("|---|---|","|---|---|\n| IndexedDB | 只保存索引 |");
 expect(wikiReadingFormat([first,conflict].join("\n\n"),{}).match(/^\|\s*---/gmu)).toHaveLength(2);
 expect(wikiReadingFormat([first,"### 独立场景",second].join("\n\n"),{}).match(/^\|\s*---/gmu)).toHaveLength(2);
});

it("aligns comparable retrieval stages and keeps numbering, extra milestones and source scope distinct",()=>{
 const versions="| 版本 | 技术方案 | 用户得到的能力 |\n|---|---|---|\n| v0.1 | Orama + 全文索引 | 搜索具体历史消息 |\n| v0.2 | Orama + Embedding + Hybrid Search | 模糊描述也能查找 |\n| v0.3 | Orama + LLM 检索 Agent | 自动尝试不同搜索方法并总结证据 |";
 const milestones="| 阶段 | 开发内容 | 完成标准 |\n|---|---|---|\n| M1 | 消息级存储 + Orama 全文搜索 | 能找到任意已索引消息并定位 |\n| M2 | Embedding + 混合检索 | 模糊描述也能找到相关消息 |\n| M3 | LLM 重排 + 引用回答 | 能从候选消息中找出真正答案 |\n| M4 | Agent 多轮搜索 | 首轮查找失败时能自动换方法 |";
 const body=[versions,"原文来源 [S-version]","对照表 · 第一版",milestones,"原文来源 [S-milestones]"].join("\n\n");
 const [reading,originals]=wikiReadingFormat(body,{}).split("<summary>原始规划表</summary>");
 expect(reading).toContain("| 检索环节 | 共同要点 | 讨论方案 1 [S-version] | 第一版 [S-milestones] |");
 expect(reading).toContain("| 全文检索 | Orama | v0.1 · 搜索具体历史消息 | M1 · 消息级存储 · 能找到任意已索引消息并定位 |");
 expect(reading).toContain("| 混合检索 | Embedding · 支持用模糊描述查找相关消息 | v0.2 · Orama | M2 |");
 expect(reading).toContain("| LLM 重排 | — | — | M3 · LLM 重排 + 引用回答");
 expect(reading).toContain("| 检索 Agent | — | v0.3");
 expect(originals).toContain(versions);
 expect(originals).toContain(milestones);
 const reversed=[...versions.split("\n").slice(0,2),...versions.split("\n").slice(2).reverse()].join("\n");
 expect(wikiReadingFormat([reversed,milestones].join("\n\n"),{})).not.toContain("共同要点");
});

it("leaves an illustrative recording in the original while retaining a distinct validation requirement", () => {
 const proposal="拍一个 DHT22 → 识别成功 → 加入我的零件 → Canvas 自动出现 → Validator PASS〔建议〕";
 const acceptance="拍一个 DHT22 → 加入我的零件 → 模拟 2 秒超时 → 必须回滚〔建议〕";
 const body=wikiReadingFormat("## 交付\n\n"+proposal+"\n\n"+acceptance,{});
 expect(body).not.toContain("Validator PASS");
 expect(body).toContain("必须回滚");
});

it("keeps the purpose of a blank study worksheet in the text and its literal table with examples",()=>{
 const table="| 指标 | A组 | B组 |\n| --- | --- | --- |\n| 正确率 | ？ | ？ |\n| 完成时间 | ？ | ？ |";
 const result=wikiReadingFormat("### 试验设计\n\n表格来源 [S-1-a]\n\n"+table,{});
 const [body,example]=result.split("<details");
 expect(body).toContain("对照试验拟记录正确率、完成时间。");
 expect(body).not.toContain("？");
 expect(example).toContain("表格来源 [S-1-a]");
 expect(example).toContain(table);
 expect(wikiReadingFormat(table.replace("完成时间 | ？","完成时间 | 30 分钟"),{})).not.toContain("<details");
});

it("orders recognition explanations by entry, candidate, recovery and completion",()=>{
 const entry="拍照入口从草稿页打开。",candidate="系统展示候选项供用户确认。",failure="识别失败时允许重新拍摄。",done="确认成功后加入零件盒。";
 const title="### 图像识别与库存",body=[title,done,failure,entry,candidate].join("\n\n");
 expect(wikiReadingFormat(body,{})).toBe([title,entry,candidate,failure,done].join("\n\n"));
});
