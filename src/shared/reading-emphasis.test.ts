import {expect,it} from "vitest";
import {readingEmphasisMarkdown} from "./reading-emphasis";
import {wikiDocument} from "../canvas/wiki-document";
import {projectDocument} from "../export/project-document";
import {contextKnowledge} from "../test/context-fixture";
import {projectOverviewContent,projectOverviewReadingText} from "./project-overview";

const filler="原始讨论按照发生顺序保存，阅读时可以逐步找回此前已经形成的理解。".repeat(8);
// Distinct sentences: a chapter's repeated sentences are dropped before reading.
const varied="原始讨论按照发生顺序保存，阅读时可以逐步找回此前已经形成的理解。每个章节都标明来源对话，读者能够回到原文核对具体说法。导入后的消息先进入本地数据库，随后才建立检索所需的索引。个人编辑与生成正文分开保存，更新时不会被静默覆盖。导出文件只包含用户选择的章节，不附带完整的数据库内容。来源变化时会给出提示，旧结论不会被当作仍然有效的结果。检索默认在本地完成，只有配置模型后才会调用外部服务。";
const highlights=(body:string)=>[...body.matchAll(/\*\*([^*]+)\*\*/gu)].map(match=>match[1]);
const emphasize=(text:string,phrases:string[]=[])=>readingEmphasisMarkdown(`## 主题\n\n${text}\n\n${filler}`,{sectioned:true,phrases});

it("shares short literal emphasis across Reader and export and protects personal bodies",()=>{
 const session=contextKnowledge().session,page=session.sections[0],phrase="自动发送原始消息";
 // Seven sentences: under the 250 characters at which reading splits a paragraph.
 page.body=`## 操作边界\n\n不得${phrase}。\n\n${varied}\n\n> ${phrase}。\n\n\`${phrase}\`\n\n\`\`\`txt\n${phrase}\n\`\`\``;
 page.claims=[{text:phrase,quote:"不能覆盖原始聊天",evidenceIds:["e-db"]}];
 const reader=wikiDocument(page.body,true,[],[phrase]).body;
 expect(highlights(reader)).toEqual([`不得${phrase}`]);
 const selection={overview:false,wikiIds:[page.id],matters:false,history:false,sources:false};
 expect(projectDocument(session,selection,"md").text).toContain(reader.replace("## 操作边界","### 操作边界"));
 expect(projectDocument(session,selection,"html").text).toContain(`<strong>不得${phrase}</strong>`);
 for(const personal of [{userEdited:true},{userEdited:false,origin:"user" as const}]){
  Object.assign(page,personal);expect(projectDocument(session,selection,"md").text).not.toContain("**");
 }
 const body="## 原文\n\n我的**重点**保持不变。";
 expect(readingEmphasisMarkdown(body,{sectioned:true,userEdited:true})).toBe(body);
 expect(readingEmphasisMarkdown(body,{sectioned:true,origin:"user"})).toBe(body);
});

it("skips opening overviews and topics below 200 characters, with one cue between ## or ### headings",()=>{
 const phrase="保留消息原始顺序",other="尊重用户确认范围";
 const body=`${phrase}。${filler}\n\n## 短节\n\n${phrase}。\n\n## 长节\n\n${phrase}。${other}。${filler}\n\n### 子节\n\n${other}。${filler}`;
 const output=readingEmphasisMarkdown(body,{sectioned:true,phrases:[phrase,other]});
 expect(output.split("## 长节")[0]).not.toContain("**");
 expect(highlights(output)).toEqual([phrase,other]);
 expect(highlights(readingEmphasisMarkdown(`## 短节\n\n${"甲".repeat(199-phrase.length)}${phrase}`,{sectioned:true,phrases:[phrase]}))).toHaveLength(0);
 expect(highlights(readingEmphasisMarkdown(`## 临界\n\n${"甲".repeat(200-phrase.length)}${phrase}`,{sectioned:true,phrases:[phrase]}))).toEqual([phrase]);
});

it("gives supplied conclusions priority over keyword scoring",()=>{
 const phrase="保留消息原始顺序";
 expect(highlights(emphasize(`必须禁止覆盖用户正文。${phrase}。`,[phrase]))).toEqual([phrase]);
 expect(highlights(emphasize("必须禁止覆盖用户正文。"))).toEqual(["必须禁止覆盖用户正文"]);
});

