import {expect,it,vi} from "vitest";
import {reviseWikiChapters} from "./wiki-revision";
import type {AtlasAIProvider,StructuredAIRequest} from "./provider";
import {projectSession,projectText} from "../test/project-fixture";
import type {ConversationMessage} from "../shared/types";

const raw:ConversationMessage={id:"message",conversationId:"source",role:"user",content:projectText,messageIndex:0,preview:"",contentHash:"",createdAt:1,updatedAt:1};
function provider(){
 const generateStructured=vi.fn(async(request:StructuredAIRequest<unknown>)=>{
  const payload=JSON.parse(request.prompt);
  if(payload.presentation==="wiki_content_plan")return request.validate({chapters:payload.chapters.map((chapter:{id:string,title:string})=>({id:chapter.id,topics:[{title:chapter.title,topicIds:payload.topics.filter((topic:{chapterId:string})=>topic.chapterId===chapter.id).map((topic:{id:string})=>topic.id)}]}))});
  const chapter=payload.chapter;
  return request.validate({coveredTopicIds:payload.contentPlan?.topicIds,body:`${chapter.title}：先验证核心流程。`,claims:[{text:"先验证核心流程",quote:"先验证核心流程",evidenceIds:["e1"]}],structure:{nodes:[{key:"core",title:"核心流程",description:"先验证",status:"proposal",quote:"先验证核心流程",evidenceIds:["e1"]}],relations:[]}});
 });
 return {generateStructured,modelId:"fixture",capabilities:{maxConcurrency:2}} as unknown as AtlasAIProvider&{generateStructured:typeof generateStructured};
}
it("applies the shared title editor to selected-chapter revisions while preserving other generated chapters",async()=>{
 const session=projectSession();session.sections[0].title="方案与参数";
 session.sections.push({...session.sections[0],id:"other",title:"界面与布局",body:"未选中的正文"});
 const before=structuredClone(session),ai=provider();
 ai.generateStructured.mockImplementation(async(request:StructuredAIRequest<unknown>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_title_edit"){
   expect(data.titles.map((item:{title:string})=>item.title)).toEqual(["方案与参数"]);
   return request.validate({titles:[{id:"c:0",title:"核心流程"}]});
  }
  return request.validate({body:"先验证核心流程，再扩展功能。",claims:[{text:"先验证核心流程",quote:"先验证核心流程",evidenceIds:["e1"]}]});
 });
 const result=await reviseWikiChapters(session,["one"],[raw],"",ai,new AbortController().signal);
 expect(result.sections[0].title).toBe("核心流程");expect(result.sections[1]).toEqual(session.sections[1]);
 expect(result.wikiTitleReview?.status).toBe("ready");expect(session).toEqual(before);
});
it("revises only selected chapters and updates their understanding in the same calls, preserving original and personal content",async()=>{
 const session=projectSession();session.sections.push({...session.sections[0],id:"two",title:"Second"},{...session.sections[0],id:"personal",userEdited:true,body:"My exact text"});
 const before=structuredClone(session),ai=provider(),progress=vi.fn();
 const result=await reviseWikiChapters(session,["one","two","one"],[raw],"保留细节",ai,new AbortController().signal,progress);
 expect(ai.generateStructured).toHaveBeenCalledTimes(3);expect(progress).toHaveBeenLastCalledWith(2,2);
 expect(result.sections[0].semanticStructure?.nodes[0].title).toBe("核心流程");
 expect(result.sections[1].body).toContain("Second");expect(result.sections[2]).toBe(session.sections[2]);expect(session).toEqual(before);
 expect(JSON.stringify(ai.generateStructured.mock.calls)).not.toContain("My exact text");
});
it("preflights every selected chapter before paid calls and never publishes a partial or cancelled rewrite",async()=>{
 const session=projectSession(),ai=provider(),signal=new AbortController().signal;
 session.sections.push({...session.sections[0],id:"personal",userEdited:true},{...session.sections[0],id:"missing",evidenceIds:[]});
 for(const ids of [["one","personal"],["one","missing"],["unknown"],[]])await expect(reviseWikiChapters(session,ids,[raw],"",ai,signal)).rejects.toThrow();
 expect(ai.generateStructured).not.toHaveBeenCalled();
 const abort=new AbortController();abort.abort();await expect(reviseWikiChapters(session,["one"],[raw],"",ai,abort.signal)).rejects.toThrow();expect(ai.generateStructured).not.toHaveBeenCalled();
 ai.generateStructured.mockRejectedValueOnce(new Error("offline"));const before=structuredClone(session);
 await expect(reviseWikiChapters(session,["one"],[raw],"",ai,signal)).rejects.toThrow("offline");expect(session).toEqual(before);
});

it("keeps an older project's existing Brief when revising an unrelated chapter without purpose metadata",async()=>{
 const session=projectSession();session.brief={summary:"这是已有的项目背景。",confirmed:[],turningPoints:[],openQuestions:[]};
 const result=await reviseWikiChapters(session,["one"],[raw],"保留细节",provider(),new AbortController().signal);
 expect(result.brief).toBe(session.brief);expect(result.knowledgeViewVersion).toBeUndefined();
 const request=provider();await reviseWikiChapters(session,["one"],[raw],"",request,new AbortController().signal);
 expect(JSON.parse(request.generateStructured.mock.calls[0][0].prompt).editorialRequest).toContain("理顺章节归属");
});

it("merges complete redundant chapters into a preview with recoverable originals and remapped personal navigation",async()=>{
 const session=projectSession();session.sections.push({...session.sections[0],id:"two",title:"机制补充",body:"## 补充条件\n\n先验证核心流程"});
 session.activeSectionId="two";session.wikiOrder=["one","two"];session.visitedSectionIds=["two"];session.completedSectionIds=["one","two"];
 session.sectionNotes={two:{text:"我的补充笔记",evidenceIds:["e1"],updatedAt:1}};
 const before=structuredClone(session),ai=provider();
 ai.generateStructured.mockImplementation(async(request:StructuredAIRequest<unknown>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_content_plan")return request.validate({chapters:[{id:"one",title:"核心流程",topics:[{title:"操作规则",topicIds:data.topics.map((topic:{id:string})=>topic.id)}]}]});
  return request.validate({body:"## 操作规则\n\n先验证核心流程",claims:[{text:"先验证核心流程",quote:"先验证核心流程",evidenceIds:["e1"]}],coveredTopicIds:data.contentPlan.topicIds});
 });
 const result=await reviseWikiChapters(session,["one","two"],[raw],"合并重复内容",ai,new AbortController().signal);
 expect(ai.generateStructured).toHaveBeenCalledTimes(2);expect(result.sections).toHaveLength(1);
 expect(result.activeSectionId).toBe("one");expect(result.wikiOrder).toEqual(["one"]);expect(result.wikiSectionAliases?.two).toBe("one");expect(result.sectionNotes?.one.text).toBe("我的补充笔记");
 expect(result.wikiContentReview?.moves).toEqual([{fromId:"two",topicTitle:"补充条件",toId:"one"}]);
 expect(result.wikiMergeHistory?.at(-1)?.sections).toEqual(session.sections);expect(result.visitedSectionIds).toEqual(["one"]);expect(session).toEqual(before);
});
