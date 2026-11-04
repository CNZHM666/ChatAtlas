import {expect,it} from "vitest";
import {projectDocument,type ProjectExportSelection} from "./project-document";
import {contextKnowledge} from "../test/context-fixture";

const selection:ProjectExportSelection={overview:false,wikiIds:["database"],matters:false,history:false,sources:false};

it("does not re-export an ignored fragment through a shared source message, while preserving retained proofs",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const foreign="另一个项目的 ProjectEvent 改进。",kept="数据库使用 IndexedDB。";
 source.excerpt=foreign+"\n\n"+kept;
 page.body=kept;page.claims=[{text:kept,quote:kept,evidenceIds:[source.id]}];
 session.wikiScopeReview={version:1,status:"complete",goal:session.goal,includeKeys:[],excludeKeys:["foreign"],ignoredKeys:["foreign"],materials:[{id:"side",key:"foreign",title:"其他项目",body:foreign,evidenceIds:[source.id],kind:"other",reason:"用户移除",quote:foreign,userExcluded:true}]};
 const before=structuredClone(session);
 for(const format of ["md","html","txt","json"] as const){
  const file=projectDocument(session,{...selection,sources:true},format).text;
  expect(file).not.toContain(foreign);expect(file).toContain(kept);
 }
 expect(session).toEqual(before);
});

it("exports unresolved scope contradictions instead of presenting a side chapter as confirmed project content",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.title="知识管理与参考";page.wikiQuestion="哪些内容属于项目之外的背景讨论？";page.wikiMaterialKeys=["one","two"];
 session.wikiScopeReview={version:1,status:"complete",goal:session.goal,includeKeys:[],materials:[]};
 expect(projectDocument(session,selection,"md").text).toContain("内容范围待确认：目录将「知识管理与参考」描述为项目外内容");
 expect(JSON.parse(projectDocument(session,selection,"json").text).context.scopeConflicts).toEqual([page.title]);
 session.wikiScopeReview.includeKeys=["one","two"];
 expect(projectDocument(session,selection,"md").text).not.toContain("内容范围待确认");
});

it("preserves late claim quotes, status, scope and provenance for an AI handoff without exposing unselected sources",()=>{
 const session=contextKnowledge().session,page=session.sections[0],quote="BYOK 密钥只在当前会话内存中，是否替换早期 sessionStorage 方案尚未决定。";
 page.claims=[{text:quote,quote,evidenceIds:["e-db"],workStatus:"proposed",subject:"凭据存储",scope:"用户 BYOK"}];
 const before=structuredClone(session),withSources=projectDocument(session,{...selection,sources:true},"md").text;
 expect(withSources).toContain(quote);expect(withSources).toContain("已保存的结论引文（仍需结合完整原文核对）");expect(withSources).toContain("建议（未确认采纳）");
 expect(withSources).toContain("已选 1/2 章");expect(withSources).toContain("非完整对话");expect(withSources).toContain("核对相关仓库与未决条件");expect(withSources).not.toContain("m-ui");
 const json=JSON.parse(projectDocument(session,{...selection,sources:true},"json").text);
 expect(json.context).toMatchObject({selectedChapters:1,totalChapters:2,sourceExcerptsIncluded:true,implementationVerifiedByExport:false});
 expect(json.sections[0].claims[0]).toMatchObject({quote,subject:"凭据存储",scope:"用户 BYOK",workStatus:"proposed",evidenceIds:["e-db"]});
 const withoutSources=projectDocument(session,selection,"json").text;
 // The conclusion may be listed by status; its source excerpt is not exported.
 expect(JSON.parse(withoutSources).sections[0].claims).toBeUndefined();expect(withoutSources).not.toContain(`「${quote}`);expect(withoutSources).not.toContain("> "+quote);expect(session).toEqual(before);
});
it("exports AI建议 in generated narration while preserving the literal source and a personal chapter",()=>{
 const session=contextKnowledge().session,page=session.sections[0];page.body="助手建议采用本地索引。";session.evidence[0].excerpt="助手建议采用本地索引。";
 const before=structuredClone(session),markdown=projectDocument(session,{...selection,sources:true},"md").text;
 expect(markdown).toContain("AI建议采用本地索引。");expect(markdown).toContain("> 助手建议采用本地索引。");expect(session).toEqual(before);
 page.userEdited=true;expect(projectDocument(session,selection,"md").text).toContain("助手建议采用本地索引。");
});
it("exports only chosen chapters in user order without personal notes or hidden source excerpts",()=>{
 const session=contextKnowledge().session,before=structuredClone(session);
 for(const format of ["md","txt","html","json"] as const){const file=projectDocument(session,selection,format);expect(file.text).toContain("数据库使用 IndexedDB");expect(file.text).not.toContain("const action");expect(file.text).not.toContain(session.notes);expect(file.text).not.toContain('"messageId": "m-ui"');expect(file.filename).toBe(`ChatAtlas.${format}`);}
 expect(session).toEqual(before);
 const result=JSON.parse(projectDocument(session,selection,"json").text);expect(result.sections).toHaveLength(1);expect(result.sources).toBeUndefined();
});
it("includes selected provenance only when requested and keeps genuine code headings intact",()=>{
 const session=contextKnowledge().session;session.sections[0].userEdited=true;session.sections[0].body="#### 子标题\n\n个人正文。\n\n```md\n# literal heading\n```";
 const markdown=projectDocument(session,{...selection,sources:true},"md").text;
 expect(markdown).toContain("### 子标题");expect(markdown).toContain("# literal heading");expect(markdown).toContain("m-db");expect(markdown).not.toContain("m-ui");expect(session.sections[0].body).toContain("#### 子标题");
 expect(markdown).toContain("**本章来源**：来源索引第 1 项");
 expect(projectDocument(session,selection,"md").text).not.toContain("**本章来源**");
});
it("creates a standalone printable HTML file with safe links, escaped raw HTML and no remote images",()=>{
 const session=contextKnowledge().session;session.title="<script>alert(1)</script>";session.sections[0].userEdited=true;
 session.sections[0].body='<script>danger()</script>\n\n[bad](javascript:alert%281%29) [good](https://example.com)\n\n![tracker](https://example.com/track)\n\n| 名称 | 内容 |\n|---|---|\n| A | **粗体** |';
 const file=projectDocument(session,selection,"html");expect(file.text).toContain('@media print');expect(file.text).toContain('href="#section-');expect(file.text).toContain('<table>');expect(file.text).toContain('<strong>粗体</strong>');expect(file.text).toContain('&lt;script&gt;');expect(file.text).not.toContain('<script>');expect(file.text).not.toContain('href="javascript:');expect(file.text).not.toContain('<img');expect(file.filename).not.toContain('/');
});
it("reports empty content instead of downloading a misleading empty file",()=>{
 expect(()=>projectDocument(contextKnowledge().session,{...selection,wikiIds:[]},"md")).toThrow("所选内容为空");
});

