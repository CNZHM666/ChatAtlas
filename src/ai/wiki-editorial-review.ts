import {replaceParagraph} from "../shared/wiki-body-text";
import {wikiProjectPersonalAside} from "./wiki-knowledge-select";
import {reviewWikiEvidenceStates} from "./wiki-evidence-state";
import {wikiDecisionRestatement,wikiLayerDeferral,wikiReleaseDeferral} from "./wiki-confirmation-scope";
import type { WikiClaim } from "../shared/wiki-claims";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiHistoricalHeading} from "../shared/wiki-history-layout";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {wikiWorkflowScopes} from "./wiki-workflow-scope";
import {wikiLocalAnswer,wikiRepairIntegrationChoice,wikiScopedIntegration} from "./wiki-question-parse";
import {wikiRepairClosedListCell} from "../shared/wiki-closed-list";
import {confirmedRoadmaps,wikiRejectedReadingOfConfirmedOrder} from "../shared/wiki-confirmed-roadmap";
import {wikiDesignContrast,wikiIntegrationProposal,wikiWithoutImplementationAside,wikiWithoutUnsupportedExample} from "./wiki-prose-grounding";
import {aboutNameKey,statesCore,wikiLedgerUnits,type WikiDraftChapter,type WikiKnowledgeLedger,type WikiKnowledgeUnit} from "../shared/wiki-knowledge";
import {knowledgeTerms} from "../shared/knowledge-subject";
import {separateUnconfirmedWikiPlans} from "./wiki-draft-checks";

const DECISION_SUPPLEMENT=/^(?:已确认的决定补记|Confirmed decisions retained)$/u;
const LEGACY_DECISION_HEADINGS=/^(?:已确[认定]的取舍|已确认的决定补记|其他已定决定|Confirmed choices|Confirmed decisions retained|Other confirmed decisions)$/u;

