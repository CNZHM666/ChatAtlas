import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { projectStateSignature } from "./project-state";
import { acceptMatterCandidates, projectMatterCandidates } from "./project-matter-candidates";
import { patchMatter, projectMatters } from "./project-matters";
import {projectOpenQuestions} from "./project-state";
const candidate=(id="fresh",text="新选择")=>({...projectSession().projectState!.decisions[0],id,text,status:"documented" as const});
it("selectively adds candidates as open and preserves all saved records and personal approvals",()=>{
 const session=projectSession(),matter=projectMatters(session).find(row=>row.type==="decision")!;session.projectMaintenance=patchMatter(session,matter,{matterStatus:"resolved",resolution:"手动确认方案"});const old=structuredClone(session),draft={...session.projectState!,decisions:[candidate(),candidate("other","另一选择")],constraints:[],questions:[candidate("q","新问题")],modules:[],relations:[]};
 const accepted=acceptMatterCandidates(session,draft,["decision:fresh","question:q"]),next={...session,projectState:accepted};expect(accepted.modules).toEqual(session.projectState!.modules);expect(accepted.decisions.map(row=>row.id)).toEqual([matter.id,"fresh"]);expect(accepted.constraints).toEqual(session.projectState!.constraints);expect(accepted.questions).toHaveLength(1);expect(projectMatters(next).find(row=>row.id==="fresh")?.status).toBe("open");expect(next.projectMaintenance).toEqual(old.projectMaintenance);expect(session).toEqual(old);
 expect(()=>acceptMatterCandidates(session,draft,["invented"])).toThrow();
});
it("does not resurrect removed, closed, resolved or personally renamed original records",()=>{
 const session=projectSession(),matter=projectMatters(session).find(row=>row.type==="decision")!;session.projectMaintenance=patchMatter(session,matter,{text:"我的改写",hidden:true});const draft={...session.projectState!,decisions:[candidate("renamed",matter.text+"。")],constraints:[]};
 expect(projectMatterCandidates(session,draft)[0].duplicate).toBeDefined();expect(acceptMatterCandidates(session,draft,["decision:renamed"]).decisions).toEqual(session.projectState!.decisions);
});
it("ID collisions cannot inherit personal confirmation and exact duplicate adoption stays idempotent",()=>{
 const session=projectSession();session.projectMaintenance={decisions:{fresh:{text:"手工选择",confirmed:true,resolution:"保留"}}};const draft={...session.projectState!,decisions:[candidate()],constraints:[]},accepted=acceptMatterCandidates(session,draft,["decision:fresh"]),next={...session,projectState:accepted};
 expect(accepted.decisions.at(-1)?.id).not.toBe("fresh");expect(projectMatters(next).find(row=>row.text==="新选择")?.status).toBe("open");expect(acceptMatterCandidates(next,draft,["decision:fresh"]).decisions).toEqual(accepted.decisions);
});
it("does not turn an AI superseded suggestion into a resolved question",()=>{
 const session=projectSession(),draft={...session.projectState!,questions:[{...candidate("q","新问题"),status:"superseded" as const}],decisions:[],constraints:[]};const next={...session,projectState:acceptMatterCandidates(session,draft,["question:q"])};expect(projectMatters(next).find(row=>row.type==="question")?.status).toBe("open");
});

it("retains old source validity separately when accepting additions from newer materials",()=>{
 const session=projectSession(),old=projectMatters(session).find(row=>row.type==="decision")!;session.projectMaintenance=patchMatter(session,old,{matterStatus:"resolved",resolution:"原确认方案"});const draft={...session.projectState!,signature:"changed-material",partSignatures:{decisions:"changed-material"},decisions:[candidate()],constraints:[]};const state=acceptMatterCandidates(session,draft,["decision:fresh"]);
 expect(state.decisions[0].sourceBasisSignature).toBe(session.projectState!.signature);expect(session.projectMaintenance.decisions![old.id].resolution).toBe("原确认方案");
});

