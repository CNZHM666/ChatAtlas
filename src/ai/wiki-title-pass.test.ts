import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {applyWikiTitleEdits,pairedWikiTitle,renameWikiHeadings,vagueWikiTitle,wikiTitleEdits} from "./wiki-title-pass";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import type {DirectoryPage} from "./wiki-directory";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
// Single-subtopic fixtures exercise renaming; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

const plan:DirectoryPage[]=[
 {title:"搜索与书签",group:"产品与市场",question:"如何找回历史消息？",sectionIds:["a","b"],subtopics:[{title:"历史搜索与收藏",question:"如何找到并保存消息？",sectionIds:["a"]},{title:"导入与导出",question:"如何迁移数据？",sectionIds:["b"]}]},
 {title:"竞品对比",group:"产品与市场",question:"和谁竞争？",sectionIds:["c"],subtopics:[{title:"市场格局",question:"市场如何？",sectionIds:["c"]}]},
];

it("detects titles that pair subjects but keeps inseparable pairs and words that merely contain 与",()=>{
 for(const title of ["产品与市场","检索、索引","Search and bookmarks","上下文以及导出"])expect(pairedWikiTitle(title)).toBe(true);
 for(const title of ["导入与导出","参与流程","侧边栏","Import and export","找回历史消息"])expect(pairedWikiTitle(title)).toBe(false);
});

it("sends only paired titles and accepts each rename on its own merits",async()=>{
 const requests:StructuredAIRequest<unknown>[]=[];
 const edits=await wikiTitleEdits(plan,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  requests.push(request as StructuredAIRequest<unknown>);
  return request.validate({titles:[{id:"p:0",title:"产品定位"},{id:"c:0",title:"找回历史消息"},{id:"s:0:0",title:"搜索与收藏"},{id:"x:9",title:"未知"}]});
 }},new AbortController().signal);
 const sent=JSON.parse(requests[0].prompt).titles.map((item:{id:string;title:string})=>[item.id,item.title]);
 expect(sent).toEqual([["p:0","产品与市场"],["c:0","搜索与书签"],["s:0:0","历史搜索与收藏"]]);
 // A rename that is still paired keeps the planned title.
 expect(edits).toEqual({parts:new Map([["产品与市场","产品定位"]]),chapters:new Map([[0,"找回历史消息"]]),subtopics:new Map()});
 const applied=applyWikiTitleEdits(plan,edits!);
 expect(applied.map(page=>[page.title,page.group])).toEqual([["找回历史消息","产品定位"],["竞品对比","产品定位"]]);
 expect(applied[0].sectionIds).toEqual(plan[0].sectionIds);expect(applied[0].subtopics![1].title).toBe("导入与导出");
});

it("rejects renames that collide with a sibling, exceed the limit or repeat the original, and skips the request when nothing is paired",async()=>{
 const edits=await wikiTitleEdits(plan,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"p:0",title:"产品与市场"},{id:"c:0",title:"竞品对比"},{id:"s:0:0",title:"导入与导出"}]})},new AbortController().signal);
 expect(edits).toBeUndefined();
 const long=await wikiTitleEdits(plan,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>request.validate({titles:[{id:"c:0",title:"找".repeat(33)}]})},new AbortController().signal);
 expect(long).toBeUndefined();
 let calls=0;
 expect(await wikiTitleEdits([{...plan[1],group:"竞品"}],"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{calls++;return request.validate({titles:[]});}},new AbortController().signal)).toBeUndefined();
 expect(calls).toBe(0);
});

it("renames only exact level-two subtopic headings in written prose",()=>{
 const after=applyWikiTitleEdits(plan,{parts:new Map(),chapters:new Map(),subtopics:new Map([["0:0","找回与收藏消息"]])});
 const body="开头提到历史搜索与收藏。\n\n## 历史搜索与收藏\n\n正文。\n\n### 历史搜索与收藏\n\n## 导入与导出\n\n迁移。";
 expect(renameWikiHeadings(body,plan[0],after[0])).toBe("开头提到历史搜索与收藏。\n\n## 找回与收藏消息\n\n正文。\n\n### 历史搜索与收藏\n\n## 导入与导出\n\n迁移。");
});

