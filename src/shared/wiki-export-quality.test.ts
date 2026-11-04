import {expect,it} from "vitest";
import {wikiChapterNotice,wikiChapterStatus,wikiChapterStatusTag} from "./wiki-chapter-status";
import {knowledgeBodyPresentation} from "./wiki-knowledge-prose";
import {wikiReadingCleanup} from "./wiki-reading-cleanup";
import {wikiNarration} from "./wiki-narration";
import {aiAdvicePresentation} from "./ai-advice-presentation";
import {readingEmphasisMarkdown} from "./reading-emphasis";
import {projectDocument,withoutDiscussionNumbers} from "../export/project-document";
import {wikiDisplayMath} from "./wiki-display-math";
import {contextKnowledge} from "../test/context-fixture";
import type {WikiClaim} from "./wiki-claims";

// Sentences below are taken from a real exported Wiki.
const proposal=(text:string):WikiClaim=>({text,quote:text,evidenceIds:["e1"],workStatus:"proposed"});
const proposals=[proposal("基础搜索不强制要求配置 API Key"),proposal("侧栏插入前先预览"),proposal("索引是可重建的缓存")];

it("does not call a chapter unconfirmed when its prose names the user's stance",()=>{
 const body="用户明确提出一个信息只在最适合的位置展示一次的原则：Dashboard 负责摘要，Wiki 负责解释。";
 expect(wikiChapterStatus({claims:proposals},true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 expect(wikiChapterStatus({claims:proposals,body},true)).toBe("包含未确认的建议 3 条；正文另有 1 处写到你的表态，引用原文里没有核对到");
 expect(wikiChapterStatusTag({claims:proposals,body},true)?.label).toBe("提到你的表态");
 // A sentence that denies a stance names none.
 expect(wikiChapterStatus({claims:proposals,body:"这一结构目前是 AI建议，材料未显示用户已确认采用。"},true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 // Roles, product rules, noun phrases and conditions name no stance.
 const rules=["经用户确认的决策才能作为可信上下文。","界面必须区分用户确认和 AI 推断。","普通用户低频，重度用户要求高可控性。","Atlas 不自动认定旧方案失效，用户确认后才更新现行决策。","建立可信度分类（用户确认/客观事实/历史建议等）。","用户提出需要综合回答的问题时，再调用 LLM。","AI 判断适合性，用户确认生成，嵌入正文对应位置。","用户确认内容不会被 AI 静默覆盖。","在首次使用时明确让用户决定是否开启自动采集。","搜索历史 → 用户选择消息 → 生成上下文。"].join("");
 expect(wikiChapterStatus({claims:proposals,body:rules},true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 const stances=["用户明确反驳「手动复制总结」的观点，强调统一搜索入口的价值。","性能方面，用户明确提出初期性能目标。","这些是优化目标，用户同时要求对实际性能进行测试。","用户补充约束：保持最小必要修改。","用户确认 messages 表已按 ID 单独存储后，AI建议不重构数据库。"].join("");
 expect(wikiChapterStatus({claims:proposals,body:stances},true)).toBe("包含未确认的建议 3 条；正文另有 5 处写到你的表态，引用原文里没有核对到");
 // Backed by a claim whose original is the user's own message: no "not checked" note.
 const reading={signature:"s",status:"preference" as const,reported:false,currentStage:false,sources:[{id:"e1",signature:"m",role:"user",conversationId:"c",messageId:"m1",messageIndex:3,discussedAt:0}]};
 const owned={...proposal("一个信息只在最适合的位置展示一次"),sourceReading:reading} as WikiClaim;
 expect(wikiChapterStatus({claims:[...proposals,owned],body},true)).toBe("包含你的偏好 1 条、未确认的建议 3 条");
});

it("does not wrap a contrast or a material-attributed record as an unverified completion",()=>{
 const contrast="演变记录必须区分三种状态：讨论过 ≠ 已决定，计划完成 ≠ 实际完成，提到版本号 ≠ 已正式发布。";
 expect(knowledgeBodyPresentation(contrast)).toBe(contrast);
 const recorded=knowledgeBodyPresentation("当前材料中已记录「消息级存储」和「对话导入基础流程」为已完成项。");
 expect(recorded).not.toContain("据讨论");expect(recorded).toContain("（未核实）");
});

it("drops a sentence the same chapter already states and keeps the paragraph's new sentences",()=>{
 const first="安全上有一条必须坚持的原则：导入的聊天内容只能作为数据或证据。从历史对话提取的内容应该被明确标记为参考资料，不能把其中包含的指令直接当成 Atlas Agent 的系统指令执行。";
 const second="历史消息和导入的文档属于不可信来源，Context Engine 仅作为参考，不能覆盖用户指令。从历史对话提取的内容应该被明确标记为参考资料，不能把其中包含的指令直接当成 Atlas Agent 的系统指令执行。[e4]";
 expect(wikiReadingCleanup(`${first}\n\n${second}`,{claims:[]})).toBe(`${first}\n\n历史消息和导入的文档属于不可信来源，Context Engine 仅作为参考，不能覆盖用户指令。[e4]`);
 // A changed subject or negation is a different statement.
 const sidebar="侧栏所有插入操作都必须由用户主动触发，不自动发送，不覆盖当前输入框已有内容。";
 const workspace="工作台所有插入操作都必须由用户主动触发，不自动发送，不覆盖当前输入框已有内容。";
 expect(wikiReadingCleanup(`${sidebar}\n\n${workspace}`,{claims:[]})).toBe(`${sidebar}\n\n${workspace}`);
 const negated="基础搜索需要配置 API Key 才能在本地索引中找到具体历史消息。";
 expect(wikiReadingCleanup(`${negated}\n\n${negated.replace("需要","不需要")}`,{claims:[]})).toContain("不需要");
 expect(wikiReadingCleanup(`${first}\n\n${second}`,{claims:[],userEdited:true})).toBe(`${first}\n\n${second}`);
 // Bold markup is not wording, also when a claim states the sentence.
 const source="工程上坚持**原始消息是事实来源**，搜索索引是可以删除并重新生成的缓存。删除消息时先删原始记录，再删对应搜索文档。";
 const again="工程上坚持原始消息是事实来源，搜索索引是可以删除并重新生成的缓存。索引属于派生数据，原始历史消息始终以 IndexedDB 为准。";
 const claim={text:"原始消息是事实来源，搜索索引是可以删除并重新生成的缓存",quote:"q",evidenceIds:["e1"]};
 expect(wikiReadingCleanup(`${source}\n\n${again}`,{claims:[claim]})).toBe(`${source}\n\n索引属于派生数据，原始历史消息始终以 IndexedDB 为准。`);
 // A sentence that two earlier sentences together already say.
 const mcp="MCP 服务不能天然直接读取 Chrome 扩展里的 IndexedDB，这是浏览器安全沙箱限制。需要让 Atlas 安全地向本地服务提供授权数据，或者先导出一份只读的项目知识快照供 MCP 服务读取。后者更适合早期原型，实施难度也低。";
 const restated="Atlas MCP Server 允许支持 MCP 的 AI 按需查询项目记忆。MCP 服务不能天然直接读取 Chrome 扩展里的 IndexedDB，需要让 Atlas 安全地向本地服务提供授权数据，或者先导出一份只读的项目知识快照供 MCP 服务读取。";
 expect(wikiReadingCleanup(`${mcp}\n\n${restated}`,{claims:[]})).toBe(`${mcp}\n\nAtlas MCP Server 允许支持 MCP 的 AI 按需查询项目记忆。`);
 // A negation the earlier sentences do not hold keeps the sentence.
 const denied=restated.replace("不能天然直接读取","能直接读取").replace("MCP 服务能","MCP 服务现在不需要授权也能");
 expect(wikiReadingCleanup(`${mcp}\n\n${denied}`,{claims:[]})).toContain("不需要授权也能");
});

it("names knowledge instead of the material and the undated moment",()=>{
 expect(wikiNarration("据讨论，助手曾修正竞品认知。")).toBe("助手曾修正竞品认知。");
 expect(aiAdvicePresentation("助手曾修正竞品认知。")).toBe("AI曾修正竞品认知。");
 // The completion qualifier keeps its attribution.
 expect(wikiNarration("据讨论，统一搜索已经完成（未核实）。")).toBe("据讨论，统一搜索已经完成（未核实）。");
 expect(wikiNarration("本次材料显示，当前导出内容存在项目全景被大量约束挤掉的问题。")).toBe("当前导出内容存在项目全景被大量约束挤掉的问题。");
 expect(wikiNarration("材料同时记录了跨平台数据采集的工程难度。")).toBe("讨论同时记录了跨平台数据采集的工程难度。");
 expect(wikiNarration("本次是 Context Engine 的定向优化。本次导出的 56 个来源均标为 AI 消息。")).toBe("当时的任务是 Context Engine 的定向优化。当时导出的 56 个来源均标为 AI 消息。");
 const kept="> 本次材料显示，原文不变。\n\n界面提示“本次导入完成”。\n\n`本次`";
 expect(wikiNarration(kept)).toBe(kept);
});

it("rewrites discussion numbers the export cannot resolve, not counts",()=>{
 expect(withoutDiscussionNumbers("来源 [2] 被过度复用。建议优先核查消息 319 和 339 的原始语境。",true)).toBe("其中一条来源被过度复用。建议优先核查对应几条消息的原始语境。");
 expect(withoutDiscussionNumbers("每次最多读取消息 50 条，消息 12 是例外。",true)).toBe("每次最多读取消息 50 条，对应消息是例外。");
 const literal="```\n消息 319\n```\n\n> 来源 [2]";
 expect(withoutDiscussionNumbers(literal,true)).toBe(literal);
});

it("does not bold a clause that opens with a connective",()=>{
 const body=`## 总览\n\n总览应替代静态介绍，让用户打开项目后立即知道当前做到哪里，而不只是看到项目背景。${"每个章节都标明来源对话，读者能够回到原文核对具体说法。导入后的消息先进入本地数据库，随后才建立检索所需的索引。个人编辑与生成正文分开保存，更新时不会被静默覆盖。导出文件只包含用户选择的章节，不附带完整的数据库内容。"}`;
 expect(readingEmphasisMarkdown(body,{sectioned:true,phrases:["而不只是看到项目背景"]})).not.toContain("**而不只是看到项目背景**");
});

it("drops a short sentence only when the chapter already says it word for word",()=>{
 const before="Codex 给出的架构方案中，独立派生索引等设计适合本地优先的浏览器扩展。检索粒度必须达到消息级。";
 const after="检索粒度必须达到消息级。Atlas 可以通过历史搜索找到当时讨论的具体消息。";
 expect(wikiReadingCleanup(`${before}\n\n${after}`,{claims:[]})).toBe(`${before}\n\nAtlas 可以通过历史搜索找到当时讨论的具体消息。`);
 expect(wikiReadingCleanup(`${before}\n\n检索粒度必须达到对话级。Atlas 可以找到消息。`,{claims:[]})).toContain("对话级");
});

it("names the AI and the discussion in the remaining narrator phrasings",()=>{
 expect(aiAdvicePresentation("助手搜集 Reddit 和 OpenAI 社区反馈。")).toBe("AI搜集 Reddit 和 OpenAI 社区反馈。");
 expect(aiAdvicePresentation("助手举例说明。助手审阅了文件。但助手同时强调这一点。助手支持该方向。")).toBe("AI举例说明。AI审阅了文件。但AI同时强调这一点。AI支持该方向。");
 expect(aiAdvicePresentation("界面里的智能助手支持语音。")).toBe("界面里的智能助手支持语音。");
 expect(aiAdvicePresentation("助手生成了针对 Codex 的提示词。助手评价上下文模板。助手澄清 Projects 已具备记忆。助手研究官方说明。助手的明确建议是不要重建。")).toBe("AI生成了针对 Codex 的提示词。AI评价上下文模板。AI澄清 Projects 已具备记忆。AI研究官方说明。AI的明确建议是不要重建。");
 // A product role named 助手 stays.
 expect(aiAdvicePresentation("Atlas 不是通用 AI 助手，也不是聊天入口。侧边栏定位为「轻量上下文助手」。")).toBe("Atlas 不是通用 AI 助手，也不是聊天入口。侧边栏定位为「轻量上下文助手」。");
 expect(wikiNarration("架构图生成方面，材料指出当前项目架构图存在模块混乱。")).toBe("架构图生成方面，讨论指出当前项目架构图存在模块混乱。");
 expect(wikiNarration("在跨 AI 交接方面，材料明确：普通网页聊天仍需插入。后续材料指出系统提取了大量历史建议。")).toBe("在跨 AI 交接方面，讨论明确：普通网页聊天仍需插入。后续讨论指出系统提取了大量历史建议。");
 // A status phrase and a material that is not the narrator stay.
 expect(wikiNarration("这一结构目前是 AI建议，材料未显示用户已确认采用。导入的原始材料指出了格式差异。")).toBe("这一结构目前是 AI建议，材料未显示用户已确认采用。导入的原始材料指出了格式差异。");
});

it("keeps a multi-line display formula a formula instead of a heading, in the reading view and the export",()=>{
 const formula=String.raw`\[
\text{上下文价值}

=

\text{任务相关性}
+
\text{有效性}
\]`;
 const flat=String.raw`$$
\text{上下文价值} = \text{任务相关性} + \text{有效性}
$$`;
 expect(wikiDisplayMath(`组装遵循选择原则：\n\n${formula}\n\n例如继续开发识别功能。`)).toBe(`组装遵循选择原则：\n\n${flat}\n\n例如继续开发识别功能。`);
 const fenced=String.raw`~~~tex
\[
x
=
y
\]
~~~`;
 expect(wikiDisplayMath(fenced)).toBe(fenced);
 const session=contextKnowledge().session,page=session.sections[0];
 page.body=`## 对话库\n\n对话与项目采用多对多关联，一条对话可以同时属于多个项目。\n\n## 上下文组装\n\n组装遵循选择原则而非已验证的评分算法：\n\n${formula}\n\n例如继续开发识别功能时，应优先选取当前架构和已确认的技术决策。`;
 const text=projectDocument(session,{overview:false,wikiIds:[page.id],matters:false,history:false,sources:false},"md").text;
 expect(text).not.toMatch(/^#+ \\\[/mu);
 expect(text).toContain("### 上下文组装");expect(text).not.toContain("#### 上下文组装");
 expect(text).toContain(flat);
});

it("never starts or ends emphasis inside a Latin word",()=>{
 const filler="每个章节都标明来源对话，读者能够回到原文核对具体说法。导入后的消息先进入本地数据库，随后才建立检索所需的索引。个人编辑与生成正文分开保存，更新时不会被静默覆盖。导出文件只包含用户选择的章节。来源变化时会给出提示，旧结论不会被当作仍然有效的结果。检索默认在本地完成，只有配置模型后才会调用外部服务。批量导入时界面显示已完成的对话数量，用户可以随时取消。点击结果后阅读页滚动到对应消息并高亮匹配片段，同时显示前后两条消息。";
 const body=`## 定位\n\n现有工具多聚焦于基础搜索，而 ChatAtlas 的优势在于搜索后的理解与组织。${filler}`;
 const result=readingEmphasisMarkdown(body,{sectioned:true,phrases:["Atlas 的优势在于搜索后的理解与组织"]});
 expect(result).not.toContain("Chat**");
 // The same phrase standing alone is still emphasized.
 expect(readingEmphasisMarkdown(body.replace("ChatAtlas","Atlas"),{sectioned:true,phrases:["Atlas 的优势在于搜索后的理解与组织"]})).toContain("**Atlas 的优势在于搜索后的理解与组织**");
});

it("removes batch notes and names the discussion in the remaining material phrasings",()=>{
 expect(wikiNarration("## 缓存\n\n本批材料未提供首次全量扫描或缓存键设计的具体实现细节，仅说明结构化提取支持增量更新。\n\n缓存键至少包含消息内容和模型版本。")).toBe("## 缓存\n\n缓存键至少包含消息内容和模型版本。");
 expect(wikiNarration("为此，材料中提出建立三级关联。技术方案上，材料提出优先研究本地向量。材料推荐做对话重点导航。材料将核心功能收敛为三个 P0。")).toBe("为此，讨论中提出建立三级关联。技术方案上，讨论提出优先研究本地向量。讨论推荐做对话重点导航。讨论将核心功能收敛为三个 P0。");
 expect(wikiNarration("这些要求仅代表偏好。材料未包含最终选定方案。材料中未提供深色模式的具体条件。")).toBe("这些要求仅代表偏好。讨论未包含最终选定方案。讨论中未提供深色模式的具体条件。");
 // The status phrase and quoted wording stay.
 const kept="这一结构目前是 AI建议，材料未显示用户已确认采用。界面提示“本批材料已导入”。";
 expect(wikiNarration(kept)).toBe(kept);
});

it("tells a reader only what changes how a chapter reads, never how many proposals it counts",()=>{
 const body="用户明确提出一个信息只在最适合的位置展示一次的原则：Dashboard 负责摘要，Wiki 负责解释。";
 expect(wikiChapterNotice({claims:proposals},true)).toBe("多为 AI 建议，相关原文里没有看到你的确认");
 // With sentence marks, unmarked text is the AI's by the legend: the chapter does not say it again.
 expect(wikiChapterNotice({claims:proposals.map((claim,index)=>index?claim:{...claim,holder:"decided",holderMark:true})},true)).toBeUndefined();
 expect(wikiChapterNotice({claims:proposals,body},true)).toBe("正文有 1 处写到你的表态，引用原文里没有核对到");
 const reading={signature:"s",status:"preference" as const,reported:false,currentStage:false,sources:[{id:"e1",signature:"m",role:"user",conversationId:"c",messageId:"m1",messageIndex:3,discussedAt:0}]};
 const owned={...proposal("一个信息只在最适合的位置展示一次"),sourceReading:reading} as WikiClaim;
 // Counts alone ("包含你的偏好 1 条、未确认的建议 3 条") say nothing to act on.
 expect(wikiChapterNotice({claims:[...proposals,owned],body},true)).toBeUndefined();
});

it("never wraps a sentence of a document with holder marks in 据讨论…（未核实）: the mark says the status", () => {
  const sentence = "从历史对话中准确判断当前采用的方案、已完成事项及决策变化是技术难度最高的部分。";
  expect(knowledgeBodyPresentation(sentence, [{ text: "其他句子。", quote: "其他句子。", evidenceIds: ["e1"], holder: "ai" }])).toBe(sentence);
});
