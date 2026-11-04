import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {VFile} from "vfile";
import type {Root,Paragraph,PhrasingContent} from "mdast";
import {aiAdvicePresentation} from "./ai-advice-presentation";
import {sourceQuoteText} from "./source-quote-text";

export interface ReaderHighlights {lead?:boolean;phrases?:string[];sectioned?:boolean;userEdited?:boolean;origin?:string;onHighlight?:(start:number,end:number)=>void}
const compact=(value:string)=>aiAdvicePresentation(value).normalize("NFKC").replace(/\s/gu,"");
function phraseRange(value:string,phrase:string):{start:number;end:number}|undefined{
 const exact=value.indexOf(phrase);if(exact>=0)return {start:exact,end:exact+phrase.length};
 const positions:Array<{start:number;end:number}>=[];let normalized="",offset=0;
 for(const char of value){for(const part of compact(char)){normalized+=part;for(let i=0;i<part.length;i++)positions.push({start:offset,end:offset+char.length});}offset+=char.length;}
 const needle=compact(phrase),at=normalized.indexOf(needle);if(at<0||!needle)return;
 return {start:positions[at].start,end:positions[at+needle.length-1].end};
}

/** A range that starts or ends inside a Latin word or number ("Chat**Atlas**") cuts it. */
const LATIN=/[A-Za-z0-9]/u;
// So does one starting or ending at a joiner inside a command or path ("benchmark:**providers…**", "lib/**ai**"): the
// bold broke a command a reader copies.
const JOINER=/[:/._-]/u;
const splitsWord=(text:string,start:number,end:number)=>LATIN.test(text[start-1]??"")&&LATIN.test(text[start]??"")||LATIN.test(text[end-1]??"")&&LATIN.test(text[end]??"")
 ||JOINER.test(text[start-1]??"")&&LATIN.test(text[start-2]??"")&&LATIN.test(text[start]??"")||JOINER.test(text[end]??"")&&LATIN.test(text[end-1]??"")&&LATIN.test(text[end+1]??"");

/** Reading-only emphasis: exact existing claims, explicit labels, and the
 * optional lead. Wiki budgets reset per subtopic and avoid repeated claims.
 * Never rewrite prose or enter quotes/code/tables. */
export function readerGuideHighlights({enabled=false,lead=false,phrases=[],sectioned=false,userEdited=false,origin,onHighlight}:ReaderHighlights&{enabled?:boolean}={}) {
 return (tree:Root,file?:VFile)=>{
  if(!enabled||userEdited||origin==="user")return;
  if(sectioned){highlightSections(tree,file,phrases,onHighlight);return;}
  let count=0,sectionCount=0,first=true;
  const candidates=[...new Set(phrases.map(sourceQuoteText))].filter(text=>compact(text).length>=6&&text.length<=80&&!FILLER.test(text.trim())&&!COMMENTARY_SENTENCE.test(text.trim())),seen=new Set<string>();
  const limit=sectioned?Math.min(24,Math.max(3,(tree.children.filter(node=>node.type==="heading"&&node.depth<=3).length+1)*2)):3;
  const highlight=(paragraph:Paragraph)=>{
   const opening=first;first=false;
   if(count>=limit||sectioned&&sectionCount>=2||paragraph.children.some(node=>node.type==="strong"))return;
   for(const [index,node] of paragraph.children.entries()){
    if(node.type!=="text")continue;
    const value=node.value;
    if(!node.position||file&&String(file.value).slice(node.position.start.offset!,node.position.end.offset!)!==value)continue;
    let phrase=candidates.find(text=>(!sectioned||!seen.has(compact(text)))&&phraseRange(value,text));
    if(!phrase&&index===0&&!sectioned){
     const label=value.match(/^([^\n:：。！？.!?]{2,24})[:：](?=\s*\S)/u)?.[1];
     if(label&&/\p{L}/u.test(label))phrase=label;
     if(!phrase&&opening&&lead)phrase=value.match(/^(?:[^\n。！？.!?]{12,78}[。！？]|[^\n。！？.!?]{12,78}[.!?](?=\s|$))/u)?.[0];
    }
    // The lead sentence may itself be a comment on the paragraph.
    if(!phrase||COMMENTARY_SENTENCE.test(phrase.trim()))continue;
    const range=phraseRange(value,phrase);if(!range||splitsWord(value,range.start,range.end))continue;
    // A reading cue must retain a directly attached negation or proposal label.
    const qualification=value.slice(0,range.start).match(/(?:AI建议|助手建议|用户(?:报告|反馈)|建议|计划|尚未|暂不|不得|不能|不应|并未|不|未|\b(?:not|never|should|proposed|planned))\s*$/iu);
    if(qualification)range.start-=qualification[0].length;
    if(sectioned&&/讨论记录提及|据讨论|The discussion describes|According to the discussion/iu.test(value.slice(0,range.start)))continue;
    onHighlight?.(node.position.start.offset!+range.start,node.position.start.offset!+range.end);
    const at=range.start,parts:PhrasingContent[]=[];
    if(at)parts.push({type:"text",value:value.slice(0,at)});
    parts.push({type:"strong",children:[{type:"text",value:value.slice(at,range.end)}]});
    if(range.end<value.length)parts.push({type:"text",value:value.slice(range.end)});
    paragraph.children.splice(index,1,...parts);count++;sectionCount++;seen.add(compact(phrase));break;
   }
  };
  for(const node of tree.children){
   if(node.type==="heading"&&node.depth<=3)sectionCount=0;
   if(node.type==="paragraph")highlight(node);
   if(node.type==="list")for(const item of node.children)for(const child of item.children)if(child.type==="paragraph")highlight(child);
  }
 };
}