it("uses the same compact leaf layout for exports while keeping personal articles and saved sources intact",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="本章说明授权前提。\n\n## 授权\n\n### 用户 BYOK\n\n仅在用户配置后调用对应服务商，失败保留原始消息。";
 const before=structuredClone(session);
 expect(projectDocument(session,selection,"md").text).toContain("用户 BYOK");
 // The compact leaf keeps a bold label; a bare line would read as a stray heading.
 expect(projectDocument(session,selection,"md").text).toContain("**用户 BYOK**");
 expect(projectDocument(session,selection,"md").text).not.toContain("### 用户 BYOK");
 expect(projectDocument(session,selection,"html").text).toContain("<strong>用户 BYOK</strong>");
 expect(session).toEqual(before);
 page.userEdited=true;
 expect(projectDocument(session,selection,"md").text).toContain("#### 用户 BYOK");
});

it("exports the overview as a short description, a one-page summary of the chapters in reading order and the source scope",()=>{
 const session=contextKnowledge().session;
 session.projectMaintenance={overview:"ChatAtlas 帮助恢复过去的理解。第二句说明保持不变。"};
 for(const section of session.sections){section.wikiGroup="技术";section.wikiGroupEdited=true;}
 const markdown=projectDocument(session,{...selection,overview:true,wikiIds:["database","sidebar"]},"md").text;
 const overview=markdown.slice(markdown.indexOf("## 项目总览"),markdown.indexOf("\n---\n"));
 expect(overview).toContain("ChatAtlas 帮助恢复过去的理解。第二句说明保持不变。");
 // One group for every chapter is no grouping: the table stands alone.
 expect(overview).toMatch(/### 一页速览\n\n\| 章节 \| 结论 \|\n\|---\|---\|\n\| 数据库存储 \| [^\n]+ \|\n\| 侧边栏按钮与界面规范 \| /u);
 expect(overview).toContain("1 个来源对话 · 2 条引用原文");
});

it("keeps complete generated overview paragraphs consistent with the reading view",async()=>{
 const {projectOverviewContent}=await import("../shared/project-overview");
 const session=contextKnowledge().session,lead="ChatAtlas 恢复过去的理解，帮助用户复习已经聊过的内容。",rest="它把分散的对话整理成可以连续阅读的章节。";
 session.brief!.summary=lead+rest;
 const generated=projectOverviewContent(session).text;expect(generated).toBe(lead+rest);
 const page=session.sections.find(section=>section.id==="database")!;page.userEdited=true;page.body=`${generated}

其他正文。`;
 const markdown=projectDocument(session,{...selection,overview:true},"md").text;
 const overview=markdown.slice(markdown.indexOf("## 项目总览"),markdown.indexOf("### 一页速览"));
 expect(overview).toContain(lead+rest);
 expect(markdown.split(rest)).toHaveLength(3);
});

it("leaves an export with nothing selected empty instead of emitting a scope-only overview",()=>{
 const session=contextKnowledge().session;session.projectMaintenance={overview:""};
 expect(()=>projectDocument(session,{...selection,overview:true,wikiIds:[]},"md")).toThrow("所选内容为空");
});

it("hides reading groups under eight chapters and omits questions identical to titles",()=>{
 const session=contextKnowledge().session;
 session.sections.forEach(section=>{section.wikiGroup=section.title;section.wikiGroupEdited=true;section.wikiQuestion=section.title;});
 const before=structuredClone(session);
 const markdown=projectDocument(session,{...selection,overview:true,wikiIds:session.sections.map(page=>page.id)},"md").text;
 const order=markdown.split("### 一页速览")[1].split("### 来源范围")[0];
 expect(order).not.toContain("####");expect(order).not.toContain("**");expect(order).not.toContain(" — ");expect(session).toEqual(before);
});
it("merges singleton groups, suppresses consecutive repeated names and keeps the chapters in reading order",()=>{
 const session=contextKnowledge().session,base=session.sections[0];
 session.sections=["甲组","甲组","单章组","甲组","甲组","乙组","乙组","尾章组"].map((wikiGroup,i)=>({...base,id:`p${i}`,title:`章节${i}`,wikiGroup,wikiGroupEdited:true,wikiQuestion:i===1?`章节${i}`:`如何阅读主题${i}？`}));
 const before=structuredClone(session);
 const markdown=projectDocument(session,{...selection,overview:true,wikiIds:session.sections.map(page=>page.id)},"md").text;
 const order=markdown.split("### 一页速览")[1].split("### 来源范围")[0];
 expect(order.match(/#### 甲组/gu)).toHaveLength(1);expect(order.match(/#### 乙组/gu)).toHaveLength(1);expect(order).not.toContain("单章组");expect(order).not.toContain("尾章组");expect(order).not.toContain("**");
 const rows=order.match(/^\| 章节\d \|/gmu)??[];
 expect(rows).toHaveLength(8);expect(rows[0]).toBe("| 章节0 |");expect(rows.at(-1)).toBe("| 章节7 |");expect(session).toEqual(before);
});

it("T24: states the document type from saved checks and puts key conclusions beside their deciding sources",async()=>{
 const {projectSession}=await import("../test/project-fixture");
 const {sourceMessageSignature}=await import("../shared/source-signature");
 const {groundWikiClaims}=await import("../shared/wiki-claims");
 const session=projectSession();session.projectState=undefined;
 const texts=[{text:"我建议采用 Orama 作为搜索引擎。",role:"assistant" as const},{text:"我决定使用 IndexedDB 保存消息。",role:"user" as const}];
 const originals=texts.map(({text,role},index)=>({id:`m${index}`,conversationId:"source",messageIndex:index,role,content:text,preview:"",contentHash:"",createdAt:0,sourceCreatedAt:Date.UTC(2026,8,index+1),updatedAt:0}));
 session.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 session.sourceConversationIds=["source"];session.sourceRoles={source:{m0:"assistant",m1:"user"}};session.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};session.sourceMessageOrder={source:["m0","m1"]};
 session.sections=groundWikiClaims([{id:"store",title:"存储与搜索",body:"消息保存在 IndexedDB 中。\n\n用户已确认采用 Orama 作为搜索引擎。",kind:"finding",transition:"",evidenceIds:["e0","e1"],claims:[{text:"消息保存在 IndexedDB 中。",quote:texts[1].text,evidenceIds:["e1"],overviewRole:"decision"},{text:"用户已确认采用 Orama 作为搜索引擎。",quote:texts[0].text,evidenceIds:["e0"],workStatus:"proposed",overviewRole:"decision"}]}],session.evidence,originals,true);
 const file=projectDocument(session,{overview:false,wikiIds:["store"],matters:false,history:false,sources:true},"md").text;
 expect(file).toContain("> 文档类型：历史讨论整理稿");
 expect(file).toContain("原始讨论时间");
 // The first line says when the discussions took place, so "当前" in the text reads as of then.
 expect(file.split("\n")[0]).toMatch(/^> 整理稿 · 讨论于 \d+\/\d+(?:–\d+\/\d+)? · \d+ 个来源对话 · 实现未核验$/u);
 expect(file).toContain("> 实现核对：未进行。");
 expect(file).toContain("**关键结论与来源**");
 // Each label heads its group once; the conclusions under it are plain items.
 expect(file).toMatch(/\*所选讨论中的决定 · 实现未核验\*\n\n- 消息保存在 IndexedDB 中。〔来源 \d〕/u);
 expect(file).toMatch(/\*AI 建议 · 所选来源中未发现用户确认\*\n\n- 采用 Orama 作为搜索引擎。〔来源 \d〕/u);
 expect(file).not.toMatch(/[]/u);
 const json=JSON.parse(projectDocument(session,{overview:false,wikiIds:["store"],matters:false,history:false,sources:false},"json").text);
 expect(json.context.document).toMatchObject({status:"history_digest",implementation:"not_checked",claims:{confirmed:1,proposals:1}});
 expect(projectDocument(session,{overview:false,wikiIds:["store"],matters:false,history:false,sources:false},"md").text).not.toContain("〔来源");
});

it("keeps the reading entrance brief, retains scope warnings and moves detailed notes below the chapters",async()=>{
 const {projectSession}=await import("../test/project-fixture");
 const {sourceMessageSignature}=await import("../shared/source-signature");
 const {groundWikiClaims}=await import("../shared/wiki-claims");
 const session=projectSession();session.projectState=undefined;
 const texts=Array.from({length:10},(_,index)=>`我建议方案 ${index} 采用本地索引第 ${index} 种组织方式。`);
 const originals=texts.map((content,index)=>({id:`m${index}`,conversationId:"source",messageIndex:index,role:"assistant" as const,content,preview:"",contentHash:"",createdAt:0,updatedAt:0}));
 session.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 session.sourceConversationIds=["source"];session.sourceRoles={source:Object.fromEntries(originals.map(message=>[message.id,"assistant"]))};session.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};session.sourceMessageOrder={source:originals.map(message=>message.id)};
 const claims=texts.map((quote,index)=>({text:`方案 ${index} 采用本地索引。`,quote,evidenceIds:[`e${index}`]}));
 session.sections=groundWikiClaims([{id:"index",title:"索引",body:`方案 9 采用本地索引。\n\n## 细节\n\n${claims.slice(0,9).map(claim=>claim.text).join("\n\n")}`,kind:"finding",transition:"",evidenceIds:session.evidence.map(ref=>ref.id),claims}],session.evidence,originals,true);
 const file=projectDocument(session,{overview:false,wikiIds:["index"],matters:false,history:false,sources:true},"md").text;
 const opening=file.split("\n\n## ")[0];
 expect(opening.split("\n").length).toBeLessThanOrEqual(2);expect(opening).toContain("实现未核验");
 expect(opening).not.toContain("句末标记说明");
 const notes=file.split("## 文档信息与核对说明")[1];expect(notes).toContain("文档类型");expect(notes).toContain("实现核对：未进行");
 expect(file).toContain("**本章来源**：共 10 条，见来源索引；关键结论旁已标出对应来源");
 const block=file.slice(file.indexOf("**关键结论与来源**"),file.indexOf("**本章来源**")),keys=block.split("\n").filter(line=>line.startsWith("- "));
 // Only the suggestion the chapter opens with is listed, under one label: the list is not filled up to a count.
 expect(keys).toHaveLength(1);
 expect(keys[0]).toContain("方案 9 采用本地索引。");
 expect(block.split("AI 建议 · 所选来源中未发现用户确认")).toHaveLength(2);
});
it("lists no clause cut from a longer sentence or opening without its subject as a key conclusion",async()=>{
 const {projectSession}=await import("../test/project-fixture");
 const {sourceMessageSignature}=await import("../shared/source-signature");
 const {groundWikiClaims}=await import("../shared/wiki-claims");
 const session=projectSession();session.projectState=undefined;
 const texts=["我建议本地持久化采用 IndexedDB 配合 Dexie.js，用于保存所有历史对话及消息。","我建议搜索结果按消息聚合到所属对话展示。","我建议测试历史知识定位成功率达到 80% 以上。"];
 const originals=texts.map((content,index)=>({id:`m${index}`,conversationId:"source",messageIndex:index,role:"assistant" as const,content,preview:"",contentHash:"",createdAt:0,updatedAt:0}));
 session.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 session.sourceConversationIds=["source"];session.sourceRoles={source:Object.fromEntries(originals.map(message=>[message.id,"assistant"]))};session.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};session.sourceMessageOrder={source:originals.map(message=>message.id)};
 const body="本地持久化采用 IndexedDB 配合 Dexie.js，**用于保存所有历史对话及消息**。搜索结果按消息聚合到所属对话展示。下一阶段要求历史知识定位成功率≥80%，并减少人工准备时间。";
 const claims=[{text:"用于保存所有历史对话及消息",quote:texts[0],evidenceIds:["e0"],overviewRole:"decision" as const},{text:"搜索结果按消息聚合到所属对话展示。",quote:texts[1],evidenceIds:["e1"],overviewRole:"decision" as const},{text:"历史知识定位成功率≥80%",quote:texts[2],evidenceIds:["e2"],overviewRole:"decision" as const}];
 session.sections=groundWikiClaims([{id:"store",title:"存储",body,kind:"finding",transition:"",evidenceIds:["e0","e1","e2"],claims}],session.evidence,originals,true);
 const file=projectDocument(session,{overview:false,wikiIds:["store"],matters:false,history:false,sources:true},"md").text;
 // Without sources the block is left out: it only repeated sentences of the text.
 expect(projectDocument(session,{overview:false,wikiIds:["store"],matters:false,history:false,sources:false},"md").text).not.toContain("**关键结论与来源**");
 const block=file.slice(file.indexOf("**关键结论与来源**"),file.indexOf("**本章来源**")),keys=block.split("\n").filter(line=>line.startsWith("- "));
 expect(keys.map(line=>line.replace(/〔[^〕]*〕/gu,""))).toEqual(["- 搜索结果按消息聚合到所属对话展示。"]);
});
it("adds no scope-review warning to a document written from the knowledge-unit ledger",async()=>{
 const {projectSession}=await import("../test/project-fixture");
 const session=projectSession();session.wikiScopeReview=undefined;
 const id=session.sections[0].id,choice={overview:false,wikiIds:[id],matters:false,history:false,sources:false};
 expect(projectDocument(session,choice,"md").text).toContain("内容范围核对未完成");
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[]};
 const file=projectDocument(session,choice,"md").text;
 expect(file).not.toContain("内容范围核对未完成");
 expect(JSON.parse(projectDocument(session,choice,"json").text).context.scopeReview).toBe("not_applicable");
});

