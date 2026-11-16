import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { DocumentOverview } from "./DocumentOverview";
import { WikiDocument } from "./WikiDocument";
import { ProjectReadingCacheContext } from "../project-reading-cache";
import { createProjectReadingCache } from "../../shared/project-reading-cache";
import * as overview from "../../shared/project-overview";
import * as knowledge from "../../shared/project-knowledge-view";
import { contextKnowledge } from "../../test/context-fixture";

afterEach(()=>{cleanup();vi.restoreAllMocks();});
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