const INTERNAL_DRAFT_LABEL = /^(?:用户补记|用户补注|用户补充记录|写作补记|整理补记|写作校对记录|User (?:addendum|supplement(?:ary note)?)|Writer(?:’s|'s)? note|Editorial (?:note|addendum))$/iu;

export function wikiInternalDraftLabel(title: string) {
  return INTERNAL_DRAFT_LABEL.test(title.replace(/^#{1,6}\s+/u, "").replace(/\*\*|__/gu, "").trim());
}

/** Hide generation labels while keeping the supported text and its existing bindings. */
export function cleanWikiDraftDisplay(body: string) {
  const original = compactWikiDecisionHeadings(body);
  if (!/补记|补注|补充记录|校对记录|addendum|supplement|writer|editorial/iu.test(original)) return original;
  const attachments = wikiSupplementRanges(original);
  let result = original;
  for (const block of wikiDocumentBlocks(original).reverse()) {
    if (attachments.some(([start, end]) => block.start >= start && block.end <= end)) continue;
    const text = original.slice(block.start, block.end);
    const prefix = block.kind === "paragraph" && text.match(/^(?:\*\*|__)?([^：:\n]{1,40})[：:](?:\*\*|__)?[ \t]*/u);
    if ((block.kind === "heading" || block.kind === "paragraph") && wikiInternalDraftLabel(text)) {
      const blank = original.slice(block.end).match(/^\r?\n(?:\r?\n)?/u)?.[0].length ?? 0;
      result = result.slice(0, block.start) + result.slice(block.end + blank);
    } else if (prefix && wikiInternalDraftLabel(prefix[1])) {
      result = result.slice(0, block.start) + result.slice(block.start + prefix[0].length);
    }
  }
  return result.trim();
}

export function cleanWikiDraftClaims(body: string, claims: WikiClaim[]) {
  return claims.map(claim => {
    if (body.includes(claim.text)) return claim;
    const text = cleanWikiDraftDisplay(claim.text);
    return text && body.includes(text) ? { ...claim, text } : claim;
  });
}

/** Project older recovery headings as one section without changing the
 * retained statements, their order, or source blocks. */
export function compactWikiDecisionHeadings(body:string):string{
 if(!/(?:已确[认定]的取舍|已确认的决定补记|Confirmed choices|Confirmed decisions retained)/u.test(body))return body;
 const blocks=wikiDocumentBlocks(body),attachments=wikiSupplementRanges(body);
 const groups:Array<{start:number;end:number;text:string;depth:number;title:string}>=[];
 for(const [index,block] of blocks.entries()){
  if(block.kind!=="heading"||attachments.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  const depth=block.text.match(/^#+/u)?.[0].length??0;
  const title=block.text.slice(depth).trim();
  if(!depth||!LEGACY_DECISION_HEADINGS.test(title))continue;
  const next=blocks.slice(index+1).find(item=>item.kind==="thematicBreak"||item.kind==="heading"&&(item.text.match(/^#+/u)?.[0].length??0)<=depth
    ||attachments.some(([start])=>item.start>=start&&start>=block.end));
  const end=next?.start??body.length;
  groups.push({start:block.start,end,text:body.slice(block.end,end).trim(),depth,title});
 }
 if(!groups.length||groups.some((group,index)=>index>0&&group.start<groups[index-1].end))return body;
 const [first]=groups;
 const title=/\p{Script=Han}/u.test(first.title)?"其他已定决定":"Other confirmed decisions";
 const retained=groups.map(group=>group.text).filter(Boolean).join("\n\n");
 for(const group of groups.slice().reverse()){
  const replacement=group===first&&retained?`${"#".repeat(first.depth)} ${title}\n\n${retained}${group.end<body.length?"\n\n":""}`:"";
  body=body.slice(0,group.start)+replacement+body.slice(group.end);
 }
 return body.trimEnd();
}

/** Older previews may already contain two rendered copies of the same unit. */
function compactDecisionSupplement(chapter:WikiDraftChapter,confirmed:ReadonlySet<string>):WikiDraftChapter{
 const paragraphs=new Map<string,WikiDraftChapter["paragraphs"]>();
 for(const row of chapter.paragraphs)if(DECISION_SUPPLEMENT.test(row.subtopic)){
  const group=paragraphs.get(row.text);
  if(group)group.push(row);else paragraphs.set(row.text,[row]);
 }
 if(!paragraphs.size)return chapter;
 const bindings=new Map([...paragraphs].flatMap(([text,rows])=>{
  const id=rows[0].unitIds[0];
  const kept=rows.find(row=>row.claims?.some(claim=>claim.text===text&&claim.unitIds.includes(id)));
  return kept&&confirmed.has(id)&&rows.every(row=>row.unitIds.length===1&&row.unitIds[0]===id)?[[text,kept] as const]:[];
 }));
 const attachments=wikiSupplementRanges(chapter.body), seen=new Set<string>(), duplicated=new Set<string>();
 const blocks=wikiDocumentBlocks(chapter.body);
 const insideAttachment=(block:typeof blocks[number])=>attachments.some(([start,end])=>block.start>=start&&block.end<=end);
 const supplementHeading=(block:typeof blocks[number])=>block.kind==="heading"&&DECISION_SUPPLEMENT.test(block.text.replace(/^#{1,6}\s+/u,""));
 let inside=false;
 const repeats=blocks.filter(block=>{
  if(insideAttachment(block))return false;
  if(block.kind==="heading")inside=supplementHeading(block);
  if(!inside||block.kind!=="paragraph"||!bindings.has(block.text))return false;
  if(!seen.has(block.text)){seen.add(block.text);return false;}
  duplicated.add(block.text);
  return true;
 });
 if(!repeats.length)return chapter;
 const removed=new Set(repeats);
 for(const [index,block] of blocks.entries()){
  if(!supplementHeading(block)||insideAttachment(block))continue;
  const next=blocks.slice(index+1).find(item=>!removed.has(item));
  if(!next||next.kind==="heading"||next.kind==="thematicBreak")removed.add(block);
 }
 let body=chapter.body;
 for(const block of [...removed].sort((a,b)=>b.start-a.start)){
  const newline=body.slice(block.end).match(/^\r?\n(?:\r?\n)?/u)?.[0].length??0;
  body=body.slice(0,block.start)+body.slice(block.end+newline);
 }
 const kept=new Set<string>();
 return {...chapter,body:body.trimEnd(),paragraphs:chapter.paragraphs.filter(row=>{
  if(!DECISION_SUPPLEMENT.test(row.subtopic)||!duplicated.has(row.text))return true;
  if(row!==bindings.get(row.text)||kept.has(row.text))return false;
  kept.add(row.text);
  return true;
 })};
}

/** Coverage requires a visible claim. A unit mentioned only by an old
 * paragraph, a source block or a discarded claim does not cover its decision. */
export function retainWikiDecisions(chapters:WikiDraftChapter[],ledger:WikiKnowledgeLedger,confirmed:ReadonlySet<string>,zh:boolean):WikiDraftChapter[]{
 const organization=ledger.organization;
 if(!organization||ledger.documentType==="learning")return chapters;
 const home=new Map<string,{chapterId:string;subtopic:string}>();
 const subjects=new Map(organization.subjects.map(subject=>[subject.id,subject]));
 for(const chapter of organization.chapters)for(const topic of chapter.subtopics)for(const id of topic.subjectIds)
  for(const unit of subjects.get(id)?.unitIds??[])home.set(unit,{chapterId:chapter.id,subtopic:topic.title});
 const visible=new Set<string>();
 const unitsById=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit]));
 chapters=chapters.map(chapter=>compactDecisionSupplement(chapter,confirmed));
 const layerChoices=new Set((ledger.userAnswers??[]).filter(answer=>wikiLayerDeferral(answer.question,answer.answer))
  .map(answer=>`answer:${answer.questionId}:${answer.optionId}`));
 const matching=(text:string)=>text.replace(/\*\*|__/gu,"").trim();
 for(const chapter of chapters){
  const prose:string[]=[];
  const attachments=wikiSupplementRanges(chapter.body);
  let historyDepth=0;
  for(const block of wikiDocumentBlocks(chapter.body)){
   if(attachments.some(([start,end])=>block.start>=start&&block.end<=end))continue;
   if(block.kind==="heading"){
    const depth=block.text.match(/^#+/u)?.[0].length??2;
    if(historyDepth&&depth<=historyDepth)historyDepth=0;
    if(wikiHistoricalHeading(block.text))historyDepth=depth;
   }else if(!historyDepth&&["paragraph","list","table","blockquote"].includes(block.kind))prose.push(matching(block.text));
  }
  for(const paragraph of chapter.paragraphs)if(!wikiHistoricalHeading(paragraph.subtopic))for(const claim of paragraph.claims??[]){
   const text=matching(claim.text);
   if(text&&prose.some(block=>block.includes(text)))for(const id of claim.unitIds){
    const unit=unitsById.get(id);
    if(layerChoices.has(id)&&unit&&!wikiDecisionRestatement(text,unit.statement))continue;
    visible.add(id);
   }
  }
  for(const id of chapter.openingUnitIds??[]){
   const unit=unitsById.get(id);
   if(unit&&openingStatesChoice(chapter,unit.statement))visible.add(id);
  }
 }
 const additions=new Map<string,WikiKnowledgeUnit[]>();
 for(const unit of unitsById.values()){
  const id=home.get(unit.id)?.chapterId;
  if(!confirmed.has(unit.id)||visible.has(unit.id)||wikiProjectPersonalAside(unit)
   ||unit.about&&ledger.scopeAnswers?.[aboutNameKey(unit.about.name)]==="exclude")continue;
  const target=chapters.find(chapter=>chapter.id===id)??chapters[0];
  if(target)additions.set(target.id,[...additions.get(target.id)??[],unit]);
 }
 return chapters.map(chapter=>{
  const subtopic=zh?"已确认的决定补记":"Confirmed decisions retained";
  const duplicate=chapter.paragraphs.filter(paragraph=>paragraph.subtopic===subtopic&&paragraph.unitIds.length===1&&
   (chapter.openingUnitIds?.includes(paragraph.unitIds[0])&&openingStatesChoice(chapter,paragraph.text)
    || chapter.paragraphs.some(other=>other.subtopic!==subtopic&&!wikiHistoricalHeading(other.subtopic)&&chapter.body.includes(other.text)&&
    other.claims?.some(claim=>claim.unitIds.includes(paragraph.unitIds[0])&&wikiDecisionRestatement(claim.text,paragraph.text)))));
  if(duplicate.length){
   let body=chapter.body;
   for(const paragraph of duplicate){
    const after=body.lastIndexOf(`\n\n${paragraph.text}`);
    if(after>=0)body=body.slice(0,after)+body.slice(after+paragraph.text.length+2);
   }
   body=body.replace(new RegExp(`\\n\\n### ${subtopic}(?=\\s*(?:#{1,6} |$))`,"u"),"");
   chapter={...chapter,body,paragraphs:chapter.paragraphs.filter(paragraph=>!duplicate.includes(paragraph))};
  }
  const units=additions.get(chapter.id);
  if(!units?.length)return chapter;
  let body=chapter.body;
  const paragraphs=units.map(unit=>{
   const topic=home.get(unit.id)?.subtopic,text=unit.statement.trim(),placed=topic&&putUnderWikiDecisionTopic(body,topic,text,true);
   if(placed)body=placed;
   return {subtopic:placed?topic!:subtopic,text,unitIds:[unit.id],claims:[{text,unitIds:[unit.id]}]};
  });
  const rest=paragraphs.filter(paragraph=>paragraph.subtopic===subtopic);
  if(rest.length)body=`${body.trimEnd()}\n\n### ${subtopic}\n\n${rest.map(p=>p.text).join("\n\n")}`;
  return {...chapter,body,paragraphs:[...chapter.paragraphs,...paragraphs]};
 });
}

function openingStatesChoice(chapter:WikiDraftChapter,choice:string){
 const opening=chapter.body.split(/^#{1,6}\s/mu)[0];
 return opening.split(/(?<=[。！？])|(?<=[.!?])(?=\s|$)|\n/u).some(sentence=>wikiDecisionRestatement(sentence.trim(),choice));
}

export function putUnderWikiDecisionTopic(body:string,topic:string,text:string,create=false){
 if(!topic.trim()||/[\r\n]/u.test(topic)||wikiHistoricalHeading(topic)||LEGACY_DECISION_HEADINGS.test(topic))return;
 const attachments=wikiSupplementRanges(body),blocks=wikiDocumentBlocks(body);
 const heading=blocks.find(block=>block.kind==="heading"&&block.text.replace(/^#{1,6}\s+/u,"").trim()===topic
   &&!attachments.some(([start,end])=>block.start>=start&&block.end<=end));
 if(heading)return `${body.slice(0,heading.end)}\n\n${text}${body.slice(heading.end)}`;
 if(!create)return;
 const end=Math.min(attachments[0]?.[0]??body.length,blocks.find(block=>block.kind==="heading"&&(wikiHistoricalHeading(block.text)
   ||LEGACY_DECISION_HEADINGS.test(block.text.replace(/^#{1,6}\s+/u,""))))?.start??body.length);
 const before=body.slice(0,end).trimEnd(),after=body.slice(end).trimStart();
 return [before,`### ${topic}\n\n${text}`,after].filter(Boolean).join("\n\n");
}

/** An answer may confirm an initial count without confirming the later target
 * in the same proposal. Keep the later count in its own open claim. */
function separateExpansion(text:string,answer:string,units:WikiKnowledgeUnit[]):string|undefined{
 const initial=/^先做稳\s*(\d+)\s*个(?:基础元件)?[，,]\s*再逐步扩展[。]?$/u.exec(answer);
 if(!initial)return;
 const compact=(value:string)=>value.replace(/\s+/gu,"");
 const row=/^\|\s*([^|\n]+)\s*\|\s*([^|\n]+)\s*\|$/u.exec(text);
 const value=row?.[2].trim()??text;
 const mixed=/^先(?:做稳|稳定)\s*(\d+)\s*个(?:基础元件)?[，,]\s*再逐步扩展至\s*(约?\s*\d+\s*个)(?:基础元件|元件)?\s*[（(]\s*AI\s*建议[，,]\s*待确认[）)][。]?$/u.exec(value);
 if(!mixed||mixed[1]!==initial[1]||!units.some(unit=>compact(unit.statement).includes("扩展至"+compact(mixed[2]))))return;
 const count = mixed[2].replace(/\s+/gu,"").replace(/(约?)(\d+)个/u,"$1 $2 个").trimStart();
 const proposal=`AI 建议逐步扩展至${count.startsWith("约")?"":" "}${count}元件，数量待确认。`;
 return row?`| 后续${row[1].trim()} | ${proposal} |`:proposal;
}

/** Reconcile only facts proved by saved answers and exact claim bindings. No model
 * calls, inferred replacement edges or rewriting of literal source examples. */
export function reviewWikiEditorial(chapters:WikiDraftChapter[],ledger:WikiKnowledgeLedger):WikiDraftChapter[]{
 const units=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit]));
 const workflow=wikiWorkflowScopes(ledger,units);
 const roadmaps=confirmedRoadmaps(ledger);
 const scopedAnswers=new Map((ledger.userAnswers??[]).flatMap(answer=>{
  const question=ledger.writingQuestions?.find(item=>item.id===answer.questionId);
  const id=`answer:${answer.questionId}:${answer.optionId}`,unit=units.get(id);
  if(!question||!unit||ledger.decisions?.[id]?.verdict!=="confirmed")return [];
  return [[id,{unit,question,answer,workflow:workflow.narrowed.get(question.id)}] as const];
 }));
 const confirmed = new Set(Object.entries(ledger.decisions ?? {}).filter(([, decision]) => decision.verdict === "confirmed").map(([id]) => id));
 const result=chapters.map(chapter=>separateUnconfirmedWikiPlans({...chapter,paragraphs:chapter.paragraphs.map(paragraph=>({...paragraph,claims:paragraph.claims?.map(claim=>({...claim}))}))}, units, confirmed));
 const latestByUnit=new Map<string,NonNullable<WikiKnowledgeLedger["userAnswers"]>[number]>();
 for(const answer of [...ledger.userAnswers??[]].sort((a,b)=>a.at-b.at))for(const id of answer.unitIds)latestByUnit.set(id,answer);
 const deferred=(ledger.userAnswers??[]).flatMap(answer=>{
  const choice=units.get(`answer:${answer.questionId}:${answer.optionId}`);
  const scope=choice&&ledger.decisions?.[choice.id]?.verdict==="confirmed"&&wikiReleaseDeferral(answer.question,answer.answer);
  return scope?[scope]:[];
 });
 for(const chapter of result)for(const paragraph of chapter.paragraphs){
  if(/`{3}|~{3}/u.test(paragraph.text))continue;
  const before=paragraph.text;
  // A driver requirement belongs to a specific validator result. Drop an
  // unbound sentence that applies it to a mixed list of unrelated error codes.
  for(const fragment of before.match(/(?:^|(?<=[。！？]))\s*遇到\s+[A-Z][A-Z_\d]+[^。！？\n]{12,250}提示安装驱动[^。！？\n]*[。！？]/gu)??[]){
   const codes=[...fragment.matchAll(/\b[A-Z][A-Z_\d]{4,}\b/gu)].map(match=>match[0]);
   if(codes.length<3||paragraph.claims?.some(claim=>claim.text.trim()&&(claim.text.includes(fragment.trim())||fragment.includes(claim.text)))
     ||paragraph.unitIds.some(id=>{const unit=units.get(id);return unit&&codes.every(code=>unit.evidence.quote.includes(code));}))continue;
   paragraph.text=paragraph.text.replace(fragment,"").trim();
  }
  const expanded=new Set<string>();
  for(const claim of paragraph.claims??[]){
   if(!claim.text||!paragraph.text.includes(claim.text))continue;
   const sources=claim.unitIds.flatMap(id=>units.get(id)??[]);
   const mislabeled=roadmaps.find(({plan})=>claim.unitIds.includes(plan.unitId)&&wikiRejectedReadingOfConfirmedOrder(claim.text,plan));
   if(mislabeled){
    // The choice's alternate already has its own evidence and historical
    // standing. This sentence assigns that verdict to the selected order.
    paragraph.text=paragraph.text.replace(claim.text,"").trim();
    claim.text="";
    continue;
   }
   let next=workflow.qualify(claim.text,claim.unitIds);
   const inventoryReport=next.match(/^(?:\*{4})?实际(包含.+共\s*\*{0,2}\d+\s*个\*{0,2}\s*(?:元件|组件)[。.]?)$/u);
   if(inventoryReport){
    const compact=(value:string)=>value.normalize("NFKC").replace(/[\s*。.]/gu,"");
    const source=sources.filter(unit=>!unit.about&&!unit.evidence.pasted&&unit.evidence.role==="user"
      &&/^.{2,22}(?:库|清单|目录)$/u.test(unit.subject)&&compact(inventoryReport[1])===compact(unit.statement));
    if(source.length===1){
     next=`据项目发起人报告，${source[0].subject}${inventoryReport[1].replace(/\*\*/gu,"").replace(/\s*(\d+)\s*个\s*/u," $1 个")}`;
     claim.unitIds=[source[0].id];
    }
   }
   if(sources.length===claim.unitIds.length){
    next=wikiWithoutUnsupportedExample(next,sources)??next;
    next=wikiWithoutImplementationAside(next,sources)??next;
    if(sources.length===1&&ledger.decisions?.[sources[0].id]?.verdict!=="confirmed")next=wikiDesignContrast(next,sources[0])??next;
   }
   const scoped=claim.unitIds.length===1?scopedAnswers.get(claim.unitIds[0]):undefined;
   if(scoped){
    const {unit,question,answer}=scoped;
    const integration=wikiScopedIntegration(answer.question,answer.answer);
    const narrowed=wikiRepairIntegrationChoice(next,answer.question,answer.answer);
    if(integration&&(narrowed||next===unit.statement)){
     const resolved=ledger.userAnswers?.some(later=>later.at>answer.at&&later.unitIds.length===1&&later.unitIds[0]===unit.id
      &&wikiLocalAnswer(ledger,`answer:${later.questionId}:${later.optionId}`)===later);
     next=resolved?integration.slice(0,integration.indexOf("。")+1):narrowed??next;
    }
    const layer=wikiLayerDeferral(question.ask,answer.answer);
    const old=`${question.about}：${answer.answer}`;
    if(layer&&(wikiDecisionRestatement(next,old)||wikiDecisionRestatement(next,answer.answer)))next=layer;
    if(scoped.workflow&&/AI 对具体细节的建议|AI proposal for the details/iu.test(before)){
     const generic=/^该方案已确认为(?:最终)?实施计划[。.]?$/u.test(next);
     const entryPart=!generic&&/移除|取消/u.test(next)&&/移除|取消/u.test(scoped.workflow.statement)&&!/[\d<>]/u.test(next)&&/常驻|固定/u.test(next);
     if(entryPart){next=scoped.workflow.statement;expanded.add(unit.id);}
    }
   }
   if(sources.length===1&&/^\s*\|/u.test(before)){
    const source=sources[0], answer=latestByUnit.get(source.id), verdict=ledger.decisions?.[source.id];
    if(answer?.unitIds.length===1&&verdict?.verdict==="confirmed"&&verdict.at===answer.at&&!source.about){
     const row=before.split("\n").find(line=>line.split("|").some(cell=>cell.trim()===claim.text));
     if(row)next=wikiRepairClosedListCell(next,row.split("|")[1]?.trim()??"",answer)??next;
    }
   }
   if(sources.length&&deferred.length&&!/完整流程设想|end-to-end vision|^[|]/iu.test(next))for(const {feature,stage} of deferred){
    const name=feature.replace(/^(?:[\w.-]+\s+)+(?=\p{Script=Han})/u,"");
    const zh=/\p{Script=Han}/u.test(next);
    const ending=next.replace(/[。.!?！？]\s*$/u,"").split(/[，,。；;]|→|->/u).at(-1)??"";
    const journey=/流程|旅程|首屏|经.+后|→|->|\b(?:journey|workflow|end-to-end)\b/iu.test(next);
    if(!journey||!ending.toLowerCase().includes(name.toLowerCase())||! /最后|最终|→|->|\b(?:finally|ends? (?:with|in))\b/iu.test(next))continue;
    if(next.toLowerCase().includes(stage.toLowerCase()))continue;
    next=zh?`完整流程设想：${next}`:`End-to-end vision: ${next}`;
    break;
   }
   if(sources.length===1&&/^(?:下一阶段|后续|next phase)/iu.test(sources[0].statement)&&/^(?:当前阶段|目前重点|current phase)/iu.test(next))next=sources[0].statement;
   const answer=claim.unitIds.flatMap(id=>latestByUnit.get(id)??[]).sort((a,b)=>b.at-a.at)[0];
   const question=ledger.writingQuestions?.find(question=>question.id===answer?.questionId);
   const option=question?.options.find(option=>option.id===answer?.optionId);
   const current=question&&option?units.get(`answer:${question.id}:${option.id}`):undefined;
   const confirmedIds=option?.actions.flatMap(action=>action.do==="confirm"?action.units:[])??[];
   if(answer&&current&&ledger.decisions?.[current.id]?.verdict==="confirmed"&&wikiScopedIntegration(answer.question,answer.answer)
    &&sources.length===1&&confirmedIds.includes(sources[0].id)&&ledger.decisions?.[sources[0].id]?.verdict!=="confirmed"){
    next=wikiIntegrationProposal(next,sources[0],/\p{Script=Han}/u.test(next))??next;
   }
   if(answer&&sources.length===1&&confirmedIds.includes(sources[0].id)&&!/早先版本|早期版本|Earlier versions/iu.test(paragraph.subtopic)){
    const proposal=separateExpansion(next,answer.answer,sources);
    if(proposal&&!next.startsWith("|")){
     const row=paragraph.text.split("\n").find(line=>line.startsWith("|")&&line.includes(claim.text));
     if(row){
      const revised=row.replace(claim.text,()=>proposal).replace(/^\|\s*(?!后续)([^|]+?)\s*\|/u,"| 后续$1 |");
      paragraph.text=paragraph.text.replace(row,()=>revised);
      claim.text=proposal;
      continue;
     }
    }
    if(proposal)next=proposal;
   }
   const alternativeIds=option?.actions.flatMap(action=>action.do==="open"||action.do==="reject"?action.units:[])??[];
   if(current&&sources.length&&sources.every(unit=>alternativeIds.includes(unit.id))&&current.statement!==next){
    const numeric=/规模|数量|个数|多少|\b(?:count|size|number)\b/iu.test(`${question?.about} ${question?.ask}`)&&/\d|二三十/u.test(next);
    const mixed=/早先版本|早期版本|Earlier versions/iu.test(paragraph.subtopic)&&answer&&next.includes(answer.answer);
    if((numeric||mixed)&&!/^(?:其他候选记录（不作为当前确认范围）：|范围待核对的候选建议：|Alternative record \(not the confirmed scope\):|Alternative proposal)/u.test(next)){
     const record=mixed?sources.map(unit=>unit.statement).join(" "):next;
     next=/\p{Script=Han}/u.test(record)?`其他候选记录（不作为当前确认范围）：${record}`:`Alternative record (not the confirmed scope): ${record}`;
    }
   }
   if(answer&&question&&/规模|数量|个数|\b(?:count|size|number)\b/iu.test(question.about)&&/(?:你|用户|发起人).{0,10}(?:否定|否决)|被(?:否定|否决)/u.test(next)&&sources.some(unit=>ledger.decisions?.[unit.id]?.verdict==="rejected")){
    // A choice about a count does not reject every other clause of a compound unit.
    next=`关于${question.about}，项目发起人在整理时选择“${answer.answer}”。该取舍仅限于此问题的范围。`;
   }
   if(sources.length===1&&knowledgeTerms(next).size>=2&&statesCore(sources[0].statement,next)
    &&!/早期|此前|待核对|earlier|previous/iu.test(next)){
    const narrowing=ledger.organization?.relations.find(relation=>relation.older===sources[0].id&&relation.kind==="narrows"&&relation.status==="resolved");
    const chosen=narrowing&&ledger.userAnswers?.find(answer=>answer.unitIds.includes(narrowing.newer));
    const option=ledger.writingQuestions?.find(question=>question.id===chosen?.questionId)?.options.find(option=>option.id===chosen?.optionId);
    if(chosen&&option?.actions.some(action=>action.do==="confirm"&&action.units.includes(narrowing!.newer))){
     // Keep the older statement, but never present it as the confirmed current scope.
     const note=`此为较宽的早期建议；整理时就相应范围选择“${chosen.answer}”，其余独有条件仍需分别判断。`;
     next=`${next.replace(/[。]$/u,"")}。${note}`;
    }
   }
   if(next!==claim.text){paragraph.text=paragraph.text.replace(claim.text,()=>next);claim.text=next;}
  }
  for(const claim of paragraph.claims??[]){
   if(claim.unitIds.length!==1||!expanded.has(claim.unitIds[0])||!/^该方案已确认为(?:最终)?实施计划[。.]?$/u.test(claim.text))continue;
   paragraph.text=paragraph.text.replace(claim.text,"").trimEnd();
   claim.text="";
   claim.unitIds=[];
  }
  if(before!==paragraph.text)chapter.body=replaceParagraph(chapter.body,before,()=>paragraph.text);
 }
 // A current answer and an old rejected candidate must have separate claims.
 // This also covers affirmative choices represented only by a reject action.
 for(const answer of [...ledger.userAnswers??[]].sort((a,b)=>b.at-a.at)){
  const question=ledger.writingQuestions?.find(question=>question.id===answer.questionId),option=question?.options.find(option=>option.id===answer.optionId);
  const current=question&&option?units.get(`answer:${question.id}:${option.id}`):undefined;
  if(!current||ledger.decisions?.[current.id]?.verdict!=="confirmed"||result.some(chapter=>chapter.paragraphs.some(paragraph=>paragraph.unitIds.includes(current.id)&&!/早先版本|早期版本|Earlier versions/iu.test(paragraph.subtopic))))continue;
  if(question?.options.length===1&&!option?.actions.length){
   const anchor=answer.unitIds.find(id=>{const unit=units.get(id);return unit&&current.evidence.evidenceId===`${unit.evidence.evidenceId}:${current.id}`;});
   const home=anchor&&result.flatMap(chapter=>chapter.paragraphs.map(paragraph=>({chapter,paragraph}))).find(({chapter,paragraph})=>
    paragraph.unitIds.includes(anchor)&&chapter.body.includes(paragraph.text)&&!wikiHistoricalHeading(paragraph.subtopic)&&!/[`~]{3}/u.test(paragraph.text));
   if(home){
    const {chapter,paragraph}=home;
    const previous=paragraph.text;
    const historical=(text:string)=>text.replace(/(关于[^，。]{1,24}，)存在(?=[一二两三四\d]+种(?:主要)?(?:提案|方案|选项))/gu,"$1讨论时提出过");
    paragraph.text=historical(previous);
    for(const claim of paragraph.claims??[])claim.text=historical(claim.text);
    const text=current.statement, added={text,subtopic:paragraph.subtopic,unitIds:[current.id],claims:[{text,unitIds:[current.id]}]};
    chapter.body=replaceParagraph(chapter.body,previous,()=>`${text}\n\n${paragraph.text}`);
    chapter.paragraphs.push(added);
    continue;
   }
  }
  const subject=ledger.organization?.subjects.find(subject=>subject.unitIds.includes(current.id));
  const plan=ledger.organization?.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.includes(subject?.id??"")));
  const topic=plan?.subtopics.find(topic=>topic.subjectIds.includes(subject?.id??""));
  const owning=result.find(chapter=>chapter.id===plan?.id);
  const placed=owning&&topic&&putUnderWikiDecisionTopic(owning.body,topic.title,current.statement,true);
  if(placed&&owning&&topic){
   const text=current.statement;
   owning.body=placed;
   owning.paragraphs.push({text,subtopic:topic.title,unitIds:[current.id],claims:[{text,unitIds:[current.id]}]});
   continue;
  }
  const home=result.find(chapter=>chapter.paragraphs.some(paragraph=>paragraph.unitIds.some(id=>answer.unitIds.includes(id))));
  if(!home)continue;
  const text=current.statement,subtopic=/\p{Script=Han}/u.test(text)?"已确认的取舍":"Confirmed choices";
  home.body+=`\n\n### ${subtopic}\n\n${text}`;
  home.paragraphs.push({text,subtopic,unitIds:[current.id],claims:[{text,unitIds:[current.id]}]});
 }
 // An over-broad bundled answer can leave its adjacent feedback out of the
 // rendered article. Keep it as a scoped suggestion in the owning topic.
 for(const scope of workflow.narrowed.values())for(const id of scope.feedbackIds){
  const unit=units.get(id);
  if(!unit||result.some(chapter=>chapter.paragraphs.some(p=>p.claims?.some(claim=>claim.unitIds.includes(id)&&chapter.body.includes(claim.text)))))continue;
  const subject=ledger.organization?.subjects.find(subject=>subject.unitIds.includes(id));
  const plan=ledger.organization?.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.includes(subject?.id??"")));
  const topic=plan?.subtopics.find(topic=>topic.subjectIds.includes(subject?.id??""));
  const home=result.find(chapter=>chapter.id===plan?.id),text=workflow.qualify(unit.statement,[id]);
  const placed=home&&topic&&text!==unit.statement&&putUnderWikiDecisionTopic(home.body,topic.title,text);
  if(!placed||!home||!topic)continue;
  home.body=placed;
  home.paragraphs.push({text,subtopic:topic.title,unitIds:[id],claims:[{text,unitIds:[id]}]});
 }
 // An explicitly retained external reference must survive editorial selection.
 const named=new Map<string,WikiKnowledgeUnit[]>();
 for(const answer of ledger.userAnswers??[]){
  const question=ledger.writingQuestions?.find(question=>question.id===answer.questionId);
  for(const action of question?.options.find(option=>option.id===answer.optionId)?.actions??[]){
   if(action.do!=="owner"||action.answer!=="reference")continue;
   const group=action.units.flatMap(id=>units.get(id)??[]).filter(unit=>unit.about&&unit.kind!=="question"&&!/需要分析|用户(?:要求|询问)|please analyze/iu.test(unit.statement));
   if(group.length)named.set(action.name,group);
  }
 }
 for(const [name,group] of named){
  if(result.some(chapter=>chapter.paragraphs.some(paragraph=>paragraph.unitIds.some(id=>group.some(unit=>unit.id===id)))))continue;
  const unit=[...group].sort((a,b)=>b.statement.length-a.statement.length)[0];
  const subject=ledger.organization?.subjects.find(subject=>subject.unitIds.includes(unit.id));
  const plan=ledger.organization?.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.includes(subject?.id??"")));
  const home=result.find(chapter=>chapter.id===plan?.id)??result.find(chapter=>/竞品|参考|competitor|reference/iu.test(chapter.title));
  if(!home)continue;
  const text=unit.statement,subtopic=plan?.subtopics.find(topic=>topic.subjectIds.includes(subject?.id??""))?.title??name;
  home.paragraphs.push({text,subtopic,unitIds:[unit.id],claims:[{text,unitIds:[unit.id]}]});
  home.body+=`\n\n### ${name}\n\n${text}`;
 }
 return reviewWikiEvidenceStates(result,ledger);
}
