import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
import {isSourceCaption} from "./wiki-source-code";
import {wikiExplanatorySentenceCount,wikiSentenceCoverage,wikiSentenceRepeats} from "./wiki-cross-duplicates";

const parser=unified().use(remarkParse);
/** A batch-written chapter introduction ("本章概述/说明/梳理…"). */
const META=/^(?:本章|这一章|本节)/u;
/** Paragraphs this short carry too little to judge as a repeat. */
const MIN_REPEAT=40;
const SENTENCE=/(?<=[。！？])/u;
const CITATION=/\[\^?e\d+(?::\d+)?\]|【e\d+(?::\d+)?】/giu;
const LABELLED=/^\s*\*\*[^*\n]{1,16}\*\*\s*[：:]/u;
/** A paragraph that repeats some sentences of earlier text keeps only its new ones.
 * Citation markers of a dropped sentence move to its neighbour; a sentence holding
 * a span tag, code or a claim found nowhere else stays. */
function withoutRepeatedSentences(value:string,earlier:string[],keeps:(sentence:string)=>boolean):string {
 const sentences=value.split(SENTENCE),seen=[...earlier],kept:string[]=[];let carried="";
 for(const sentence of sentences){
  // A sentence opening on its label ("**AI 批改**：完全正确。") says whose words follow: dropped as a repeat of an
  // earlier exercise's verdict, the next review lost its label and read as the text's own.
  const removable=!/<\/?e\d|`/u.test(sentence)&&!LABELLED.test(sentence)&&!keeps(sentence)&&wikiSentenceRepeats(sentence.replace(CITATION,""),seen);
  seen.push(sentence);
  if(!removable){kept.push(carried?carried+sentence.trimStart():sentence);carried="";continue;}
  const markers=(sentence.match(CITATION)??[]).join("");
  if(kept.length)kept[kept.length-1]+=markers;else carried+=markers;
 }
 if(!kept.length)return value;
 return kept.join("").replace(/^\s+/u,"");
}

/** A numbered list opening a subtopic counts from 1: a writer that left out its first step started at "2. **第2周**".
 * A list resumed after an example block keeps its numbers. */
function renumberedHeadLists(body:string):string {
 return body.replace(/(^#{2,6} [^\n]+\n\n)((?:\d+\.\s[^\n]*(?:\n|$))+)/gmu,(whole,heading:string,list:string)=>{
  const first=Number(list.match(/^(\d+)\./u)?.[1]??1);
  if(first<=1)return whole;
  let next=0;
  return heading+list.replace(/^\d+\.(?=\s)/gmu,()=>`${++next}.`);
 });
}

/** Reading projection for a generated chapter written in several batches: keep
 * its first introduction and drop further "本章…" introductions before the first
 * heading, and drop a paragraph whose every sentence an earlier paragraph of the
 * same chapter already states, and drop single sentences an earlier paragraph
 * already says. Saved text, personal chapters, code, tables,
 * quotations and lists are unchanged; a paragraph holding a claim formulation
 * found nowhere else in the chapter is always kept. */
export function wikiReadingCleanup(body:string,section:Pick<FocusSection,"claims"|"userEdited"|"origin">):string {
 if(section.userEdited||section.origin)return body;
 body=renumberedHeadLists(body);
 const claims=(section.claims??[]).flatMap(claim=>[claim.text,...claim.formulations??[]]).filter(Boolean);
 const nodes=parser.parse(body).children,firstHeading=nodes.findIndex(node=>node.type==="heading");
 const text=(index:number)=>body.slice(nodes[index].position!.start.offset!,nodes[index].position!.end.offset!);
 const removed=new Set<number>(),kept:string[]=[],trimmed=new Map<number,string>();
 const onlyUnderHeading=(index:number)=>{
  let start=index;while(start>0&&nodes[start-1].type!=="heading")start--;
  if(start===0)return false;
  let end=index+1;while(end<nodes.length&&nodes[end].type!=="heading")end++;
  return end-start===1;
 };
 const ownsClaim=(index:number)=>{const value=text(index);return claims.some(claim=>value.includes(claim)&&!nodes.some((_,other)=>other!==index&&!removed.has(other)&&text(other).includes(claim)));};
 nodes.forEach((node,index)=>{
  if(node.type!=="paragraph"){return;}
  const value=text(index);
  // A source block's caption says whose the block under it is; the second in a chapter reads as a repeat of the first.
  if(isSourceCaption(value,nodes[index+1]&&{type:nodes[index+1].type,text:text(index+1)}))return;
  const leading=firstHeading<0||index<firstHeading;
  const extraIntro=leading&&kept.length>0&&META.test(value.trim());
  // Only explanatory sentences count: a paragraph whose one sentence also carries
  // a status phrase, or a run of fragments, is never judged a repeat.
  const repeat=value.length>=MIN_REPEAT&&wikiExplanatorySentenceCount(value)>0&&kept.length>0&&wikiSentenceCoverage(value,kept.join("\n\n"),.9)===1;
  // A subtopic's only paragraph stays though the opening said it first: dropped, 「pytest测试」 was left a bare heading.
  if((extraIntro||repeat)&&!ownsClaim(index)&&!onlyUnderHeading(index)){removed.add(index);return;}
  // Bold markup is not wording: "**原始消息是事实来源**" restates the same claim.
  const plain=(text:string)=>text.replace(/\*\*|__/gu,""),unmarked=plain(body);
  const once=(sentence:string)=>claims.some(claim=>plain(sentence).includes(claim)&&unmarked.split(claim).length===2);
  const own=withoutRepeatedSentences(value,kept.flatMap(text=>text.split(SENTENCE)),once);
  if(own!==value&&(own.trim()||!onlyUnderHeading(index)))trimmed.set(index,own);
  kept.push(own.trim()||!onlyUnderHeading(index)?own:value);
 });
 if(!removed.size&&!trimmed.size)return body;
 let next=body;
 for(const index of [...removed,...trimmed.keys()].sort((a,b)=>b-a)){
  const start=nodes[index].position!.start.offset!,end=nodes[index].position!.end.offset!;
  next=next.slice(0,start)+(trimmed.get(index)??"")+next.slice(end);
 }
 return next.replace(/\n{3,}/gu,"\n\n").trim();
}
