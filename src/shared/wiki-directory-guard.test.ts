import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {guardWikiDirectory,projectNamedChapter,catchAllChapter,MAX_WIKI_SUBSECTIONS} from "./wiki-directory-guard";
import type {FocusSection,FocusSession} from "./focus-session";

const chapter=(id:string,title:string,body:string,extra:Partial<FocusSection>={}):FocusSection=>({id,title,body,kind:"finding",transition:"",evidenceIds:[],...extra});
const session=(sections:FocusSection[],extra:Partial<FocusSession>={}):FocusSession=>({...projectSession(),title:"Atlas 项目知识工作区",goal:"",mode:"work",projectState:undefined,sections,wikiOrder:sections.map(section=>section.id),activeSectionId:sections[0].id,completedSectionIds:[],...extra});
const search=chapter("search","统一检索","统一检索负责找回历史消息。\n\n## 混合检索架构\n\n全文索引与向量检索结合，Orama 保存索引，查询按消息聚合返回结果。\n\n## 书签与消息定位\n\n书签优先召回，定位到原始消息。");
const context=chapter("context","上下文引擎","Context Engine 按任务组装上下文。\n\n## 上下文组装\n\nContext Engine 选择知识、去重并控制长度，Context Engine 输出 Markdown。Context Engine 不自动发送。Context Engine 支持预览。\n\n## 上下文预算\n\nContext Engine 按预算裁剪内容。");

it("recognizes chapters that name the project or hold leftovers, not real subjects",()=>{
 for(const title of ["Atlas 项目知识工作区","Atlas项目知识工作区","核心机制","其他","Overview"])expect(projectNamedChapter(title,["Atlas 项目知识工作区"])||catchAllChapter(title)).toBe(true);
 for(const title of ["统一检索","上下文引擎","核心体验闭环","Atlas Reader"])expect(projectNamedChapter(title,["Atlas 项目知识工作区"])||catchAllChapter(title)).toBe(false);
});

it("dissolves a project-named chapter into the chapters its subsections belong to, with claims and sources",()=>{
 const claim={text:"查询按消息聚合返回结果并标出原始消息位置",quote:"按消息聚合",evidenceIds:["e9"]};
 const named=chapter("atlas","Atlas 项目知识工作区","Atlas 是项目知识工作区。\n\n## 检索结果聚合\n\n查询按消息聚合返回结果并标出原始消息位置，全文索引由 Orama 保存。\n\n## 上下文长度控制\n\nContext Engine 按预算裁剪上下文长度并去重。",{claims:[claim],evidenceIds:["e9","e10"],wikiMaterialKeys:["k1"]});
 const {session:out,report}=guardWikiDirectory(session([search,context,named]));
 expect(report.dissolved).toEqual(["Atlas 项目知识工作区"]);
 expect(out.sections.map(section=>section.id)).toEqual(["search","context"]);
 const searchOut=out.sections[0],contextOut=out.sections[1];
 expect(searchOut.body).toContain("## 检索结果聚合");expect(searchOut.body).toContain("Atlas 是项目知识工作区。");
 expect(contextOut.body).toContain("## 上下文长度控制");
 expect(searchOut.claims).toEqual([claim]);expect(searchOut.evidenceIds).toEqual(expect.arrayContaining(["e9","e10"]));expect(searchOut.wikiMaterialKeys).toEqual(["k1"]);
 expect(out.wikiSectionAliases?.atlas).toBe("search");expect(out.wikiOrder).toEqual(["search","context"]);
});

it("moves a subsection that names another chapter's own subject to that chapter",()=>{
 const architecture=chapter("arch","系统架构","系统分层。\n\n## 三层架构\n\n数据层、知识层与交付层分开。\n\n## Context Engine 与上下文检索\n\n它为任务检索历史知识并生成上下文包。");
 const {session:out,report}=guardWikiDirectory(session([architecture,context]));
 expect(report.moved).toBe(1);
 expect(out.sections[0].body).not.toContain("Context Engine 与上下文检索");
 expect(out.sections[1].body).toContain("## Context Engine 与上下文检索\n\n它为任务检索历史知识并生成上下文包。");
});

