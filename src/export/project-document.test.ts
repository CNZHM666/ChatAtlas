import {expect,it} from "vitest";
import {numberedLearningChapter,projectDocument,type ProjectExportSelection} from "./project-document";
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
 expect(file).toContain("| 文档类型 | 历史讨论整理稿");
 expect(file).toMatch(/\| 来源 \| .* · 讨论于 /u);
 // The first line says when the discussions took place, so "当前" in the text reads as of then.
 expect(file.split("\n")[0]).toBe("文档状态：整理稿 · 实现未核验  ");expect(file.split("\n")[1]).toMatch(/^来源：\d+ 个来源对话 · 讨论于 \d+\/\d+(?:–\d+\/\d+)?$/u);
 expect(file).toContain("| 实现核对 | 未进行");
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
 expect(opening.split("\n").length).toBeLessThanOrEqual(5);expect(opening).toContain("实现未核验");
 expect(opening).not.toContain("### 句末标记");
 const notes=file.split("## 文档信息与核对说明")[1];expect(notes).toContain("文档类型");expect(notes).toContain("| 实现核对 | 未进行");
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
 expect(file).toContain("### 句末标记\n\n- 〔已定〕你确认的决定");expect(file).toContain("- 没有标记：AI 的建议或分析");
 page.claims=page.claims.map(claim=>({...claim,holder:undefined,holderMark:undefined}));
 expect(projectDocument(session,{...selection,holderMarks:true},"md").text).not.toContain("### 句末标记");
});

it("names each of several conversations by its AI: in the source scope, after each chapter, in marks and in the key decisions",()=>{
 const session=contextKnowledge().session,page=session.sections[0],noon=(day:number)=>Date.UTC(2026,8,day,12);
 session.sourceConversationIds=["c","c2"];
 session.evidence[1]={...session.evidence[1],conversationId:"c2"};
 const unit=(id:string,conversationId:string,statement:string)=>({id,subject:"",statement,kind:"decision" as const,details:[],evidence:{evidenceId:id,conversationId,messageId:id,messageIndex:0,role:"user" as const,pasted:false,quote:statement},adoption:{status:"user_decision" as const},delivery:"unknown" as const});
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[{sourceIds:[],status:"ok",units:[unit("u-db","c","数据库使用 IndexedDB。"),unit("u-ui","c2","首页只保留搜索入口。")],rejected:{}}],
  sources:{c:{platform:"chatgpt",title:"硬件方向",start:noon(1),end:noon(3)},c2:{platform:"claude",title:"界面细化",start:noon(5),end:noon(9)}}};
 page.body="数据库使用 IndexedDB。首页只保留搜索入口。";page.evidenceIds=["e-db","e-ui"];
 page.claims=[{text:"数据库使用 IndexedDB。",quote:"数据库使用 IndexedDB。",evidenceIds:["e-db"],unitIds:["u-db"],holder:"ai",holderMark:true},{text:"首页只保留搜索入口。",quote:"首页只保留搜索入口。",evidenceIds:["e-ui"],unitIds:["u-ui"],holder:"decided",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,holderMarks:true},"md").text;
 expect(file).toContain("首页只保留搜索入口。〔已定 · Claude〕");
 expect(file).toContain("**本章来源对话**：ChatGPT、Claude");
 expect(file).toContain("- ChatGPT · 《硬件方向》 · 9/1–9/3 · 引用 1 条");
 expect(file).toContain("- Claude · 《界面细化》 · 9/5–9/9 · 引用 1 条");
 expect(file).toMatch(/\| [^|\n]+ · Claude \| 首页只保留搜索入口。 \|/u);
 // One conversation: nothing to tell apart, nothing named.
 session.sourceConversationIds=["c"];
 const single=projectDocument(session,{...selection,overview:true,holderMarks:true},"md").text;
 expect(single).toContain("首页只保留搜索入口。〔已定〕");expect(single).not.toContain("本章来源对话");expect(single).not.toContain("〔已定 · ChatGPT〕");
});

