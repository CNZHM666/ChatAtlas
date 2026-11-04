import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {evolutionRecords,evolutionReviewOperations,mergeEvolutionReview} from "./product-evolution";
import type {ProjectHistoryAnalysis} from "./project-history";
import type {ProjectHistoryEvent} from "./project-state";
const event:ProjectHistoryEvent={id:"plan",title:"采用操作计划",area:"执行方式",version:"",changeKind:"adopt",decisionStatus:"confirmed",status:"documented",after:"AI 生成计划，由执行器执行",before:"",reason:"",quote:"改成操作计划后执行。",evidenceIds:["p"],beforeQuote:"",beforeEvidenceIds:[]};
function analysis(events:ProjectHistoryEvent[],message="m1"):ProjectHistoryAnalysis{return {version:6,kind:"evolution",signature:"scope",sourceSignature:"originals",generatedAt:1,events,evidence:[{id:"p",conversationId:"c",messageId:message,title:"原始讨论",excerpt:message,sourceSignature:message}],sources:[{id:"p",conversationId:"c",messageId:message,signature:message,role:"user",messageIndex:0,discussedAt:1}]};}
it("adds cross-conversation corroboration without replacing the original text or applying a batch twice",()=>{
 const session=projectSession();session.projectEvolutionAnalysis=analysis([event]);
 const draft=analysis([{...event,id:"another",quote:"先生成计划再由执行器执行。"}],"m2");draft.evidence[0].conversationId="other";draft.sources[0].conversationId="other";
 expect(evolutionReviewOperations(session,draft)).toMatchObject([{kind:"evidence",savedId:"plan"}]);
 const first=mergeEvolutionReview(session,draft,["another"]),next={...session,projectEvolutionAnalysis:first};
 expect(first.events).toHaveLength(1);expect(first.events[0].quote).toBe(event.quote);expect(first.events[0].corroborations?.[0].quote).toContain("先生成计划");
 expect(evolutionRecords(next)[0].sources.map(source=>source.excerpt)).toEqual([event.quote,"先生成计划再由执行器执行。"]);
 expect(mergeEvolutionReview(next,draft,["another"])).toEqual(first);expect(evolutionReviewOperations(next,draft)).toEqual([]);
});
it("keeps an independently matched paraphrase on the old stable ID and preserves personal edits",()=>{
 const session=projectSession();session.projectEvolutionAnalysis=analysis([event]);session.projectMaintenance={evolutionEvents:{plan:{updatedAt:2,edited:{title:"我的说明",version:"",before:"",after:"我保留的执行设计",reason:"",decisionStatus:"confirmed",workStatus:"unknown"}}}};
 const draft=analysis([{...event,id:"paraphrase",after:"由 AI 输出操作计划，确定性代码负责执行"}],"m2");draft.matches=[{eventId:"paraphrase",targetId:"plan",kind:"duplicate",basis:"model"}];
 const merged=mergeEvolutionReview(session,draft,["paraphrase"]);expect(merged.events).toHaveLength(1);expect(merged.events[0].id).toBe("plan");expect(evolutionRecords({...session,projectEvolutionAnalysis:merged})[0].event.after).toBe("我保留的执行设计");
});
it("preserves changed states, ID collisions and re-adoption after cancellation",()=>{
 const session=projectSession(),cancel={...event,id:"cancel",changeKind:"retire" as const,after:"取消操作计划",quote:"取消这个方案。"};session.projectEvolutionAnalysis=analysis([event,cancel]);
 const draft=analysis([{...event,id:"resumed",quote:"恢复操作计划。"}],"m2");draft.matches=[{eventId:"resumed",targetId:"plan",kind:"duplicate",basis:"model"}];
 expect(mergeEvolutionReview(session,draft,["resumed"]).events).toHaveLength(3);
 const completed=analysis([{...event,workStatus:"reported_complete",workQuote:"执行器已完成",workEvidenceIds:["p"]}],"m2");
 const merged=mergeEvolutionReview(session,completed,["plan"]);expect(merged.events).toHaveLength(3);expect(merged.events[0].workStatus).toBeUndefined();expect(new Set(merged.events.map(item=>item.id)).size).toBe(3);
});
it("does not restore ignored events or replace existing records when no candidate is selected",()=>{
 const session=projectSession();session.projectEvolutionAnalysis=analysis([event]);const draft=analysis([{...event,id:"new",after:"新的方案"}],"m2");
 const next=mergeEvolutionReview(session,draft,[]);expect(next.events).toEqual([event]);expect(next.evidence).toEqual(session.projectEvolutionAnalysis.evidence);expect(evolutionReviewOperations({...session,projectEvolutionAnalysis:next},draft)).toEqual([]);
});