it("caps subsections per chapter by merging the most similar ones, keeping every sentence",()=>{
 const topics=Array.from({length:15},(_,index)=>`## 主题${index}方案\n\n第 ${index} 段独立说明${index%5===0?"上下文预算与裁剪":"内容"}。`);
 const long=chapter("long","上下文引擎",`开篇。\n\n${topics.join("\n\n")}`,{wikiSubtopics:Array.from({length:15},(_,index)=>({title:`主题${index}方案`,question:""}))});
 const {session:out}=guardWikiDirectory(session([search,long]));
 const body=out.sections[1].body;
 expect(body.match(/^## /gmu)).toHaveLength(MAX_WIKI_SUBSECTIONS);
 for(let index=0;index<15;index++)expect(body).toContain(`第 ${index} 段独立说明`);
 expect(out.sections[1].wikiSubtopics).toHaveLength(MAX_WIKI_SUBSECTIONS);
});

it("leaves personal chapters, chapters with notes and an already clean directory untouched",()=>{
 const personal=chapter("mine","其他","我的笔记。",{userEdited:true});
 const noted=chapter("noted","核心机制","## 说明\n\n带有个人笔记的章。");
 const value=session([search,context,personal,noted],{sectionNotes:{noted:{text:"我的批注",evidenceIds:[],updatedAt:1}}});
 const result=guardWikiDirectory(value);
 expect(result.session).toBe(value);expect(result.report).toEqual({dissolved:[],moved:0,merged:0});
});

it("gives a subject to the chapter titled after it, also across languages and mention counts",()=>{
 const mentions="Context Engine 选择知识。".repeat(8);
 const architecture=chapter("arch","系统架构",`分层说明。\n\n## 三层架构\n\n${mentions}\n\n## Context Pack 最小版本实现\n\n先导出 Markdown，再按预算裁剪。`);
 const engine=chapter("engine","上下文引擎","引擎负责组装。\n\n## 安全约束\n\n导入内容只作参考。");
 const {session:out}=guardWikiDirectory(session([architecture,engine]));
 expect(out.sections[0].body).not.toContain("Context Pack 最小版本实现");
 expect(out.sections[1].body).toContain("## Context Pack 最小版本实现\n\n先导出 Markdown，再按预算裁剪。");
 // An ordinary subsection mentioning the subject stays where it is.
 expect(out.sections[0].body).toContain("## 三层架构");
});

it("joins same-titled subsections from different chapters in the chapter that fits them, with their claims",()=>{
 const claim={text:"侧边栏只做快速复用",quote:"侧边栏只做快速复用",evidenceIds:["e5"]};
 const architecture=chapter("arch","系统架构","系统分层。\n\n## 三层架构\n\n数据层与知识层分开。\n\n## 侧边栏与工作台的职责分工\n\n侧边栏只做快速复用。",{claims:[claim],evidenceIds:["e5"]});
 const ui=chapter("ui","界面设计","界面说明。\n\n## 侧边栏与工作台分工\n\n侧边栏界面精简，工作台界面负责深度整理，界面按钮分组。\n\n## 视觉层级\n\n界面减少说明文字。");
 const {session:out}=guardWikiDirectory(session([architecture,ui]));
 const titles=out.sections.flatMap(section=>section.body.match(/^## .*$/gmu)??[]);
 expect(titles.filter(title=>title.includes("侧边栏与工作台"))).toHaveLength(1);
 const home=out.sections.find(section=>section.body.includes("侧边栏只做快速复用"))!;
 expect(home.body).toContain("工作台界面负责深度整理");
 expect(home.claims).toEqual([claim]);expect(home.evidenceIds).toContain("e5");
 expect(out.sections.filter(section=>section!==home).flatMap(section=>section.claims??[])).toEqual([]);
});
