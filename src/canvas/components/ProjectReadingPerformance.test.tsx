import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DocumentOverview } from "./DocumentOverview";
import { KnowledgeLedger } from "./KnowledgeLedger";
import { WikiDocument } from "./WikiDocument";
import { ProjectReadingCacheContext } from "../project-reading-cache";
import { createProjectReadingCache } from "../../shared/project-reading-cache";
import * as overview from "../../shared/project-overview";
import * as knowledge from "../../shared/project-knowledge-view";
import { contextKnowledge } from "../../test/context-fixture";
import { useWikiPageReading } from "../hooks/useWikiPageReading";
import { projectWikiPages } from "../project-wiki-pages";
import { wikiOverviewSignature } from "../../shared/wiki-overview";

afterEach(()=>{cleanup();vi.restoreAllMocks();vi.unstubAllGlobals();});
it("shares overview work between parent and intro and retains checked chapter results across navigation",()=>{
 const overviewBuild=vi.spyOn(overview,"projectOverviewContent"),chapterBuild=vi.spyOn(knowledge,"projectKnowledgeReadingContext");
 function Workspace(){
  const [cache]=useState(createProjectReadingCache),[session,setSession]=useState(()=>contextKnowledge().session),[page,setPage]=useState("overview");
  const move=(next:string)=>{setPage(next);setSession(current=>({...current,activeSectionId:current.sections[0].id,visitedSectionIds:[next],updatedAt:Date.now()}));};
  return <ProjectReadingCacheContext.Provider value={cache}>
   <button onClick={()=>move("overview")}>总览页</button><button onClick={()=>move("wiki")}>Wiki 页</button>
   <button onClick={()=>setSession(current=>({...current,sections:current.sections.map((section,index)=>index?section:{...section,body:"用户修改后的正文。"})}))}>修改正文</button>
   {page==="overview"?<DocumentOverview session={session} zh onRead={()=>{}} onLocate={()=>{}}/>:<WikiDocument session={session} section={session.sections[0]} zh structure={null} onCurrent={()=>{}} onLocate={()=>{}}/>}
  </ProjectReadingCacheContext.Provider>;
 }
 render(<Workspace/>);
 fireEvent.click(screen.getByText("Wiki 页"));fireEvent.click(screen.getByText("总览页"));fireEvent.click(screen.getByText("Wiki 页"));
 expect(overviewBuild).toHaveBeenCalledOnce();expect(chapterBuild).toHaveBeenCalledOnce();
 fireEvent.click(screen.getByText("修改正文"));
 expect(chapterBuild).toHaveBeenCalledTimes(2);expect(screen.getByText("用户修改后的正文。")).toBeVisible();
});

it("switches immediately during background loading and reuses one result for both pages",async()=>{
 const session=contextKnowledge().session;
 const savedText="该工作区整理本地检索及其使用边界。";
 session.wikiOverview={version:1,text:savedText,signature:wikiOverviewSignature(session),evidenceIds:[]};
 session.wikiKnowledge={version:1,generatedAt:1,status:"complete",materials:1,batches:[{
  sourceIds:["e-db"],status:"ok",rejected:{},units:[{id:"db",subject:"索引",statement:"索引使用 Orama。",kind:"mechanism",
   details:[],adoption:{status:"proposal"},delivery:"unknown",evidence:{evidenceId:"e-db",role:"assistant",pasted:false,conversationId:"c",messageId:"m-db",messageIndex:0,quote:"索引使用 Orama。"}}],
 }],organization:{version:1,generatedAt:1,status:"complete",report:{},subjects:[{id:"s",name:"索引",aliases:[],unitIds:["db"]}],
  relations:[],merged:[],chapters:[{id:"db",title:"索引实现",question:"",group:"",subtopics:[{title:"技术",subjectIds:["s"]}]}]}};
 const workers:TestWorker[]=[];
 class TestWorker {
  constructor(){workers.push(this);}
  postMessage=vi.fn();
  terminate=vi.fn();
  onmessage?: (event:{data:ReturnType<typeof projectWikiPages>})=>void;
 }
 vi.stubGlobal("Worker",TestWorker);
 function Workspace(){
  const [current,setCurrent]=useState(session),[ledger,setLedger]=useState(false);
  const reading=useWikiPageReading(current,true);
  const switchPage=(next:boolean)=>{setCurrent({...current,updatedAt:current.updatedAt+1});setLedger(next);};
  return <><button onClick={()=>switchPage(false)}>查看总览</button><button onClick={()=>switchPage(true)}>查看账本</button>
   {ledger?<KnowledgeLedger session={current} zh pageReading={reading} onLocate={()=>{}}/>
    :<DocumentOverview session={current} zh pageReading={reading} onRead={()=>{}} onLocate={()=>{}}/>}</>;
 }
 render(<Workspace/>);
 expect(screen.getByText(savedText)).toBeVisible();
 expect(screen.queryByText("正在加载总览内容…")).toBeNull();
 fireEvent.click(screen.getByText("查看账本"));
 expect(screen.getByText("正在加载知识点…")).toBeVisible();
 expect(workers).toHaveLength(1);
 expect(workers[0].postMessage).toHaveBeenCalledWith({session,target:"pages",zh:true});
 await act(async()=>workers[0].onmessage?.({data:projectWikiPages(session,true)}));
 expect(screen.getByText("索引实现")).toBeVisible();
 expect(screen.queryByText("索引使用 Orama。")).toBeNull();
 fireEvent.click(screen.getByText("索引实现"));
 expect(screen.getByText("索引使用 Orama。")).toBeVisible();
 fireEvent.click(screen.getByText("查看总览"));
 expect(screen.queryByText("正在加载总览内容…")).toBeNull();
 fireEvent.click(screen.getByText("查看账本"));
 expect(screen.queryByText("正在加载知识点…")).toBeNull();
 expect(workers).toHaveLength(1);

 cleanup();
 render(<Workspace/>);
 fireEvent.click(screen.getByText("查看账本"));
 expect(screen.queryByText("正在加载知识点…")).toBeNull();
 expect(screen.getByText("索引实现")).toBeVisible();
 expect(workers).toHaveLength(1);
});
