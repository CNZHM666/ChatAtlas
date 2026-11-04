import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { patchMatter, projectMatters } from "./project-matters";
import { createMatterKnowledge, linkMatterKnowledge, linkedMatterKnowledge, matterKnowledgeSignature, mergeOpenMatters, setRelatedKnowledge, unlinkMatterKnowledge } from "./project-knowledge-links";
const resolved=()=>{const session=projectSession(),matter=projectMatters(session).find(row=>row.type==="decision")!;session.projectMaintenance=patchMatter(session,matter,{matterStatus:"resolved",resolution:"采用确定性校验",resolutionReason:"可复现"},10);return {session,matter:projectMatters(session).find(row=>row.id===matter.id)!};};
it("links canonical conclusions without copying prose or manufacturing source proof",()=>{
 const {session,matter}=resolved(),before=structuredClone(session),signature=matterKnowledgeSignature(matter),next=linkMatterKnowledge(session,matter,"one",signature,20);
 expect(next.sections[0].body).toBe(session.sections[0].body);expect(next.evidence).toEqual(session.evidence);expect(next.sections[0].matterLinks).toHaveLength(1);expect(next.projectMaintenance?.decisions?.[matter.id].linkedKnowledgeIds).toEqual(["one"]);
 expect(linkedMatterKnowledge(next,next.sections[0])[0]).toMatchObject({current:true,matter:{resolution:"采用确定性校验"}});expect(session).toEqual(before);
 const repeated=linkMatterKnowledge(next,matter,"one",signature,30);expect(repeated.sections[0].matterLinks).toHaveLength(1);expect(projectMatters(repeated).find(row=>row.id===matter.id)?.resolutionHistory).toEqual(matter.resolutionHistory);
});
it("requires explicit review after edits, reopening or removal and retains existing article content",()=>{
 const {session,matter}=resolved();let next=linkMatterKnowledge(session,matter,"one",matterKnowledgeSignature(matter));
 next.projectMaintenance=patchMatter(next,projectMatters(next).find(row=>row.id===matter.id)!,{resolution:"采用新校验方式"},40);expect(linkedMatterKnowledge(next,next.sections[0])[0].current).toBe(false);
 expect(()=>linkMatterKnowledge(next,matter,"one",matterKnowledgeSignature(matter))).toThrow(/变化/);
 const latest=projectMatters(next).find(row=>row.id===matter.id)!;next=linkMatterKnowledge(next,latest,"one",matterKnowledgeSignature(latest));expect(linkedMatterKnowledge(next,next.sections[0])[0].current).toBe(true);
 next.projectMaintenance=patchMatter(next,latest,{matterStatus:"open"});expect(linkedMatterKnowledge(next,next.sections[0])[0].current).toBe(false);
 next.projectMaintenance=patchMatter(next,projectMatters(next).find(row=>row.id===matter.id)!,{hidden:true});expect(linkedMatterKnowledge(next,next.sections[0])[0].matter).toBeUndefined();expect(next.sections[0].body).toBe(session.sections[0].body);
});
it("creates a personal chapter with only a stable link and removes only the edge",()=>{
 const {session,matter}=resolved(),next=createMatterKnowledge(session,matter,"校验选择",matterKnowledgeSignature(matter),"new",20),chapter=next.sections[1];
 expect(chapter).toMatchObject({id:"new",body:"",origin:"user",evidenceIds:[]});expect(linkedMatterKnowledge(next,chapter)[0].current).toBe(true);
 const unlinked=unlinkMatterKnowledge(next,matter,"new");expect(unlinked.sections).toHaveLength(2);expect(projectMatters(unlinked).find(row=>row.id===matter.id)?.resolution).toBe(matter.resolution);
 expect(()=>createMatterKnowledge(session,matter," ",matterKnowledgeSignature(matter),"bad")).toThrow();
});
it("keeps manual related chapter IDs valid and never changes chapter order or articles",()=>{
 const session=projectSession();session.sections.push({...session.sections[0],id:"two"});const next=setRelatedKnowledge(session,"one",["one","two","missing","two"]);
 expect(next.sections[0].relatedKnowledgeIds).toEqual(["two"]);expect(next.sections.map(row=>row.id)).toEqual(["one","two"]);expect(next.sections[0].body).toBe(session.sections[0].body);
});
it("merges only user-selected open peers, keeps originals and history, and reopening removes the redirect",()=>{
 const session=projectSession();session.brief={summary:"",turningPoints:[],confirmed:[],openQuestions:["问题甲","问题乙"]};const [a,b]=projectMatters(session).filter(row=>row.type==="question");
 const merged=mergeOpenMatters(session,a,[b,b],20),members=projectMatters(merged);expect(members.find(row=>row.id===b.id)).toMatchObject({status:"dismissed",originalText:"问题乙",mergedInto:{id:a.id,type:"question"}});expect(members.find(row=>row.id===a.id)?.relatedMatters).toHaveLength(1);expect(members.find(row=>row.id===b.id)?.resolutionHistory).toHaveLength(1);
 expect(()=>mergeOpenMatters(merged,a,[b])).toThrow();expect(session.brief.openQuestions).toEqual(["问题甲","问题乙"]);
 merged.projectMaintenance=patchMatter(merged,members.find(row=>row.id===b.id)!,{matterStatus:"open"});expect(projectMatters(merged).find(row=>row.id===b.id)?.mergedInto).toBeUndefined();
});
