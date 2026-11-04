import type { FocusSession } from "./focus-session";
import type { DirectoryPage } from "./wiki-directory";
import { applyWikiDirectory, editableWikiTopic } from "./wiki-directory";

/** Atomic editorial merge. Originals and note ownership remain recoverable. */
export function mergeWikiTopics(session:FocusSession,pages:DirectoryPage[]):FocusSession {
  pages=pages.map(page=>({...page,sectionIds:session.sections.filter(section=>page.sectionIds.includes(section.id)).map(section=>section.id)}));
  if(pages.some(page=>page.sectionIds.some(id=>{const section=session.sections.find(section=>section.id===id)!;return !editableWikiTopic(section)||session.wikiSuggestions?.[id];})))throw new Error("Personal chapters or pending revisions cannot be merged");
  const aliases=new Map(pages.flatMap(page=>page.sectionIds.map(id=>[id,page.sectionIds[0]] as const)));
  const map=(id:string)=>aliases.get(id)??id;
  if(pages.some(page=>page.sectionIds.length<2)||new Set(pages.flatMap(page=>page.sectionIds)).size!==pages.flatMap(page=>page.sectionIds).length)throw new Error("Invalid merge groups");
  const grouped=applyWikiDirectory(session.sections.filter(section=>aliases.has(section.id)),pages);
  const sections=[...grouped,...session.sections.filter(section=>!aliases.has(section.id))].sort((a,b)=>session.sections.findIndex(section=>map(section.id)===a.id)-session.sections.findIndex(section=>map(section.id)===b.id)).map(section=>({...section,relatedKnowledgeIds:section.relatedKnowledgeIds?.map(map).filter(id=>id!==section.id)}));
  return remapWikiSectionReferences(session,sections,aliases);
}

/** Remap navigation and personal metadata after an accepted candidate merge. */
export function remapWikiSectionReferences(session:FocusSession,sections:FocusSession["sections"],aliases:Map<string,string>):FocusSession {
  const map=(id:string)=>aliases.get(id)??id;
  sections=sections.map(section=>({...section,relatedKnowledgeIds:section.relatedKnowledgeIds?.map(map).filter(id=>id!==section.id)}));
  const notes:NonNullable<FocusSession["sectionNotes"]>={};
  for(const [id,note] of Object.entries(session.sectionNotes??{})) {
    const key=map(id),prior=notes[key];
    if(prior?.deletedAt&&!note.deletedAt){notes[key]=note;continue;}
    if(prior&&!prior.deletedAt&&note.deletedAt)continue;
    notes[key]=prior?{...prior,text:[prior.text,note.text].filter(Boolean).join("\n\n"),evidenceIds:[...new Set([...prior.evidenceIds,...note.evidenceIds])],sources:[...prior.sources??[],...note.sources??[]],updatedAt:Math.max(prior.updatedAt,note.updatedAt),deletedAt:prior.deletedAt&&note.deletedAt?Math.max(prior.deletedAt,note.deletedAt):undefined}:note;
  }
  const allAliases={...session.wikiSectionAliases,...Object.fromEntries(aliases)};
  for(const key of Object.keys(allAliases))allAliases[key]=map(allAliases[key]);
  const remapLinks=(value:unknown):unknown=>Array.isArray(value)?value.map(remapLinks):value&&typeof value==="object"?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,["sectionIds","wikiSectionIds","linkedKnowledgeIds"].includes(key)&&Array.isArray(item)?[...new Set(item.map(id=>typeof id==="string"?map(id):id))]:remapLinks(item)])):value;
  return {...session,projectMaintenance:remapLinks(session.projectMaintenance) as FocusSession["projectMaintenance"],projectUnderstanding:remapLinks(session.projectUnderstanding) as FocusSession["projectUnderstanding"],semanticOverview:remapLinks(session.semanticOverview) as FocusSession["semanticOverview"],detachedNotes:session.detachedNotes?.map(note=>({...note,section:note.section?{...note.section,id:map(note.section.id)}:undefined})),reviewNeeds:Object.fromEntries(Object.entries(session.reviewNeeds??{}).map(([id,text])=>[map(id),text])),sections,sectionNotes:notes,activeSectionId:map(session.activeSectionId),wikiOrder:[...new Set((session.wikiOrder??session.sections.map(section=>section.id)).map(map))],visitedSectionIds:session.visitedSectionIds?[...new Set(session.visitedSectionIds.map(map))]:undefined,completedSectionIds:sections.filter(section=>session.sections.filter(old=>map(old.id)===section.id).every(old=>session.completedSectionIds.includes(old.id))).map(section=>section.id),wikiSectionAliases:allAliases,wikiMergeHistory:[...session.wikiMergeHistory??[],{at:Date.now(),sections:session.sections,sectionNotes:session.sectionNotes,wikiOrder:session.wikiOrder}],updatedAt:Date.now()};
}