it("rejects meta explanations and status declarations sentence by sentence",()=>{
 for(const sentence of ["材料未显示必须保存所有消息","本章必须保存所有消息","这些均为必须保存所有消息","这些属于必须保存所有消息","状态：必须保存所有消息","当前已经实现保存所有消息","已完成保存所有原始消息","尚未保存所有原始消息","AI建议保存所有原始消息","用户报告保存所有原始消息","该功能已实现保存所有原始消息"]){
  expect(highlights(emphasize(sentence+"。",["保存所有原始消息","必须保存所有消息"])),sentence).toEqual([]);
 }
});

it("never detaches conditions, negations, quotes or inline formatting",()=>{
 for(const sentence of ["只有用户确认范围后，才能保存所有原始消息。","如果检查成功，就保存所有原始消息。","只有`allowed`有效时，才能保存所有原始消息。","保存所有原始消息的前提是确认范围。","系统不允许直接保存所有原始消息。","保存所有原始消息是不允许的。","不能通过`unsafe`保存所有原始消息。","不太建议直接保存所有原始消息。","失败时保存所有原始消息。","不需要直接保存所有原始消息。"]){
  expect(highlights(emphasize(sentence,["保存所有原始消息"]))).toEqual([]);
 }
 expect(highlights(emphasize("不能保存所有原始消息。",["保存所有原始消息"]))).toEqual(["不能保存所有原始消息"]);
 const body='## 边界\n\n引用“这里的**重点**：不得自动发送用户消息”。\n\n> 不得自动发送用户消息。\n\n`不得自动发送用户消息`\n\n```txt\n不得自动发送用户消息\n```\n\n'+filler;
 expect(readingEmphasisMarkdown(body,{sectioned:true,phrases:["自动发送用户消息"]})).toBe(body);
 for(const quoted of ["‘不得自动发送用户消息’", "'不得自动发送用户消息'",'"不得自动发送用户消息"'])expect(highlights(emphasize(quoted,["自动发送用户消息"]))).toEqual([]);
});

it("reduces long whole-sentence emphasis to 8–30 Chinese characters or at most 60 English characters",()=>{
 const long="必须保留所有原始消息以及个人笔记和此前完成的分析结果以便恢复完整上下文并继续阅读";
 const body=`## 规则\n\n**${long}**，必须保留所有原始消息。\n\n${filler}`;
 const selected=highlights(readingEmphasisMarkdown(body,{sectioned:true,phrases:[long]}));
 expect(selected).toEqual(["必须保留所有原始消息"]);
 expect(selected[0].length).toBeLessThan(long.length/2);
 expect(highlights(emphasize("保存消息。",["保存消息"]))).toEqual([]);
 const english="Preserve all original messages without overwriting drafts";
 expect(highlights(emphasize(english+".",[english]))).toEqual([english]);
 expect(highlights(emphasize("Must "+"preserve ".repeat(12)+"messages.",[]))).toEqual([]);
});

it("exports complete overview paragraphs with the same emphasis projection and keeps personal wording exact",()=>{
 const session=contextKnowledge().session,overview="这个工具帮助用户恢复过去的理解。通过连续阅读重新掌握上下文。";
 session.brief!.summary=overview;
 const content=projectOverviewContent(session),reading=projectOverviewReadingText(session,content);
 const file=projectDocument(session,{overview:true,wikiIds:[],matters:false,history:false,sources:false},"md");
 expect(content.text).toBe(overview);expect(file.text).toContain(reading);
 session.projectMaintenance={overview:"我的第一段。\n\n我的第二段。"};
 expect(projectOverviewReadingText(session)).toBe(session.projectMaintenance.overview);
});

it("removes bolded sentences, even around inline code, and never bolds half a parenthesis",()=>{
 const sentence="**AI建议在自然语言与 Hardware IR 之间引入名为`Requirement Spec`的中间层，避免直接转换。**";
 expect(emphasize(sentence)).not.toContain(sentence);
 expect(emphasize(sentence)).toContain("AI建议在自然语言与 Hardware IR 之间引入名为`Requirement Spec`的中间层");
 // A short label paragraph is structure and stays.
 expect(emphasize("**记忆层借鉴**")).toContain("**记忆层借鉴**");
 const claim="第三层为可构建性检查（是否缺少关键连接、库文件，以及能否生成代码）";
 const output=emphasize(`${claim}，这是核心约束。`,[claim]);
 expect(output).not.toMatch(/\*\*[^*]*（[^）*]*\*\*/u);
});

