import {withWikiOutline} from "../test/wiki-outline-fixture";
import {expect,it,vi} from "vitest";
import {projectSession} from "../test/project-fixture";
import {autoOrganizeWiki} from "./wiki-auto-organize";
import type {AtlasAIProvider,StructuredAIRequest} from "./provider";
const signal=()=>new AbortController().signal;
it("reduces 47 fragments to owning chapters without dropping prose or rerunning an unchanged catalogue",async()=>{
 const session=fixture(),base=session.sections[0];
 session.sections=Array.from({length:47},(_,i)=>({...base,id:`fragment-${i}`,title:`设计片段${i}`,body:`特有条件${i}必须保留。`,evidenceIds:[`e${i}`],claims:[]}));
 let calls=0;
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  calls++;const items=JSON.parse(request.prompt).sections as Array<{id:string}>;
  const ids=items.map(item=>item.id);
  return request.validate({pages:[{title:"系统设计",group:"",question:"系统如何运行？",sectionIds:ids,subtopics:[{title:"具体机制",question:"有哪些条件？",sectionIds:ids}]}]});
 }};
 const result=await autoOrganizeWiki(session,ai,signal());
 expect(result.sections).toHaveLength(1);
 for(let i=0;i<47;i++){expect(result.sections[0].body).toContain(`特有条件${i}必须保留。`);expect(result.sections[0].evidenceIds).toContain(`e${i}`);}
 expect(calls).toBeGreaterThan(1);const previousCalls=calls;
 expect((await autoOrganizeWiki(result,ai,signal())).sections).toEqual(result.sections);
 expect(calls).toBe(previousCalls);expect(session.sections).toHaveLength(47);
});
it("applies clearer singleton names without forcing a merge or touching personal titles",async()=>{
 const session=fixture();session.sections[2].userEdited=true;session.sections[0].title="技术架构与索引维护";session.sections[1].title="界面设计与键盘导航";
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{const items=JSON.parse(request.prompt).sections;return request.validate(withWikiOutline({pages:[{title:"索引维护",group:"技术架构",question:"如何更新索引？",sectionIds:[items[0].id]},{title:"键盘导航",group:"产品设计",question:"如何使用键盘？",sectionIds:[items[1].id]}]}));}};
 const result=await autoOrganizeWiki(session,ai,signal());expect(result.sections.map(section=>section.title)).toEqual(["索引维护","键盘导航","存储"]);expect(result.sections.map(section=>section.body)).toEqual(session.sections.map(section=>section.body));expect(result.wikiOrganization).toMatchObject({version:6,status:"organized",mergedSections:0});expect(result.sections[2]).toEqual(session.sections[2]);
});
function fixture(){
 const session=projectSession(),base=session.sections[0];
 session.sections=[{...base,id:"layout",title:"界面布局",body:"搜索框放在顶部。\n\n本地优先。",evidenceIds:["e1"]},{...base,id:"navigation",title:"导航交互",body:"本地优先。\n\n键盘可返回目录。",evidenceIds:["e2"]},{...base,id:"storage",title:"存储",body:"原始消息不可覆盖。",evidenceIds:["e3"]}];
 session.activeSectionId="navigation";session.sectionNotes={navigation:{text:"保留键盘操作",evidenceIds:["e2"],updatedAt:2}};
 session.sections[0].claims=[{text:"布局建议",quote:"搜索框放在顶部",evidenceIds:["e1"]}];
 return session;
}
it("automatically organizes the final directory with a compact directory and lossless block organization, retaining text, claims, notes, aliases and undo",async()=>{
 const session=fixture(),before=structuredClone(session),calls=vi.fn();
 const ai:Pick<AtlasAIProvider,"generateStructured">={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls(request);const data=JSON.parse(request.prompt);if(data.presentation==="wiki_title_edit")return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({...item,keep:true,keepReason:"布局和导航是同一用户交互表面的完整范围"}))});if(data.presentation==="wiki_topic_content")return request.validate(withWikiOutline({parts:[{heading:"布局和操作",blockIds:data.blocks.map((block:{id:string})=>block.id)}]}));return request.validate(withWikiOutline({pages:[{title:"界面与导航",group:"体验",question:"如何布局及导航？",sectionIds:[data.sections[1].id,data.sections[0].id]},{title:"存储",group:"技术",question:"如何存储？",sectionIds:[data.sections[2].id]}]}));}};
 const next=await autoOrganizeWiki(session,ai,signal());
 expect(next.sections).toHaveLength(2);expect(next.sections[0].id).toBe("layout");expect(next.sections[0].body).toContain("键盘可返回目录。");expect(next.sections[0].body.match(/本地优先。/gu)).toHaveLength(1);expect(next.sections[0].claims).toEqual(before.sections[0].claims);
 expect(next.sectionNotes?.layout.text).toBe("保留键盘操作");expect(next.activeSectionId).toBe("layout");expect(next.wikiSectionAliases?.navigation).toBe("layout");expect(next.wikiMergeHistory?.[0].sections).toEqual(before.sections);expect(next.evidence).toEqual(before.evidence);expect(session).toEqual(before);
 // The kept paired title is challenged once; the second keep, with its reason, stands.
 expect(calls).toHaveBeenCalledTimes(3);expect(JSON.parse(calls.mock.calls[0][0].prompt).sections[0].body).toBeUndefined();expect(next.wikiOrganization?.status).toBe("organized");
 await autoOrganizeWiki(next,ai,signal());expect(calls).toHaveBeenCalledTimes(3);
});
it("never reorganizes personal pages or pending personal revisions, nor review-mode documents",async()=>{
 const session=fixture();session.sections[0].userEdited=true;session.wikiSuggestions={navigation:{...session.sections[1],body:"待采用"}};const ai={generateStructured:vi.fn()};
 expect((await autoOrganizeWiki(session,ai,signal())).sections).toEqual(session.sections);expect(await autoOrganizeWiki({...fixture(),mode:"review"},ai,signal())).toMatchObject({mode:"review"});expect(ai.generateStructured).not.toHaveBeenCalled();
});
it("falls back to exact duplicate ownership without losing text when the model fails, and exposes incompleteness",async()=>{
 const session=fixture();session.sections[1].title=session.sections[0].title;const ai={generateStructured:vi.fn().mockRejectedValue(Error("offline"))};
 const next=await autoOrganizeWiki(session,ai,signal());expect(next.sections).toHaveLength(2);expect(next.sections[0].body).toContain("键盘可返回目录。");expect(next.wikiDirectoryReview?.status).toBe("pending");expect(next.wikiOrganization?.status).toBe("deferred");
});
it("groups one subject while retaining proposal status and cancellation",async()=>{
 const session=fixture();session.sections[1].kind="proposal";
 const ai:Pick<AtlasAIProvider,"generateStructured">={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate(withWikiOutline({pages:[{title:"合并",group:"",question:"同一个？",sectionIds:JSON.parse(request.prompt).sections.map((section:{id:string})=>section.id)}]}))};
 const mixed=await autoOrganizeWiki(session,ai,signal());expect(mixed.sections).toHaveLength(1);expect(mixed.sections[0].kind).toBe("review");expect(mixed.sections[0].body).toContain("Proposal");expect(mixed.sections[0].body).toContain("键盘可返回目录。");
 const controller=new AbortController();controller.abort();await expect(autoOrganizeWiki(fixture(),ai,controller.signal)).rejects.toThrow();
});

