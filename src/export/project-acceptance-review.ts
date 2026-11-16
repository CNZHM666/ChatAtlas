import {knowledgeStage,knowledgeTerms,knowledgeVersion} from "../shared/knowledge-subject";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {wikiHistoricalHeading} from "../shared/wiki-history-layout";

const CHECK=/验收|成功标准|通过标准|通过率|运行率|编译率|\b(?:acceptance|definition of done|pass rate|success criteria)\b/iu;
const FIRST=/MVP|首版|最小可用|第\s*[一1](?:版|阶段)|\b(?:first release|first phase|initial release)\b/iu;
const CREDENTIAL=/API\s*Key|凭据|密钥|\b(?:credentials?|access tokens?|secrets?)\b/iu;
const STORAGE=/sessionStorage|localStorage|IndexedDB|在此设备记住|remember on (?:this|the) device/iu;
const SAVE=/暂存|保存|保存在|存储|存入|记住|\b(?:store[ds]?|persist\w*|remember)\b/iu;
const NO_STORAGE=/(?:各|所有|全部).{0,12}(?:存储层|存储).{0,20}(?:无|不得|不能|不含)|(?:无|不得|不能|不含).{0,24}(?:各|所有|全部).{0,12}(?:存储层|存储)|\ball (?:storage|stores).{0,30}(?:no|without|must not)|\bno .{1,55} in (?:any|all) (?:storage|stores)/iu;
const QUALIFIED=/适用(?:版本|范围)待(?:核对|确认)|applicable (?:release|scope) unconfirmed|metric applicability needs review|允许保存的位置|permitted storage|凭据存储验收待确认|credential storage acceptance needs review|存储规则[\s\S]{0,15}待确认/iu;
const prose=new Set(["paragraph","list","table"]);
const plain=(text:string)=>text.normalize("NFKC").replace(/\*\*|`/gu,"");

export function currentProjectBlocks(body:string){
 const attachments=wikiSupplementRanges(body);
 let historyDepth=0;
 return wikiDocumentBlocks(body).filter(block=>{
  if(attachments.some(([start,end])=>block.start>=start&&block.end<=end))return false;
  if(block.kind==="heading"){
   const depth=block.text.match(/^#+/u)?.[0].length??3;
   if(historyDepth&&depth<=historyDepth)historyDepth=0;
   if(wikiHistoricalHeading(block.text))historyDepth=depth;
  }
  return !historyDepth;
 });
}

/** Look at actual selected chapter prose, since older drafts did not bind every
 * checklist item to a claim. */
export function hasCredentialStoragePlan(body:string){
 return currentProjectBlocks(body).some(block=>prose.has(block.kind)&&CREDENTIAL.test(block.text)&&STORAGE.test(block.text)
  &&plain(block.text).split(/(?<=[。.!?；;])\s*|\n/u).some(line=>CREDENTIAL.test(line)&&STORAGE.test(line)&&SAVE.test(line)
   &&!/严禁|禁止|不得|不(?:应|能|可|允许)保存|\b(?:never|do not|not permitted|must not)\b/iu.test(line)));
}

export function reviewProjectAcceptance(body:string,deferrals:readonly {feature:string;stage:string}[],credentialStorage:boolean,zh:boolean){
 const edits:Array<{start:number;end:number;text:string}>=[];
 const blocks=currentProjectBlocks(body);
 const stated=deferrals.map(({stage,feature})=>({stage,feature,terms:knowledgeTerms(feature)}));
 let scopeCount=0,credentialCount=0;
 for(const [index,block] of blocks.entries()){
  if(!prose.has(block.kind))continue;
  const raw=block.text.split("\n");
  const lines=raw.map(plain);
  const earlier=blocks[index-1]?.text??"";
  const clashes=new Set<string>();
  const context:string[]=[];
  for(const [row,line] of lines.entries()){
   if(QUALIFIED.test(line)||!CHECK.test(line)||!/\d\s*%/u.test(line))continue;
   const stageLabel=line.split("|").find(cell=>cell.trim())??line;
   const first=FIRST.test(stageLabel);
   const stage=first?knowledgeVersion(stageLabel):knowledgeStage(stageLabel);
   if(!stage&&!first)continue;
   const terms=knowledgeTerms(line);
   const conflicts=stated.filter(fact=>{
    if(stage&&stage!==knowledgeStage(fact.stage))return false;
    const shared=[...fact.terms].filter(term=>terms.has(term)).length;
    return shared>=Math.max(1,Math.ceil(fact.terms.size/2));
   });
   if(!conflicts.length)continue;
   for(const fact of conflicts)clashes.add(`${fact.stage} ${fact.feature}`);
   const label=zh?"候选指标，适用版本待确认":"Candidate metrics, applicable release unconfirmed";
   if(block.kind==="table"){
    const split=splitAcceptanceMetrics(raw[row],conflicts,zh);
    if(split){raw[row]=split.rows;context.push(split.context);}
    else raw[row]=raw[row].replace(/^(\s*\|\s*)([^|]+?)(\s*\|)/u,(_all,prefix:string,original:string,suffix:string)=>
     `${prefix}${label} · ${zh?"原阶段标签":"Original stage label"} ${original.trim()}${suffix}`);
   }
   else raw[row]=labelledAcceptanceLine(raw[row],label);
  }
  const notices:string[]=[];
  if(clashes.size&&!QUALIFIED.test(earlier)){
   const scope=[...clashes].join(zh?"、":", ");
   notices.push(zh?`**指标适用版本待核对** · 已确认暂缓 ${scope}。请确认相关指标所属阶段和验证方式。`:`**Metric applicability needs review** · Confirmed deferral: ${scope}. Check which release and verification method the affected metrics apply to.`);
   scopeCount+=clashes.size;
  }
  if(credentialStorage){
   const items=lines.flatMap((line,row)=>CREDENTIAL.test(line)&&NO_STORAGE.test(line)&&!QUALIFIED.test(line)?[row]:[]);
   const proposals:string[]=[];
   for(const row of items){
    const label=zh?"凭据存储验收待确认":"Credential storage acceptance needs review";
    const requirement=zh?"按使用模式核对允许保存的位置、期限和清理行为。":"Check permitted storage, lifetime and cleanup for each use mode.";
    const item=block.kind==="list"&&raw[row].match(/^(\s*(?:\d+[.)]|[-*+])\s+)(.+)$/u);
    if(item){proposals.push(item[2]);raw[row]=`${item[1]}**${label}** · ${requirement}`;}
    else raw[row]=labelledAcceptanceLine(raw[row],label,requirement);
   }
   if(items.length&&!QUALIFIED.test(earlier)){
    notices.push(zh?"**凭据存储验收待确认** · 先按使用模式明确允许的位置、期限和清理行为，再据此检查完整凭据。":"**Credential storage acceptance needs review** · Confirm allowed locations, lifetime and cleanup by mode before checking credential storage.");
    credentialCount++;
   }
   if(proposals.length)context.push(...proposals.map(proposal=>`${zh?"原验收提案":"Original acceptance proposal"} · ${proposal}`));
  }
  const text=[...notices.map(note=>`> ${note}`),raw.join("\n"),...context.map(note=>`> ${note}`)].join("\n\n");
  if(text!==block.text)edits.push({start:block.start,end:block.end,text});
 }
 for(const {start,end,text} of edits.reverse())body=body.slice(0,start)+text+body.slice(end);
 return {body,scopeCount,credentialCount};
}

function splitAcceptanceMetrics(row:string,conflicts:readonly {terms:Set<string>}[],zh:boolean){
 const cells=row.trim().replace(/^\||\|$/gu,"").split(/(?<!\\)\|/u).map(cell=>cell.trim());
 if(cells.length<2||cells.length>3||cells.some(cell=>/\[|〔|\\|<br\b/iu.test(cell)))return;
 const [stage,metrics,condition]=cells;
 const percentage=/[<>≥≤=]=?\s*\d+(?:\.\d+)?\s*%/gu;
 const groups={core:[] as string[],dependent:[] as string[]};
 let end=0;
 for(const value of metrics.matchAll(percentage)){
  const subject=metrics.slice(end,value.index).replace(/^[\s;；,，、]+/u,"").trim();
  if(!subject||/[。；;<>%≥≤=]/u.test(subject))return;
  end=value.index+value[0].length;
  const words=knowledgeTerms(subject);
  const deferred=conflicts.some(fact=>[...fact.terms].filter(term=>words.has(term)).length>=Math.max(1,Math.ceil(fact.terms.size/2)));
  // Compilation or deployment metrics need their own prerequisite deliverable.
  const toolDependent=/编译率|部署通过率|\b(?:compilation|deployment) (?:success|pass) rate\b/iu.test(subject);
  groups[deferred||toolDependent?"dependent":"core"].push(`${subject} ${value[0]}`);
 }
 if(metrics.slice(end).trim()||!groups.core.length||!groups.dependent.length)return;
 const line=(label:string,values:string[],detail:string)=>`| ${[label,values.join(zh?"；":"; "),...(condition!==undefined?[detail]:[])].join(" | ")} |`;
 return {rows:[
  line(zh?"候选指标，适用范围待确认":"Candidate metrics, applicable scope unconfirmed",groups.core,zh?"样本和判定口径待确认":"Confirm the samples and evaluation criteria"),
  line(zh?"依赖交付能力，适用版本待确认":"Delivery-dependent metrics, applicable release unconfirmed",groups.dependent,zh?"先确认依赖能力、版本和验证方式":"Confirm prerequisite capabilities, release and verification method"),
 ].join("\n"),context:[zh?"原指标分组":"Original metric group",stage,condition].filter(Boolean).join(" · ")};
}

function labelledAcceptanceLine(text:string,label:string,requirement?:string){
 return text.replace(/^(\s*(?:(?:\d+[.)]|[-*+])\s+|\|\s*)?)/u,`$1**${label}** · ${requirement?`${requirement} · `:""}`);
}

/** The confirmed initial count is already printed above – keep only the
 * separately proposed expansion target in a row citing the same message. */
export function separateConfirmedStartingCount(body:string,answer:string,locator:string,zh:boolean){
 const exact=answer.normalize("NFKC").match(/^先(?:做稳|稳定)\s*(\d+)\s*个[^,，。]{0,16}[,，]\s*再逐步扩展[。.]?$/u)
  ??answer.match(/^(?:start|begin) with\s+(\d+)\s+[^,.]{1,30},?\s+then (?:gradually\s+)?expand[.]?$/iu);
 if(!exact)return body;
 for(const block of currentProjectBlocks(body).reverse()){
  if(block.kind!=="table"||!block.text.includes(`[${locator}]`))continue;
  const revised=block.text.split("\n").map(line=>{
   if(!line.includes(`[${locator}]`)||!/未定|待确认|\b(?:open|unconfirmed|pending)\b/iu.test(line))return line;
   const match=line.match(/^(\s*\|\s*)[^|]+?(\s*\|\s*)先(?:做稳|稳定)\s*(\d+)\s*个[^,，。|]{0,16}[,，]\s*再逐步扩展(?:到|至)(?=(?:约\s*)?\d)/u)
    ??line.match(/^(\s*\|\s*)[^|]+?(\s*\|\s*)(?:start|begin) with\s+(\d+)\s+[^,|.]{1,30},?\s+then (?:gradually\s+)?expand to\s+(?=(?:(?:about|around)\s+)?\d)/iu);
   if(!match||match[3]!==exact[1])return line;
   return `${match[1]}${zh?"后续扩展数量":"Later expansion target"}${match[2]}${line.slice(match[0].length)}`;
  }).join("\n");
  if(revised!==block.text)body=body.slice(0,block.start)+revised+body.slice(block.end);
 }
 return body;
}

/** Requirements like “full editing” need a scoped checklist before they can
 * be accepted. Do not infer what specific operations were approved. */
export function reviewFullInteractionAcceptance(body:string,choices:readonly string[],zh:boolean){
 const edits=new Map<number,boolean>();
 const blocks=currentProjectBlocks(body);
 const existing=blocks.some(block=>block.kind==="heading"&&/编辑验收|操作验收|editing acceptance|interaction acceptance/iu.test(block.text));
 if(existing||body.includes(zh?"操作级验收待细化":"Operation-level acceptance needs detail"))return {body,count:0};
 for(const choice of new Set(choices)){
  if(!/支持完整.{1,24}(?:编辑|操作)|\b(?:support|allow)s? full [\w -]{1,45}(?:editing|operation)/iu.test(choice))continue;
  const matches=blocks.filter(block=>block.kind==="paragraph"&&plain(block.text).includes(plain(choice)));
  if(matches.length===1)edits.set(matches[0].end,edits.get(matches[0].end)===true||/画布|\bcanvas\b/iu.test(choice));
 }
 const note=zh?[
  "**操作级验收待细化** · 已确认总体能力，以下项目需逐项确认。",
  "| 候选验收维度 | 待明确的条件 |","| --- | --- |",
  "| 设备与输入 | 支持哪些设备、界面尺寸和输入方式？ |",
  "| 操作与结果 | 哪些操作必须可完成，如何观察结果？ |",
  "| 异常与恢复 | 操作取消、失败或中断时，应保留或恢复什么？ |",
 ]:[
  "**Operation-level acceptance needs detail** · The overall capability is confirmed. Confirm the following candidates individually.",
  "| Candidate area | Conditions to define |","| --- | --- |",
  "| Device and input | Which devices, screen sizes, and input methods are supported? |",
  "| Operation and result | Which operations must work and what observable result is expected? |",
  "| Failure and recovery | What should be retained or restored when an operation is cancelled or interrupted? |",
 ];
 for(const [at,canvas] of [...edits].sort(([a],[b])=>b-a)){
  const rows=canvas?(zh?[
   "| 画布导航 | 确认支持的设备和手势，验证平移、缩放和选中节点。 |",
   "| 节点编辑 | 确认添加、拖动、删除和查看详情是否纳入，逐项核对画布结果。 |",
   "| 连线与撤销 | 若纳入，核对创建、修改、删除连线及撤销后的状态。 |",
  ]:[
   "| Canvas navigation | Confirm supported devices and gestures, then verify panning, zooming and selection. |",
   "| Node editing | Confirm add, move, remove and details individually, then verify the canvas state. |",
   "| Connections and undo | If included, verify creating, editing and deleting connections and the restored state after undo. |",
  ]):note.slice(3);
  const criteria=[note[0],[...note.slice(1,3),...rows].join("\n")].join("\n\n");
  body=body.slice(0,at)+`\n\n${criteria}`+body.slice(at);
 }
 return {body,count:edits.size};
}
