import { useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { WikiDiagram } from "./WikiDiagram";
import { generateUnderstanding } from "../../ai/understanding-analysis";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { projectSession } from "../../test/project-fixture";
import type { FocusSession } from "../../shared/focus-session";
// Internal engine coverage explicitly opts into the experimental feature.
const feature=vi.hoisted(()=>({enabled:true}));
vi.mock("../../shared/release-features",()=>({get PROJECT_ARCHITECTURE_GENERATION_ENABLED(){return feature.enabled;}}));
vi.mock("../../ai/understanding-analysis",()=>({generateUnderstanding:vi.fn()}));
vi.mock("./FocusChapterPath",()=>({FocusChapterPath:({headerActions}:{headerActions?:ReactNode})=> <div><span>Saved chapter diagram</span>{headerActions}</div>}));
afterEach(()=>{cleanup();vi.clearAllMocks();feature.enabled=true;});
const generated=(session:FocusSession):Awaited<ReturnType<typeof generateUnderstanding>>=>({...session,structureAnalysis:{status:"ready",version:6},sections:session.sections.map(section=>({...section,semanticStructure:{nodes:[{key:"input",title:"输入",description:"用户需求",quote:"原句",status:"discussed",evidenceIds:["e1"]},{key:"plan",title:"计划",description:"生成计划",quote:"原句",status:"proposal",evidenceIds:["e1"]}],relations:[{from:"input",to:"plan",kind:"flow",label:"需求与约束",quote:"需求传递给计划",status:"supported",evidenceIds:["e1"]}]}}))});
it("generates only after confirmation, saves to the existing chapter and reuses its cached graph",async()=>{
 let stored=projectSession();const prose=stored.sections[0].body;vi.mocked(generateUnderstanding).mockImplementation(async session=>generated(session));
 function Harness(){const[session,setSession]=useState(stored);return <ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:vi.fn(),save:async update=>{stored=update(stored);setSession(stored);}}}><WikiDiagram section={session.sections[0]} session={session} zh onLocate={vi.fn()}/></ProjectKnowledgeActions.Provider>;}
 const view=render(<Harness/>);expect(generateUnderstanding).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"生成图解"}));expect(generateUnderstanding).not.toHaveBeenCalled();fireEvent.click(screen.getByRole("button",{name:"确认生成图解"}));
 await screen.findByText("Saved chapter diagram");expect(generateUnderstanding).toHaveBeenCalledOnce();expect(stored.sections[0].body).toBe(prose);expect(stored.sections[0].wikiDiagram?.hidden).toBe(false);expect(stored.evidence).toEqual(projectSession().evidence);
 expect(vi.mocked(generateUnderstanding).mock.calls[0][3]).toEqual({forceSectionIds:[stored.sections[0].id]});
 view.unmount();render(<Harness/>);expect(screen.getByText("Saved chapter diagram")).toBeVisible();expect(generateUnderstanding).toHaveBeenCalledOnce();
});
it.each(["no-sources","request-failed","review-failed","budget-exceeded"] as const)("distinguishes %s from unsupported content and preserves existing chapters",async issue=>{
 const original=projectSession(),before=structuredClone(original),save=vi.fn();
 vi.mocked(generateUnderstanding).mockResolvedValue({sections:original.sections,structureAnalysis:{status:"failed",version:5},chapterIssues:{[original.sections[0].id]:issue}});
 render(<ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:vi.fn(),save}}><WikiDiagram section={original.sections[0]} session={original} zh onLocate={vi.fn()}/></ProjectKnowledgeActions.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"生成图解"}));fireEvent.click(screen.getByRole("button",{name:"确认生成图解"}));
 const alert=await screen.findByRole("alert");expect(alert).not.toHaveTextContent("资料不足");expect(alert).toHaveTextContent(issue==="no-sources"?"尚未关联来源":issue==="request-failed"?"生成请求未完成":issue==="review-failed"?"依据校验未完成":"超出分析额度");expect(save).not.toHaveBeenCalled();expect(original).toEqual(before);
 expect(screen.getByRole("button",{name:"确认生成图解"})).toBeEnabled();
});
it("retains the draft and rejects generation if the current chapter changed before saving",async()=>{
 let stored=projectSession();const original=structuredClone(stored);vi.mocked(generateUnderstanding).mockResolvedValue(generated(original));
 render(<ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:vi.fn(),save:async update=>{stored={...stored,sections:stored.sections.map(section=>({...section,body:"User changed this chapter"}))};stored=update(stored);}}}><WikiDiagram section={original.sections[0]} session={original} zh onLocate={vi.fn()}/></ProjectKnowledgeActions.Provider>);
 fireEvent.click(screen.getByRole("button",{name:"生成图解"}));fireEvent.click(screen.getByRole("button",{name:"确认生成图解"}));await waitFor(()=>expect(screen.getByRole("alert")).toHaveTextContent("章节或来源已变化"));expect(stored.sections[0].semanticStructure).toBeUndefined();expect(stored.sections[0].body).toBe("User changed this chapter");
});

it.each([true,false])("shows the experimental notice without generating or saving (Chinese: %s)",zh=>{
 feature.enabled=false;const session=projectSession(),before=structuredClone(session),save=vi.fn();
 render(<ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:vi.fn(),save}}><WikiDiagram section={session.sections[0]} session={session} zh={zh} onLocate={vi.fn()}/></ProjectKnowledgeActions.Provider>);
 fireEvent.click(screen.getByRole("button",{name:zh?"生成图解":"Generate diagram"}));
 expect(screen.getByRole("heading",{name:zh?"架构图测试中":"Architecture diagrams are experimental"})).toBeVisible();
 expect(screen.queryByRole("combobox")).toBeNull();expect(generateUnderstanding).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();expect(session).toEqual(before);
 fireEvent.click(screen.getByRole("button",{name:zh?"知道了":"Got it"}));expect(screen.queryByRole("dialog")).toBeNull();
});
it("still displays and edits a saved diagram while generation is experimental",()=>{
 feature.enabled=false;const session=projectSession();session.sections=generated(session).sections;
 render(<ProjectKnowledgeActions.Provider value={{read:vi.fn(),matter:vi.fn(),save:vi.fn()}}><WikiDiagram section={session.sections[0]} session={session} zh onLocate={vi.fn()}/></ProjectKnowledgeActions.Provider>);
 expect(screen.getByText("Saved chapter diagram")).toBeVisible();fireEvent.click(screen.getByRole("button",{name:"修改图解"}));expect(screen.getByRole("button",{name:"保存位置"})).toBeVisible();expect(generateUnderstanding).not.toHaveBeenCalled();
});
