import {knowledgeStage,knowledgeTerms} from "../shared/knowledge-subject";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiExampleStage,wikiExampleStanding} from "../shared/wiki-example-identity";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";

const FUTURE=/未来规划|后续(?:阶段|版本)(?:的|候选)?(?:方案|规划)|\b(?:future plan|planned for a later release)\b/iu;
const CURRENT=/当前参考|现行规范|\b(?:current reference|current contract)\b/iu;
const EXTERNAL=/^(?:外部参考(?:项目)?|开源方案调研|External (?:references?|projects?)|Open.source research)$/iu;
const FLOW=/流程(?:示例|图)|\b(?:flowchart|workflow)\b/iu;
const GENERIC=/的(?:流程示例|参考示例|界面草图)$|^(?:流程示例|参考示例|界面草图|代码示例|目录结构|JSON 示例|终端命令|(?:.+? )?(?:reference example|flow example|interface sketch)|code example|directory structure|file layout|JSON example|terminal command)$/iu;
const DIRECTORY_ENTRY=/^[ \t│├└─┬+|-]*((?:[\w.@[\]-]+\/)*[\w.@[\]-]+(?:\/|\.[a-z\d]{1,8}))[ \t]*$/iu;
const CODE_OUTPUT=/\b(?:firmware(?: code)? generation|code gen(?:eration)?|BOM\s*\+\s*Code)\b|(?:固件|代码)生成/iu;
const PRICES=/(?:[¥￥$€]\s*\d|\d+(?:\.\d+)?\s*元)/u;
const COLLECTION=/<summary>(?:原文与示例|参考示例) · \d+ 项<\/summary>|<summary>(?:Originals and examples|Reference examples) · \d+ items<\/summary>/u;