it("reuses this generation's validated ownership without directory or per-chapter sorting calls",async()=>{
 const session=fixture();session.sections=session.sections.map((section,index)=>({...section,wikiOwnerId:index<2?"ui":"store",wikiQuestion:index<2?"如何操作？":"如何保存？"}));
 const ai={generateStructured:vi.fn().mockRejectedValue(Error("must not call"))};
 const result=await autoOrganizeWiki(session,ai,signal(),true);
 expect(ai.generateStructured).not.toHaveBeenCalled();expect(result.sections).toHaveLength(2);
 expect(result.sections[0].body).toContain("键盘可返回目录。");expect(result.sections[0].evidenceIds).toEqual(["e1","e2"]);
 expect(result.wikiMergeHistory?.[0].sections).toEqual(session.sections);
});
it("does not trust old owner IDs as a fresh directory plan",async()=>{
 const session=fixture();session.sections.forEach(section=>{section.wikiOwnerId=section.id;section.wikiQuestion=section.title;});
 const ai={generateStructured:vi.fn().mockRejectedValue(Error("offline"))};
 expect((await autoOrganizeWiki(session,ai,signal())).wikiOrganization?.status).toBe("deferred");expect(ai.generateStructured).toHaveBeenCalledTimes(1);
});

it("consolidates 24 generated chapters into six semantic owners without dropping details or sources",async()=>{
 const session=fixture(),base=session.sections[0];session.sectionNotes=undefined;
 const topics=["产品定位","技术架构","操作体验","发布准备","项目记忆","市场策略"];
 session.sections=Array.from({length:24},(_,index)=>({...base,id:`page${index}`,title:`${topics[index%6]}的讨论${index}`,body:`${topics[index%6]}。\n\n必须保留的独特条件${index}。`,evidenceIds:[`proof${index}`],claims:undefined}));
 session.evidence=session.sections.map((section,index)=>({id:`proof${index}`,conversationId:"source",messageId:`message${index}`,title:section.title,excerpt:`独特条件${index}`}));
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_content")return request.validate(withWikiOutline({parts:[{heading:"具体设计与条件",blockIds:data.blocks.map((block:{id:string})=>block.id)}]}));
  return request.validate(withWikiOutline({pages:topics.map(title=>({title,group:"项目",question:`${title}如何设计？`,sectionIds:data.sections.filter((section:{title:string})=>section.title.startsWith(title)).map((section:{id:string})=>section.id)}))}));
 }};
 const result=await autoOrganizeWiki(session,ai,signal());expect(result.sections).toHaveLength(6);expect(result.evidence).toEqual(session.evidence);expect(result.wikiOrganization).toMatchObject({status:"organized",mergedSections:18});
 for(let index=0;index<24;index++){const owner=result.sections.find(section=>section.title===topics[index%6])!;expect(owner.body).toContain(`必须保留的独特条件${index}。`);expect(owner.evidenceIds).toContain(`proof${index}`);}
 expect(result.wikiMergeHistory?.[0].sections).toEqual(session.sections);
});
