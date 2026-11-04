import type {FocusSection} from "../shared/focus-session";
import type {DirectoryPage} from "./wiki-directory";
import {wikiNameKey,wikiOutlineError} from "./wiki-outline-policy";

/** Navigation scopes for parent assignment. All child titles remain visible;
 * source inventories and detailed prose stay in the local catalogue. */
export function wikiCandidateSection(page:DirectoryPage,index:number):FocusSection {
 return {id:`owner:${index}`,title:page.title,kind:"review",transition:"",evidenceIds:[],wikiQuestion:page.question,wikiGroup:page.group,
  wikiSubtopics:page.subtopics?.map(({title,question})=>({title,question})),
  body:`Retained subtopics: ${page.subtopics?.length??0}\n`+(page.subtopics?.map(topic=>topic.title+": "+topic.question).join("\n")??page.question)};
}

/** Route child scopes rather than treating a whole local page as indivisible.
 * Children sharing material travel together: regrouping must never duplicate
 * that material across parents. Full prose and conditions stay in the notes. */
export function wikiConvergenceCandidates(pages:DirectoryPage[]):DirectoryPage[]{
 return pages.flatMap(page=>{
  const children=page.subtopics??[{title:page.title,question:page.question,sectionIds:page.sectionIds}];
  const groups:Array<typeof children>=[];
  for(const child of children){
   const connected=groups.filter(group=>group.some(item=>item.sectionIds.some(id=>child.sectionIds.includes(id))));
   const merged=[...connected.flat(),child];
   for(const group of connected)groups.splice(groups.indexOf(group),1);
   groups.push(merged);
  }
  return groups.map(group=>({title:page.title,question:page.question,group:page.group,
   sectionIds:[...new Set(group.flatMap(child=>child.sectionIds))],subtopics:group}));
 });
}

/** Expand editorial candidate assignments into complete original materials.
 * Legacy parent-only callers can still restore their old child headings. */
export function expandWikiCandidates(plan:DirectoryPage[],items:FocusSection[],originals:DirectoryPage[]):DirectoryPage[]{
 const byId=new Map(items.map((item,index)=>[item.id,originals[index]]));
 return plan.map(parent=>{
  // A new editorial plan names the final child scopes. Translate its verified
  // candidate assignments back to originals instead of restoring every old
  // heading. Legacy parent-only plans retain the old lossless expansion below.
  if(parent.subtopics?.length){
   const expand=(ids:string[])=>[...new Set(ids.flatMap(id=>{const source=byId.get(id);if(!source)throw wikiOutlineError("mapping");return source.sectionIds;}))];
   return {...parent,sectionIds:expand(parent.sectionIds),subtopics:parent.subtopics.map(child=>({...child,sectionIds:expand(child.sectionIds)}))};
  }
  const children:NonNullable<DirectoryPage["subtopics"]>=[];
  for(const id of parent.sectionIds){const source=byId.get(id);if(!source)throw wikiOutlineError("mapping");
   for(const child of source.subtopics??[{title:source.title,question:source.question,sectionIds:source.sectionIds}]){
    // Merge identical editorial scopes only. Removing punctuation can erase
    // meaningful signs such as -5V versus 5V from a boundary description.
    const same=children.find(item=>item.title===child.title&&item.question===child.question);
    if(same){same.sectionIds.push(...child.sectionIds);continue;}
    let title=child.title;
    if(children.some(item=>wikiNameKey(item.title)===wikiNameKey(title))){
     const base=`${source.title} · ${child.title}`.slice(0,90).replace(/[\uD800-\uDBFF]$/u,"");title=base;
     for(let suffix=2;children.some(item=>wikiNameKey(item.title)===wikiNameKey(title));suffix++)title=`${base} (${suffix})`;
    }
    children.push({...child,title,sectionIds:[...child.sectionIds]});
   }
  }
  return {...parent,sectionIds:parent.sectionIds.flatMap(id=>byId.get(id)!.sectionIds),subtopics:children};
 });
}