const ATTRIBUTION_LEAD=/^(?:据(?:用户|你)提供的(?:材料|资料|审查)|据资料|AI\s?(?:建议|分析认为|认为|提出)|用户(?:指出|认为|提出|报告)|以下均为\s?AI\s?的建议)[，,：:]?\s*/u;
const emphasisParser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
const CONNECTIVE=/^(?:并且?|但(?:是)?|而(?:且|是|不|非)?|且|或者?|以(?:便|免)|从而|因此|所以|同时|以及|甚至|也|还|即|则|帮助|\b(?:but|and|or|so|while|whereas)\b)/iu;
/** Filler, not a conclusion: a purpose tail ("以确保用户隐私安全", "用于保存…") or the writer's comment on what
 * it just said ("这一决定明确了…", "这一原则旨在…"). Bold on it points the reader at the least informative words. */
const FILLER=/^(?:这(?:种|一|些|样|个)?(?:决定|原则|选型|方案|设计|机制|做法|结构|定位|策略|流程|安排|方向|路线|调整)|此举|以(?:确保|保证|便于?|免)|旨在|用于|为了|确保|保证|从而|进而|有助于|这(?:需要|意味着|使得))/u;
const COMMENTARY_SENTENCE=/^(?:这(?:种|一|些|样|个)|此举|该(?:设计|策略|方案|机制|流程|原则|定位|结构))[^。！？!?]{0,40}?(?:确保|旨在|体现|避免了|使得|突出了|明确了|构成了|简化了|降低了|提升了|保证了|意味着|有助于|奠定)/u;
/** Same reading policy for Reader, preview and export. Only literal text ranges
 * receive markers; saved prose, quotations, code and personal edits stay intact. */
