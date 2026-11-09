import {wikiNarration} from "./wiki-narration";
import {isSourceCaption,readableSourceCaptions} from "./wiki-source-code";
import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
import {extractHistoryNotes} from "./wiki-history";
import {aiAdvicePresentation} from "./ai-advice-presentation";

const parser=unified().use(remarkParse);
/** Older saved exports may contain a "> **演变记录**" block; it still renders collapsed. */
export const WIKI_HISTORY_LABEL="演变记录";
const LONG_PARAGRAPH=250,MIN_PART=80;

/** Sentence ends where a paragraph may be split: outside quotes, bold and code. */
function splitPoints(text:string):number[] {
 const points:number[]=[];let quote=0,bold=false,code=false;
 for(let index=0;index<text.length;index++){
  const char=text[index];
  if(char==="`")code=!code;
  else if(text.startsWith("**",index)){bold=!bold;index++;}
  else if("“「『".includes(char))quote++;
  else if("”」』".includes(char))quote=Math.max(0,quote-1);
  else if("。！？".includes(char)&&!quote&&!bold&&!code)points.push(index+1);
 }
 return points;
}
function splitParagraph(text:string):string[] {
 if(text.length<=LONG_PARAGRAPH||text.includes("\n"))return [text];
 const middle=text.length/2,point=splitPoints(text).filter(at=>at>=MIN_PART&&text.length-at>=MIN_PART).sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle))[0];
 if(!point)return [text];
 return [...splitParagraph(text.slice(0,point).trim()),...splitParagraph(text.slice(point).trim())];
}
/** Paragraphs over 250 characters split at the sentence end nearest their middle. */
function splitLongParagraphs(body:string):string {
 const nodes=parser.parse(body).children;let next=body;
 for(const node of [...nodes].reverse()){
  if(node.type!=="paragraph")continue;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,parts=splitParagraph(body.slice(start,end));
  if(parts.length>1)next=next.slice(0,start)+parts.join("\n\n")+next.slice(end);
 }
 return next;
}

const grams=(text:string)=>{const chars=Array.from(text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu,""));return new Set(chars.slice(2).map((_,i)=>chars.slice(i,i+3).join("")));};
/** Share of `a`'s wording that `b` already says. */
const covered=(a:Set<string>,b:Set<string>)=>{if(!a.size)return 0;let shared=0;for(const gram of a)if(b.has(gram))shared++;return shared/a.size;};
const removeRanges=(body:string,ranges:Array<[number,number]>)=>{for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))body=body.slice(0,start)+body.slice(end);return body.replace(/\n{3,}/gu,"\n\n").trim();};

/** A paragraph restating another adds length, not knowledge. The chapter's two
 * opening paragraphs often say the same thing twice (a summary, then a longer
 * summary): the one the other mostly covers goes. Elsewhere only near-verbatim
 * repeats of an earlier paragraph go. Lists, quotes, code and tables are kept. */
function dropRepeatedParagraphs(body:string):string {
 const nodes=parser.parse(body).children;
 // A source block's caption is no paragraph to compare: every block of a chapter has the same one.
 const slice=(index:number)=>body.slice(nodes[index].position!.start.offset!,nodes[index].position!.end.offset!);
 const caption=(index:number)=>isSourceCaption(slice(index),nodes[index+1]&&{type:nodes[index+1].type,text:slice(index+1)});
 const items=nodes.map((node,index)=>node.type==="paragraph"&&!caption(index)?{index,start:node.position!.start.offset!,end:node.position!.end.offset!,grams:grams(body.slice(node.position!.start.offset!,node.position!.end.offset!))}:undefined);
 const dropped=new Set<number>();
 // The opening is the first two paragraphs before any heading; a status quote may precede them.
 const heading=nodes.findIndex(node=>node.type==="heading");
 const [first,second]=items.slice(0,heading<0?items.length:heading).filter(item=>item!==undefined);
 if(first&&second&&first.grams.size>=12&&second.grams.size>=12){
  const a=covered(first.grams,second.grams),b=covered(second.grams,first.grams);
  // Unrelated openings share well under a third of their wording; restatements share about half.
  if(Math.max(a,b)>=.4)dropped.add(a>=b?first.index:second.index);
 }
 // Anywhere else, a paragraph another paragraph almost entirely repeats goes; the fuller one stays.
 const paragraphs=items.filter((item):item is NonNullable<typeof item>=>item!==undefined&&item.grams.size>=20);
 for(const item of paragraphs){
  if(dropped.has(item.index))continue;
  const fuller=paragraphs.some(other=>other!==item&&!dropped.has(other.index)&&covered(item.grams,other.grams)>=.8&&(covered(other.grams,item.grams)<covered(item.grams,other.grams)||other.index<item.index));
  if(fuller)dropped.add(item.index);
 }
 if(!dropped.size)return body;
 return removeRanges(body,[...dropped].map(index=>[items[index]!.start,items[index]!.end]));
}

// A short label line with no sentence punctuation, e.g. "用户痛点与市场空白".
const LABEL_LINE=/^[^\s\p{P}\p{S}\d][^。，、；：:！？!?,.（）()“”"'`*#|>[\]]{1,19}$/u;
/** Generated text sometimes writes a sub-heading as a bare line glued to the next
 * paragraph or list. It becomes a real heading one level below its section. */
function promotePseudoHeadings(body:string):string {
 const nodes=parser.parse(body).children;let depth=1;
 const changes:Array<{start:number;end:number;text:string}>=[];
 nodes.forEach((node,index)=>{
  if(node.type==="heading"){depth=node.depth;return;}
  if(node.type!=="paragraph")return;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,lines=body.slice(start,end).split("\n"),label=lines[0].trim();
  if(!LABEL_LINE.test(label))return;
  const glued=lines.length>1,beforeList=lines.length===1&&nodes[index+1]?.type==="list";
  if(!glued&&!beforeList)return;
  const heading=`${"#".repeat(Math.min(4,Math.max(3,depth+1)))} ${label}`;
  changes.push({start,end,text:glued?`${heading}\n\n${lines.slice(1).join("\n")}`:heading});
 });
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
 return body;
}

/** Reading layout for a generated chapter: "历史：" paragraphs leave the prose (the
 * chapter's evolution card shows them), restated paragraphs go, bare label lines
 * become sub-headings, long paragraphs split. Saved text and personal chapters
 * are unchanged. */
export function wikiReadingFormat(body:string,section:Pick<FocusSection,"userEdited"|"origin">):string {
 if(section.userEdited||section.origin)return body;
 // Narration cleanup runs here too, so exports read like the Reader ("AI发现了", not "AI建议发现了"; no "据讨论，" lead-ins).
 return readableSourceCaptions(splitLongParagraphs(promotePseudoHeadings(dropRepeatedParagraphs(wikiNarration(aiAdvicePresentation(extractHistoryNotes(body).body))))));
}
