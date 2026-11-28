import type {FocusEvidence,FocusSection} from "../shared/focus-session";
import {wikiDocumentBlocks} from "../shared/wiki-document-blocks";
import {wikiSupplementRanges} from "../shared/wiki-source-supplements";
import {statesCore,wikiLedgerUnits,type WikiDraftChapter,type WikiKnowledgeLedger,type WikiKnowledgeUnit} from "../shared/wiki-knowledge";
import type {WikiClaim} from "../shared/wiki-claims";
import {compactWikiDecisionHeadings,putUnderWikiDecisionTopic,reviewWikiEditorial} from "./wiki-editorial-review";
import {claimSupported} from "./wiki-claim-support";
import {wikiDecisionRestatement} from "./wiki-confirmation-scope";
import {answerLeavesDetailsOpen,wikiChoiceQuestionText,wikiLocalAnswer,wikiScopedIntegration} from "./wiki-question-parse";
import {wikiUnconfirmedWorkflowFeedback} from "./wiki-workflow-scope";
import {placeWikiChoices} from "./wiki-choice-placement";
import {wikiBoundClosedListChoices} from "./wiki-number-diagnostics";
import {wikiStatesClosedList} from "../shared/wiki-closed-list";
import {withStop} from "../shared/wiki-sentences";
import {trimWikiEditorialRepeats} from "./wiki-editorial-repetitions";

/** Apply the same answer reconciliation to saved generated prose as to new
 * drafts. All receipts must still belong to this chapter's selected sources.
 * This is a reading projection: neither the saved article nor sources change. */
