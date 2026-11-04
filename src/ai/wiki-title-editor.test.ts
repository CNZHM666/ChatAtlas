import {expect,it,vi} from "vitest";
import {projectSession} from "../test/project-fixture";
import {editWikiSessionTitles} from "./wiki-title-editor";
import {autoOrganizeWiki} from "./wiki-auto-organize";
import {wikiTitleEdits,renameWikiHeadings,WIKI_TITLE_BATCH_SIZE} from "./wiki-title-pass";
import type {WikiTitleReview} from "../shared/focus-session";
import type {StructuredAIRequest} from "./provider";

it("uses the whole outline for a new document name and leaves an existing name as a reviewable suggestion",async()=>{
 const session=projectSession(),base=session.sections[0];session.title="第一章";
 session.sections=[{...base,title:"定位与竞品"},{...base,id:"context",title:"上下文处理"},{...base,id:"ui",title:"界面设计",userEdited:true}];
 const before=structuredClone(session),ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);expect(data.project.outline.map((page:{title:string})=>page.title)).toEqual(session.sections.map(page=>page.title));
  expect(data.titles.map((item:{id:string})=>item.id)).toEqual(["d:0","c:0"]);
  return request.validate({titles:[{id:"d:0",title:"项目知识工具"},{id:"c:0",title:"市场定位"}]});
 }};
 const fresh=await editWikiSessionTitles(session,ai,new AbortController().signal,"new");
 expect(fresh.title).toBe("项目知识工具");expect(fresh.wikiTitleReview?.status).toBe("ready");
 const existing=await editWikiSessionTitles(session,ai,new AbortController().signal,"suggest");
 expect(existing.title).toBe("第一章");expect(existing.wikiSuggestedTitle).toBe("项目知识工具");
 expect(existing.sections[2]).toEqual(session.sections[2]);expect(existing.evidence).toEqual(session.evidence);expect(session).toEqual(before);
});

it("batches large title lists, retains successful batches and reports a failed batch without dropping material",async()=>{
 const plan=Array.from({length:WIKI_TITLE_BATCH_SIZE*2+1},(_,i)=>({title:`范围${i}与条件`,group:"技术",question:`如何处理条件${i}？`,sectionIds:[`s${i}`]}));
 let calls=0,report:WikiTitleReview|undefined;
 const edits=await wikiTitleEdits(plan,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);expect(data.titles.length).toBeLessThanOrEqual(WIKI_TITLE_BATCH_SIZE);
  expect(request.maxOutputTokens).toBeLessThanOrEqual(2400);if(++calls===2)throw Error("timeout");
  return request.validate({titles:data.titles.map((item:{id:string})=>({id:item.id,title:`处理条件${item.id.split(":")[1]}`}))});
 }},new AbortController().signal,{onReport:value=>{report=value;}});
 expect(calls).toBe(3);expect(edits?.chapters.size).toBe(17);
 expect(report).toMatchObject({status:"partial",requested:33,accepted:17});expect(report?.rejected).toHaveLength(16);
 expect(plan.every(page=>page.title.endsWith("与条件"))).toBe(true);
});

it("preserves meaningful compounds explicitly and protects titles that collide with personal pages",async()=>{
 const session=projectSession();session.sections[0].title="范围与条件";
 session.sections.push({...session.sections[0],id:"mine",title:"保存机制",userEdited:true});
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"c:0",title:"保存机制"}]})};
 const result=await editWikiSessionTitles(session,ai,new AbortController().signal);
 expect(result.sections).toEqual(session.sections);expect(result.wikiTitleReview?.status).toBe("failed");
 const keep=await editWikiSessionTitles(session,{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"c:0",title:"范围与条件",keep:true,keepReason:"范围和条件共同界定同一操作的适用边界"}]})},new AbortController().signal);
 expect(keep.sections).toEqual(session.sections);expect(keep.wikiTitleReview?.status).toBe("ready");
});

