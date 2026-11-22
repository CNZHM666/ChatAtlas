import { illustrativeWikiFlow } from "./wiki-plain-block";
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
import {WIKI_SUPPLEMENT,wikiSupplementRanges} from "./wiki-source-supplements";
import {NEGATION,protectedDifference, type WikiKnowledgeUnit} from "./wiki-knowledge";
import {withoutUnrelatedScopeNotes} from "./wiki-scope-identity";
import {consolidateWikiPlanTables} from "./wiki-plan-tables";
import {orderWikiFeatureReading} from "./wiki-feature-reading";
import {wikiTableCells,wikiTableKey} from "./wiki-table-source";

const parser=unified().use(remarkParse);
const GENERATED_LINK = /<Link\s+url=(?:"([^"\n]+)"|'([^'\n]+)'|\{(turn\w+\.url\.uri)\})\s+title=(?:"([^"\n]+)"|'([^'\n]+)')\s*\/\s*>/giu;
const SOURCE_SHAPE = /\s*(?:[（(](?:(?:涉及|包含|includes?)\s+)?(?:table\s*,\s*\d+\s+rows?|[\w+#.-]+\s*,\s*\d+\s+lines?)[)）])/giu;

function generatedReadingDetails(body:string,section:Pick<FocusSection,"claims">,zh:boolean) {
 if(!/\*{4}|以下组件另有取值|具体组件另有取值|individual components have separate values/iu.test(body))return body;
 const attachments=wikiSupplementRanges(body);
 const blocks=wikiDocumentBlocks(body,section.claims);
 for(const block of [...blocks].reverse()){
  if(attachments.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  let text=block.text;
  if(block.kind==="paragraph"||block.kind==="list"){
   text=text.replace(/^([ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(?:\*\*\*\*)(?!\*)(?:[ \t]*[：:][ \t]*)?/gmu,"$1");
   if(block.kind==="paragraph"){
    for(const claim of block.claims){
     if(claim.holder!=="decided"||claim.checked||/[。.!?]$/u.test(claim.text))continue;
     const at=text.indexOf(claim.text);
     if(at<0||at!==text.lastIndexOf(claim.text))continue;
     const end=at+claim.text.length, tail=text.slice(end);
     const aside=tail.match(/^([（(])((?:以下组件另有取值|具体组件另有取值|individual components have separate values)[^\n()（）]{2,250})[）)][。.]?/iu);
     if(aside&&/未明确|未确认|尚未|待定|unclear|unconfirmed/iu.test(aside[2])){
      text=text.slice(0,end)+(zh?"。":".")+" "+aside[2].replace(/[。.]$/u,"")+(zh?"。":".")+tail.slice(aside[0].length);
     }
    }
   }
  }
  if(text!==block.text)body=body.slice(0,block.start)+text+body.slice(block.end);
 }
 return body;
}

function compactStudyWorksheets(body:string,zh:boolean,options:{units?:WikiKnowledgeUnit[];citeTable?:(unit:WikiKnowledgeUnit)=>string}) {
 if(!/[?？]\s*\|/u.test(body))return body;
 const attachments=wikiSupplementRanges(body);
 const blocks=wikiDocumentBlocks(body);
 for(const [index,block] of [...blocks.entries()].reverse()){
  if(block.kind==="table"&&!attachments.some(([start,end])=>block.start>=start&&block.end<=end)){
   const [head, , ...rows]=block.text.split("\n").map(wikiTableCells);
   const study=head.length>=3&&/^(?:指标|Metric|Measure)$/iu.test(head[0])
    &&head.slice(1).some(cell=>/组|group|cohort/iu.test(cell));
   if(study&&rows.length>=2&&rows.every(row=>row.length===head.length&&row[0]&&row.slice(1).every(cell=>/^[?？]$/u.test(cell)))){
    const previous=blocks[index-1];
    const source=previous?.kind==="paragraph"&&/^(?:表格来源|原文来源|Table source|Original source)\s+\[/iu.test(previous.text)?previous:undefined;
    const key=wikiTableKey(block.text);
    const citations=[...new Set(options.units?.flatMap(unit=>unit.evidence.code?.language==="table"&&wikiTableKey(unit.evidence.code.text)===key
     ?options.citeTable?.(unit)||[]:[])??[])].join(" ");
    const sourceLine=source?.text||(citations?`${zh?"表格来源":"Table source"} ${citations}`:"");
    const metrics=rows.map(row=>row[0]).join(zh?"、":", ");
    const text=(zh?`对照试验拟记录${metrics}。`:`The comparison is designed to track ${metrics}.`)+(citations?" "+citations:"")
     +`\n\n<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${zh?"参考示例 · 1 项":"Reference examples · 1 items"}</summary>\n\n`
     +[zh?"#### 对照试验记录模板":"#### Comparative study worksheet",sourceLine,block.text].filter(Boolean).join("\n\n")+"\n\n</details>";
    body=body.slice(0,source?.start??block.start)+text+body.slice(block.end);
   }
  }
 }
 return body;
}

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
function splitParagraph(text:string,bindings:readonly string[]):string[] {
 if(text.length<=LONG_PARAGRAPH||text.includes("\n"))return [text];
 const locked=bindings.flatMap(binding=>{
  const start=text.indexOf(binding);
  return start>=0?[[start,start+binding.length] as const]:[];
 });
 const middle=text.length/2,point=splitPoints(text).filter(at=>at>=MIN_PART&&text.length-at>=MIN_PART&&
  !locked.some(([start,end])=>start<at&&at<end)&&
  !/^\s*(?:〔|\[(?:〔|S-|来源\d+|Source\s+\d+))/iu.test(text.slice(at))).sort((a,b)=>Math.abs(a-middle)-Math.abs(b-middle))[0];
 if(!point)return [text];
 return [...splitParagraph(text.slice(0,point).trim(),bindings),...splitParagraph(text.slice(point).trim(),bindings)];
}
/** Paragraphs over 250 characters split at the sentence end nearest their middle. */
function splitLongParagraphs(body:string,bindings:readonly string[]):string {
 const nodes=parser.parse(body).children;let next=body;
 for(const node of [...nodes].reverse()){
  if(node.type!=="paragraph")continue;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,parts=splitParagraph(body.slice(start,end),bindings);
  if(parts.length>1)next=next.slice(0,start)+parts.join("\n\n")+next.slice(end);
 }
 return next;
}

const grams=(text:string)=>{const chars=Array.from(text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu,""));return new Set(chars.slice(2).map((_,i)=>chars.slice(i,i+3).join("")));};
/** Share of `a`'s wording that `b` already says. */
const covered=(a:Set<string>,b:Set<string>)=>{if(!a.size)return 0;let shared=0;for(const gram of a)if(b.has(gram))shared++;return shared/a.size;};
const removeRanges=(body:string,ranges:Array<[number,number]>)=>{for(const [start,end] of ranges.sort((a,b)=>b[0]-a[0]))body=body.slice(0,start)+body.slice(end);return body.replace(/\n{3,}/gu,"\n\n").trim();};
const EDITORIAL_SCOPE=/〔[^〕]+〕|\[(?:S-[\w-]+|Decided|Proposed|Earlier|Open)\]|(?:如果|若|仅在|只有|除非|截至)[^，。\n]{1,40}|\b(?:only if|unless|as of)\b[^,.\n]{1,50}|(?:AI\s*)?建议|提议|讨论中|当时|此前|当前|计划|用户报告|已(?:实现|验证|确认)|\b(?:proposed|planned|previously|reported|currently|implemented|verified)\b/giu;
function sameEditorialScope(first:string,second:string){
 return NEGATION.test(first)===NEGATION.test(second) && !protectedDifference(first,second) &&
  JSON.stringify(first.match(EDITORIAL_SCOPE)??[])===JSON.stringify(second.match(EDITORIAL_SCOPE)??[]);
}

const FLOW_TERMS=new Map<string,RegExp>([
 ["validator",/Validator|校验器|验证器/iu],["canvas visualization",/高亮|可视化|visuali[sz]|highlight/iu],
 ["fix",/修复|\bfix\b/iu],["revalidate",/重(?:新|复)验证|再验证|复验|重验|revalidat/iu],
]);

export function compactProposalFlows(body:string,zh:boolean,otherChapters:string[]=[]){
 if(!body.includes("→"))return body;
 const suffix = /(?:（AI\s*建议，未确认(?: · (v\d+(?:\.\d+)*))?）| \(AI suggestion, not confirmed(?: · (v\d+(?:\.\d+)*))?\)|〔建议〕| \[Proposal\])$/iu;
 const parts = wikiDocumentBlocks(body);
 const originals = wikiSupplementRanges(body);
 const prose=[...parts,...otherChapters.flatMap(text=>wikiDocumentBlocks(text))]
  .filter(block=>block.kind==="paragraph"&&!suffix.test(block.text)&&/(?:Canvas|画布)/iu.test(block.text));
 const explanations=prose.filter(block=>!NEGATION.test(block.text)&&
   !/〔(?:已定|此前|未定|资料)〕|(?:此前|当前版本|仅在|除非)|\bv\d|\b(?:must not|never|without)\b/iu.test(block.text));
 const flowKey = (value:string) => value.normalize("NFKC").toLowerCase().replace(/[\s*]/gu,"");
 const seen = new Set<string>(), edits:Array<{start:number;end:number;text:string}>=[];
 let topic = "";
 for(const block of parts){
  if(block.kind==="heading"){topic=block.text;continue;}
  if(block.kind!=="paragraph"||block.text.includes("\n")||!suffix.test(block.text)||
    originals.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  const flow=block.text.replace(suffix,"").trim(), nodes=flow.split(/\s*→\s*/u);
  if(nodes.length<2||nodes.some(node=>node.length>65))continue;
  const matched=suffix.exec(block.text)!,version=matched[1]??matched[2];
  const key=JSON.stringify([topic,version,flowKey(flow)]);
  // A bare list of part names, with no action or outcome, is an illustration.
  const bareParts=nodes.length<=4&&nodes.some(node=>/\d/u.test(node))&&nodes.every(node=>/^[A-Z][A-Z0-9-]{2,20}$/u.test(node));
  const stages=nodes.map(node=>FLOW_TERMS.get(node.toLowerCase()));
  const genericCycle=!version&&stages.length===4&&stages.every(Boolean)
   && new Set(nodes.map(node=>node.toLowerCase())).size===FLOW_TERMS.size
   && !prose.some(({text})=>NEGATION.test(text)&&stages.filter(stage=>stage?.test(text)).length>=2);
  const explained=!version&&stages.length>=3&&stages.every(Boolean)&&explanations.some(({text})=>{
   let at=0;
   return stages.every(pattern=>{
    const match=pattern!.exec(text.slice(at));
    if(!match)return false;
    at+=match.index+match[0].length;
    return true;
   });
  });
  const repeated=seen.has(key), demonstration=!version&&illustrativeWikiFlow(flow);
  seen.add(key);
  const scope=version?(zh?`（${version}）`:` (${version})`):"";
  edits.push({start:block.start,end:block.end,text:!version&&bareParts||repeated||explained||demonstration||genericCycle?"":`${flow}${scope}${zh?"〔建议〕":" [Proposal]"}`});
 }
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return edits.length?body.replace(/\n{3,}/gu,"\n\n").trim():body;
}

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

/** When the same scope suffix has spilled into every row, restore it to the
 * header. Different row prefixes remain separate scopes. */
function restoreTableHeaderScope(body:string):string {
 if(!/(?:[（(][^（）()\n|]+|候选记录[^\n|]{0,55})\|/u.test(body))return body;
 const supplements=wikiSupplementRanges(body);
 for(const block of wikiDocumentBlocks(body).reverse()){
  if(block.kind!=="table"||supplements.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  const original=body.slice(block.start,block.end);
  if(original.includes("\\|"))continue;
  let changed=false;
  const rows=original.split("\n").map(line=>{
   const carried=line.match(/^\s*((?:其他)?候选记录[^|\n]{0,50})[：:]\s*\|(.+)\|\s*(〔[^〕\n]+〕)?\s*$/u);
   const cells=(carried?.[2]??line.trim().replace(/^\||\|$/gu,"")).split("|").map(cell=>cell.trim());
   if(carried){cells[cells.length-1]+=" · "+carried[1]+(carried[3]??"");changed=true;}
   return cells;
  });
  const [head,separator,...data]=rows;
  if(data.length<2||rows.some(row=>row.length!==head.length))continue;
  for(const [index,cell] of head.entries()){
   if(!/[^（）()]+[（(][^（）()]+$/u.test(cell))continue;
   const suffixes=data.map(row=>row[index].match(/^([^（）()：:\n]{1,24})[）)]\s*[：:]\s*(\S.*)$/u));
   const suffix=suffixes[0]?.[1];
   if(!suffix||!suffixes.every(item=>item?.[1]===suffix))continue;
   head[index]=cell+suffix+(cell.includes("（")?"）":")");
   data.forEach((row,at)=>{row[index]=suffixes[at]![2];});
   changed=true;
  }
  if(changed){
   const table=[head,separator,...data].map(row=>"| "+row.join(" | ")+" |").join("\n");
   body=body.slice(0,block.start)+table+body.slice(block.end);
  }
 }
 return body;
}

/** A paragraph restating another adds length, not knowledge. The chapter's two
 * opening paragraphs often say the same thing twice (a summary, then a longer
 * summary): the one the other mostly covers goes. Elsewhere only near-verbatim
 * repeats of an earlier paragraph go. Lists, quotes, code and tables are kept. */
function dropRepeatedParagraphs(body:string,bindings:readonly string[]):string {
 const blocks=wikiDocumentBlocks(body);
 // A source block's caption is no paragraph to compare: every block of a chapter has the same one.
 const items=blocks.map((block,index)=>{
  const next=blocks[index+1];
  if(block.kind!=="paragraph"||isSourceCaption(block.text,next&&{type:next.kind,text:next.text})
   || /^(?:原文来源|Original source|Source references?)\s+\[/iu.test(block.text))return;
  return {index,start:block.start,end:block.end,text:block.text,grams:grams(block.text),bindings:bindings.filter(binding=>block.text.includes(binding))};
 });
 const keepsBindings=(from:{bindings:string[]},into:{text:string})=>from.bindings.every(binding=>into.text.includes(binding));
 const dropped=new Set<number>();
 // The opening is the first two paragraphs before any heading; a status quote may precede them.
 const heading=blocks.findIndex(block=>block.kind==="heading");
 const [first,second]=items.slice(0,heading<0?items.length:heading).filter(item=>item!==undefined);
 if(first&&second&&first.grams.size>=12&&second.grams.size>=12){
  const a=covered(first.grams,second.grams),b=covered(second.grams,first.grams);
  // A similar opening with a different assertion still needs its own paragraph.
  const [shorter,fuller]=a>=b?[first,second]:[second,first];
  if(Math.max(a,b)>=.65&&sameEditorialScope(first.text,second.text)&&keepsBindings(shorter,fuller))dropped.add(shorter.index);
 }
 // Anywhere else, a paragraph another paragraph almost entirely repeats goes; the fuller one stays.
 const paragraphs=items.filter((item):item is NonNullable<typeof item>=>item!==undefined&&item.grams.size>=20);
 for(const item of paragraphs){
  if(dropped.has(item.index))continue;
  const fuller=paragraphs.some(other=>other!==item&&!dropped.has(other.index)&&covered(item.grams,other.grams)>=.8&&sameEditorialScope(item.text,other.text)
   &&keepsBindings(item,other)&&(covered(other.grams,item.grams)<covered(item.grams,other.grams)||other.index<item.index));
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
export function wikiReadingFormat(body:string,section:Pick<FocusSection,"userEdited"|"origin"|"claims">,options:{zh?:boolean;units?:WikiKnowledgeUnit[];citeTable?:(unit:WikiKnowledgeUnit)=>string;tableSources?:readonly {text:string;link:string}[]}={}):string {
 // Personal text stays as written; only block captions, which are labels and not its words, read like the rest.
 if(section.userEdited||section.origin)return readableSourceCaptions(body);
 // Narration cleanup runs here too, so exports read like the Reader ("AI发现了", not "AI建议发现了"; no "据讨论，" lead-ins).
 const sanitized=generatedReadingDetails(body,section,options.zh??true);
 const prose=wikiNarration(aiAdvicePresentation(extractHistoryNotes(withoutUnrelatedScopeNotes(withoutPlaceholderFences(sanitized))).body));
 const bindings=[...new Set(section.claims?.flatMap(claim=>claim.markOnly?[]:[claim.text,...claim.formulations??[]])??[])].filter(Boolean);
 const grouped=restoreTableHeaderScope(promotePseudoHeadings(dropRepeatedParagraphs(wikiNumberedProse(dropRepeatedRoutingLead(prose)),bindings)));
 const formatted=readableUiSketches(readableSourceCaptions(splitLongParagraphs(grouped,bindings),true));
 const reading=wikiBlockPresentation(restoreWikiLiteralPayloads(body,clarifyGeneratedProse(formatted,options.zh??true)),options).body;
 const clean=compactStudyWorksheets(cleanGeneratedAnnotations(reading,options.zh??true),options.zh??true,options);
 return orderWikiFeatureReading(compactProposalFlows(consolidateWikiPlanTables(clean,options.zh??true,options),options.zh??true));
}