export function reviewSavedWikiEditorial(section:FocusSection,ledger:WikiKnowledgeLedger,sourceOf:(unit:WikiKnowledgeUnit)=>FocusEvidence|undefined):FocusSection{
 if(section.userEdited||section.origin||ledger.documentType==="learning")return section;
 const units=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit]));
 const storedClaims=ledger.draft?.chapters.find(chapter=>chapter.id===section.id)?.paragraphs.flatMap(paragraph=>paragraph.claims??[])??[];
 for(const claim of storedClaims){
  const id=claim.unitIds.length===1?claim.unitIds[0]:"";
  if(!id.startsWith("answer:")||!/[和与及].{1,26}(?:已确认|已决定)(?:集成|接入)/u.test(claim.text)||!section.body.includes(claim.text))continue;
  const choice=units.get(id), answer=wikiLocalAnswer(ledger,id), ref=choice&&sourceOf(choice);
  const scoped=answer&&wikiScopedIntegration(answer.question,answer.answer);
  if(!choice||!ref||!scoped||!choice.statement.startsWith(scoped)||section.claims?.some(item=>item.text===claim.text&&item.checked))continue;
  const already=section.body.includes(choice.statement);
  const blocks=wikiDocumentBlocks(section.body);
  if(!blocks.some(block=>block.kind==="paragraph"&&block.text===claim.text)||section.body.indexOf(claim.text)!==section.body.lastIndexOf(claim.text))continue;
  const body=section.body.replace(claim.text,()=>already?"":choice.statement).replace(/\n{3,}/gu,"\n\n");
  const claims=(section.claims??[]).filter(item=>item.text!==claim.text);
  if(!claims.some(item=>item.text===choice.statement))claims.push({text:choice.statement,quote:choice.evidence.quote,
   unitIds:[id],evidenceIds:[ref.id],holder:"decided",holderMark:true,userDecided:true,verification:"supported"});
  section={...section,body,claims};
 }
 const narrowed = new Map<string, {choice:WikiKnowledgeUnit;ref:FocusEvidence;ask:string}>();
 for (const answer of ledger.userAnswers ?? []) {
  const choice=units.get(`answer:${answer.questionId}:${answer.optionId}`);
  const ref=choice&&sourceOf(choice);
  const question=ledger.writingQuestions?.find(item=>item.id===answer.questionId);
  const option=question?.options.find(item=>item.id===answer.optionId);
  if(!choice||!ref||!question||!option||!wikiLocalAnswer(ledger,choice.id))continue;
  const scoped=wikiScopedIntegration(answer.question,answer.answer);
  if(scoped){
   const canonical=withStop(scoped);
   const tail=scoped.match(/(?:具体采用|The specific choice)[^\n]+$/u)?.[0];
   const echoes=tail?section.claims?.filter(claim=>!claim.checked&&claim.unitIds?.length===1&&claim.unitIds[0]===choice.id
    &&claim.text.startsWith(tail)&&claim.text!==tail&&/但.{0,16}(?:已获批准|已确认|已决定)|\bbut.{0,40}(?:approved|confirmed)\b/iu.test(claim.text))??[]:[];
   if(echoes.length){
    let body=section.body;
    const removed=new Set<WikiClaim>();
    for(const claim of echoes){
     if(!body.includes(claim.text)||body.indexOf(claim.text)!==body.lastIndexOf(claim.text))continue;
     body=body.replace(claim.text,()=>body.includes(canonical)?"":canonical);
     removed.add(claim);
    }
    if(removed.size){
     const claims=(section.claims??[]).filter(claim=>!removed.has(claim));
     if(!claims.some(claim=>claim.text===canonical))claims.push({text:canonical,quote:choice.evidence.quote,
      unitIds:[choice.id],evidenceIds:[ref.id],holder:"decided",holderMark:true,userDecided:true,verification:"supported"});
     section={...section,body,claims};
    }
   }
   // The backed design option remains an independently attributable proposal.
   continue;
  }
  const confirmedIds=option.actions.filter(action=>action.do==="confirm").flatMap(action=>action.units);
  for(const id of option.actions.length?confirmedIds:answer.unitIds){
   const unit=units.get(id);
   if(unit&&unit.evidence.conversationId===choice.evidence.conversationId&&unit.evidence.messageId===choice.evidence.messageId
      &&unit.evidence.quote===choice.evidence.quote&&answerLeavesDetailsOpen(unit,question,answer.answer))narrowed.set(id,{choice,ref,ask:question.ask});
  }
 }
 if(narrowed.size&&section.claims?.length){
  let body=section.body;
  const replacements:WikiClaim[]=[];
  const blocks=wikiDocumentBlocks(body);
  for(const claim of section.claims){
   const matches=[...new Set((claim.unitIds??[]).flatMap(id=>narrowed.get(id)??[]))];
   const selected=matches.length===1?matches[0]:undefined;
   if(!selected||claim.checked||claim.markOnly){replacements.push(claim);continue;}
   const original=units.get(claim.unitIds!.find(id=>narrowed.get(id)===selected)!);
   const {choice,ref,ask}=selected;
   // An independently grounded proposal still needs its source after a
   // separate answer fixes the current scope.
   const proposalBasis=original&&sourceOf(original);
   if(claim.holder==="ai"&&!claim.userDecided&&claim.verification==="supported"&&proposalBasis
    &&ledger.decisions?.[original.id]?.verdict!=="confirmed"&&claim.evidenceIds.includes(proposalBasis.id)){
    replacements.push(claim);
    continue;
   }
   const block=blocks.find(item=>item.kind==="paragraph"&&item.text.includes(claim.text));
   const isPrompt=wikiChoiceQuestionText(claim.text,ask)||Boolean(original&&wikiChoiceQuestionText(claim.text,original.statement));
   if(block&&isPrompt&&body.indexOf(claim.text)===body.lastIndexOf(claim.text)&&body.includes(claim.text)){
    body=body.replace(claim.text,()=>choice.statement);
   }else{
    replacements.push({...claim,unitIds:claim.unitIds?.filter(id=>!narrowed.has(id)),holder:original?.evidence.role==="assistant"?"ai":"user",holderMark:undefined,userDecided:undefined,sourceReading:undefined});
    if(block&&!body.includes(choice.statement)&&body.includes(block.text))body=body.replace(block.text,()=>`${choice.statement}\n\n${block.text}`);
   }
   if(body.includes(choice.statement)&&!replacements.some(item=>item.text===choice.statement))
    replacements.push({text:choice.statement,quote:choice.evidence.quote,unitIds:[choice.id],evidenceIds:[ref.id],holder:"decided",holderMark:true,userDecided:true,verification:"supported"});
  }
  section={...section,body,claims:replacements};
 }
 const recovered=new Set((ledger.writingQuestions??[]).filter(question=>question.options.length===1&&!question.options[0].actions.length)
  .map(question=>`answer:${question.id}:${question.options[0].id}`));
 const safeClaims=section.claims?.map(claim=>{
  if(claim.holder!=="decided"&&!claim.userDecided){
   const unit=claim.unitIds?.length===1?units.get(claim.unitIds[0]):undefined;
   if(!unit||!sourceOf(unit)||!wikiLocalAnswer(ledger,unit.id))return claim;
   const [list,...otherLists]=wikiBoundClosedListChoices(claim.text,[unit],ledger);
   const prefix=claim.text.match(/^(.*?)[，,]\s*(?:仅限|只限|only)\s*(?:列出|上述|上面|the listed)/iu)?.[1];
   const confirmedList=list&&!otherLists.length&&wikiStatesClosedList(claim.text,list,true)
    &&Boolean(prefix&&statesCore(prefix,unit.statement)&&claimSupported(prefix,[unit]));
   if(unit.id.startsWith("answer:")&&wikiDecisionRestatement(claim.text,unit.statement)||confirmedList)
    return {...claim,holder:"decided" as const,holderMark:true,userDecided:true,workStatus:undefined,verification:"supported" as const};
   return claim;
  }
  const stale=claim.unitIds?.filter(id=>recovered.has(id)&&!claimSupported(claim.text,units.has(id)?[units.get(id)!]:[]))??[];
  if(!stale.length)return claim;
  return {...claim,unitIds:claim.unitIds?.filter(id=>!stale.includes(id)),holder:"ai" as const,holderMark:undefined,userDecided:undefined,workStatus:"proposed" as const};
 });
 if(safeClaims?.some((claim,index)=>claim!==section.claims?.[index]))section={...section,claims:safeClaims};
 const blocks=wikiDocumentBlocks(section.body,section.claims),ranges=wikiSupplementRanges(section.body),bindings:Array<{claim:WikiClaim;from:string;to:{text:string;unitIds:string[]}}>=[];
 let subtopic="";
 const paragraphs=blocks.map(block=>{
  if(ranges.some(([start,end])=>block.start>=start&&block.end<=end))return {text:block.text,subtopic,unitIds:[],claims:[]};
  if(block.kind==="heading")subtopic=block.text.replace(/^#+\s+/u,"");
  const candidates=block.kind==="list"&&!/[`~]{3}/u.test(block.text)?(section.claims??[]).filter(claim=>[claim.text,...claim.formulations??[]].some(form=>form&&block.text.includes(form))):block.claims;
  const claims=candidates.flatMap(claim=>{
   if(claim.checked)return [];
   const ids=claim.unitIds??[];
   if(!ids.length||!ids.every(id=>{const unit=units.get(id);return unit&&sourceOf(unit);}))return [];
   return [claim.text,...claim.formulations??[]].filter((form,index,all)=>form&&block.text.includes(form)&&all.indexOf(form)===index).map(from=>{
    const to={text:from,unitIds:[...ids]};bindings.push({claim,from,to});return to;
   });
  });
  return {text:block.text,subtopic,unitIds:[...new Set(claims.flatMap(claim=>claim.unitIds))],claims};
 });
 // Editorial review clones its input; bind the returned claims by paragraph/index.
 const draft:WikiDraftChapter={id:section.id,title:section.title,question:"",group:"",body:section.body,problems:[],paragraphs,openingUnitIds:ledger.draft?.chapters.find(chapter=>chapter.id===section.id)?.openingUnitIds?.filter(id=>{const unit=units.get(id);return unit&&sourceOf(unit);})};
 const reviewed=reviewWikiEditorial([draft],ledger)[0];
 let body=section.body;
 const claims=[...section.claims??[]];
 for(let index=paragraphs.length-1;index>=0;index--){
  const before=paragraphs[index],after=reviewed.paragraphs[index];
  if(before.text===after.text)continue;
  const block=blocks[index];body=body.slice(0,block.start)+after.text+body.slice(block.end);
  for(let ci=0;ci<(before.claims?.length??0);ci++){
   const from=before.claims![ci],to=after.claims![ci];if(from.text===to.text)continue;
   const bound=bindings.find(binding=>binding.to===from);if(!bound)continue;
   const originalIndex=section.claims?.indexOf(bound.claim)??-1;
   if(originalIndex>=0){const claim=claims[originalIndex];claims[originalIndex]={...claim,text:claim.text===bound.from?to.text:claim.text,formulations:claim.formulations?.map(form=>form===bound.from?to.text:form),
    ...(wikiUnconfirmedWorkflowFeedback(to.text)?{holder:"ai",holderMark:undefined,userDecided:undefined,workStatus:"proposed",sourceReading:undefined}:{})};}
  }
 }
 const additions:string[]=[];
 for(const paragraph of reviewed.paragraphs.slice(paragraphs.length)){
  const sourceUnits=paragraph.unitIds.flatMap(id=>units.get(id)??[]);
  const feedback=wikiUnconfirmedWorkflowFeedback(paragraph.text);
  if(!sourceUnits.length||!sourceUnits.every(unit=>sourceOf(unit))||!feedback&&!sourceUnits.every(unit=>ledger.decisions?.[unit.id]?.verdict==="confirmed"))continue;
  // Restored references are handled by the draft pipeline; here only explicit
  // answers can add a missing current decision to an already saved chapter.
  if(!feedback&&!sourceUnits.every(unit=>unit.id.startsWith("answer:")))continue;
  const subjectIds=new Set(ledger.organization?.subjects.filter(subject=>sourceUnits.some(unit=>subject.unitIds.includes(unit.id))).map(subject=>subject.id));
  const home=ledger.organization?.chapters.find(chapter=>chapter.subtopics.some(topic=>topic.subjectIds.some(id=>subjectIds.has(id))));
  if(home&&home.id!==section.id&&home.id!==section.wikiOwnerId)continue;
  const text=paragraph.text;
  if(!body.includes(text)){
   const topic=home?.subtopics.find(subtopic=>subtopic.subjectIds.some(id=>subjectIds.has(id)));
   const placed=putUnderWikiDecisionTopic(body,topic?.title??paragraph.subtopic,text,Boolean(topic&&!feedback));
   if(placed)body=placed;
   else if(!feedback)additions.push(text);
   else continue;
  }
  if(!claims.some(claim=>claim.text===text))claims.push({text,quote:sourceUnits[0].evidence.quote,unitIds:paragraph.unitIds,evidenceIds:[...new Set(sourceUnits.map(unit=>sourceOf(unit)!.id))],
   ...(feedback?{holder:"ai",workStatus:"proposed"}:{holder:"decided",holderMark:true,userDecided:true}),verification:"supported"});
 }
 if(additions.length)body+=`\n\n### ${/\p{Script=Han}/u.test(additions.join(""))?"已确认的取舍":"Confirmed choices"}\n\n${additions.join("\n\n")}`;
 const local=ledger.userAnswers?.filter(answer=>{
  const unit=units.get(`answer:${answer.questionId}:${answer.optionId}`);
  return unit&&sourceOf(unit);
 });
 if(local?.length){
  const projection=wikiDocumentBlocks(body,claims),owner=section.wikiOwnerId??section.id;
  let topic="";
  const [placed]=placeWikiChoices([{...draft,id:owner,body,paragraphs:projection.map(block=>{
   if(block.kind==="heading")topic=block.text.replace(/^#+\s+/u,"");
   const points=block.claims.flatMap(claim=>claim.unitIds?.length&&block.text.includes(claim.text)?[{text:claim.text,unitIds:claim.unitIds}]:[]);
   return {text:block.text,subtopic:topic,claims:points,unitIds:[...new Set(points.flatMap(point=>point.unitIds))]};
  })}],{...ledger,userAnswers:local});
  if(placed.body!==body){
   for(let index=claims.length-1;index>=0;index--){
    const forms=[claims[index].text,...claims[index].formulations??[]].filter(Boolean);
    if(forms.some(form=>body.includes(form))&&!forms.some(form=>placed.body.includes(form)))claims.splice(index,1);
   }
   body=placed.body;
   for(const paragraph of placed.paragraphs)for(const point of paragraph.claims??[]){
    const unit=point.unitIds.length===1?units.get(point.unitIds[0]):undefined,ref=unit&&sourceOf(unit);
    if(unit&&ref&&point.text===unit.statement&&wikiLocalAnswer(ledger,unit.id)&&body.includes(point.text)&&!claims.some(claim=>claim.text===point.text&&claim.holder==="decided"))
     claims.push({text:point.text,unitIds:[unit.id],quote:unit.evidence.quote,evidenceIds:[ref.id],holder:"decided",holderMark:true,userDecided:true,verification:"supported"});
   }
  }
 }
 body=compactWikiDecisionHeadings(body);
 const patched=body===section.body&&claims.length===(section.claims?.length??0)?section:{...section,body,claims:claims.filter(claim=>claim.text)};
 return polishSavedWikiParagraphs(patched,ledger,sourceOf,units,storedClaims);
}

export function polishSavedWikiParagraphs(section:FocusSection,ledger:WikiKnowledgeLedger,sourceOf:(unit:WikiKnowledgeUnit)=>FocusEvidence|undefined,
 units=new Map(wikiLedgerUnits(ledger).map(unit=>[unit.id,unit])),
 storedClaims=ledger.draft?.chapters.find(chapter=>chapter.id===section.id)?.paragraphs.flatMap(paragraph=>paragraph.claims??[])??[]){
 if(section.userEdited||section.origin||ledger.documentType==="learning")return section;
 let body=section.body;
 const claims=[...section.claims??[]],eligible=new Map([...units].filter(([,unit])=>sourceOf(unit)));
 if(!eligible.size)return section;
 let title="";
 const projection=wikiDocumentBlocks(body,claims),checked=claims.filter(claim=>claim.checked);
 const article:WikiDraftChapter={id:section.id,title:section.title,group:"",question:"",problems:[],body,paragraphs:projection.flatMap(block=>{
  if(block.kind==="heading"){title=block.text.replace(/^#+\s+/u,"");return [];}
  if(checked.some(claim=>block.text.includes(claim.text)))return [];
  const points=claims.flatMap(claim=>claim.checked||!claim.unitIds?.length||!claim.unitIds.every(id=>eligible.has(id))?[]
   :[claim.text,...claim.formulations??[]].filter(form=>form&&block.text.includes(form)).map(text=>({text,unitIds:claim.unitIds!})));
  const saved = storedClaims.filter(claim=>claim.unitIds.length&&claim.unitIds.every(id=>eligible.has(id))
   &&block.text.includes(claim.text)&&!points.some(point=>point.text===claim.text));
  points.push(...saved.map(claim=>({...claim,unitIds:[...claim.unitIds]})));
  return [{text:block.text,subtopic:title,claims:points,unitIds:[...new Set(points.flatMap(point=>point.unitIds))]}];
 })};
 trimWikiEditorialRepeats([article],ledger,eligible,checked.map(claim=>claim.text));
 if(article.body===body)return section;
 const supported=article.paragraphs.flatMap(paragraph=>paragraph.claims??[]);
 for(let index=claims.length-1;index>=0;index--){
  const claim=claims[index],forms=[claim.text,...claim.formulations??[]].filter(Boolean);
  if(claim.checked||!forms.some(form=>body.includes(form))||forms.some(form=>article.body.includes(form)))continue;
  const split=supported.filter(point=>forms.some(form=>form.includes(point.text))&&point.unitIds.every(id=>claim.unitIds?.includes(id)));
  claims.splice(index,1,...split.map(point=>({...claim,text:point.text,unitIds:point.unitIds,formulations:undefined,sourceReading:undefined,
   evidenceIds:[...new Set(point.unitIds.flatMap(id=>{const unit=eligible.get(id), ref=unit&&sourceOf(unit);return ref?[ref.id]:[];}))]})));
 }
 for(const point of supported){
  if(body.includes(point.text)||!article.body.includes(point.text)||claims.some(claim=>claim.text===point.text))continue;
  const unit=eligible.get(point.unitIds[0]),ref=unit&&sourceOf(unit);
  if(!unit||!ref||!wikiLocalAnswer(ledger,unit.id)||ledger.decisions?.[unit.id]?.verdict!=="confirmed"||point.text!==unit.statement)continue;
  claims.push({text:point.text,quote:unit.evidence.quote,unitIds:[unit.id],evidenceIds:[ref.id],holder:"decided",holderMark:true,userDecided:true,verification:"supported"});
 }
 body=article.body;
 body=compactWikiDecisionHeadings(body);
 return body===section.body&&claims.length===(section.claims?.length??0)?section:{...section,body,claims:claims.filter(claim=>claim.text)};
}
