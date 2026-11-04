import {expect,it} from "vitest";
import {assertWikiOutline,broadWikiChapters,documentNamedWikiTitle,identifyWikiOwners,wikiChapterTarget,capWikiSubtopics,dissolveUnownedWikiPages,wikiSubtopicLimit} from "./wiki-outline-policy";
import {validateWikiDirectory} from "./wiki-directory";
import {planWikiTopics,type WikiPlanReceipt} from "./wiki-topic-plan";
import {requireOrganizedWiki} from "./wiki-auto-organize";
import {projectSession} from "../test/project-fixture";
import {contextKnowledge} from "../test/context-fixture";
import type {DirectoryPage} from "../shared/wiki-directory";
import type {StructuredAIRequest} from "./provider";
const page=(index:number):DirectoryPage=>({title:`领域${index}`,question:`问题${index}`,group:"",sectionIds:[`id${index}`]});

it("rejects 47 valid singleton pages instead of treating source coverage as outline quality",()=>{
 const pages=Array.from({length:47},(_,i)=>page(i));
 const sections=pages.map(p=>({...projectSession().sections[0],id:p.sectionIds[0],title:p.title}));
 expect(validateWikiDirectory({pages},sections,true)).toHaveLength(47);
 expect(()=>assertWikiOutline(pages)).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_chapter_count"}));
 expect(()=>requireOrganizedWiki({...projectSession(),mode:"work",sections})).toThrow();
});
it("requires children and rejects actual duplicate titles without inferring subjects from conjunctions",()=>{
 expect(()=>assertWikiOutline([{...page(0),sectionIds:["a","b"]}])).toThrowError(expect.objectContaining({fieldPaths:["pages[0].subtopics"]}));
 expect(()=>assertWikiOutline([{...page(0),title:"系统设计"},{...page(1),title:"系统：设计"}])).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_duplicate_title",fieldPaths:["pages[1].title"]}));
 expect(()=>assertWikiOutline([{...page(0),title:"系统架构与存储"},{...page(1),title:"系统架构与检索"}])).not.toThrow();
 expect(()=>assertWikiOutline([{...page(0),title:"导入与导出"},{...page(1),title:"消息检索"}])).not.toThrow();
});
it("allows coherent compound subjects in most chapters and the character 与 inside a word",()=>{
 for(const titles of [["导入与导出","备份与恢复","权限管理"],["参与者管理","导入与导出","消息检索"],["Import and export","Backup and recovery","Identity & access"]]){
  expect(()=>assertWikiOutline(titles.map((title,i)=>({...page(i),title})))).not.toThrow();
 }
 expect(()=>assertWikiOutline([{...page(0),title:"过长".repeat(20)}])).toThrowError(expect.objectContaining({code:"PROVIDER_SCHEMA_wiki_directory_verbose_title"}));
});
it("preserves meaningful punctuation in different subject names and owner identities",()=>{
 for(const titles of [["-5V","5V"],["V1.0","V10"],["C#","C"],["a/b","ab"]]){
  const pages=titles.map((title,index)=>({...page(index),title}));expect(()=>assertWikiOutline(pages)).not.toThrow();expect(new Set(identifyWikiOwners(pages,[]).map(item=>item.ownerId)).size).toBe(2);
 }
});
it("does not publish a deferred plan or overwrite a protected page",()=>{
 const session=projectSession(),before=structuredClone(session);
 expect(()=>requireOrganizedWiki({...session,mode:"work",wikiDirectoryReview:{status:"pending",reason:"analysis"}})).toThrow();
 expect(session).toEqual(before);
 const personal=Array.from({length:12},(_,i)=>({...session.sections[0],id:`personal${i}`,userEdited:true}));
 expect(requireOrganizedWiki({...session,mode:"work",sections:personal}).sections).toEqual(personal);
});
it("keeps owner identity independent of material IDs and preserves an existing verified owner",()=>{
 const initial=identifyWikiOwners([page(0)],[])[0];
 expect(identifyWikiOwners([{...page(0),sectionIds:["different"]}],[])[0].ownerId).toBe(initial.ownerId);
 const existing={...projectSession().sections[0],id:"old",title:"旧名称",wikiOwnerId:"persistent-owner",wikiQuestion:page(0).question};
 expect(identifyWikiOwners([{...page(0),sectionIds:["old"]}],[existing])[0].ownerId).toBe("persistent-owner");
});
it("retains complete candidates and stops an unproductive convergence with exact counts",async()=>{
 const sections=Array.from({length:24},(_,i)=>({...projectSession().sections[0],id:`id${i}`,title:`领域${i}`}));let calls=0;let receipt:WikiPlanReceipt|undefined;
 // No merge proposal: the regrouping rounds' stop rule is under test.
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;const input=JSON.parse(request.prompt);if(calls===2)expect(input.convergence).toMatchObject({previousMainCount:24,targetMainCount:10});return request.validate({pages:input.sections.map((section:{id:string},i:number)=>({...page(i),sectionIds:[section.id]}))});}};
 await expect(planWikiTopics(sections,"zh-CN",ai,new AbortController().signal,r=>{receipt=r;})).rejects.toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_no_convergence",fieldPaths:["pages"],wikiDirectoryCounts:{mainCount:24,maxMainCount:10},message:expect.stringContaining("24 个主章节")});
 expect(calls).toBe(3);expect(receipt).toMatchObject({requests:4,repairCount:0,convergenceCount:2,candidateCount:24,reconciled:false,inputCount:24});
});
it("uses one bounded repair to accept real parents and children without losing any IDs",async()=>{
 const sections=Array.from({length:24},(_,i)=>({...projectSession().sections[0],id:`id${i}`,title:`领域${i}`}));let calls=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{if(JSON.parse(request.prompt).presentation==="wiki_chapter_merge")return request.validate({groups:[]});calls++;const ids=JSON.parse(request.prompt).sections.map((section:{id:string})=>section.id);return request.validate({pages:calls===1?ids.map((id:string,i:number)=>({...page(i),sectionIds:[id]})):[{title:"系统设计",group:"",question:"系统怎样运行？",sectionIds:ids,subtopics:[{title:"具体机制",question:"如何处理？",sectionIds:ids}]}]});}};
 const result=await planWikiTopics(sections,"zh-CN",ai,new AbortController().signal);
 expect(calls).toBe(2);expect(result).toHaveLength(1);expect(result[0].sectionIds).toEqual(sections.map(s=>s.id));
});