const run=async(rename:(request:StructuredAIRequest<unknown>)=>unknown)=>{
 const id=crypto.randomUUID(),source:Conversation={id,title:"历史搜索",platform:"chatgpt",url:"",updatedAt:1,messageCount:1};
 const passages=transcriptPassages(source,[{id,conversationId:id,role:"user",messageIndex:0,content:"用户用一句话描述就能找回当时的消息，并可以收藏。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 const writes:string[]=[];
 const ai={canReuseProjectKnowledge:true,getAnalysisKey:async()=>id,
  generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt);
   if(data.presentation==="wiki_title_edit")return rename(request as StructuredAIRequest<unknown>) as T;
   return request.validate({scope:[], pages:[{title:"搜索与书签",group:"产品与市场",subtopics:[{title:"历史搜索与收藏",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});
  },
  synthesize:async<T,>(request:StructuredAIRequest<T>)=>{
   const data=JSON.parse(request.prompt),ids=data.passages.map((item:{id:string})=>item.id);
   if(!data.coverage.final)return request.validate({title:"笔记",sections:[{title:"历史搜索",body:"用户用一句话描述就能找回当时的消息，并可以收藏。",kind:"finding",transition:"",evidenceIds:ids}]});
   writes.push(request.prompt);const topic=data.wikiTopics[0];
   return request.validate({title:"项目",sections:[{title:topic.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",body:topic.subtopics.map((child:{title:string})=>`## ${child.title}\n\n用户用一句话描述就能找回当时的消息，并可以收藏。`).join("\n\n"),evidenceIds:ids}]});
  }};
 const result=await synthesizeCoveredFocus({goal:"复习找回方式",mode:"work",locale:"zh-CN",sources:[source],passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 return {section:result.result.sections[0],writes};
};

it("applies accepted renames to the saved chapter while writing keeps the planned titles",async()=>{
 const {section,writes}=await run(request=>request.validate({titles:[{id:"p:0",title:"产品定位"},{id:"c:0",title:"找回历史消息"},{id:"s:0:0",title:"一句话找回"}]}));
 expect(writes.length).toBeGreaterThan(0);expect(writes.every(prompt=>prompt.includes("历史搜索与收藏"))).toBe(true);
 expect([section.title,section.wikiGroup,section.wikiSubtopics?.map(child=>child.title)]).toEqual(["找回历史消息","产品定位",["一句话找回"]]);
 expect(section.body).toContain("## 一句话找回");expect(section.body).not.toContain("## 历史搜索与收藏");
});

it("keeps the planned titles when the rename request fails",async()=>{
 const {section}=await run(()=>{throw new Error("provider unavailable");});
 expect([section.title,section.wikiGroup]).toEqual(["搜索与书签","产品与市场"]);expect(section.body).toContain("## 历史搜索与收藏");
});

it("records why paired titles were kept, by rejection reason",async()=>{
 const {getDatabase}=await import("../storage/db"),runId=crypto.randomUUID();
 const ai={generateStructured:async<T,>(request:StructuredAIRequest<T>):Promise<T>=>{const data=JSON.parse(request.prompt);return request.validate({titles:data.titles.map((item:{id:string;title:string})=>({id:item.id,title:item.title}))});}};
 let report:{rejected:Array<{reason:string}>}|undefined;
 await wikiTitleEdits(plan,"zh-CN",ai,new AbortController().signal,{runId,onReport:value=>{report=value;}});
 // The real reason survives the re-check of accepted rows.
 // Missing keep justification remains an editorial refusal for every title kind.
 expect(report!.rejected.map(item=>item.reason)).toEqual(["unchanged","unchanged","unchanged"]);
 const span=(await (await getDatabase()).get("organizationRuns",runId))!.pipelineSpans!.find(item=>item.phase==="wiki:title-editing")!;
 expect(span.counts).toMatchObject({requested:3,accepted:0,rejected:3,rejected_unchanged:3});
});

it("rejects generic labels without rejecting short concrete subjects",()=>{
 for(const title of ["发布","架构","界面","条件0"])expect(vagueWikiTitle(title)).toBe(true);
 for(const title of ["产品定位","开源发布策略","Wiki 目录","Reader","MCP","零件盒","验证码","元件库"])expect(vagueWikiTitle(title)).toBe(false);
});

it("requests title batches in parallel and still refuses a name an earlier batch already took",async()=>{
 // Twenty paired chapters make two batches of sixteen and four.
 const pages:DirectoryPage[]=Array.from({length:20},(_,index)=>({title:`检索${index}与同步${index}`,group:"",question:`第${index}章负责什么？`,sectionIds:[`m${index}`],subtopics:[{title:`机制${index}`,question:"哪些条件？",sectionIds:[`m${index}`]}]}));
 let active=0,peak=0,batch=0;
 const edits=await wikiTitleEdits(pages,"zh-CN",{generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const ids=(JSON.parse(request.prompt).titles as Array<{id:string}>).map(item=>item.id),first=batch++===0;
  active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,5));active--;
  // Both batches propose 消息检索 for their first chapter.
  return request.validate({titles:ids.map((id,index)=>({id,title:index===0?"消息检索":`${first?"甲":"乙"}主题${id.slice(2)}`}))});
 }},new AbortController().signal);
 expect(peak).toBe(2);
 expect(edits?.chapters.get(0)).toBe("消息检索");expect(edits?.chapters.get(16)).toBeUndefined();
 expect(edits?.chapters.get(17)).toBe("乙主题17");
});
