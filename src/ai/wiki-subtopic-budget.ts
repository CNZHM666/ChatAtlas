import {unified} from "unified";
import remarkParse from "remark-parse";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import type {FocusSection} from "../shared/focus-session";

const parser=unified().use(remarkParse);
/** Chinese explanation characters (whitespace excluded) per ## subtopic, about two
 * paragraphs. Calibrated on real exports: 75 subtopics averaged 214 characters. */
export const WIKI_CHARACTERS_PER_SUBTOPIC=350;
/** A subsection with less of its own explanation, about one short paragraph, joins a neighbour. */
export const WIKI_MIN_SUBTOPIC_CHARACTERS=150;
/** English needs about this many more characters for the same explanation. */
const LATIN_SCALE=2.5;

const proseLength=(text:string)=>Array.from(text.replace(/^#{1,6}\s[^\n]*$/gmu,"").replace(/\s+/gu,"")).length;
/** 1 for mostly Chinese prose, LATIN_SCALE otherwise. */
export function wikiProseScale(text:string):number {
 const visible=text.replace(/\s+/gu,"");
 return visible&&(visible.match(/\p{Script=Han}/gu)?.length??0)/Array.from(visible).length>=.3?1:LATIN_SCALE;
}
export const wikiSubtopicBudget=(characters:number,scale=1)=>Math.floor(characters/(WIKI_CHARACTERS_PER_SUBTOPIC*scale));

interface Part {title:string;heading:string;content:string;/** Original headings joined into this part. */parts:string[]}
/** A merged or duplicated heading whose name no longer covers its content. */
export interface WikiHeadingToName {/** Position among the chapter's ## headings. */index:number;heading:string;parts:string[];excerpt:string}
const headingTitle=(heading:string)=>heading.replace(/^##\s+/u,"").trim();
const nameKey=(text:string)=>text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{Z}\s]/gu,"");

/** Merges ## subsections of one written chapter until each has enough explanation
 * and their number fits the chapter's prose. Only heading lines are removed or
 * renamed; every paragraph, citation and code block stays, in original order.
 * The heading kept for two merged neighbours is the one with more explanation;
 * toName lists merged or duplicated headings so their names can be corrected. */
export function mergeThinWikiSubtopics(body:string):{body:string;merged:number;toName:WikiHeadingToName[]} {
 const headings=parser.parse(body).children.filter(node=>node.type==="heading"&&node.depth===2);
 if(headings.length<2)return {body,merged:0,toName:[]};
 const lead=body.slice(0,headings[0].position!.start.offset!);
 let parts:Part[]=headings.map((node,index)=>{
  const start=node.position!.start.offset!,end=node.position!.end.offset!,next=headings[index+1]?.position!.start.offset??body.length;
  const heading=body.slice(start,end),title=headingTitle(heading);
  return {title,heading,content:body.slice(end,next),parts:[title]};
 });
 const size=(part:Part)=>proseLength(part.content);
 const join=(index:number)=>{
  const [a,b]=[parts[index],parts[index+1]];
  const keep=size(b)>size(a)?b:a;
  parts=[...parts.slice(0,index),{title:keep.title,heading:keep.heading,content:`${a.content.trimEnd()}\n\n${b.content.trimStart()}`,parts:[...a.parts,...b.parts]},...parts.slice(index+2)];
 };
 const scale=wikiProseScale(body),original=parts.length,budget=wikiSubtopicBudget(parts.reduce((sum,part)=>sum+size(part),0),scale);
 for(;;){
  if(parts.length<2)break;
  const thin=parts.map((part,index)=>({index,size:size(part)})).filter(item=>item.size<WIKI_MIN_SUBTOPIC_CHARACTERS*scale).sort((a,b)=>a.size-b.size)[0];
  if(thin){
   // Join the thin subsection with its smaller neighbour.
   const {index}=thin,before=index>0?size(parts[index-1]):Infinity,after=index<parts.length-1?size(parts[index+1]):Infinity;
   join(before<=after?index-1:index);continue;
  }
  if(parts.length<=Math.max(1,budget))break;
  let best=0;
  for(let index=1;index<parts.length-1;index++)if(size(parts[index])+size(parts[index+1])<size(parts[best])+size(parts[best+1]))best=index;
  join(best);
 }
 // Joined headings, and a later heading repeating an earlier sibling's name, need a name of their own.
 const seen=new Set<string>();
 const toName=parts.length<2?[]:parts.flatMap((part,index)=>{
  const key=nameKey(part.title),duplicate=seen.has(key);seen.add(key);
  const joined=new Set(part.parts.map(nameKey)).size>1;
  return joined||duplicate?[{index,heading:part.title,parts:part.parts,excerpt:part.content.replace(/\s+/gu," ").trim().slice(0,160)}]:[];
 });
 if(parts.length===original)return {body,merged:0,toName};
 // One remaining heading only repeats the chapter title; the chapter becomes continuous prose.
 const sections=parts.length===1?[parts[0].content.trim()]:parts.map(part=>`${part.heading}\n\n${part.content.trim()}`);
 return {body:[lead.trim(),...sections].filter(Boolean).join("\n\n")+"\n",merged:original-parts.length,toName};
}

/** A brief note under a related topic can keep its label without a separate directory entry. */
export function foldAdjacentWikiNotes(body: string) {
 const blocks=wikiDocumentBlocks(body);
 const headings=blocks.flatMap((block,index)=>/^### [^\n]+$/u.test(block.text)&&block.kind==="heading"?[index]:[]);
 const folded=new Map<string,string>();
 let text=body;
 for(let index=headings.length-1;index>0;index--){
  const start=headings[index],prior=headings[index-1],end=headings[index+1]??blocks.length;
  const heading=blocks[start],previous=blocks[prior];
  const items=blocks.slice(start+1,end);
  if(items.length!==1||items[0].kind!=="paragraph"||proseLength(items[0].text)>WIKI_MIN_SUBTOPIC_CHARACTERS*wikiProseScale(items[0].text)
   ||blocks.slice(prior+1,start).some(block=>block.kind==="heading"||block.kind==="html"||block.kind==="thematicBreak")
   ||/历史|此前|待决|引用|history|earlier|pending|citation/iu.test(heading.text))continue;
  const title=heading.text.slice(4),parent=previous.text.slice(4),terms=knowledgeTerms(title),priorTerms=knowledgeTerms(blocks.slice(prior,start).map(block=>block.text).join("\n"));
  const shared=[...terms].filter(term=>priorTerms.has(term));
  if(title===parent||shared.length<2||shared.length<terms.size*.5||headings.filter(at=>blocks[at].text===heading.text).length>1)continue;
  text=text.slice(0,heading.start)+"**"+title+"**"+text.slice(heading.end);
  folded.set(title,parent);
 }
 for(const [title,parent] of folded){
  let root=parent;
  while(folded.has(root)&&folded.get(root)!==root)root=folded.get(root)!;
  folded.set(title,root);
 }
 return {body:text,folded};
}

/** Generated chapters only; a user's own structure is never merged. */
export function mergeThinWikiChapters(sections:FocusSection[]):{sections:FocusSection[];merged:number;toName:Array<WikiHeadingToName&{sectionId:string}>} {
 let merged=0;
 const toName:Array<WikiHeadingToName&{sectionId:string}>=[];
 const next=sections.map(section=>{
  if(section.userEdited||section.origin||section.structureEdited)return section;
  const result=mergeThinWikiSubtopics(section.body);
  toName.push(...result.toName.map(item=>({...item,sectionId:section.id})));
  if(!result.merged)return section;
  merged+=result.merged;
  const remaining=new Set(parser.parse(result.body).children.flatMap(node=>node.type==="heading"&&node.depth===2?[headingTitle(result.body.slice(node.position!.start.offset!,node.position!.end.offset!))]:[]));
  const subtopics=section.wikiSubtopics?.filter(topic=>remaining.has(topic.title));
  return {...section,body:result.body,...(section.wikiSubtopics?{wikiSubtopics:subtopics?.length?subtopics:undefined}:{})};
 });
 return {sections:next,merged,toName};
}

/** Renames level-two headings of one chapter by position; its outline follows a
 * renamed heading whose old name is not shared with another heading. */
export function renameWikiSubheadings(section:FocusSection,names:Map<number,string>):FocusSection {
 if(!names.size)return section;
 let fenced=false,index=-1;
 const renamed=new Map<string,string>(),counts=new Map<string,number>();
 const body=section.body.split("\n").map(line=>{
  if(/^\s*(```|~~~)/u.test(line)){fenced=!fenced;return line;}
  const match=!fenced&&line.match(/^##\s+(.+?)\s*$/u);
  if(!match)return line;
  index++;counts.set(match[1],(counts.get(match[1])??0)+1);
  const name=names.get(index);if(!name)return line;
  renamed.set(match[1],name);return `## ${name}`;
 }).join("\n");
 const wikiSubtopics=section.wikiSubtopics?.map(topic=>renamed.has(topic.title)&&counts.get(topic.title)===1?{...topic,title:renamed.get(topic.title)!}:topic);
 return {...section,body,...(wikiSubtopics?{wikiSubtopics}:{})};
}