export function readingEmphasisMarkdown(body:string,options:ReaderHighlights):string{
 if(options.userEdited||options.origin==="user")return body;
 const preferred:string[]=[];
 if(options.sectioned){
  const changes:Array<{start:number;end:number;text:string}>=[];
  const quoted=[...body.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|'[^'\n]*'|"[^"\n]*"/gu)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
  const clean=(node:import("mdast").RootContent)=>{
   if(node.type==="blockquote"||node.type==="code"||node.type==="table")return;
   if(node.type==="paragraph")for(const [index,child] of node.children.entries()){
    if(child.type!=="strong"||!child.position)continue;
    // Structure, not emphasis: a short label line (the whole paragraph) or a short run-in
    // label ("**记忆层借鉴**。…") stays bold; stripping it leaves a bare pseudo-heading.
    // A bolded sentence, with or without inline code, is emphasis and is re-chosen below.
    const after=node.children[index+1],label=child.children.map(item=>"value" in item?item.value:"").join("");
    if(label.length<=24&&(node.children.length===1||index===0&&after?.type==="text"&&/^[。：:]/u.test(after.value)))continue;
    const start=child.position.start.offset!,end=child.position.end.offset!;
    if(quoted.some(range=>start>=range.start&&end<=range.end))continue;
    const raw=body.slice(start,end),text=raw.slice(2,-2);preferred.push(sourceQuoteText(text));changes.push({start,end,text});
   }
   else if("children" in node)for(const child of node.children)clean(child as import("mdast").RootContent);
  };
  for(const node of emphasisParser.parse(body).children)clean(node);
  for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
 }
 const ranges:Array<{start:number;end:number}>=[];
 readerGuideHighlights({...options,phrases:[...options.phrases??[],...preferred],enabled:true,onHighlight:(start,end)=>ranges.push({start,end})})(emphasisParser.parse(body),{value:body} as VFile);
 for(const {start,end} of ranges.sort((a,b)=>b.start-a.start))body=body.slice(0,start)+"**"+body.slice(start,end)+"**"+body.slice(end);
 return body;
}
/** One short, literal conclusion per substantial topic. Unsafe qualifications
 * are skipped rather than expanded into a whole sentence. */