it("bolds one key clause per subtopic in a ledger chapter that has only level-3 headings", () => {
  const paragraph = "全文索引使用 Orama 在浏览器本地完成，首版只在本机运行。索引在导入后增量更新，删除对话时同步移除对应条目，搜索结果始终与本地数据一致。这部分设计保证离线可用，也让隐私数据始终留在本机，由用户自己掌握。";
  const body = `本章说明检索。\n\n### 全文索引\n\n${paragraph}\n\n${paragraph}`;
  const shown = readingEmphasisMarkdown(body, { sectioned: true, phrases: ["全文索引使用 Orama 在浏览器本地完成"] });
  expect(shown).toMatch(/\*\*[^*]+\*\*/u);
});

it("never bolds who said something, only what was said", () => {
  const paragraph = "据用户提供的材料，目标用户锁定为重度多平台用户和独立开发者，他们需要在多个 AI 客户端之间维持项目知识的连续性。这一判断来自多轮讨论，覆盖了日常使用、长期项目和跨工具协作等典型场景，也影响了首页的设计取舍。";
  const shown = readingEmphasisMarkdown(`### 目标用户\n\n${paragraph}\n\n${paragraph}`, { sectioned: true, phrases: ["据用户提供的材料，目标用户锁定为重度多平台用户和独立开发者"] });
  expect(shown).not.toContain("**据用户提供的材料**");
  expect(shown).toContain("**目标用户锁定为重度多平台用户和独立开发者**");
});

it("never bolds a purpose tail or a sentence commenting on the paragraph, and moves the cue to a conclusion",()=>{
 // The writer's own bold is re-chosen: the filler loses it and the paragraph's conclusion takes it.
 const body="系统坚持本地优先和自带密钥的产品方向，**以确保用户隐私安全**。**这一原则旨在避免数据孤岛**，确保各模块间事实的一致性。原始消息完整保存在本地数据库中。";
 expect(highlights(emphasize(body,["原始消息完整保存在本地数据库中"]))).toEqual(["原始消息完整保存在本地数据库中"]);
 expect(highlights(emphasize("这一方向确立了其作为跨 AI 的项目知识与上下文管理层的地位。",["这一方向确立了其作为跨 AI 的项目知识与上下文管理层的地位"]))).toEqual([]);
 expect(highlights(emphasize("这一决定明确了当前阶段的核心交付物，确保资源集中在高频场景上。本地持久化用于保存所有历史对话及消息。",["这一决定明确了当前阶段的核心交付物","用于保存所有历史对话及消息"]))).toEqual([]);
});

it("never starts or ends a highlight inside a command or path", () => {
  expect(emphasize("使用 npm run benchmark:providers 对同一需求在不同协议下运行，比较最终 Hardware IR 的关键语义等价性。", ["providers 对同一需求在不同协议下运行"])).not.toContain("benchmark:**");
});

it("never bolds an English clause of one or two words, a list item or a lone word",()=>{
 const text="Milestone 2 includes CSV export alongside remaining core features like category management and budget tracking. Bank syncing, receipt OCR, AI coaching, native mobile apps, and complex reports are excluded from the v1 beta scope. Privacy and currency constraints apply to all future architecture recommendations made for the project.";
 const body=readingEmphasisMarkdown(`## Scope\n\n${text}`,{sectioned:true,phrases:["Milestone 2, category, budget tracking","Bank syncing, receipt OCR, AI coaching","Privacy and currency, currency"]});
 expect(highlights(body).filter(phrase=>phrase.trim().split(/\s+/u).length<3)).toEqual([]);
});

it("leaves a list line opening on a bold label without a second bold",()=>{
 const list="- **Built**: Adding and editing transactions and the monthly spending chart are built by the team.\n- **Unfinished**: CSV export functionality does not work yet and needs fixing before the beta.\n- **Criticality**: Export and backup features are critical because browser storage can be cleared, leading to data loss.";
 const body=readingEmphasisMarkdown(`## Status\n\n${list}`,{sectioned:true,phrases:["CSV export functionality does not work yet","Export and backup features are critical"]});
 expect(highlights(body)).toEqual(["Built","Unfinished","Criticality"]);
});

it("keeps a label line with only a note in brackets after it bold, and a bolded sentence start still re-chosen", () => {
 expect(emphasize("**你写的**（第 42 条消息）")).toContain("**你写的**（第 42 条消息）");
 expect(emphasize("**你写的**（第 42 条消息）后面还有一整句话说明这段代码。")).not.toContain("**你写的**（第 42 条消息）后面");
});