it("accepts at most fourteen generated chapters without truncating protected personal chapters",()=>{
 expect(()=>assertWikiOutline(Array.from({length:14},(_,i)=>page(i)))).not.toThrow();
 expect(()=>assertWikiOutline(Array.from({length:15},(_,i)=>page(i)))).toThrowError(expect.objectContaining({wikiDirectoryCounts:{mainCount:15,maxMainCount:14,subtopicCount:0}}));
});

it("finds catch-all chapters by material share or a generic project title, largest first",()=>{
 const page=(title:string,size:number)=>({title,sectionIds:Array.from({length:size},(_,index)=>`${title}-${index}`)});
 const pages=[page("产品战略",12),page("Atlas 项目知识管理",60),page("对话导入",10),page("信息提取",11),page("项目全景与优化",20),page("界面设计",9)];
 expect(broadWikiChapters(pages)).toEqual([1,4]);
 // Evenly sized chapters, or a generic title on an ordinary chapter, are left alone.
 expect(broadWikiChapters([page("产品战略",12),page("项目总览",11),page("对话导入",10),page("信息提取",13)])).toEqual([]);
 expect(broadWikiChapters([page("项目知识管理",60),page("对话导入",10),page("信息提取",11)])).toEqual([]);
});

it("treats a chapter named after the document as a catch-all at any size",()=>{
 const page=(title:string,size:number)=>({title,sectionIds:Array.from({length:size},(_,index)=>`${title}-${index}`)});
 const names=["Atlas 项目知识工作区",undefined,"AI对话项目总览"];
 expect(documentNamedWikiTitle("Atlas 项目知识工作区",names)).toBe(true);
 expect(documentNamedWikiTitle("Atlas项目知识工作区",names)).toBe(true);
 expect(documentNamedWikiTitle("Atlas 项目知识管理",["Atlas"])).toBe(true);
 expect(documentNamedWikiTitle("Atlas 产品体验设计",["Atlas"])).toBe(false);
 expect(documentNamedWikiTitle("上下文引擎",names)).toBe(false);
 // Source counts from a real export: the document-named chapter is below the median, so only its name gives it away.
 const pages=[page("产品定位与差异化",140),page("系统架构",170),page("上下文引擎",110),page("Atlas 产品体验设计",150),page("Atlas 项目知识工作区",62),page("项目知识管理",60),page("上下文复用与知识重建",42),page("Logo设计需求",4)];
 expect(broadWikiChapters(pages)).toEqual([]);
 expect(broadWikiChapters(pages,names)).toEqual([4]);
 // The name says nothing about the subject, however small the chapter.
 expect(broadWikiChapters(pages.map(item=>item.title==="Atlas 项目知识工作区"?page(item.title,6):item),names)).toEqual([4]);
});


