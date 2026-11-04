import type { FocusSection, FocusSession } from "./focus-session";
import { patchMatter, projectMatters, type ProjectMatter } from "./project-matters";
import { sourceMessageSignature } from "./source-signature";

export type MatterRef = Pick<ProjectMatter,"id"|"type">;
export const matterIdentity = (ref:MatterRef) => `${ref.type}:${ref.id}`;
export const matterKnowledgeSignature = (matter:ProjectMatter) => sourceMessageSignature(JSON.stringify([matter.type,matter.status,matter.text,matter.resolution,matter.resolutionReason,matter.included,matter.excluded,matter.phase]));
export function linkedMatterKnowledge(session:FocusSession, section:FocusSection) {
  const matters=projectMatters(session);
  return (section.matterLinks??[]).map(link=>{const matter=matters.find(item=>matterIdentity(item)===matterIdentity(link));return {link,matter,current:Boolean(matter&&matter.status==="resolved"&&matter.resolution&&link.signature===matterKnowledgeSignature(matter))};});
}

/** One user-confirmed edge; article prose and original proof are never overwritten. */
export function linkMatterKnowledge(session:FocusSession, ref:MatterRef, sectionId:string, expected:string, now=Date.now()):FocusSession {
  const matter=projectMatters(session).find(item=>matterIdentity(item)===matterIdentity(ref));
  if(!matter||matter.status!=="resolved"||!matter.resolution||matterKnowledgeSignature(matter)!==expected)throw new Error("事项结论已变化，请重新核对 / Matter changed; review again");
  const section=session.sections.find(item=>item.id===sectionId);
  if(!section)throw new Error("Wiki 章节不可用 / Wiki chapter unavailable");
  const projectMaintenance=patchMatter(session,matter,{linkedKnowledgeIds:[...new Set([...(matter.linkedKnowledgeIds??[]),sectionId])]},now);
  const link={id:matter.id,type:matter.type,signature:expected,linkedAt:now};
  return {...session,projectMaintenance,sections:session.sections.map(item=>item.id===sectionId?{...item,matterLinks:[...(item.matterLinks??[]).filter(old=>matterIdentity(old)!==matterIdentity(ref)),link]}:item),updatedAt:now};
}

export function createMatterKnowledge(session:FocusSession,ref:MatterRef,title:string,expected:string, id:string, now=Date.now()) {
  if(!title.trim()||session.sections.some(section=>section.id===id))throw new Error("请填写新章节标题 / Enter a new chapter title");
  const section:FocusSection={id,title:title.trim(),body:"",transition:"",evidenceIds:[],kind:"finding",origin:"user",wikiGroup:"",wikiGroupEdited:true};
  return linkMatterKnowledge({...session,sections:[...session.sections,section],wikiOrder:session.wikiOrder?[...session.wikiOrder,id]:undefined},ref,id,expected,now);
}

export function unlinkMatterKnowledge(session:FocusSession,ref:MatterRef,sectionId:string,now=Date.now()):FocusSession {
  const matter=projectMatters(session).find(item=>matterIdentity(item)===matterIdentity(ref));
  return {...session,projectMaintenance:matter?patchMatter(session,matter,{linkedKnowledgeIds:(matter.linkedKnowledgeIds??[]).filter(id=>id!==sectionId)},now):session.projectMaintenance,
    sections:session.sections.map(section=>section.id===sectionId?{...section,matterLinks:(section.matterLinks??[]).filter(link=>matterIdentity(link)!==matterIdentity(ref))}:section),updatedAt:now};
}

export function setRelatedKnowledge(session:FocusSession,sectionId:string,ids:string[],now=Date.now()):FocusSession {
  if(!session.sections.some(section=>section.id===sectionId))throw new Error("章节已变化 / Chapter changed");
  const valid=[...new Set(ids)].filter(id=>id!==sectionId&&session.sections.some(section=>section.id===id));
  return {...session,sections:session.sections.map(section=>section.id===sectionId?{...section,relatedKnowledgeIds:valid}:section),updatedAt:now};
}

/** A merge is explicit closure with redirects. No original or conclusion is deleted. */
export function mergeOpenMatters(session:FocusSession,targetRef:MatterRef,sourceRefs:MatterRef[],now=Date.now()):FocusSession {
  const matters=projectMatters(session),target=matters.find(item=>matterIdentity(item)===matterIdentity(targetRef));
  const members=[...new Map(sourceRefs.map(ref=>[matterIdentity(ref),ref])).values()].map(ref=>matters.find(item=>matterIdentity(item)===matterIdentity(ref)));
  if(!target||target.status!=="open"||!members.length||members.some(item=>!item||item.type!==target.type||item.status!=="open"||matterIdentity(item)===matterIdentity(target)))throw new Error("仅可合并同类型的待处理事项 / Only open matters of the same type can merge");
  let next=session;
  const related=[...target.relatedMatters??[],...members.map(item=>({id:item!.id,type:item!.type}))];
  next={...next,projectMaintenance:patchMatter(next,target,{relatedMatters:[...new Map(related.map(ref=>[matterIdentity(ref),ref])).values()]},now)};
  for(const member of members)next={...next,projectMaintenance:patchMatter(next,member!,{matterStatus:"dismissed",mergedInto:targetRef},now)};
  return {...next,updatedAt:now};
}