it("sums each chapter up in the overview: its first sentence, how many points are decided and open, and those points",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.body="**数据库使用 IndexedDB。** 首页只保留搜索入口。导出格式待定。";
 page.claims=[{text:"首页只保留搜索入口。",quote:"首页只保留搜索入口。",evidenceIds:[source.id],holder:"decided",holderMark:true},{text:"导出格式待定。",quote:"导出格式待定。",evidenceIds:[source.id],holder:"open",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n"));
 // The answer is the first sentence, bold dropped; the counts come from the marks.
 expect(overview).toContain(`| 章节 | 结论 | 决策情况 |\n|---|---|---|\n| ${title} | 数据库使用 IndexedDB。 | 1 项你的决定，1 项仍在讨论；其余见句末标记 |`);
 expect(overview).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(overview).toContain(` | 首页只保留搜索入口。 |`);
 expect(overview).toContain(`### 待决问题\n\n| 领域 | 问题 |\n|---|---|\n| ${title}`);expect(overview).toContain(` | 导出格式待定。 |`);
});

it("names the subtopic a key decision sits under, sets its figures in bold and says first how to read the marks",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 page.body="数据库使用 IndexedDB。\n\n### 顶栏\n\n顶栏高度固定为 48px。";
 page.claims=[{text:"顶栏高度固定为 48px。",quote:"顶栏高度固定为 48px。",evidenceIds:[source.id],holder:"decided",holderMark:true}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(file).toContain(`| ${title} › 顶栏 | 顶栏高度固定为 **48px**。 |`);
 expect(file.slice(0,file.indexOf("\n## "))).toContain("> 阅读方式：标〔已定〕的是你确认的决定");
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

it("shows a long subsection in full, with no HTML folding a Markdown viewer would print as tags",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 const reason=(n:number)=>`第 ${n} 条原因：`+"这一环节需要独立的处理路径，它和其他环节分开验收，出问题时只回退这一环节。".repeat(6);
 page.body=["## 检索","索引放在本地。",...[1,2,3,4,5,6,7,8].map(reason),"## 导出","导出只读本地数据库。"].join("\n\n");
 page.claims=[];page.userEdited=true;
 const file=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 expect(file).toMatch(/### 检索\n\n索引放在本地。\n\n第 1 条[\s\S]*第 8 条[\s\S]*?\n\n### 导出/u);
 expect(file).not.toMatch(/<\/?(?:details|summary)>/u);
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
 expect(overview).toContain("| 首屏为欢迎页，随后进入对话层，再进入 Canvas，最后进行仿真。 |");
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
 expect(file).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(file).toContain(` | 采用浅色极简新手首页设计基准。 |`);
 expect(file).toContain("采用浅色极简新手首页设计基准〔已定〕，并认可推开式分屏作为默认交互模式。");
});

it("says under the header what the automatic checks left, with the counts in the notes, and nothing when they passed",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="首页只保留搜索入口。";
 const draft={version:1,generatedAt:1,status:"complete",chapters:[],report:{},quality:{sources:"complete",failedBatches:0,uncovered:83,organization:"partial",critical:2,problems:32,passed:false}};
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],draft} as unknown as typeof session.wikiKnowledge;
 const file=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 const head=file.slice(0,file.indexOf("\n## "));
 expect(head).toContain("> 本次仍有关键检查未通过，部分用户消息未提取知识点，整理未全部完成；决定与范围请结合来源核对。");
 expect(head).not.toContain("83");
 expect(file).toContain("| 自动检查 | 质量检查未通过 · 整理完整性部分完成 · 关键检查未通过 2 项 · 提示 32 项 · 未抽出知识点的消息 83 条 |");
 draft.quality={sources:"complete",failedBatches:0,uncovered:0,organization:"complete",critical:0,problems:0,passed:true};
 const clean=projectDocument(session,{...selection,wikiIds:[page.id]},"md").text;
 expect(clean).not.toContain("本次仍有");expect(clean).not.toContain("自动检查");
});

