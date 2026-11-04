import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
import {wikiExplanatorySentenceCount,wikiSentenceCoverage,wikiSentenceRepeats} from "./wiki-cross-duplicates";

const parser=unified().use(remarkParse);
/** A batch-written chapter introduction ("本章概述/说明/梳理…"). */
const META=/^(?:本章|这一章|本节)/u;
/** Paragraphs this short carry too little to judge as a repeat. */
const MIN_REPEAT=40;
const SENTENCE=/(?<=[。！？])/u;
const CITATION=/\[\^?e\d+(?::\d+)?\]|【e\d+(?::\d+)?】/giu;
/** A paragraph that repeats some sentences of earlier text keeps only its new ones.
 * Citation markers of a dropped sentence move to its neighbour; a sentence holding
 * a span tag, code or a claim found nowhere else stays. */
function withoutRepeatedSentences(value:string,earlier:string[],keeps:(sentence:string)=>boolean):string {
 const sentences=value.split(SENTENCE),seen=[...earlier],kept:string[]=[];let carried="";
 for(const sentence of sentences){
  const removable=!/<\/?e\d|`/u.test(sentence)&&!keeps(sentence)&&wikiSentenceRepeats(sentence.replace(CITATION,""),seen);
  seen.push(sentence);
  if(!removable){kept.push(carried?carried+sentence.trimStart():sentence);carried="";continue;}
  const markers=(sentence.match(CITATION)??[]).join("");
  if(kept.length)kept[kept.length-1]+=markers;else carried+=markers;
 }
 if(!kept.length)return value;
 return kept.join("").replace(/^\s+/u,"");
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
 const claims=(section.claims??[]).flatMap(claim=>[claim.text,...claim.formulations??[]]).filter(Boolean);
 const nodes=parser.parse(body).children,firstHeading=nodes.findIndex(node=>node.type==="heading");
 const text=(index:number)=>body.slice(nodes[index].position!.start.offset!,nodes[index].position!.end.offset!);
 const removed=new Set<number>(),kept:string[]=[],trimmed=new Map<number,string>();
 const ownsClaim=(index:number)=>{const value=text(index);return claims.some(claim=>value.includes(claim)&&!nodes.some((_,other)=>other!==index&&!removed.has(other)&&text(other).includes(claim)));};
 nodes.forEach((node,index)=>{
  if(node.type!=="paragraph"){return;}
  const value=text(index);
  const leading=firstHeading<0||index<firstHeading;
  const extraIntro=leading&&kept.length>0&&META.test(value.trim());
  // Only explanatory sentences count: a paragraph whose one sentence also carries
  // a status phrase, or a run of fragments, is never judged a repeat.
  const repeat=value.length>=MIN_REPEAT&&wikiExplanatorySentenceCount(value)>0&&kept.length>0&&wikiSentenceCoverage(value,kept.join("\n\n"),.9)===1;
  if((extraIntro||repeat)&&!ownsClaim(index)){removed.add(index);return;}
  // Bold markup is not wording: "**原始消息是事实来源**" restates the same claim.
  const plain=(text:string)=>text.replace(/\*\*|__/gu,""),unmarked=plain(body);
  const once=(sentence:string)=>claims.some(claim=>plain(sentence).includes(claim)&&unmarked.split(claim).length===2);
  const own=withoutRepeatedSentences(value,kept.flatMap(text=>text.split(SENTENCE)),once);
  if(own!==value)trimmed.set(index,own);
  kept.push(own);
 });
 if(!removed.size&&!trimmed.size)return body;
 let next=body;
 for(const index of [...removed,...trimmed.keys()].sort((a,b)=>b-a)){
  const start=nodes[index].position!.start.offset!,end=nodes[index].position!.end.offset!;
  next=next.slice(0,start)+(trimmed.get(index)??"")+next.slice(end);
 }
 return next.replace(/\n{3,}/gu,"\n\n").trim();
}