it("bounds chapters by source breadth rather than by how finely one conversation was cut",()=>{
 expect(wikiChapterTarget(700,1)).toBe(6);expect(wikiChapterTarget(700,3)).toBe(8);expect(wikiChapterTarget(700,8)).toBe(10);
 // Little material still lowers the count; callers without a source count keep the old ceiling.
 expect(wikiChapterTarget(24,8)).toBe(4);expect(wikiChapterTarget(700)).toBe(10);
});

it("caps planned subtopics per chapter, merging the most similar and keeping every material",()=>{
 const topics=Array.from({length:16},(_,index)=>({title:index%4===0?`上下文预算 ${index}`:`主题${index}`,question:"",sectionIds:[`m${index}`]}));
 const pages=Array.from({length:6},(_,index)=>({title:`章${index}`,group:"",question:"",sectionIds:index?[`x${index}`]:topics.map(topic=>topic.sectionIds[0]),subtopics:index?[{title:"唯一",question:"",sectionIds:[`x${index}`]}]:topics}));
 expect(wikiSubtopicLimit(6)).toBe(10);
 const capped=capWikiSubtopics(pages);
 expect(capped[0].subtopics).toHaveLength(10);
 expect(capped[0].subtopics!.flatMap(topic=>topic.sectionIds).sort()).toEqual(topics.map(topic=>topic.sectionIds[0]).sort());
 expect(capped.slice(1)).toEqual(pages.slice(1));
});

it("dissolves project-named and catch-all pages into the chapters their subtopics belong to before writing",()=>{
 const pages=[
  {title:"统一检索",group:"技术",question:"如何检索历史消息？",sectionIds:["s1"],subtopics:[{title:"全文索引",question:"",sectionIds:["s1"]}]},
  {title:"上下文引擎",group:"技术",question:"如何组装上下文？",sectionIds:["c1"],subtopics:[{title:"上下文组装",question:"",sectionIds:["c1"]}]},
  {title:"Atlas 项目知识工作区",group:"",question:"",sectionIds:["a1","a2","a3"],subtopics:[{title:"检索索引更新",question:"全文索引如何增量更新",sectionIds:["a1"]},{title:"上下文组装预算",question:"上下文如何控制长度",sectionIds:["a2"]},{title:"核心机制",question:"",sectionIds:["a3"]}]},
 ];
 const result=dissolveUnownedWikiPages(pages,["Atlas 项目知识工作区"]);
 expect(result.map(page=>page.title)).toEqual(["统一检索","上下文引擎"]);
 expect(result[0].subtopics?.map(topic=>topic.title)).toContain("检索索引更新");
 expect(result[1].subtopics?.map(topic=>topic.title)).toContain("上下文组装预算");
 // The leftover heading does not become a subtopic; its material joins an existing one.
 expect(result.flatMap(page=>page.subtopics??[]).map(topic=>topic.title)).not.toContain("核心机制");
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(["a1","a2","a3","c1","s1"]);
 expect(result.flatMap(page=>page.subtopics!.flatMap(topic=>topic.sectionIds)).sort()).toEqual(["a1","a2","a3","c1","s1"]);
 // Alone, an unowned page stays: there is nowhere to put its material.
 expect(dissolveUnownedWikiPages([pages[2]],["Atlas 项目知识工作区"])).toEqual([pages[2]]);
});

it("keeps a material shared by two dissolved subtopics under one chapter, so the directory stays valid",()=>{
 // Subtopics of one chapter may share a material; sent to different homes it would sit under two chapters.
 const pages=[
  {title:"统一检索",group:"技术",question:"如何检索历史消息？",sectionIds:["s1"],subtopics:[{title:"全文索引",question:"如何建立全文索引？",sectionIds:["s1"]}]},
  {title:"上下文引擎",group:"技术",question:"如何组装上下文？",sectionIds:["c1"],subtopics:[{title:"上下文组装",question:"如何组装上下文？",sectionIds:["c1"]}]},
  {title:"Atlas 项目知识工作区",group:"",question:"项目包含什么？",sectionIds:["a1","a2","a3"],subtopics:[{title:"检索索引更新",question:"全文索引如何增量更新",sectionIds:["a1","a2"]},{title:"上下文组装预算",question:"上下文如何控制长度",sectionIds:["a2","a3"]}]},
 ];
 const sections=["s1","c1","a1","a2","a3"].map(id=>({...contextKnowledge().session.sections[0],id,kind:"finding" as const}));
 const result=dissolveUnownedWikiPages(pages,["Atlas 项目知识工作区"]);
 expect(result.flatMap(page=>page.sectionIds).sort()).toEqual(["a1","a2","a3","c1","s1"]);
 expect(()=>validateWikiDirectory({pages:result},sections,true)).not.toThrow();
 expect(result[1].subtopics?.find(topic=>topic.title==="上下文组装预算")?.sectionIds).toEqual(["a3"]);
});
