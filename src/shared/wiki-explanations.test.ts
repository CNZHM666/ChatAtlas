import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {sourceMessageSignature} from "./source-signature";
import {groundWikiClaims} from "./wiki-claims";
import {wikiChapterLinks} from "./wiki-chapter-links";
import {mergeWikiDuplicateExplanations,wikiBlockIssues,wikiBlocks,wikiVerification,missingWikiDetails} from "./wiki-explanations";
import type {FocusSection,FocusSession} from "./focus-session";
import type {ConversationMessage} from "./types";

const flow="首次分析时解析对话并为每条消息生成稳定 ID 与去重，然后建立全文索引并在后台生成向量，最后持久化到本地，以后只更新发生变化的消息。";
const page=(id:string,title:string,body:string,claims:FocusSection["claims"]=[]):FocusSection=>({id,title,body,kind:"finding",transition:"",evidenceIds:claims.flatMap(claim=>claim.evidenceIds),claims});

function session(texts:Array<{text:string;role:"user"|"assistant"}>,sections:FocusSection[]):{session:FocusSession;originals:ConversationMessage[]}{
 const value=projectSession();value.projectState=undefined;
 const originals:ConversationMessage[]=texts.map(({text,role},index)=>({id:`m${index}`,conversationId:"source",messageIndex:index,role,content:text,preview:"",contentHash:"",createdAt:0,sourceCreatedAt:Date.UTC(2026,8,index+1),updatedAt:0}));
 value.evidence=originals.map((message,index)=>({id:`e${index}`,conversationId:"source",messageId:message.id,title:"讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 value.sourceConversationIds=["source"];value.sourceRoles={source:Object.fromEntries(originals.map(message=>[message.id,message.role]))};
 value.sourceSignatures={source:Object.fromEntries(originals.map(message=>[message.id,sourceMessageSignature(message.content)]))};value.sourceMessageOrder={source:originals.map(message=>message.id)};
 value.sections=groundWikiClaims(sections,value.evidence,originals,true);value.wikiOrder=sections.map(section=>section.id);
 return {session:value,originals};
}

it("T14/T16: a complete repeat in a later chapter becomes a pointer and its own claim moves to the explaining chapter",()=>{
 const first=page("search","搜索与索引",flow,[{text:"建立全文索引",quote:"建立全文索引",evidenceIds:["e0"]}]);
 const second=page("cache","首次分析与增量缓存",`## 缓存\n\n${flow}\n\n缓存键使用 contentHash 判断消息是否变化。`,[{text:flow,quote:"只更新变化消息",evidenceIds:["e1"]}]);
 const result=mergeWikiDuplicateExplanations([first,second]);
 expect(result.merged).toBe(1);
 expect(result.sections[1].body).toContain("> 这部分已在[「搜索与索引」](#atlas-chapter-search)中说明。");
 expect(result.sections[1].body).toContain("contentHash");expect(result.sections[1].body).not.toContain(flow);
 expect(result.sections[1].claims).toEqual([]);
 expect(result.sections[0].claims?.map(claim=>claim.quote)).toEqual(["建立全文索引","只更新变化消息"]);
 expect(result.sections[0].evidenceIds).toEqual(["e0","e1"]);
});

it("T15: a similar paragraph with its own number, condition or identifier is kept and reported, never deleted",()=>{
 const first=page("search","搜索与索引",flow);
 const extra=flow.replace("最后持久化到本地","最后持久化到本地（仅 BYOK 模式，最多 3 次重试）");
 const second=page("cache","缓存",extra);
 const result=mergeWikiDuplicateExplanations([first,second]);
 expect(result.merged).toBe(0);expect(result.sections[1].body).toBe(extra);
 expect(result.issues).toEqual([expect.objectContaining({code:"duplicate_with_extra",sectionId:"cache",targetSectionId:"search",details:expect.arrayContaining(["byok","3"])})]);
 expect(missingWikiDetails(extra,flow)).toEqual(expect.arrayContaining(["仅","byok","3"]));
});

it("T16: reading links no longer keep a repeat only because its claim is local, when the earlier chapter carries the same claim",()=>{
 const claim={text:flow,quote:"只更新变化消息",evidenceIds:["e1"]};
 const chapters=[page("a","搜索与索引",flow,[claim]),page("b","缓存",flow,[claim])];
 expect(wikiChapterLinks(flow,chapters[1],chapters)).toContain("#atlas-chapter-a");
 // A claim with other evidence remains protected at reading time (generation migrates it).
 const other=page("b","缓存",flow,[{...claim,evidenceIds:["e2"]}]);
 expect(wikiChapterLinks(flow,other,[chapters[0],other])).toBe(flow);
});

it("locates unsupported status wording, unbound core decisions and reworded duplicates by block",()=>{
 const proposal="我建议采用 Orama 作为搜索引擎。";
 const status=page("search","搜索",`用户已确认采用 Orama 作为搜索引擎。\n\nAtlas 的核心技术决策是不把原始对话直接交给大模型生成视图，而是先建立索引与结构化结果。`,[{text:"用户已确认采用 Orama 作为搜索引擎。",quote:proposal,evidenceIds:["e0"],workStatus:"proposed"}]);
 const again=page("arch","架构","系统在检索层面选用 Orama 作为全文搜索的实现，用它负责关键词查询与排序，返回消息级的结果供阅读器定位，并在索引更新后保持查询结果与原始消息的对应关系不变。",[{text:"系统在检索层面选用 Orama 作为全文搜索的实现",quote:proposal,evidenceIds:["e0"],workStatus:"proposed"}]);
 const {session:value}=session([{text:proposal,role:"assistant"}],[status,again]);
 const issues=wikiBlockIssues(value);
 const blocks=wikiBlocks(value.sections[0]);
 expect(issues).toEqual(expect.arrayContaining([
  expect.objectContaining({code:"unsupported_status",sectionId:"search",blockId:blocks[0].id}),
  expect.objectContaining({code:"unbound_decision",sectionId:"search",blockId:blocks[1].id}),
  expect.objectContaining({code:"duplicate_explanation",sectionId:"arch",targetSectionId:"search"}),
 ]));
 expect(wikiVerification(value,issues).status).toBe("history_digest");
});

it("calls a document decision-checked only when key claims were read against originals and no status issue remains",()=>{
 const decision="我决定使用 IndexedDB 保存消息。";
 const {session:value}=session([{text:decision,role:"user"}],[page("db","存储","消息保存在 IndexedDB 中，由用户决定采用。",[{text:"消息保存在 IndexedDB 中",quote:decision,evidenceIds:["e0"],overviewRole:"decision"}])]);
 const verification=wikiVerification(value);
 expect(verification).toMatchObject({status:"decisions_checked",claims:{confirmed:1,unread:0},implementation:"not_checked",sources:{conversations:1,messages:1}});
 expect(verification.sources.earliest).toBe(Date.UTC(2026,8,1));
 const unread={...value,sections:value.sections.map(section=>({...section,claims:section.claims?.map(claim=>({...claim,sourceReading:undefined}))}))};
 expect(wikiVerification(unread).status).toBe("history_digest");
});

it("merges twin subsections of one chapter under the earlier heading without dropping content",async()=>{
 const {mergeWikiTwinSubsections}=await import("./wiki-explanations");
 const section={...page("search","统一检索","开篇。\n\n## 混合检索架构\n\n全文与向量结合。\n\n## 书签定位\n\n书签优先。\n\n## 混合检索与性能\n\n延迟控制在本地。"),wikiSubtopics:[{title:"混合检索架构",question:""},{title:"书签定位",question:""},{title:"混合检索与性能",question:""}]};
 const result=mergeWikiTwinSubsections(section);
 expect(result.merged).toBe(1);
 expect(result.section.body).toBe("开篇。\n\n## 混合检索架构\n\n全文与向量结合。\n\n延迟控制在本地。\n\n## 书签定位\n\n书签优先。");
 expect(result.section.wikiSubtopics?.map(topic=>topic.title)).toEqual(["混合检索架构","书签定位"]);
 // Headings sharing one generic word are different subjects.
 expect(mergeWikiTwinSubsections(page("x","x","## 搜索降级与容错\n\n甲。\n\n## 搜索交互与体验\n\n乙。")).merged).toBe(0);
});

it("removes a complete repeat inside one chapter but keeps one with its own detail",()=>{
 const repeat=page("cache","缓存",`${flow}\n\n${flow}`);
 expect(mergeWikiDuplicateExplanations([repeat]).sections[0].body).toBe(flow);
 const detailed=page("cache","缓存",`${flow}\n\n${flow.replace("最后","仅在 BYOK 模式下最后")}`);
 const result=mergeWikiDuplicateExplanations([detailed]);
 expect(result.sections[0].body).toBe(detailed.body);expect(result.issues[0]).toMatchObject({code:"duplicate_with_extra",targetSectionId:"cache"});
});

it("nominates reworded repeats in one chapter by shared content terms, but not the chapter opening",()=>{
 const a="侧边栏被建议从「保存工具」重构为「智能管家」，核心路径改为找回历史、阅读结果、整理上下文并插入当前对话，减少用户在多个平台之间来回切换。";
 const b="侧边栏的核心定位从「对话保存工具」转向「所有 AI 对话智能管家」，核心路径为找回历史、阅读结果、整理上下文，再插入当前对话框。";
 const {session:value}=session([{text:"讨论",role:"user"}],[page("ui","体验设计",`本章概述侧边栏、搜索与工作台的分工，侧边栏负责找回历史与整理上下文，核心路径从找回历史到插入当前对话。\n\n## 侧边栏\n\n${a}\n\n## 重构\n\n${b}`)]);
 const issues=wikiBlockIssues(value).filter(issue=>issue.code==="duplicate_explanation");
 expect(issues).toHaveLength(1);
 const blocks=wikiBlocks(value.sections[0]);
 expect(issues[0]).toMatchObject({blockId:blocks[2].id,targetBlockId:blocks[1].id});
});

it("raises no status issue in a chapter whose sentences carry status marks: the mark says it, and switching it fixes it",()=>{
 const proposal="我建议采用 Orama 作为搜索引擎。";
 const marked=page("search","搜索","确认采用 Orama 作为搜索引擎。",[{text:"确认采用 Orama 作为搜索引擎。",quote:proposal,evidenceIds:["e0"],holder:"ai" as const,holderMark:true}]);
 const {session:value}=session([{text:proposal,role:"assistant"}],[marked]);
 expect(wikiBlockIssues(value).filter(issue=>["unsupported_status","unbound_decision","retired_as_current"].includes(issue.code))).toEqual([]);
});

it("keeps the line over a table even when an earlier chapter tells the decision it names",()=>{
 const decision="Pocket Ledger v1 supports USD only; multi-currency functionality is explicitly excluded from the first release.";
 const caption=`*Table from the discussion · AI suggestion, not confirmed; your later decision takes precedence: ${decision}*`;
 const table="| Milestone | Proposed adjustment |\n|---|---|\n| M2 | Finish CSV export; consider configurable currency |";
 const body=`Cloud sync is deferred.\n\n${caption}\n\n${table}`;
 const chapters=[page("a","Scope",decision,[]),page("b","Architecture",body,[])];
 expect(wikiChapterLinks(body,chapters[1],chapters,false)).toBe(body);
});
