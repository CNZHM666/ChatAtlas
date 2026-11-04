import { act,cleanup,renderHook,waitFor } from "@testing-library/react";
import { afterEach,expect,it,vi } from "vitest";
import { useOrganizationTasks } from "./useOrganizationTasks";
const {list,save}=vi.hoisted(()=>({list:vi.fn(),save:vi.fn()}));
vi.mock("../../storage/organization-runs",()=>({listOrganizationRuns:list,saveOrganizationRun:save}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
it("never queues or automatically dispatches project-analysis diagnostics on reload",async()=>{
 list.mockResolvedValue([{id:"analysis",title:"架构分析",status:"running",stage:"question_analysis",targetType:"conversation",targetIds:["c"],startedAt:1,updatedAt:1,progress:0,events:[],projectAnalysis:{kind:"architecture",sessionId:"p",phases:[],reusedRequests:0,reusedWikiSections:0}}]);
 const hook=renderHook(()=>useOrganizationTasks({conversations:[],conversationsReady:true,canvases:[],onKnowledgeProposal:vi.fn(),onApplied:vi.fn(),onError:vi.fn()}));
 await waitFor(()=>expect(list).toHaveBeenCalledOnce());await act(async()=>undefined);expect(hook.result.current.runs).toEqual([]);expect(save).not.toHaveBeenCalled();
});