export function projectReferenceGroups(body:string,includeSingle:boolean){
 const ranges=wikiSupplementRanges(body);
 if(!ranges.length)return [];
 const blocks=wikiDocumentBlocks(body);
 const headings=blocks.filter(block=>block.kind==="heading"&&!ranges.some(([start,end])=>block.start>=start&&block.end<=end));
 return ranges.flatMap(([start,end])=>{
  const raw=body.slice(start,end);
  if(!raw.trimEnd().endsWith("</details>"))return [];
  const roadmap=/<summary>(?:原始规划表|Original planning tables)<\/summary>/u.test(raw);
  const assessment=/<summary>(?:讨论中的方案评估|Design assessments from the discussion)<\/summary>/u.test(raw);
  if(!roadmap&&!assessment&&!COLLECTION.test(raw)){
   if(!includeSingle) return [];
   const contents=blocks.filter(block=>block.start>start&&block.end<end);
   if(contents.filter(block=>block.kind==="code").length!==1||contents.some(block=>block.kind!=="code"&&!(block.kind==="paragraph"
    &&/^(?:原文来源|Original source|Source(?: references?)?)\s+\[S-/u.test(block.text))))return [];
  }
  const heading=headings.filter(block=>block.end<start).at(-1);
  return [{start,end,raw,roadmap,topic:roadmap?undefined:heading?.text.replace(/^#{1,6}\s+/u,"")}];
 });
}

/** Remove generated collection count headings and numbering from the separate file. */
export function compactReferenceHeadings(markdown:string,heading:string){
 const edits:Array<{start:number;end:number;text:string}>=[];
 let removedDepth=0;
 for(const block of wikiDocumentBlocks(markdown)){
  if(block.kind!=="heading")continue;
  const depth=block.text.match(/^#+/u)?.[0].length??1;
  if(depth===1)continue;
  const title=block.text.slice(depth+1);
  if(removedDepth&&depth<=removedDepth)removedDepth=0;
  if(block.text===`## ${heading}`||/^(?:参考示例|原文与示例) · \d+ 项$|^(?:Reference examples|Originals and examples) · \d+ items$/u.test(title)){
   if(depth>2)removedDepth=depth;
   edits.push({start:block.start,end:block.end+(markdown.slice(block.end).match(/^\n\n/u)?.[0].length??0),text:""});
  }else edits.push({start:block.start,end:block.end,text:`${"#".repeat(Math.max(2,depth-(removedDepth?2:1)))} ${removedDepth?title.replace(/^\d+\. /u,""):title}`});
 }
 for(const {start,end,text} of edits.reverse())markdown=markdown.slice(0,start)+text+markdown.slice(end);
 return markdown;
}

function directoryEntries(payload:string){
 const lines=payload.split("\n").filter(line=>line.replace(/[│|]/gu,"").trim());
 const entries=lines.map(line=>DIRECTORY_ENTRY.exec(line)?.[1]).filter((entry):entry is string=>Boolean(entry));
 return entries.length>=2&&entries.length===lines.length&&entries.some(entry=>entry.endsWith("/"))?entries:[];
}

function compactExampleLabel(payload:string,title:string,zh:boolean){
 const [first="",second=""]=payload.split("\n").filter(line=>line.trim()).map(line=>line.trim());
 if(!second)return "";
 const table=/^([\p{L}][\p{L}\d /-]{1,24})\s{2,}([\p{L}][\p{L}\d /-]{1,24})$/u.exec(first);
 if(table&&/\b(?:qty|quantity|status|unit|total)\b|数量|状态|单位|合计/iu.test(table[2]))return `${table[1].trim()} · ${table[2]}`;
 if(!/^[\p{L}][\p{L}\p{N} ,，/()（）·'-]{2,27}[。.!！]?$/u.test(first))return "";
 const label=first.replace(/[。.!！]$/u,"");
 if(/^[┌╔┏]/u.test(second))return zh?`${label} · 界面草图`:`${label} · UI sketch`;
 if(/界面|文案|布局|\b(?:ui|layout|copy|interface)\b/iu.test(title)&&/[。.!！]$/u.test(first)&&/[。.!！]$/u.test(second)&&!/[↓↑→←├└│]/u.test(payload)){
  return zh?`${label} · 界面文案`:`${label} · UI copy`;
 }
 return "";
}

const stageLabel=(stage:string)=>stage.replace(/^(phase|milestone|stage)(.+)$/u,(_,unit:string,value:string)=>`${unit[0].toUpperCase()}${unit.slice(1)} ${value.toUpperCase()}`);

/** Annotate the generated appendix outside literal payloads. The standalone file shares
 * a single default-status note and uses content-based captions where the source has none. */
export function annotateReferenceExamples(markdown:string,heading:string,zh:boolean,deferrals:readonly {feature:string;stage:string}[],standalone=false){
 const blocks=wikiDocumentBlocks(markdown);
 const start=blocks.map(block=>block.kind==="heading"?block.text:"").lastIndexOf(`## ${heading}`);
 if(start<0)return markdown;
 const localized=(cn:string,en:string)=>zh?cn:en;
 const edits:Array<{start:number;end:number;text:string}>=[];
 const examples:Array<{heading:(typeof blocks)[number];prefix:string;title:string;suffix:string;entries:string[]}>=[];
 const headings=new Map<number,string>();
 const titled=new Set<number>();
 let caption:(typeof blocks)[number]|undefined;
 for(let index=start+1;index<blocks.length;index++){
  const block=blocks[index];
  if(block.kind==="heading"&&/^#{1,2}\s/u.test(block.text))break;
  if(block.kind==="heading"){
   caption=block;
   const depth=block.text.match(/^#+/u)![0].length;
   for(const level of headings.keys())if(level>=depth)headings.delete(level);
   headings.set(depth,block.text.slice(depth+1));
  }
  if(block.kind!=="code")continue;
  const previous=blocks[index-1]?.text.replace(/\*\*/gu,"")??"";
  if(/^(?:当前参考|设计构想|历史方案|未来规划|Current reference|Design proposal|Historical proposal|Future plan) · (?:原标阶段 |阶段未注明|Source label |Stage unspecified)|^(?:示例说明|Example notes) · /u.test(previous))continue;
  const open=block.text.match(/^[ \t]*(`{3,}|~{3,})([^\n]*)\n/u);
  if(!open)continue;
  const payload=block.text.slice(open[0].length).split("\n").slice(0,-1).join("\n");
  const language=open[2].trim().toLowerCase();
  const label=caption?.text.replace(/^#+\s+/u,"")??"";
  const stage=wikiExampleStage(label);
  const standing=wikiExampleStanding(label);
  const terms=knowledgeTerms(payload);
  const outsideScope=stage?deferrals.filter(({feature,stage:deferredStage})=>{
   if(stage!==knowledgeStage(deferredStage))return false;
   const names=knowledgeTerms(feature);
   return [...names].some(name=>terms.has(name)||(name==="仿真"&&terms.has("simulation"))||(name==="simulation"&&terms.has("仿真")))
    ||CODE_OUTPUT.test(payload)&&/(?:固件代码生成|固件生成|\b(?:firmware(?: code)? generation|code generation)\b)/iu.test(feature);
  }):[];
  const status=standing==="history"?localized("历史方案","Historical proposal")
   :outsideScope.length&&standalone?localized("早期构想","Early concept")
   :FUTURE.test(label)?localized("未来规划","Future plan")
   :[...headings.values()].some(title=>EXTERNAL.test(title))?localized("外部参考","External reference")
   :CURRENT.test(label)&&!outsideScope.length&&!standalone?localized("当前参考","Current reference")
   :standalone?"":localized("设计构想","Design proposal");
  const notes=status?[`**${status}**`]:[];
  if(stage&&(outsideScope.length||!standalone))notes.push(localized(`原标阶段 ${stageLabel(stage)}`,`Source label ${stageLabel(stage)}`));
  else if(!stage&&!standalone)notes.push(localized("阶段未注明","Stage unspecified"));
  if(outsideScope.length){
   const deferred=[...new Map(outsideScope.map(scope=>[scope.feature,scope])).values()].map(({stage,feature})=>`${stageLabel(stage)} ${feature}`).join(localized("、",", "));
   notes.push(localized(`范围以已确认暂缓项为准（${deferred}）。`,`Apply the confirmed deferral (${deferred}).`));
   if(standalone&&CODE_OUTPUT.test(payload)&&!outsideScope.some(({feature})=>/(?:固件|代码|firmware|code)/iu.test(feature))){
    notes.push(localized("原稿也包含代码生成，适用阶段见 Wiki 的版本范围。","The draft also shows code generation. See release scope in the Wiki."));
   }
  }
  const entries=directoryEntries(payload);
  const declaration=/^(?:tsx?|typescript|jsx?|javascript)$/u.test(language)?/\b(?:interface|type)\s+(\w+)/u.exec(payload)?.[1]:undefined;
  const requirementData=language==="json"&&/"requirements"\s*:\s*\[/u.test(payload);
  const flags=/\b(?:features|featureFlags)\s*:\s*\{[\s\S]*?\b(?:true|false)\b/u.test(payload);
  if(requirementData){
   notes.push(localized("需求阶段的输入或中间数据示意，字段以对应 Schema 为准。","Requirement-stage data example. Use the relevant schema for exact fields."));
  }else if(declaration){
   notes.push(localized("接口原稿，字段和约束以源码为准。","Interface draft. Check the source for fields and constraints."));
  }else if(flags){
   notes.push(localized("示意开关值，实际配置及开放状态以源码为准。","Illustrative switch values. Check the source for actual configuration and availability."));
  }else if(entries.length){
   notes.push(localized("目录草图，实际路径以工作区为准。","Directory sketch. Check the workspace for actual paths."));
  }
  if(PRICES.test(payload)&&/采购|购买清单|shopping list|purchase/iu.test(label)){
   notes.push(localized("金额为示例，实际价格需核对。","Prices are illustrative and need verification."));
  }
  if(notes.length)edits.push({start:block.start,end:block.start,text:notes.join(" · ")+"\n\n"});
  if(!standalone||!caption||!/^#{4,6}\s/u.test(caption.text)||titled.has(caption.start))continue;
  titled.add(caption.start);
  const prefix=label.match(/^\d+\. /u)?.[0]??"";
  const [title,...details]=label.slice(prefix.length).split(" · ");
  const cleanDetails=details.filter(detail=>!/^(?:适用范围待核对|Current reference|当前参考|现行规范)$/iu.test(detail)
   &&!(outsideScope.length&&/^原稿\s*v[\d.]+(?:，适用范围待核对)?$/iu.test(detail)));
  if(stage&&!cleanDetails.some(detail=>wikiExampleStage(detail)===stage)&&!wikiExampleStage(title))cleanDetails.push(stageLabel(stage));
  if(outsideScope.length)cleanDetails.splice(0,cleanDetails.length,...cleanDetails.filter(detail=>!wikiExampleStage(detail)));
  const suffix=cleanDetails.map(detail=>wikiExampleStage(detail)===stage&&stage&&/^(?:milestone|phase|stage)\s*[\da-z]/iu.test(detail)?stageLabel(stage):detail).join(" · ");
  let name=title;
  if(GENERIC.test(title)){
   const root=entries.find(entry=>entry.endsWith("/"));
   if(root)name=localized(`目录结构 · ${root}`,`Directory layout · ${root}`);
   else if(requirementData)name=localized("需求解析数据示例","Requirements data example");
   else if(declaration)name=localized(`${declaration} 接口`,`${declaration} contract`);
   else if(flags)name=localized("功能开关示例","Feature flag example");
   else if(outsideScope.length&&FLOW.test(title))name=localized("早期完整流程构想","Early end-to-end workflow");
   else if(/界面草图|参考示例|interface sketch|reference example/iu.test(title))name=compactExampleLabel(payload,title,zh)||title;
  }
  examples.push({heading:caption,prefix,title:name,suffix,entries});
 }
 const byTitle=new Map<string,typeof examples>(),seen=new Map<string,number>();
 for(const example of examples)byTitle.set(example.title,[...(byTitle.get(example.title)??[]),example]);
 for(const {heading,prefix,title,suffix,entries} of examples){
  const peers=byTitle.get(title)??[];
  const distinguishing=entries.filter(entry=>peers.length>1&&peers.every(other=>other.heading===heading||!other.entries.includes(entry)));
  const distinctive=distinguishing.find(entry=>entry.endsWith("/"))??distinguishing[0];
  const base=distinctive?`${title}（${distinctive}）`:title;
  const key=[base,suffix].join("\n"),occurrence=(seen.get(key)??0)+1;
  seen.set(key,occurrence);
  const number=occurrence>1?` · ${occurrence}`:"";
  const tail=suffix?` · ${suffix}`:"";
  const replacement=`${heading.text.match(/^#+/u)![0]} ${prefix}${base}${tail}${number}`;
  if(replacement!==heading.text)edits.push({start:heading.start,end:heading.end,text:replacement});
 }
 for(const {start,end,text} of edits.sort((a,b)=>b.start-a.start))markdown=markdown.slice(0,start)+text+markdown.slice(end);
 return markdown;
}