it("cannot reapprove omitted historical decisions merely by adopting a new candidate",()=>{
 const session=projectSession(),old=projectMatters(session).find(row=>row.type==="decision")!;session.projectMaintenance=patchMatter(session,old,{matterStatus:"resolved",resolution:"原确认方案"});session.sourceSignatures={source:{message:"changed"}};const currentSignature=projectStateSignature(session),draft={...session.projectState!,signature:currentSignature,partSignatures:{decisions:currentSignature},decisions:[candidate()],constraints:[]};const next={...session,projectState:acceptMatterCandidates(session,draft,["decision:fresh"])};
 let kept=projectMatters(next).find(row=>row.id===old.id)!;expect(kept).toMatchObject({status:"open",resolution:"原确认方案"});next.projectMaintenance=patchMatter(next,kept,{matterStatus:"resolved",resolution:"重新核对后采用"});kept=projectMatters(next).find(row=>row.id===old.id)!;expect(kept.status).toBe("resolved");
});

it("adopts a reviewed later answer onto the original question without duplicating it, and permits manual reopening",()=>{
 const session=projectSession(),base={...candidate("old-question","首版存储用本地还是云端？"),quote:"首版存储用本地还是云端？",matter:{subject:"首版存储",scope:"V1",state:"open" as const}};
 session.projectState!.questions=[base];session.evidence[0].excerpt=base.quote;session.evidence.push({...session.evidence[0],id:"e2",messageId:"answer",excerpt:"我决定采用本地存储。"});session.sourceRoles={source:{message:"user",answer:"user"}};session.sourceMessageOrder={source:["message","answer"]};session.projectState!.signature=projectStateSignature(session);
 const closed={...base,id:"new-id",matter:{...base.matter,state:"settled" as const,settlement:{text:"首版采用本地存储",quote:"我决定采用本地存储。",evidenceIds:["e2"]}}};
 const draft={...session.projectState!,questions:[closed]},entry=projectMatterCandidates(session,draft).find(item=>item.type==="question")!;
 expect(entry.updateTarget?.id).toBe("old-question");expect(entry.duplicate).toBeUndefined();
 const next={...session,projectState:acceptMatterCandidates(session,draft,[entry.key])};
 expect(next.projectState.questions).toHaveLength(1);expect(next.projectState.questions![0].id).toBe("old-question");
 const matter=projectMatters(next).find(item=>item.type==="question")!;expect(matter).toMatchObject({status:"resolved",resolution:"首版采用本地存储"});expect(matter.sources.map(ref=>ref.id)).toEqual(["e1","e2"]);expect(projectOpenQuestions(next)).toEqual([]);
 next.projectMaintenance=patchMatter(next,matter,{matterStatus:"open"});const reopened=projectMatters(next).find(item=>item.id===matter.id)!;expect(reopened.status).toBe("open");expect(reopened.resolutionHistory?.at(-1)).toMatchObject({status:"resolved",resolution:"首版采用本地存储"});
 expect(projectMatterCandidates(next,draft).find(item=>item.type==="question")?.updateTarget).toBeUndefined();
});
it("does not accept a same-worded closure for another phase and does not trust stale settlement metadata",()=>{
 const session=projectSession(),base={...candidate("q","是否支持云同步？"),matter:{subject:"云同步",scope:"V2",state:"open" as const}};
 session.projectState!.questions=[base];const draft={...session.projectState!,questions:[{...base,matter:{subject:"云同步",scope:"V1",state:"settled" as const,settlement:{text:"V1仅本地",quote:"确认V1仅本地",evidenceIds:["e1"]}}}]};
 const entry=projectMatterCandidates(session,draft).find(item=>item.type==="question")!;expect(entry.updateTarget).toBeUndefined();expect(entry.duplicate).toBeDefined();
 session.projectState!.questions=draft.questions;session.projectState!.questions![0].status="uncertain";
 expect(projectMatters(session).find(item=>item.type==="question")?.status).toBe("open");
 session.projectState!.questions![0].status="documented";session.projectState!.questions![0].sourceBasisSignature="older-material";
 expect(projectMatters(session).find(item=>item.type==="question")?.status).toBe("open");
});
