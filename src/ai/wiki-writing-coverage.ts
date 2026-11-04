import {unified} from "unified";
import remarkParse from "remark-parse";
import type {RootContent} from "mdast";
import type {FocusSection} from "../shared/focus-session";
import type {DirectoryPage} from "./wiki-directory";
import type {CoverageMaterial} from "./focus-coverage";
import {AIProviderValidationError} from "./provider-errors";

const parser=unified().use(remarkParse);
const text=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>text(child as RootContent)).join(""):"";
const key=(title:string)=>title.normalize("NFKC").replace(/\s+/gu," ").trim();
const belongs=(item:CoverageMaterial,ids:string[])=>ids.some(id=>item.id===id||item.id.startsWith(`${id}:`));
export const batchSubtopics=(page:DirectoryPage,batch:CoverageMaterial[])=>page.subtopics?.filter(topic=>batch.some(item=>belongs(item,topic.sectionIds)))??[];

/** Send whole support for only the missing topics. Shared support stays whole;
 * unrelated notes/code must not inflate a small completion's reservation. */
export function wikiMissingTopicBatch(batch:CoverageMaterial[],pages:DirectoryPage[],missing:Array<{ownerId:string;titles:string[]}>):CoverageMaterial[]{
 return batch.filter(item=>missing.some(target=>{
  if(item.wikiOwnerId!==target.ownerId)return false;
  const page=pages.find(page=>(page.ownerId??page.sectionIds[0])===target.ownerId);
  return page?.subtopics?.some(topic=>target.titles.includes(topic.title)&&belongs(item,topic.sectionIds));
 }));
}

/** Normalize only headings with an exact known identity. Never infer a renamed
 * topic from similar prose, and never count empty headings as coverage. */
export function validateWikiWritingCoverage(sections:FocusSection[],pages:DirectoryPage[],batch:CoverageMaterial[]):FocusSection[]{
 const output=sections.map(section=>({...section}));
 for(const page of pages){
  const owner=page.ownerId??page.sectionIds[0],expected=batchSubtopics(page,batch);
  if(!expected.length)continue;
  const owned=output.filter(section=>section.wikiOwnerId===owner),covered=new Set<string>();
  for(const section of owned){
   let nodes=parser.parse(section.body).children;
   // Some providers return one section per supplied subtopic, with its exact
   // title but no repeated ## label in body. That is an explicit scope, not a
   // missing explanation. Preserve it before canonicalizing the page title.
   const declared=expected.find(topic=>key(topic.title)===key(section.title));
   const ownIds=section.evidenceIds.filter(id=>batch.some(item=>item.id===id&&item.wikiOwnerId===owner));
   if(expected.length>1&&declared&&ownIds.length&&ownIds.every(id=>batch.some(item=>item.id===id&&belongs(item,declared.sectionIds)))&&!nodes.some(node=>node.type==="heading"&&expected.some(topic=>key(topic.title)===key(text(node))))){
    const headings=nodes.filter(node=>node.type==="heading"),shift=Math.max(0,3-Math.min(6,...headings.map(node=>node.depth)));
    for(const heading of headings.reverse()){
     const start=heading.position!.start.offset!,end=heading.position!.end.offset!;
     section.body=section.body.slice(0,start)+`${"#".repeat(Math.min(6,heading.depth+shift))} ${text(heading)}`+section.body.slice(end);
    }
    section.body=`## ${declared.title}\n\n${section.body}`;nodes=parser.parse(section.body).children;
   }
   const replacements:Array<{start:number;end:number;value:string}>=[];
   for(const [index,node] of nodes.entries()){
    if(node.type!=="heading")continue;
    const topic=expected.find(topic=>key(topic.title)===key(text(node)));if(!topic)continue;
    const end=nodes.findIndex((next,at)=>at>index&&next.type==="heading"&&next.depth<=node.depth);
    if(!nodes.slice(index+1,end<0?undefined:end).some(next=>next.type!=="heading"&&next.type!=="thematicBreak"&&text(next).trim()))continue;
    covered.add(topic.title);
    replacements.push({start:node.position!.start.offset!,end:node.position!.end.offset!,value:`## ${topic.title}`});
   }
   for(const change of replacements.reverse())section.body=section.body.slice(0,change.start)+change.value+section.body.slice(change.end);
   // One explicitly assigned topic is an unambiguous scope; existing inner
   // headings stay subordinate. Its label never supplies missing content.
   if(expected.length===1&&!covered.has(expected[0].title)&&nodes.some(node=>node.type!=="heading"&&node.type!=="thematicBreak"&&text(node).trim())){
    const topic=expected[0],ownIds=section.evidenceIds.filter(id=>batch.some(item=>item.id===id&&item.wikiOwnerId===owner));
    if(ownIds.length&&ownIds.every(id=>batch.some(item=>item.id===id&&belongs(item,topic.sectionIds)))){
     const headings=parser.parse(section.body).children.filter(node=>node.type==="heading"),shift=Math.max(0,3-Math.min(6,...headings.map(node=>node.depth)));
     for(const heading of headings.reverse()){const start=heading.position!.start.offset!,end=heading.position!.end.offset!;section.body=section.body.slice(0,start)+`${"#".repeat(Math.min(6,heading.depth+shift))} ${text(heading)}`+section.body.slice(end);}
     // Keep a standalone opening before the outline. Wrapping the entire body
     // previously turned real overviews into child excerpts in the Reader.
     const first=parser.parse(section.body).children.find(node=>node.type==="heading");
     const at=first?.position?.start.offset??0;
     section.body=section.body.slice(0,at)+`## ${topic.title}\n\n`+section.body.slice(at);covered.add(topic.title);
    }
   }
  }
  if(expected.some(topic=>!covered.has(topic.title))){const error=new AIProviderValidationError("wiki_subtopic_missing");error.fieldPaths=owned.map(section=>`sections[${output.indexOf(section)}].body`);error.wikiMissingSubtopics=[{ownerId:owner,titles:expected.filter(topic=>!covered.has(topic.title)).map(topic=>topic.title)}];throw error;}
 }
 return output;
}

