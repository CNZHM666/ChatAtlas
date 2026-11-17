import {wikiNarration} from "./wiki-narration";
import {wikiNumberedProse} from "./wiki-numbered-prose";
import {isSourceCaption,readableSourceCaptions,readableUiSketches,withoutPlaceholderFences} from "./wiki-source-code";
import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
import {extractHistoryNotes} from "./wiki-history";
import {aiAdvicePresentation} from "./ai-advice-presentation";
import {restoreWikiLiteralPayloads,wikiBlockPresentation} from "./wiki-block-presentation";
import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {wikiSupplementRanges} from "./wiki-source-supplements";
import type {WikiKnowledgeUnit} from "./wiki-knowledge";
import {withoutUnrelatedScopeNotes} from "./wiki-scope-identity";
import {consolidateWikiPlanTables} from "./wiki-plan-tables";

const parser=unified().use(remarkParse);
const GENERATED_LINK = /<Link\s+url=(?:"([^"\n]+)"|'([^'\n]+)'|\{(turn\w+\.url\.uri)\})\s+title=(?:"([^"\n]+)"|'([^'\n]+)')\s*\/\s*>/giu;
const SOURCE_SHAPE = /\s*(?:[（(](?:(?:涉及|包含|includes?)\s+)?(?:table\s*,\s*\d+\s+rows?|[\w+#.-]+\s*,\s*\d+\s+lines?)[)）])/giu;

/** Old generated prose sometimes includes tool-only links or request metadata.
 * Keep the title and evidence wording, and surface a missing URL explicitly. */
function cleanGeneratedAnnotations(body:string,zh:boolean):string {
 if(!/<Link\b|<badge\b|\d+\s+(?:rows?|lines?)\s*[)）]/iu.test(body))return body;
 for(const block of wikiDocumentBlocks(body).reverse()){
  if(!["paragraph","table","list","html"].includes(block.kind))continue;
  const original=body.slice(block.start,block.end);
  const updated=original.replace(/`+[^`\n]+`+|<Link\s+[^<>\n]+\/\s*>|<\/?badge(?:\s+[^<>\n]*)?>|\s*[（(][^()（）\n]{1,70}[)）]/giu,match=>{
   if(match.startsWith("`"))return match;
   if(/^<\/?badge/iu.test(match))return "";
   return match.replace(GENERATED_LINK,(_all,url:string,quoted:string,_unresolved:string,title:string,otherTitle:string)=>{
    const label=(title??otherTitle).replace(/[[\]]/gu,"\\$&");
    const href=url??quoted??"";
    return /^https?:\/\/[^\s<>"']+$/iu.test(href)
     ?`[${label}](<${href}>)`:`${label}${zh?"（来源链接待核验）":" (source link unverified)"}`;
   }).replace(SOURCE_SHAPE,"");
  });
  if(updated!==original)body=body.slice(0,block.start)+updated+body.slice(block.end);
 }
 return body;
}
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

/** A generic routing summary adds no scope when the next sentence explains
 * the same local/remote split with its actual criteria. */
function dropRepeatedRoutingLead(body:string):string {
 const short=/^(?:AI\s*规划)?采用混合解析策略[：:]简单命令(?:由)?本地(?:零成本)?处理[，,]复杂需求才调用\s*LLM(?:[，,]以优化速度、成本和可靠性)?。\s*/u;
 const specific=/^通过\s*[\w().]+\s*区分\s*Simple[（(][^）)\n]+[）)]\s*和\s*Complex[（(][^）)\n]+[）)]/u;
 const attachments=wikiSupplementRanges(body);
 for(const block of wikiDocumentBlocks(body).reverse()){
  if(block.kind!=="paragraph"||attachments.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  const lead=short.exec(block.text)?.[0];
  if(!lead||!specific.test(block.text.slice(lead.length)))continue;
  body=body.slice(0,block.start)+block.text.slice(lead.length)+body.slice(block.end);
 }
 return body;
}

/** Clarify wording that makes a historical proposal sound like an
 * engineering guarantee. The saved claim and literal sources stay intact. */
function clarifyGeneratedProse(body:string,zh:boolean):string {
 if(!zh||!/数据库保证电气兼容性|学习路线规划|关闭(?:浏览器|页面).*消失/u.test(body))return body;
 const ranges=wikiSupplementRanges(body);
 const blocks=wikiDocumentBlocks(body);
 for(let index=blocks.length-1;index>=0;index--){
  const block=blocks[index];
  if(ranges.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  let revised=block.text;
  if(block.kind==="heading"&&/^#{1,6} 学习路线规划$/u.test(revised)){
   const next=blocks[index+1];
   if(next?.kind==="paragraph"&&/^(?:V\d+|第一版).{0,45}(?:功能边界|支持范围|范围)/u.test(next.text))revised=revised.replace("学习路线规划","第一版范围与识别边界");
  }else if(block.kind==="paragraph"||block.kind==="list"){
   if(/^(?:[“「>]|\s*`)/u.test(revised))continue;
   revised=revised
    .replace(/(规则引擎[^。！\n]{0,35})数据库保证电气兼容性/gu,"$1目录提供元件参数，由规则引擎检查已知电气约束")
    .replace(/（sessionStorage）[，,]\s*关闭浏览器后消失/gu,"（sessionStorage），按标签页会话管理。刷新和恢复会话时需单独核对保留行为")
    .replace(/(关闭页面时[“「]仅本次使用[”」]的\s*Key\s*消失)(?=\s*[。\n]|$)/gu,"验证「仅本次使用」的 Key 在新会话中不可用，并单独测试刷新和会话恢复");
  }
  if(revised!==block.text)body=body.slice(0,block.start)+revised+body.slice(block.end);
 }
 return body;
}

/** A paragraph restating another adds length, not knowledge. The chapter's two
 * opening paragraphs often say the same thing twice (a summary, then a longer
 * summary): the one the other mostly covers goes. Elsewhere only near-verbatim
 * repeats of an earlier paragraph go. Lists, quotes, code and tables are kept. */
function dropRepeatedParagraphs(body:string):string {
 const blocks=wikiDocumentBlocks(body);
 // A source block's caption is no paragraph to compare: every block of a chapter has the same one.
 const items=blocks.map((block,index)=>{
  const next=blocks[index+1];
  if(block.kind!=="paragraph"||isSourceCaption(block.text,next&&{type:next.kind,text:next.text})
   || /^(?:原文来源|Original source|Source references?)\s+\[/iu.test(block.text))return;
  return {index,start:block.start,end:block.end,grams:grams(block.text)};
 });
 const dropped=new Set<number>();
 // The opening is the first two paragraphs before any heading; a status quote may precede them.
 const heading=blocks.findIndex(block=>block.kind==="heading");
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
export function wikiReadingFormat(body:string,section:Pick<FocusSection,"userEdited"|"origin">,options:{zh?:boolean;units?:WikiKnowledgeUnit[];citeTable?:(unit:WikiKnowledgeUnit)=>string}={}):string {
 // Personal text stays as written; only block captions, which are labels and not its words, read like the rest.
 if(section.userEdited||section.origin)return readableSourceCaptions(body);
 // Narration cleanup runs here too, so exports read like the Reader ("AI发现了", not "AI建议发现了"; no "据讨论，" lead-ins).
 const prose=wikiNarration(aiAdvicePresentation(extractHistoryNotes(withoutUnrelatedScopeNotes(withoutPlaceholderFences(body))).body));
 const formatted=readableUiSketches(readableSourceCaptions(splitLongParagraphs(promotePseudoHeadings(dropRepeatedParagraphs(wikiNumberedProse(dropRepeatedRoutingLead(prose))))),true));
 const reading=wikiBlockPresentation(restoreWikiLiteralPayloads(body,clarifyGeneratedProse(formatted,options.zh??true)),options).body;
 return consolidateWikiPlanTables(cleanGeneratedAnnotations(reading,options.zh??true),options.zh??true,options);
}
