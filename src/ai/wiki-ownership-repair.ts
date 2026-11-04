import type {FocusSection} from "../shared/focus-session";
import type {DirectoryPage} from "./wiki-directory";
import {AIProviderValidationError} from "./provider-errors";
import {normalizeWikiPlanInput,validateWikiPlan} from "./wiki-plan-contract";

/** Remove only references outside the request's FULL material roster. This is
 * independent of hierarchy/metadata validity and never chooses a real owner.
 * Scope-excluded materials remain real IDs and must still fail if assigned. */
export function quarantineWikiForeignReferences(value:unknown,sections:FocusSection[]){
 const input=value&&typeof value==="object"&&!Array.isArray(value)?value as Record<string,unknown>:undefined;
 if(input&&Object.hasOwn(input,"routes"))return {value,count:0};
 const original=Array.isArray(value)?value:input?.pages;
 if(!Array.isArray(original))return {value,count:0};
 const known=new Set(sections.map(section=>section.id));let count=0;
 const pages=original.map(entry=>{
  if(!entry||typeof entry!=="object"||Array.isArray(entry))return entry;
  const page=entry as Record<string,unknown>,foreign=new Set<unknown>();
  const keep=(ids:unknown)=>Array.isArray(ids)?ids.filter(id=>{if(typeof id==="string"&&known.has(id))return true;foreign.add(id);return false;}):ids;
  const next={...page,...(Object.hasOwn(page,"sectionIds")?{sectionIds:keep(page.sectionIds)}:{}),...(Array.isArray(page.subtopics)?{subtopics:page.subtopics.map(topic=>{
   if(!topic||typeof topic!=="object"||Array.isArray(topic))return topic;
   return {...topic,...(Object.hasOwn(topic,"sectionIds")?{sectionIds:keep(topic.sectionIds)}:{})};
  })}:{})};
  // Parent and child inventories often repeat the same foreign reference.
  count+=foreign.size;return next;
 });
 if(!input)return {value:count?pages:value,count};
 const assignments=input.assignments;
 let nextAssignments=assignments;
 if(assignments&&typeof assignments==="object"&&!Array.isArray(assignments))nextAssignments=Object.fromEntries(Object.entries(assignments).filter(([id])=>{if(known.has(id))return true;count++;return false;}));
 return {value:count?{...input,pages,...(Object.hasOwn(input,"assignments")?{assignments:nextAssignments}:{})}:value,count};
}

/** Preserve unambiguous assignments. The model only chooses ONE destination for
 * each unresolved slot; it cannot rewrite titles, other owners or source IDs. */