it("retries failed title editing on an unchanged organized document without replanning its directory",async()=>{
 const session=projectSession();session.sections[0].title="保存与索引";
 const generateStructured=vi.fn().mockRejectedValueOnce(Error("offline")).mockImplementation(async(request:StructuredAIRequest<unknown>)=>request.validate({titles:[{id:"c:0",title:"本地存储"}]}));
 const ai={generateStructured:<T,>(request:StructuredAIRequest<T>)=>generateStructured(request as StructuredAIRequest<unknown>) as Promise<T>};
 const first=await autoOrganizeWiki(session,ai,new AbortController().signal);
 expect(first.wikiTitleReview?.status).toBe("failed");expect(first.sections).toEqual(session.sections);
 const second=await autoOrganizeWiki(first,ai,new AbortController().signal);
 expect(second.sections[0].title).toBe("本地存储");expect(second.wikiTitleReview?.status).toBe("ready");
 await autoOrganizeWiki(second,ai,new AbortController().signal);expect(generateStructured).toHaveBeenCalledTimes(2);
 for(const [request] of generateStructured.mock.calls)expect(JSON.parse(request.prompt).presentation).toBe("wiki_title_edit");
});

it("renames real subtopic headings while preserving the same text in code and quotes",()=>{
 const page={title:"页面",group:"技术",question:"机制",sectionIds:["s"],subtopics:[{title:"保存与索引",question:"机制",sectionIds:["s"]}]};
 const body="## 保存与索引\n\n```md\n## 保存与索引\n```\n\n> ## 保存与索引\n\n原文保存与索引。";
 expect(renameWikiHeadings(body,page,{...page,subtopics:[{...page.subtopics[0],title:"本地存储"}]})).toBe(body.replace(/^## 保存与索引/u,"## 本地存储"));
});

it("propagates cancellation and never treats it as a completed title review",async()=>{
 const session=projectSession();session.sections[0].title="保存与索引";const controller=new AbortController();
 await expect(editWikiSessionTitles(session,{generateStructured:async()=>{controller.abort();throw controller.signal.reason;}},controller.signal)).rejects.toThrow();
 expect(session.wikiTitleReview).toBeUndefined();
});

it("clears an old name suggestion when the current full-outline review explicitly retains the saved name",async()=>{
 const session=projectSession();session.wikiSuggestedTitle="过时的建议";
 const result=await editWikiSessionTitles(session,{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"d:0",title:session.title,keep:true,keepReason:"范围和条件共同界定同一操作的适用边界"}]})},new AbortController().signal,"suggest");
 expect(result.title).toBe(session.title);expect(result.wikiSuggestedTitle).toBeUndefined();expect(result.wikiTitleReview?.status).toBe("ready");
});

it("edits generated names independently of personal group and diagram edits while protecting personal titles",async()=>{
 const session=projectSession(),base=session.sections[0];
 session.sections=[{...base,title:"存储与索引",wikiGroup:"我的分类",wikiGroupEdited:true,structureEdited:true},{...base,id:"title",title:"我的标题与命名",wikiDisplayTitle:"我的标题与命名"}];
 const result=await editWikiSessionTitles(session,{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);expect(data.titles.map((item:{id:string})=>item.id)).toEqual(["c:0"]);
  return request.validate({titles:[{id:"c:0",title:"本地存储"}]});
 }},new AbortController().signal);
 expect(result.sections[0]).toMatchObject({title:"本地存储",wikiGroup:"我的分类",wikiGroupEdited:true,structureEdited:true});expect(result.sections[1]).toEqual(session.sections[1]);
});
it("does not silently accept a generic keep flag without a scope justification",async()=>{
 const session=projectSession();session.sections[0].title="定位与竞品";
 const result=await editWikiSessionTitles(session,{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"c:0",title:"定位与竞品",keep:true}]})},new AbortController().signal);
 expect(result.wikiTitleReview).toMatchObject({status:"failed",policyVersion:3});
});

it("keeps a personal diagram beside the same subtopic after its generated heading is renamed",async()=>{
 const session=projectSession();session.sections[0]={...session.sections[0],body:"## 保存与索引\n\n保留消息",wikiSubtopics:[{title:"保存与索引",question:"如何保存"}],wikiDiagram:{afterHeading:"保存与索引",hidden:false}};
 const result=await editWikiSessionTitles(session,{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"s:0:0",title:"本地存储"}]})},new AbortController().signal);
 expect(result.sections[0].body).toContain("## 本地存储");expect(result.sections[0].wikiDiagram).toEqual({afterHeading:"本地存储",hidden:false});
 expect(session.sections[0].wikiDiagram?.afterHeading).toBe("保存与索引");
});
