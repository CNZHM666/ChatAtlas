import type {AIProviderValidationError} from "./provider-errors";

const subject=(path:string)=>path.replace(/\.(?:sectionIds|title|question|group)$/u,"");

/** Plain statements of what was wrong with the previous directory, so a
 * correction names the conflict instead of only an error code and field path.
 * A model that is told only "unknown m3" while m3 is in its list tends to
 * return the same directory again. */
export function wikiPlanCorrectionProblems(error:AIProviderValidationError,draft:unknown,ids:string[]):string[]{
 const problems:string[]=[],details=error.wikiDirectoryDetails,known=new Set(ids);
 if(error.code.endsWith("_scope_review"))problems.push("The required scope array is missing or invalid. Review every supplied material against projectBoundary; return scope rows for other/uncertain/reference material, or scope:[] if none. Keep existing valid routes and chapter ownership.");
 const scope=draft&&typeof draft==="object"&&Array.isArray((draft as {scope?:unknown}).scope)?(draft as {scope:Array<{id?:unknown;kind?:unknown}>}).scope:[];
 for(const id of details?.unknownIds??[]){
  const excluded=scope.find(item=>item?.id===id&&item.kind==="other");
  problems.push(known.has(id)&&excluded
   ?`${id} is listed in scope as ${String(excluded.kind)} AND assigned to a subtopic. Make one decision: keep it assigned and remove it from scope, or keep the scope entry and assign it nowhere.`
   :`${id} is not one of this request's section IDs. Remove it; use only the listed IDs.`);
 }
 for(const id of details?.missingIds??[])problems.push(`${id} has no destination. Assign it to exactly one subtopic.`);
 for(const id of details?.duplicateIds??[])problems.push(`${id} is assigned under more than one chapter. Keep exactly one chapter.`);
 for(const id of details?.parentMismatchIds??[])problems.push(`${id} differs between a chapter and its subtopics. List it under the same chapter in both places.`);
 for(const issue of error.wikiDirectoryIssues??[]){
  if(issue.reason==="empty_source_list")problems.push(`${subject(issue.path)} has no materials. Assign materials to it or remove it.`);
  else if(issue.reason==="text_too_long")problems.push(`${issue.path} exceeds ${issue.maxLength} characters. Shorten it.`);
  else if(issue.reason==="required_text")problems.push(`${issue.path} is missing. Provide it.`);
  else if(issue.reason==="invalid_source_list")problems.push(`${issue.path} is not a list of section IDs.`);
 }
 return problems.slice(0,24);
}
