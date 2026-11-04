import type {DirectoryPage} from "../shared/wiki-directory";
import type {StructuredAIRequest} from "../ai/provider";
/** Explicit successful hierarchical provider fixture; failure tests use raw output. */
export function withWikiOutline<T>(value:T):T {
 if(!value||typeof value!=="object"||!("pages" in value)||!Array.isArray(value.pages))return value;
 return {scope:[],...value,pages:(value.pages as DirectoryPage[]).map(page=>({...page,subtopics:page.subtopics??(page.sectionIds.length>1?[{title:"具体机制",question:"哪些机制和条件？",sectionIds:page.sectionIds}]:undefined)}))};
}

/** One-owner planning fixture for source coverage/cache tests, not quality evals. */
export async function singleOwnerPlan<T>(request:StructuredAIRequest<T>):Promise<T>{
 const input=JSON.parse(request.prompt) as {sections:Array<{id:string}>};
 const ids=input.sections.map(section=>section.id);
 return request.validate({scope:[],pages:[{title:"来源条件",question:"哪些条件有效？",group:"",sectionIds:ids,subtopics:[{title:"具体机制",question:"哪些机制和条件？",sectionIds:ids}]}]});
}