export function prepareWikiOwnershipRepair(value:unknown,sections:FocusSection[],error:AIProviderValidationError,excludedIds:string[]=[]){
 const details=error.wikiDirectoryDetails;
 if(!details||details.invalidAssignmentIds?.length
  ||!details.duplicateIds.length&&!details.missingIds.length&&!details.unknownIds.length&&!details.parentMismatchIds.length)return;
 let normalized:unknown;
 try{normalized=normalizeWikiPlanInput(value,sections);}catch{return;}
 if(!Array.isArray(normalized)||!normalized.length)return;
 const known=new Set(sections.map(section=>section.id));
 let quarantinedReferences=0;
 const targets:Array<{id:string;page:number;child:number;title:string;question:string;chapter:string;chapterQuestion:string}>=[];
 const occurrences=new Map<string,string[]>();
 const parentOccurrences=new Map<string,number[]>();
 const shadow:DirectoryPage[]=[],shadowSections:FocusSection[]=[];
 for(const [pageIndex,page] of normalized.entries()){
  if(!page||!Array.isArray(page.subtopics)||!page.subtopics.length||!Array.isArray(page.sectionIds))return;
  // A real source simultaneously declared excluded and assigned is a scope
  // contradiction, not a foreign transport reference we may quarantine.
  if(page.sectionIds.some((id:unknown)=>typeof id==="string"&&excludedIds.includes(id)))return;
  for(const id of page.sectionIds)if(typeof id==="string"&&known.has(id))parentOccurrences.set(id,[...parentOccurrences.get(id)??[],pageIndex]);
  const children:NonNullable<DirectoryPage["subtopics"]>=[];
  for(const [childIndex,child] of page.subtopics.entries()){
   if(!child||!Array.isArray(child.sectionIds))return;
   if(child.sectionIds.some((id:unknown)=>typeof id==="string"&&excludedIds.includes(id)))return;
   // Quarantine foreign references, never rewrite them into a guessed source.
   // Real materials absent from the remaining inventory become explicit slots.
   const valid=child.sectionIds.filter((id:unknown)=>typeof id==="string"&&known.has(id));
   quarantinedReferences+=child.sectionIds.length-valid.length;
   child.sectionIds=valid;
   const id=`s${targets.length}`,material=`m${targets.length}`;
   targets.push({id,page:pageIndex,child:childIndex,title:child.title,question:child.question,chapter:page.title,chapterQuestion:page.question});
   for(const material of child.sectionIds)occurrences.set(material,[...occurrences.get(material)??[],id]);
   children.push({...child,sectionIds:[material]});
   shadowSections.push({...sections[0],id:material});
  }
  shadow.push({...page,sectionIds:children.flatMap(child=>child.sectionIds),subtopics:children});
 }
 // Validate all editorial metadata with synthetic identities, never a guessed
 // real assignment. Invalid metadata still uses the existing format repair.
 try{validateWikiPlan({pages:shadow},shadowSections,{candidate:true});}catch{return;}
 const slots=sections.flatMap(section=>{
  const owners=occurrences.get(section.id)??[];
  const childParents=new Set(owners.map(owner=>targets.find(target=>target.id===owner)!.page));
  const parentOnly=(parentOccurrences.get(section.id)??[]).filter(page=>!childParents.has(page));
  const parents=new Set([...childParents,...parentOnly]);
  // A declared parent with no child assignment is an omission WITHIN that
  // chapter. Contradicting parents remain competing choices, never guessed.
  const choices=[...new Set([...owners,...targets.filter(target=>parentOnly.includes(target.page)).map(target=>target.id)])];
  return parents.size===1&&owners.length?[]:[{section,choices:choices.length?choices:targets.map(target=>target.id)}];
 });
 if(!slots.length&&!details.unknownIds.length&&!details.parentMismatchIds.length)return;
 const failure=(receivedSlots:number,reason:"count"|"target"|"slot"="count",expectedSlots=slots.length)=>{
  const next=new AIProviderValidationError(reason==="count"?"wiki_directory_ownership_incomplete":"wiki_directory_ownership_target");
  next.fieldPaths=["owners"];next.wikiOwnershipDetails={expectedSlots,receivedSlots,reason};next.wikiDirectoryDetails=error.wikiDirectoryDetails;return next;
 };
 const readPartial=(value:unknown,indices:number[],recoverValid=false)=>{
  const owners=Array.isArray(value)?value:value&&typeof value==="object"?(value as {owners?:unknown}).owners:undefined;
  if(!owners||typeof owners!=="object")throw failure(0,"count",indices.length);
  if(Array.isArray(owners)&&owners.length!==indices.length)throw failure(owners.length,"count",indices.length);
  const entries=Array.isArray(owners)?owners.map((owner,index)=>[`r${indices[index]}`,owner] as const):Object.entries(owners);
  const expected=new Map(indices.map(index=>[`r${index}`,index])),valid:Record<string,string>={};
  let invalid:"slot"|"target"|undefined;
  for(const [key,owner] of entries){
   const index=expected.get(key);if(index===undefined){if(!recoverValid)throw failure(entries.length,"slot",indices.length);invalid??="slot";continue;}
   if(typeof owner!=="string"||!slots[index].choices.includes(owner)){if(!recoverValid)throw failure(entries.length,"target",indices.length);invalid??="target";continue;}
   valid[key]=owner;
  }
  if(!Object.keys(valid).length)throw failure(0,invalid??"count",indices.length);
  return {owners:valid};
 };
 const validate=(value:unknown):string[]=>{
  if(!slots.length)return [];
  const {owners}=readPartial(value,slots.map((_,index)=>index));
  if(Object.keys(owners).length!==slots.length)throw failure(Object.keys(owners).length);
  return slots.map((_,index)=>owners[`r${index}`]);
 };
 const apply=(value:unknown)=>{
  const owners=validate(value),unresolved=new Set(slots.map(slot=>slot.section.id));
  const pages=structuredClone(normalized) as DirectoryPage[];
  const selected=new Map(slots.map((slot,index)=>[slot.section.id,targets.find(target=>target.id===owners[index])!]));
  // Keep all declared support within the winning parent; only a losing parent
  // loses the conflicting material. Shared child evidence is not an ambiguity.
  for(const [index,page] of pages.entries())for(const child of page.subtopics!)child.sectionIds=child.sectionIds.filter(id=>!unresolved.has(id)||selected.get(id)!.page===index);
  for(const [index,slot] of slots.entries()){
   const target=targets.find(target=>target.id===owners[index])!;
   if(!occurrences.has(slot.section.id))pages[target.page].subtopics![target.child].sectionIds.push(slot.section.id);
  }
  for(const page of pages)page.sectionIds=[...new Set(page.subtopics!.flatMap(child=>child.sectionIds))];
  return validateWikiPlan({pages},sections,{candidate:true});
 };
 // Keep only explicit requested-slot/allowed-target pairs. Unknown IDs are
 // never guessed or cached, and final application still requires every slot.
 return {targets,slots,quarantinedReferences,validate,readPartial,readRecoverable:(value:unknown,indices:number[])=>readPartial(value,indices,true),failure,apply};
}