it("lists a first-version scope stated both ways among the open questions",()=>{
 const session=contextKnowledge().session,page=session.sections[0],title=page.wikiDisplayTitle||page.title;
 page.body="| 事项 | 第一版 |\n| --- | --- |\n| Wiki/知识图谱 | 暂缓 |\n\n> 范围有分歧：「Wiki/知识图谱」写为暂缓，下文又写「Wiki 为核心」。第一版是否包含，需要你确认。\n\nWiki 为核心。";
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(file).toContain(`### 待决问题\n\n| 领域 | 问题 |\n|---|---|\n| ${title}`);expect(file).toContain(` | 范围有分歧：「Wiki/知识图谱」写为暂缓，下文又写「Wiki 为核心」。第一版是否包含，需要你确认。 |`);
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
 expect(overview).toContain("### 当前基线\n\n**当前阶段**\n\n- 下一阶段开发 Inventory 模块。\n\n**暂不做**\n\n- V0.1 暂不做实时比价。〔已定〕\n\n**完成标准**\n\n- lint、typecheck、test、build 必须全部通过。〔你〕");
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

it("counts and lists a decision told as steps once, each step with its own label",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 const steps=[["首屏","采用ChatGPT式简洁欢迎页。"],["对话层","用户输入需求后进入此层确定清单。"],["仿真","最后进行仿真操作。"]];
 page.body=`**数据库使用 IndexedDB。**\n\n${steps.map(([label,text],index)=>`${index+1}. **${label}**：${text}`).join("\n")}`;
 page.claims=steps.map(([,text],index)=>({text,quote:text,evidenceIds:[source.id],holder:"decided" as const,holderMark:index===steps.length-1,unitIds:["u-flow"]}));
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n"));
 expect(overview).toContain("| 1 项你的决定；其余见句末标记 |");
 expect(overview).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(overview).toContain(` | 首屏：采用ChatGPT式简洁欢迎页；对话层：用户输入需求后进入此层确定清单；仿真：最后进行仿真操作。 |`);
 // With its whole sentence in the chapter too, the sentence is the item.
 const whole="首屏采用ChatGPT式简洁欢迎页，用户输入需求后进入对话层确定清单，最后进行仿真。";
 page.body+=`\n\n${whole}`;page.claims=[...page.claims,{text:whole,quote:whole,evidenceIds:[source.id],holder:"decided",holderMark:true,unitIds:["u-flow"]}];
 const again=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(again).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(again).toContain(` | ${whole} |`);
 expect(again).toContain("| 1 项你的决定；其余见句末标记 |");
});

it("lists a decision written in several places once, by its whole sentence",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 const whole="首屏采用 ChatGPT 式简洁欢迎页，用户输入需求后进入对话层确定清单，再进入 Canvas，中间嵌套旧物识别，最后进行仿真。";
 const again="首屏采用ChatGPT式简洁欢迎页，用户输入需求后进入对话层确定清单，再进入Canvas，中间嵌套旧物识别，最后进行仿真。";
 const tail="随后进入对话层确定清单，中间嵌套旧物识别，最后进行仿真。";
 page.body=`${whole}\n\n用户输入需求后不直接生成 Canvas，${tail}\n\n${again}`;
 page.claims=[whole,tail,again].map(text=>({text,quote:text,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-flow"]}));
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(overview).toContain(` | ${whole} |`);
});

it("lists a decision saved with its list bullet and label by what it says",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0],title=page.wikiDisplayTitle||page.title;
 const item="- **BYOK模式**：采用 BYOK 模式，不保存到服务器。";
 page.body=`**数据库使用 IndexedDB。**\n\n${item}`;
 page.claims=[{text:item,quote:item,evidenceIds:[source.id],holder:"decided",holderMark:true,unitIds:["u-byok"]}];
 const overview=(file=>file.slice(file.indexOf("## 项目总览"),file.indexOf("\n---\n")))(projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text);
 expect(overview).toContain(`### 已定的关键决定\n\n| 领域 | 决定 |\n|---|---|\n| ${title}`);expect(overview).toContain(` | 采用 BYOK 模式，不保存到服务器。 |`);
});

it("lists a decided list item that left its subject to the label with the label first",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const text="Confirmed at 48px for both desktop and mobile views.";
 page.body=`Opening line.\n\n- **Dashboard Top Bar Height**: ${text}\n- **Users can** add expenses.`;
 page.claims=[{text,quote:text,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-bar"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 expect(file).toContain(" | Dashboard Top Bar Height: confirmed at **48px** for both desktop and mobile views. |");
});

it("lists an open list item that left its subject to the label with the label first",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const text="Deferred to V2 evaluation, pending validation of demand during private alpha.";
 page.body=`Opening line.

- **Cloud Sync**: ${text}
- **Users can** add expenses.`;
 page.claims=[{text,quote:text,evidenceIds:[source.id],holder:"ai" as const,unitIds:["u-sync"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 expect(file).toContain(" | Cloud Sync: deferred to V2 evaluation, pending validation of demand during private alpha. |");
});

it("does not list a decided sentence that names its subject only through the sentence before it",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const lean="This was replaced by the confirmed global standard of 8px corner radius.",own="Standard UI components use a global corner radius of 8px.";
 page.body=`Opening line.\n\nEarlier specifications proposed a 16px card radius. ${lean}\n\n${own}`;
 page.claims=[lean,own].map((text,index)=>({text,quote:text,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:[`u-${index}`]}));
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 const overview=file.slice(0,file.indexOf("\n---\n"));
 expect(overview).toContain("global corner radius of **8px**. |");
 expect(overview).not.toContain("| This was replaced");
});

it("lists a decision without the connective that tied it to the sentence before, and one open question said twice once",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const usd="However, Pocket Ledger v1 explicitly excludes multi-currency functionality, supporting USD only.";
 const first="The specific cadence—monthly versus per-pay-period—remains an open product decision; explicit start/end dates are proposed.",second="The choice between monthly budgets and per-pay-period budgets remains explicitly undecided.";
 page.body=`Opening line.\n\nFeedback asked for currencies. ${usd}\n\n${first} ${second}`;
 page.claims=[{text:usd,quote:usd,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-usd"]},...[first,second].map((text,index)=>({text,quote:text,evidenceIds:[source.id],holder:"open" as const,holderMark:true,unitIds:[`u-open-${index}`]}))];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 const overview=file.slice(0,file.indexOf("\n---\n"));
 expect(overview).toContain("| Pocket Ledger **v1** explicitly excludes multi-currency functionality, supporting USD only. |");
 expect(overview.split("per-pay-period").length-1).toBe(1);
});

it("lists the whole sentences of one decision together, and a ban apart from the choice it goes with",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 session.locale="en";
 const stack="The system is built as a client-only web application using React, Vite, and TypeScript with IndexedDB via Dexie for local data persistence.";
 const ban="Use IndexedDB via Dexie for local data persistence; do not use localStorage.";
 const never="In version 1, transaction data must never be sent to any server.",analytics="Analytics are limited to collecting anonymous page views only, excluding all transaction details or identifying information.";
 page.body=`${stack}\n\n${ban}\n\n${never} ${analytics}`;
 page.claims=[{text:stack,quote:stack,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-stack"]},{text:ban,quote:ban,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-ban"]},
  {text:never,quote:never,evidenceIds:[source.id],holder:"decided" as const,unitIds:["u-never"]},{text:analytics,quote:analytics,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-never"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 const overview=file.slice(file.indexOf("### Key decisions"),file.indexOf("\n---\n"));
 expect(overview).toContain(` | ${ban} |`);
 expect(overview).toContain(` | ${never} ${analytics} |`);
});

it("lists a decision told after another point without the joining word",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const usd="but Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded.";
 page.body=`Opening line.\n\nExternal feedback suggests supporting multiple currencies, ${usd}`;
 page.claims=[{text:usd,quote:usd,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-usd"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 const overview=file.slice(0,file.indexOf("\n---\n"));
 expect(overview).toContain("| Pocket Ledger **v1** supports USD only; multi-currency functionality is explicitly excluded. |");
 expect(overview).not.toContain("| but ");
});

it("names the failing key checks, with where they are, under the header",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="Opening line.";
 const chapters=[{id:"c",title:"Scope and Roadmap",question:"",group:"",body:"",paragraphs:[],problems:["\" **Milestone 3**：Private…\" has no claim naming the units it states; add a claim for each decided, done, figure or change sentence","\"- Bank syncing…\" explains the core of one explanation group again"]}];
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[],draft:{version:1,generatedAt:1,status:"complete",chapters,report:{},quality:{sources:"complete",failedBatches:0,organization:"complete",critical:1,problems:2,passed:false}}} as unknown as typeof session.wikiKnowledge;
 const file=projectDocument(session,{...selection,wikiIds:[page.id]},"md",false).text;
 expect(file.slice(0,file.indexOf("\n## "))).toContain("Failing: Scope and Roadmap (“Milestone 3: Private…”): a decided, done or figure sentence is not tied to its sources.");
 expect(file).not.toContain("explains the core");
});

it("gives a chapter's answer at a glance without its sentence mark",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const stack="The system is built as a client-only web application using React, Vite, and TypeScript.";
 page.body=`${stack} Amounts are stored as integers.\n\n### Tech Stack\n\nDetails.`;
 page.claims=[{text:stack,quote:stack,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-stack"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md",false).text;
 const glance=file.slice(file.indexOf("### At a glance"),file.indexOf("### Key decisions"));
 expect(glance).toContain(`| ${stack} |`);
 expect(glance).not.toContain("[Decided]");
 expect(file).toContain(`${stack} [Decided]`);
});

it("lists a decided table row with its item first, and two overlapping sentences once",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const look="界面采用极简暖白色风格，Popup 布局宽度固定为 360px，高度按内容自适应。",size="Popup 布局宽度固定为 360px，高度按内容自适应，首页目标高度约 460px，以避免首页出现滚动条。";
 page.body=`${look}${size}\n\n| 事项 | 决策 |\n| --- | --- |\n| 云同步 | 不做，后续规划不再纳入开发范围 |`;
 page.claims=[{text:look,quote:look,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-look"]},{text:size,quote:size,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-look"]},
  {text:"云同步",quote:"云同步",evidenceIds:[source.id],holder:"decided" as const,unitIds:["u-sync"]},{text:"不做，后续规划不再纳入开发范围",quote:"不做，后续规划不再纳入开发范围",evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-sync"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("### 已定的关键决定"));
 expect(overview).toContain(" | 界面采用极简暖白色风格，Popup 布局宽度固定为 **360px**，高度按内容自适应，首页目标高度约 **460px**，以避免首页出现滚动条。 |");
 expect(overview).toContain(" | 云同步：不做，后续规划不再纳入开发范围。 |");
});

it("lists a decision without the 但 tying it to the clause before, and an earlier undecided point not as open",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const chose="但最终确认 Popup 宽度为 380px。",waited="宽度未定前 CSS 变量默认值暂用 B2 (360px)。";
 page.body=`尽管曾有两案并存的提议，${chose}\n\n${waited}`;
 page.claims=[{text:chose,quote:chose,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-w"]},{text:waited,quote:waited,evidenceIds:[source.id],holder:"earlier" as const,holderMark:true,unitIds:["u-old"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 expect(file).toContain(" | 最终确认 Popup 宽度为 **380px**。 |");
 expect(file).not.toContain("### 待决问题");
});

it("lists once two decisions ruling out the same thing in different words",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const first="第一版采用本地优先策略，不引入服务器、云数据库或 API，后续规划不再将云同步纳入开发范围。",second="V0.1 版本明确决定不做数据云同步，采用本地优先策略。";
 page.body=`${first}\n\n${second}`;
 page.claims=[{text:first,quote:first,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-first"]},{text:second,quote:second,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-second"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("### 已定的关键决定"),file.indexOf("\n---\n"));
 expect(overview).toContain(first);
 expect(overview).not.toContain(second);
});

it("lists once a short ban told inside a longer decision",()=>{
 const session=contextKnowledge().session,page=session.sections[0],source=session.evidence[0];
 const first="第一版采用本地优先策略，不引入服务器、云数据库或 API，后续规划不再将云同步纳入开发范围。",second="V0.1 版本明确决定不做数据云同步。",other="V0.1 版本明确决定不做账号系统。";
 page.body=`${first}

${second}

${other}`;
 page.claims=[first,second,other].map((text,index)=>({text,quote:text,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:[`u-${index}`]}));
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("### 已定的关键决定"),file.indexOf("\n---\n"));
 expect(overview).toContain(first);
 expect(overview).not.toContain(second);
 // A ban on something the longer one never names stays.
 expect(overview).toContain("版本明确决定不做账号系统");
 expect(overview).not.toContain("版本明确决定不做数据云同步");
});

it("tells a chapter whose decision is listed with another chapter's that it still holds one",()=>{
 const session=contextKnowledge().session,[first,second]=session.sections,source=session.evidence[0];
 const wide="第一版采用本地优先策略，不引入服务器、云数据库或 API，后续规划不再将云同步纳入开发范围。",narrow="V0.1 版本明确决定不做数据云同步。";
 if(!second)return;
 first.body=wide;first.claims=[{text:wide,quote:wide,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-wide"]}];
 second.body=narrow;second.claims=[{text:narrow,quote:narrow,evidenceIds:[source.id],holder:"decided" as const,holderMark:true,unitIds:["u-narrow"]}];
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[first.id,second.id]},"md").text;
 const glance=file.slice(file.indexOf("### 一页速览"),file.indexOf("### 已定的关键决定"));
 expect(glance).toContain("1 项与其他章节相同的决定");
 expect(glance).not.toContain("未见你的确认");
});

it("opens a learning record with where the learner stands, not decisions or a baseline",()=>{
 const session=contextKnowledge().session,page=session.sections[0];
 page.body="### 条件判断 · 已会\n\nif 判断从上往下，遇到第一个 True 即停止。\n\n> **回忆**：多个条件为真时执行哪个？\n>\n> 第一个为真的。\n\n### 列表\n\nlist 可以存多个值。";
 const unit=(id:string,statement:string,role:"user"|"assistant"="assistant")=>({id,subject:"s",statement,kind:"fact",details:[],evidence:{evidenceId:id,conversationId:"c",messageId:id,messageIndex:Number(id.slice(1)),role,pasted:false,quote:statement},adoption:{status:"proposal"},delivery:"unknown"});
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,documentType:"learning",documentTypeBy:"auto",
  learningRoles:{u1:"learned",u2:"todo",u3:"skip",u4:"mistake",u5:"exercise",u6:"learned",u7:"goal"},
  batches:[{sourceIds:[],status:"ok",units:[unit("u1","已掌握 if、list、for、def。"),unit("u2","尚未学习 NumPy 和 class。"),unit("u3","暂时不学习 lambda。"),unit("u4","注意区分赋值 = 与比较 ==。"),unit("u5","写了电压检查函数。","user"),unit("u6","学会了用 Notion 记录学习笔记。"),unit("u7","学习目标是读懂 python-control 源码。")]}],
  draft:{version:1,generatedAt:1,status:"complete",chapters:[],report:{},baseline:[{part:"now",text:"下一阶段学 NumPy。",unitIds:["u2"]}]}} as unknown as typeof session.wikiKnowledge;
 const file=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const overview=file.slice(file.indexOf("## 学习总览"),file.indexOf("\n---\n"));
 expect(overview).toContain("**现在在哪**：已掌握 if、list、for、def。（AI 看过练习后的判断）");
 expect(overview).toContain("### 学习地图");
 // Three parts: what was learned, how the learner studies (never "learned"), and the goals and plans.
 expect(overview).toContain("**知识点**\n\n| 知识点 | 状态 | 依据 |\n|---|---|---|\n| if、list、for、def | 已会 · AI 看过练习后的判断 | 第 2 条消息 |\n\n**学习方法与资源**\n\n- 学会了用 Notion 记录学习笔记。\n\n**目标与计划**");
 expect(overview).toContain("1. 学习目标是读懂 python-control 源码。\n\n| 计划 | 状态 | 依据 |\n|---|---|---|\n| NumPy、class | 计划学 | 第 3 条消息 |\n| 暂时不学习 lambda。 | 暂不学 | 第 4 条消息 |");
 expect(overview).not.toContain("Notion 记录学习笔记 | 已会");
 // A file cannot fold: the chapter's recall questions come at its end, the answers after them.
 expect(file).toContain("1. 多个条件为真时执行哪个？（「1.1 条件判断」）");
 expect(file.indexOf("多个条件为真时执行哪个？")).toBeGreaterThan(file.indexOf("list 可以存多个值。"));
 expect(file).not.toContain("**回忆**");
 expect(overview).toContain("### 常见错误与纠正\n\n- 注意区分赋值 = 与比较 ==。");
 expect(overview).not.toContain("当前基线");
 expect(file).not.toContain("## 项目总览");
 expect(file).toContain("| 学习 |");
 expect(file).toContain("你的练习 1 条 · 错误与纠正 1 条 · 类型：学习（自动识别）");
 expect(file).not.toContain("实现核对");
 // A mistake its chapter shows on a card is read there: the overview says where, and does not list it again.
 const ledger=session.wikiKnowledge!;
 session.wikiKnowledge={...ledger,draft:{...ledger.draft!,chapters:[{id:"c1",title:"Python",question:"",group:"",body:"",paragraphs:[{subtopic:"s",text:"**易错**：注意区分赋值 = 与比较 ==。",unitIds:["u4"]}],problems:[]}]}} as typeof session.wikiKnowledge;
 const carded=projectDocument(session,{...selection,overview:true,wikiIds:[page.id]},"md").text;
 const cardedOverview=carded.slice(carded.indexOf("## 学习总览"),carded.indexOf("\n---\n"));
 expect(cardedOverview).not.toContain("### 常见错误与纠正");
 expect(cardedOverview).toContain("易错 1 条放在各章对应的卡片里，章首「本章学习总览」标出了位置；每章末尾有回忆题。");
});

it("gives the HTML export a script-free quick navigation beside the text",()=>{
 const session=contextKnowledge().session,html=projectDocument(session,{...selection,overview:true,sources:true},"html").text;
 expect(html).toContain('<nav class="locator" aria-label="快捷导航">');expect(html).toMatch(/<nav class="locator"[^>]*><a href="#section-\d+" title=/u);expect(html).not.toContain("<script");
 expect(projectDocument(session,{...selection,overview:true,sources:true},"md").text).not.toContain("locator");
});


it("numbers a learning record's chapter, its cards, and the cards its table and recall questions name", () => {
 const fence="```";
 const part={title:"Python编程基础",body:["**本章学习总览**","| 知识点 | 状态 |\n|---|---|\n| 条件判断 | 已会 |\n| for循环 | 讲过 |","### 条件判断 · 已会","讲解。",`${fence}markdown\n### 不是标题\n${fence}`,"### for循环","讲解。","### 本章回忆题","1. 「for循环」容易错在哪里？"].join("\n\n")};
 expect(numberedLearningChapter(part,2)).toEqual({title:"2. Python编程基础",body:["**本章学习总览**","| 知识点 | 状态 |\n|---|---|\n| 2.1 条件判断 | 已会 |\n| 2.2 for循环 | 讲过 |","### 2.1 条件判断 · 已会","讲解。",`${fence}markdown\n### 不是标题\n${fence}`,"### 2.2 for循环","讲解。","### 本章回忆题","1. 「2.2 for循环」容易错在哪里？"].join("\n\n")});
});