/** Shared child support is a connected scope: never split one material into
 * several writing requests. Independent components can recover separately. */
export function splitWikiWritingBatch(batch:CoverageMaterial[],pages:DirectoryPage[]):CoverageMaterial[][]|undefined {
 const roots=new Map<string,string>();
 const root=(id:string):string=>{const parent=roots.get(id);if(!parent){roots.set(id,id);return id;}if(parent===id)return id;const result=root(parent);roots.set(id,result);return result;};
 const scopes=batch.map(item=>pages.flatMap(page=>(page.subtopics??[]).flatMap((topic,index)=>belongs(item,topic.sectionIds)?[`${page.ownerId??page.sectionIds[0]}:${index}`]:[])));
 if(scopes.some(items=>!items.length))return;
 for(const items of scopes)for(const scope of items.slice(1))roots.set(root(scope),root(items[0]));
 const groups=new Map<string,CoverageMaterial[]>();
 for(const [index,item] of batch.entries()){const scope=root(scopes[index][0]),group=groups.get(scope)??[];group.push(item);groups.set(scope,group);}
 if(groups.size<2)return;
 const values=[...groups.values()],middle=Math.ceil(values.length/2);
 return [values.slice(0,middle).flat(),values.slice(middle).flat()];
}

/** Retry omitted chapters along explicit owner bindings, without guessing titles
 * or spreading one chapter's evidence across another chapter. */
export function splitWikiOwnerBatch(batch:CoverageMaterial[]):CoverageMaterial[][]|undefined {
 const groups=new Map<string,CoverageMaterial[]>();
 for(const item of batch){if(!item.wikiOwnerId)return;groups.set(item.wikiOwnerId,[...groups.get(item.wikiOwnerId)??[],item]);}
 if(groups.size<2)return;
 const values=[...groups.values()],middle=Math.ceil(values.length/2);
 return [values.slice(0,middle).flat(),values.slice(middle).flat()];
}
