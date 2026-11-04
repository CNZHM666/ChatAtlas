import { expect,it } from "vitest";
import { projectSession,projectText } from "../test/project-fixture";
import { evolutionRecords,mergeEvolutionReview,evolutionEdit,evolutionReviewOperations } from "./product-evolution";
import type { ProjectHistoryAnalysis } from "./project-history";
import { validateProjectState } from "./project-state";
const event={id:"history:choice",title:"选择操作计划",version:"",before:"",after:"使用操作计划",reason:"",status:"documented" as const,quote:"先验证核心流程",evidenceIds:["e1"],beforeQuote:"",beforeEvidenceIds:[]};
it("keeps unnumbered events and separate version results, while personal edits lose original proof",()=>{
 const session=projectSession();session.projectHistoryAnalysis={version:5,kind:"releases",events:[{...event,version:"v0.1"}],evidence:session.evidence,sources:[],signature:"old",sourceSignature:"old",generatedAt:1};
 session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[event],evidence:session.evidence,sources:[],signature:"new",sourceSignature:"new",generatedAt:2};
 expect(evolutionRecords(session)[0].event.version).toBe("");session.projectMaintenance={evolutionEvents:{[event.id]:{updatedAt:3,edited:{...evolutionEdit(event),after:"个人选择新执行器",decisionStatus:"confirmed"}}}};
 expect(evolutionRecords(session)[0]).toMatchObject({personal:true,sources:[],event:{quote:"",evidenceIds:[],after:"个人选择新执行器"},original:{after:event.after}});expect(session.projectHistoryAnalysis.events[0].version).toBe("v0.1");
});
it("adopts only selected changes and keeps distinct raw snapshots for retained events",()=>{
 const session=projectSession(),old:ProjectHistoryAnalysis={version:6,kind:"evolution",events:[event,{...event,id:"retained"}],evidence:session.evidence,sources:[],signature:"old",sourceSignature:"old",generatedAt:1};session.projectEvolutionAnalysis=old;
 const draft={...old,events:[{...event,after:"新方案"},{...event,id:"ignored"}],generatedAt:2};const merged=mergeEvolutionReview(session,draft,[event.id]);
 expect(merged.events).toHaveLength(3);expect(merged.events[0].after).toBe(event.after);expect(merged.events[2].evidenceIds).toEqual(["evolution:2:e1"]);expect(merged.events[1].evidenceIds).toEqual(["e1"]);expect(old.events[0].after).toBe(event.after);
});
it("requires a grounded original user report for completion and release instead of a label",()=>{
 const session=projectSession(),raw={id:"e1",text:projectText,conversationId:"source",messageId:"message",role:"assistant",messageIndex:0};const state={summary:"项目",modules:[],relations:[],decisions:[],constraints:[],actions:[],history:[{...event,workStatus:"released",workQuote:"先验证核心流程",workEvidenceIds:["e1"]}]};
 expect(()=>validateProjectState(state,[raw],session)).toThrow("original user report");expect(()=>validateProjectState({...state,history:[{...event,workStatus:"reported_complete"}]},[{...raw,role:"user"}],session)).toThrow();
 const result=validateProjectState({...state,history:[{...event,workStatus:"unknown"}]},[raw],session);expect(result.history?.[0].workStatus).toBe("unknown");
});
it("locates the actual event proof rather than an unrelated message introduction",()=>{
 const session=projectSession();session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[event],evidence:[{...session.evidence[0],excerpt:"无关的开篇介绍"}],sources:[],signature:"s",sourceSignature:"s",generatedAt:1};
 expect(evolutionRecords(session)[0].sources[0].excerpt).toBe(event.quote);expect(session.projectEvolutionAnalysis.evidence[0].excerpt).toBe("无关的开篇介绍");
});
it("applies presentation corrections only through review and keeps personal edits and evidence intact",()=>{
 const session=projectSession();session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[{...event,after:"Use operation plans",decisionStatus:"confirmed"}],evidence:session.evidence,sources:[],signature:"s",sourceSignature:"s",generatedAt:1};
 const translated={...session.projectEvolutionAnalysis.events[0],after:"采用操作计划"};
 const draft={...session.projectEvolutionAnalysis,events:[translated],generatedAt:2,presentationChanges:[event.id]};
 expect(evolutionReviewOperations(session,draft)).toMatchObject([{savedId:event.id,kind:"evidence"}]);
 expect(session.projectEvolutionAnalysis.events[0].after).toBe("Use operation plans");
 const applied=mergeEvolutionReview(session,draft,[event.id]);expect(applied.events).toHaveLength(1);expect(applied.events[0]).toMatchObject({after:"采用操作计划",quote:event.quote,decisionStatus:"confirmed"});
 session.projectMaintenance={evolutionEvents:{[event.id]:{updatedAt:3,edited:{...evolutionEdit(event),after:"个人修改的方案"}}}};
 const personal=mergeEvolutionReview(session,draft,[event.id]);expect(personal.events[0].after).toBe("Use operation plans");expect(session.projectMaintenance.evolutionEvents?.[event.id].edited?.after).toBe("个人修改的方案");
});
it("marks a removed message or changed message role as stale rather than preserving valid-looking proof",()=>{
 const session=projectSession();session.projectEvolutionAnalysis={version:6,kind:"evolution",events:[event],evidence:session.evidence,sources:[{id:"e1",conversationId:"source",messageId:"message",role:"user",messageIndex:0,signature:"old"}],signature:"s",sourceSignature:"s",generatedAt:1};
 session.sourceSignatures={source:{}};expect(evolutionRecords(session)[0].sourceStale).toBe(true);
 session.sourceSignatures={source:{message:"old"}};session.sourceRoles={source:{message:"assistant"}};expect(evolutionRecords(session)[0].sourceStale).toBe(true);
});