it("marks who holds each run of text after its last sentence, with a legend at the top, as the Wiki does",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 page.body="数据库使用 IndexedDB。首页只保留搜索入口。";
 page.claims=[{text:"数据库使用 IndexedDB。",quote:"数据库使用 IndexedDB。",evidenceIds:[source.id],holder:"ai",holderMark:true},{text:"首页只保留搜索入口。",quote:"首页只保留搜索入口。",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 // Off when unticked in the export dialog (it starts ticked there).
 expect(projectDocument(session,{...selection,holderMarks:false},"md").text).toContain("〔已定〕");
 const file=projectDocument(session,{...selection,holderMarks:true},"md").text;
 // The assistant's text carries no mark; a decision does, and the legend says what no mark means.
 expect(file).not.toContain("〔建议／分析〕");expect(file).toContain("〔已定〕");
 expect(file).toContain("首页只保留搜索入口。〔已定〕");
 expect(file).toContain("> 句末标记说明：〔已定〕你确认的决定");expect(file).toContain("没有标记的是 AI 的建议或分析");
 page.claims=page.claims.map(claim=>({...claim,holder:undefined,holderMark:undefined}));
 expect(projectDocument(session,{...selection,holderMarks:true},"md").text).not.toContain("句末标记说明");
});

it("sums each chapter up in the overview: its first sentence, how many points are decided and open, and those points",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.body="**数据库使用 IndexedDB。** 首页只保留搜索入口。导出格式待定。";
 page.claims=[{text:"首页只保留搜索入口。",quote:"首页只保留搜索入口。",evidenceIds:[source.id],holder:"decided",holderMark:true},{text:"导出格式待定。",quote:"导出格式待定。",evidenceIds:[source.id],holder:"open",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n"));
 // The answer is the first sentence, bold dropped; the counts come from the marks.
 expect(overview).toContain(`| 章节 | 结论 | 决策情况 |\n|---|---|---|\n| ${title} | 数据库使用 IndexedDB。 | 1 项你的决定，1 项仍在讨论；其余见句末标记 |`);
 expect(overview).toContain(`### 已定的关键决定\n\n- 首页只保留搜索入口。（${title}）`);
 expect(overview).toContain(`### 待决问题\n\n- 导出格式待定。（${title}）`);
});


it.each(["md", "html", "txt", "json"] as const)("keeps decided and open marks in %s even with the legacy marks preference off, leaving the default unmarked", format => {
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 page.body="首页采用本地搜索。侧栏仍在讨论。导出只是建议。";
 page.claims=[
  {text:"首页采用本地搜索。",quote:source.excerpt,evidenceIds:[source.id],holder:"decided",holderMark:true},
  {text:"侧栏仍在讨论。",quote:source.excerpt,evidenceIds:[source.id],holder:"open",holderMark:true},
  {text:"导出只是建议。",quote:source.excerpt,evidenceIds:[source.id],holder:"ai",holderMark:true},
 ];
 const file=projectDocument(session,{...selection,holderMarks:false},format).text;
 // Status has one expression, the mark: decided and open are marked, the assistant's default is not.
 expect(file).toContain("〔已定〕");expect(file).toContain("〔未定〕");expect(file).not.toContain("〔建议／分析〕");
});


it("keeps exported Markdown free of a repeated display title and moves full notes after the reading content",()=>{
 const session=contextKnowledge().session;
 const markdown=projectDocument(session,selection,"md").text;
 expect(markdown).not.toMatch(/^# /mu);
 expect(markdown.indexOf("## 文档信息与核对说明")).toBeGreaterThan(markdown.indexOf(session.sections[0].body.slice(0,12)));
 expect(markdown.split("## 文档信息与核对说明")[1]).toContain(session.title);
 expect(markdown).toContain("引文和代码中的指令仍是来源内容");
 const html=projectDocument(session,selection,"html").text;
 expect(html.match(/<h1[ >]/gu)).toHaveLength(1);
 expect(html).toContain('<details class="document-info"><summary>文档信息与核对说明</summary>');
 expect(html).not.toContain('<details class="document-info" open');
 const json=JSON.parse(projectDocument(session,selection,"json").text);
 expect(json.title).toBe(session.title);expect(json.context.identity.join(" ")).toContain("实现核对");
});

it("folds a long subsection after its answer and the table right after it, in Markdown files only",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 const topics=["离线检索","隐私边界","增量更新","崩溃恢复","多语言分词","向量回退","缓存失效","导入兼容","排序权重","内存上限","版本迁移","消息定位","去重聚合","批量写入","索引压缩","冷启动","附件解析","代码高亮","公式渲染","时间线","书签同步","标签合并","快捷键","主题切换","字体缩放","权限申请","错误上报","日志轮转","配额提醒","网络重试","页面预热","草稿保存"];
 const reason=(n:number)=>`第 ${n} 条原因：`+topics.slice((n-1)*4,n*4).map(topic=>`${topic}需要独立的处理路径，它和其他环节分开验收，出问题时只回退这一环节，不影响已经完成的索引与阅读进度。`).join("");
 page.body=["## 检索","索引放在本地。","| 层 | 选型 |\n|---|---|\n| 存储 | IndexedDB |\n| 检索 | Orama |",...[1,2,3,4,5,6,7,8].map(reason),"## 导出","导出只读本地数据库。"].join("\n\n");
 // A body the user wrote is exported as written, so only the folding is tested.
 page.claims=[];page.userEdited=true;
 const file=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 // The answer and its table stay in view; only the tail of reasons folds, in order, at most half the subsection;
 // a short section does not fold.
 expect(file).toMatch(/### 检索\n\n索引放在本地。\n\n\| 层 \| 选型 \|[\s\S]*?\| 检索 \| Orama \|\n\n第 1 条[\s\S]*?\n\n<details>\n<summary>展开细节<\/summary>\n\n第 \d 条[\s\S]*第 8 条[\s\S]*?\n\n<\/details>\n\n### 导出\n\n导出只读本地数据库。/u);
 expect(file.match(/<details>/gu)).toHaveLength(1);
 const section=file.slice(file.indexOf("### 检索"),file.indexOf("### 导出")),folded=section.slice(section.indexOf("<details>"));
 expect(folded.length).toBeLessThanOrEqual(section.length/2+80);
 // A rule late in the subsection keeps everything up to it in view.
 page.body=page.body.replace("第 7 条原因：","第 7 条原因：导出必须只读本地数据库。");
 const ruled=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 // What is left after it is too short to fold.
 expect(ruled).toContain("导出必须只读本地数据库。");expect(ruled).not.toContain("<details>");
 // Other formats show everything.
 expect(projectDocument(session,{...selection,wikiIds:[page.id]},"txt").text).not.toContain("<details>");
});

it("answers in the overview only with the chapter's opening, and lists only whole sentences as decided or open",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.wikiQuestion="数据库怎么选？";
 // No opening, and the first subsection starts on a table: the overview says what the chapter covers, never its
 // question and never a sentence from further in.
 page.body="## 选型\n\n| 方案 | 状态 |\n|---|---|\n| SQLite | Open（替代方案） |\n\n部分方案处于早期阶段。\n\n## 迁移\n\n迁移按版本进行。";
 page.claims=[{text:"Open（替代方案）",quote:"Open（替代方案）",evidenceIds:[source.id],holder:"open",holderMark:true}];
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain(`| ${title} | 本章讨论选型、迁移。 | 未见你的确认，见句末标记 |`);expect(overview).not.toContain("数据库怎么选？");expect(overview).not.toContain("部分方案处于早期阶段");
 // A table cell is no open question: none is listed, and the chapter reads as all suggestions, not "—".
 expect(overview).not.toContain("### 待决问题");
 // A first subsection that starts on prose answers with its own first sentence.
 page.body="## 选型\n\n数据库选用 SQLite。其余待定。\n\n## 迁移\n\n迁移按版本进行。";
 expect(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text).toContain(`| ${title} | 数据库选用 SQLite。 |`);
 // One that starts on a labelled list answers with its first item, not "本章讨论……".
 page.body="## 首页\n\n- **首屏形态**：首屏是类似 ChatGPT 的欢迎页，引导输入需求。\n- **布局**：中间大输入框。\n\n## 布局\n\n三栏式。";
 expect(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text).toContain(`| ${title} | 首屏是类似 ChatGPT 的欢迎页，引导输入需求。 |`);
});

it("lists no decision that is only the end of a longer one listed",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 page.body="首屏为欢迎页，随后进入对话层，再进入 Canvas，最后进行仿真。\n\n1. **仿真验证**：最后进行仿真。";
 page.claims=[{text:"首屏为欢迎页，随后进入对话层，再进入 Canvas，最后进行仿真。",quote:"首屏",evidenceIds:[source.id],holder:"decided",holderMark:true},{text:"最后进行仿真。",quote:"仿真",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain("- 首屏为欢迎页，随后进入对话层，再进入 Canvas，最后进行仿真。");
 expect(overview).not.toContain("- 最后进行仿真。");
});

it("lists no decided clause whose subject is in the sentence before it",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 page.body="系统采用 BYOK 模式，由用户提供 API Key。默认仅保存在当前浏览器会话中，不保存到服务器，避免消耗平台额度。";
 page.claims=[{text:"默认仅保存在当前浏览器会话中，不保存到服务器",quote:"会话",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).not.toContain("- 默认仅保存在当前浏览器会话中");
});

it("answers a chapter of tables with its first table's subjects, and lists a decision said twice once",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.body="## 直接竞品对比\n\n| 产品 | 能力 |\n|---|---|\n| Memex | 搜索 |\n| ChatsRecall | 同步 |\n| **Echoes** | 聚合 |\n| Reweave | 知识条目 |\n\n## 原生平台\n\n各平台导出格式不同。";
 page.claims=[
  {text:"侧边栏搜索摘要、Reader 原始消息展示及精准定位被确认为 P0 优先级功能。",quote:"P0",evidenceIds:[source.id],holder:"decided",holderMark:true},
  {text:"保留消息级搜索、侧边栏快速上下文、项目Dashboard/Wiki及原文定位为P0或核心。",quote:"P0",evidenceIds:[source.id],holder:"decided",holderMark:true},
  {text:"第一版采用用户主动点击触发查找。",quote:"点击",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 page.body+=`\n\n${page.claims.map(claim=>claim.text).join("")}`;
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain(`| ${title} | 直接竞品对比：Memex、ChatsRecall、Echoes 等 4 项。 |`);
 expect(overview).toContain("侧边栏搜索摘要、Reader 原始消息展示及精准定位被确认为 P0 优先级功能。");
 expect(overview).not.toContain("保留消息级搜索");
 expect(overview).toContain("第一版采用用户主动点击触发查找。");
});

it("lists the decided first clause of a sentence whose rest was never confirmed",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.body="采用浅色极简新手首页设计基准，并认可推开式分屏作为默认交互模式。";
 page.claims=[{text:"采用浅色极简新手首页设计基准",quote:"浅色",evidenceIds:[source.id],holder:"decided",holderMark:true},{text:"并认可推开式分屏作为默认交互模式。",quote:"分屏",evidenceIds:[source.id],holder:"ai",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(file).toContain(`### 已定的关键决定\n\n- 采用浅色极简新手首页设计基准。（${title}）`);
 expect(file).toContain("采用浅色极简新手首页设计基准〔已定〕，并认可推开式分屏作为默认交互模式。");
});

it("says under the header what the automatic checks left, with the counts in the notes, and nothing when they passed",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="首页只保留搜索入口。";
 const draft={version:1,generatedAt:1,status:"complete",chapters:[],report:{},quality:{sources:"complete",failedBatches:0,uncovered:83,organization:"partial",critical:2,problems:32,passed:false}};
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],draft} as unknown as typeof session.wikiKnowledge;
 const file=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 const head=file.slice(0,file.indexOf("\n\n"));
 expect(head).toContain("> 本次整理仍有关键检查未通过，部分用户消息未提取知识点，整理不完整；决定与范围请结合来源核对。");
 expect(head).not.toContain("83");
 expect(file).toContain("自动检查：质量检查未通过 · 整理完整性部分完成 · 关键检查未通过 2 项 · 全部检查提示 32 项 · 未抽出知识点的用户消息 83 条。");
 draft.quality={sources:"complete",failedBatches:0,uncovered:0,organization:"complete",critical:0,problems:0,passed:true};
 const clean=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 expect(clean).not.toContain("本次整理");expect(clean).not.toContain("自动检查");
});

it("lists a first-version scope stated both ways among the open questions",()=>{
 const session=contextKnowledge().session,page=session.sections[0],title=page.wikiDisplayTitle||page.title;
 page.body="| 事项 | 第一版 |\n| --- | --- |\n| Wiki/知识图谱 | 暂缓 |\n\n> 范围有分歧：「Wiki/知识图谱」写为暂缓，下文又写「Wiki 为核心」。第一版是否包含，需要你确认。\n\nWiki 为核心。";
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(file).toContain(`### 待决问题\n\n- 范围有分歧：「Wiki/知识图谱」写为暂缓，下文又写「Wiki 为核心」。第一版是否包含，需要你确认。（${title}）`);
 expect(file).toContain("> 范围有分歧：「Wiki/知识图谱」写为暂缓");
});

it("shows the current baseline from the draft: doing now, not now and done when, each with its mark",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="检索在本地完成。";
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],draft:{version:1,generatedAt:1,status:"complete",chapters:[],report:{},baseline:[
  {part:"now",text:"下一阶段开发 Inventory 模块。",unitIds:["u1"]},
  {part:"notNow",text:"V0.1 暂不做实时比价。",unitIds:["u2"],holder:"decided"},
  {part:"done",text:"lint、typecheck、test、build 必须全部通过。",unitIds:["u3"],holder:"user"}]}} as unknown as typeof session.wikiKnowledge;
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain("### 当前基线\n\n**现在做**\n\n- 下一阶段开发 Inventory 模块。\n\n**暂不做**\n\n- V0.1 暂不做实时比价。〔已定〕\n\n**完成标准**\n\n- lint、typecheck、test、build 必须全部通过。〔你〕");
});