function highlightSections(tree:Root,file:VFile|undefined,phrases:string[],onHighlight?:ReaderHighlights["onHighlight"]){
 const source=file?String(file.value):undefined;
 const quotations=source?[...source.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|'[^'\n]*'|"[^"\n]*"/gu)].map(match=>({start:match.index!,end:match.index!+match[0].length})):[];
 const textOf=(node:{type:string;value?:string;children?:unknown[]}):string=>node.value??(node.children??[]).map(child=>textOf(child as typeof node)).join("");
 // A clause cut at a comma inside brackets or quotes would bold half a parenthesis.
 const balanced=(text:string)=>[["（","）"],["(",")"],["“","”"],["《","》"],["【","】"],["「","」"]].every(([open,close])=>text.split(open).length===text.split(close).length);
 const short=(text:string)=>{const size=compact(text).length;return size>=8&&size<=(/\p{Script=Han}/u.test(text)?30:60)&&balanced(text);};
 const clauses=(text:string)=>text.split(/[，,；;：:。！？!?\n]/u).map(text=>text.trim()).filter(short);
 // Who said it is not the point: "据用户提供的材料", "AI 分析认为" are cut off a clause, never bolded alone.
 const unattributed=(text:string)=>text.replace(ATTRIBUTION_LEAD,"").trim();
 const candidates=[...new Set(phrases.map(sourceQuoteText).flatMap(clauses).map(unattributed).filter(short))],seen=new Set<string>();
 const sections:Paragraph[][]=[];let started=false;
 for(const node of tree.children){
  // Ledger chapters open straight into their subtopics (###), with no level-2 heading.
  if(node.type==="heading"&&(node.depth===2||node.depth===3))started=true;
  if(started&&node.type==="heading"&&(node.depth===2||node.depth===3))sections.push([]);
  if(!started)continue;
  if(node.type==="paragraph")sections.at(-1)!.push(node);
  if(node.type==="list")for(const item of node.children)for(const child of item.children)if(child.type==="paragraph")sections.at(-1)!.push(child);
 }
 const importance=(text:string)=>Number(/必须|不得|不能|不覆盖|不自动|核心|关键|优先|决定|\b(?:must|never|key|decided)\b/iu.test(text));
 const negated=/(?:不得|不能|不应|并未|没有|不会|不允许|不可以|禁止|尚未|未能|否认|并非|不是|不太|不建议|无需|无须|不|未|\b(?:not|never)\b)/iu;
 const unsafe=(text:string)=>/(?:已|尚未|仍未)(?:实现|完成|上线|验证|确认|测试|交付|采用|部署)|材料未显示|本章|这些均为|这些属于|讨论记录提及|据讨论|未核实|据称|The discussion describes|According to the discussion|unverified|AI建议|AI认为|助手建议|用户(?:报告|反馈)|只有|仅在|仅当|如果|若|除非|当.+时|前提|(?:失败|成功|变化|失效).{0,6}(?:时|后)|\b(?:only if|unless|if|when|proposed|planned)\b/iu.test(text)||/^(?:状态[：:]|目前|当前|现阶段|截至|已完成|已实现|已上线|尚未|暂未|暂不|待确认|待实现|Status[：:]|Currently|Not yet)/iu.test(text.trim());
 for(const paragraphs of sections){
  if(paragraphs.reduce((sum,paragraph)=>sum+compact(textOf(paragraph)).length,0)<200)continue;
  const choices=paragraphs.flatMap((paragraph,order)=>paragraph.children.flatMap((node,index)=>{
   if(node.type!=="text"||!node.position)return [];
   const value=node.value,absolute=node.position.start.offset!;
   if(source&&source.slice(absolute,node.position.end.offset!)!==value)return [];
   // Check the entire sentence, including inline code/links and other text nodes.
   const before=paragraph.children.slice(0,index).map(textOf).join("");
   const after=paragraph.children.slice(index+1).map(textOf).join("");
   const all=before+value+after;
   const localQuotes=[...all.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|‘[^’]*’|'[^'\n]*'|"[^"\n]*"/gu)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
   const literal=candidates.flatMap((phrase,priority)=>{const range=phraseRange(value,phrase);return range&&!splitsWord(value,range.start,range.end)?[{...range,priority}]:[];});
   const fallback=[...value.matchAll(/[^，,；;：:。！？!?\n]+/gu)].flatMap(match=>{const text=match[0].trim();return short(text)&&importance(text)?[{start:match.index!+match[0].indexOf(text),end:match.index!+match[0].indexOf(text)+text.length,priority:candidates.length}]:[];});
   return [...literal,...fallback].flatMap(point=>{
    let {start}=point;const {end}=point;
    const sentenceStart=Math.max(...["。","！","？","!","?","\n"].map(mark=>all.lastIndexOf(mark,before.length+start-1)))+1;
    const tail=all.slice(before.length+end).search(/[。！？!?\n]/u);
    const sentence=all.slice(sentenceStart,tail<0?all.length:before.length+end+tail);
    if(unsafe(sentence))return [];
    // Never cut a directly attached negation off the selected phrase.
    const prefix=all.slice(sentenceStart,before.length+start);
    const negation=prefix.match(/(?:不得|不能|不应|并未|没有|不会|不|未|\bnot|\bnever)\s*$/iu)?.[0];
    if(negation){if(start<negation.length)return [];start-=negation.length;}
    // A remote negation or a negated predicate after the phrase cannot be
    // retained by extending a short cue. Leave that sentence unemphasized.
    if(negated.test(prefix.slice(0,prefix.length-(negation?.length??0)))||negated.test(sentence.slice(before.length+end-sentenceStart)))return [];
    const selected=value.slice(start,end),key=compact(selected);
    // A clause opening with a connective ("但…", "而不只是…") is half of a sentence, not a conclusion.
    if(CONNECTIVE.test(selected.trim()))return [];
    // Nor is a purpose tail or a sentence commenting on the paragraph: the next best point is bolded instead.
    if(FILLER.test(selected.trim())||COMMENTARY_SENTENCE.test(sentence.trim()))return [];
    if(!short(selected)||seen.has(key)||localQuotes.some(range=>before.length+start<range.end&&before.length+end>range.start)||quotations.some(range=>absolute+start<range.end&&absolute+end>range.start))return [];
    return [{node,index,paragraph,start,end,key,priority:point.priority,score:importance(selected),order}];
   });
  })).sort((a,b)=>a.priority-b.priority||b.score-a.score||a.order-b.order||a.start-b.start);
  const point=choices[0];if(!point)continue;
  const {node,paragraph,index,start,end,key}=point,value=node.value;
  const parts:PhrasingContent[]=[];if(start)parts.push({type:"text",value:value.slice(0,start)});
  parts.push({type:"strong",children:[{type:"text",value:value.slice(start,end)}]});if(end<value.length)parts.push({type:"text",value:value.slice(end)});
  paragraph.children.splice(index,1,...parts);onHighlight?.(node.position!.start.offset!+start,node.position!.start.offset!+end);seen.add(key);
 }
}
