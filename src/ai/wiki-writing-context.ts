import type {OwnedMaterial} from "./focus-coverage";
import {unified} from "unified";
import remarkParse from "remark-parse";
import type {RootContent} from "mdast";
import type {FocusSection} from "../shared/focus-session";

const parser=unified().use(remarkParse);
const text=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>text(child as RootContent)).join(""):"";
export interface WikiExistingExplanation {title:string;text:string;kind:FocusSection["kind"];phase?:string;path?:string[]}

/** Small whole paragraphs from this owner's already completed prose. Navigation
 * only: never source proof, another model call or a truncated condition. */
export function wikiExistingExplanations(sections:FocusSection[],titles:string[],limit=1800,scoped=true,recent=false):WikiExistingExplanation[]{
 const result:WikiExistingExplanation[]=[],candidates:WikiExistingExplanation[]=[],seen=new Set<string>();let size=0;
 for(const section of sections){
  let heading="";const path:Array<{depth:number;title:string}>=[];
  for(const node of parser.parse(section.body).children){
   if(node.type==="heading"){
    if(node.depth===2)heading=text(node);
    if(scoped){while(path.length&&path.at(-1)!.depth>=node.depth)path.pop();path.push({depth:node.depth,title:text(node)});}
    continue;
   }
   if(scoped&&node.type==="paragraph"&&node.children.length===1&&node.children[0].type==="strong"){
    while(path.length&&path.at(-1)!.depth>=7)path.pop();path.push({depth:7,title:text(node)});continue;
   }
   if(node.type!=="paragraph")continue;
   const paragraph=section.body.slice(node.position!.start.offset!,node.position!.end.offset!).trim();
   const scope=scoped&&path.length?path.map(item=>item.title):undefined;
   const key=JSON.stringify([heading,paragraph,section.kind,section.phase,...(scoped?[scope]:[])]);
   if(seen.has(key)||paragraph.length<20)continue;
   seen.add(key);candidates.push({title:heading,text:paragraph,kind:section.kind,...(section.phase?{phase:section.phase}:{}),...(scope?{path:scope}:{})});
  }
 }
 // Same subject first, then the opening, then other chapter explanations.
 // Whole paragraphs preserve the qualification; the caller supplies one owner.
 const rank=(item:WikiExistingExplanation)=>titles.includes(item.title)?0:item.title?2:1;
 let ordered:WikiExistingExplanation[];
 if(recent){
  // Share the allowance across subjects/conditions before adding another
  // paragraph from one scope. Latest prose is navigation, never replacement
  // evidence; original materials and earlier conditions remain in the input.
  const groups=new Map<string,WikiExistingExplanation[]>();
  for(const item of candidates){const key=JSON.stringify([item.title,item.path,item.kind,item.phase]);groups.set(key,[...groups.get(key)??[],item]);}
  const scopes=[...groups.values()].sort((a,b)=>rank(a[0])-rank(b[0]));
  for(const group of scopes)if(group[0].title)group.reverse();
  ordered=[];
  for(let index=0;scopes.some(group=>index<group.length);index++)for(const group of scopes)if(group[index])ordered.push(group[index]);
 }else ordered=candidates.sort((a,b)=>rank(a)-rank(b));
 for(const item of ordered){
  if(size+item.text.length>limit||result.length>=8)continue;
  size+=item.text.length;result.push(item);
 }
 return result;
}

/** Parallel chapters, sequential dependent chunks inside each chapter. A
 * multi-owner direct request stays one job; it is not split for scheduling. */
export function wikiWritingJobs(batches:Array<Array<Pick<OwnedMaterial,"wikiOwnerId">>>):number[][] {
 const owners=new Map<string,number[]>();
 for(const [index,batch] of batches.entries()){
  const ids=[...new Set(batch.map(item=>item.wikiOwnerId))];
  const key=ids.length===1&&ids[0]?ids[0]:`direct:${index}`;
  owners.set(key,[...owners.get(key)??[],index]);
 }
 return [...owners.values()];
}