it("reports failed planned chapters separately from the available export selection",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 session.sections=[page];
 const done={id:page.id,title:page.title,question:"",group:"",body:page.body,paragraphs:[{subtopic:"正文",text:page.body,unitIds:[]}],problems:[]};
 const missing={...done,id:"failed-plan",title:"开发计划与发布状态",body:"",paragraphs:[],problems:["part 1 could not be written"]};
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],draft:{version:1,generatedAt:1,status:"partial",chapters:[done,missing],report:{},quality:{sources:"complete",failedBatches:0,organization:"complete",critical:1,problems:1,passed:false}}};
 const chosen={...selection,wikiIds:[page.id]};
 const file=projectDocument(session,chosen,"md").text;
 expect(file).toContain("已选 1/2 章");
 expect(file).toContain("缺少「开发计划与发布状态」");
 expect(file).toContain("整理完整性部分完成");
 expect(JSON.parse(projectDocument(session,chosen,"json").text).context.missingChapters).toEqual(["开发计划与发布状态"]);
});

it("lists every decided sentence of a run among the key decisions, not only the one carrying the mark",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 page.body="第一阶段允许使用 Mock AI 准备三个演示项目。若成本合理，再加入命令面板作为后续增强。";
 page.claims=[{text:"第一阶段允许使用 Mock AI 准备三个演示项目。",quote:"Mock AI",evidenceIds:[source.id],holder:"decided"},{text:"若成本合理，再加入命令面板作为后续增强。",quote:"命令面板",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,holderMarks:true},"md").text;
 expect(file).toContain("命令面板作为后续增强。〔已定〕");
 expect(file).toMatch(/已定的关键决定[\s\S]*第一阶段允许使用 Mock AI 准备三个演示项目。/u);
});
