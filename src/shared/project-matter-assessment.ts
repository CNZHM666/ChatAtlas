import {statementEvidence,referenceEvidence} from "./statement-evidence";
import {wikiQuoteRange} from "./wiki-claims";
import {compareHistoryPositions,historyProofPosition} from "./history-order";
import type {FocusSession} from "./focus-session";
import {projectStateSignature,type ProjectRecord} from "./project-state";
import {knowledgeOverlap,knowledgeScopesAgree} from "./knowledge-subject";

export interface MatterAssessment {
 state:"open"|"context"|"settled"|"withdrawn";
 subject:string;
 scope?:string;
 /** Original answer/choice, never a generated summary used as proof. */
 settlement?:{text:string;quote:string;evidenceIds:string[]};
}
type Source={id:string;text:string;role?:string;conversationId?:string;messageId?:string;messageIndex?:number;discussedAt?:number};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==="object"&&!Array.isArray(value);
export const pendingMatterCue=(text:string)=>/[?？]|是否|能否|要不要|还是|尚未(?:决定|确定|确认|验证|解决)|还没(?:决定|确定|验证|解决)|待(?:决定|确认|验证|解决)|仍需(?:决定|确认|验证|解决)|需要(?:决定|确认|验证|核对|测试)|\b(?:undecided|unresolved|pending|whether|need to (?:decide|verify))\b/iu.test(text);

/** A saved resolution cannot silently renew its source validity. */
export function currentMatterSettlement(session:FocusSession,record?:ProjectRecord){
 if(!record||record.status==="uncertain"||(record.sourceBasisSignature??session.projectState?.partSignatures?.decisions??session.projectState?.signature)!==projectStateSignature(session))return;
 if(!record.matter?.settlement)return;
 const sources=session.evidence.map(ref=>({id:ref.id,text:ref.excerpt,role:session.sourceRoles?.[ref.conversationId]?.[ref.messageId]??session.projectState?.sources?.find(source=>source.id===ref.id)?.role,conversationId:ref.conversationId,messageId:ref.messageId}));
 const assessed=validateMatterAssessment(record.matter,record,sources,session);
 return assessed?.state==="settled"||assessed?.state==="withdrawn"?assessed.settlement:undefined;
}

/** Metadata cannot manufacture an unresolved choice or close it from silence,
 * an assistant recommendation, a quoted prompt or unknown chronology. */
export function validateMatterAssessment(value:unknown,proof:{quote:string;evidenceIds:string[]},sources:Source[],session:FocusSession):MatterAssessment|undefined {
 if(!object(value)||typeof value.subject!=="string"||!value.subject.trim()||value.subject.length>100||!["open","context","settled","withdrawn"].includes(String(value.state)))return;
 const subject=value.subject.trim(),scope=typeof value.scope==="string"&&value.scope.trim()&&value.scope.length<=100?value.scope.trim():undefined;
 const anchors=sources.filter(source=>proof.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,proof.quote));
 const pending=anchors.some(source=>pendingMatterCue(proof.quote)&&!referenceEvidence(source.text,proof.quote));
 const base={subject,...(scope?{scope}:{})};
 if(value.state==="context")return {...base,state:"context"};
 if(value.state==="open")return {...base,state:pending?"open":"context"};
 const settlement=value.settlement;
 if(object(settlement)&&typeof settlement.text==="string"&&settlement.text.trim()&&settlement.text.length<=500&&typeof settlement.quote==="string"&&settlement.quote.trim()&&settlement.quote.length<=350&&Array.isArray(settlement.evidenceIds)&&settlement.evidenceIds.length){
  const ids=settlement.evidenceIds.filter((id):id is string=>typeof id==="string"&&session.evidence.some(ref=>ref.id===id&&session.sourceConversationIds.includes(ref.conversationId)&&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===ref.conversationId&&block.messageIds.includes(ref.messageId)))));
  const quote=settlement.quote;
  const supported=sources.filter(source=>ids.includes(source.id)&&source.role==="user"&&wikiQuoteRange(source.text,quote)&&!referenceEvidence(source.text,quote));
  const selected=supported.filter(source=>{
   const status=statementEvidence(source.text,quote);
   const decision=status.decision&&(!status.plan||status.explicitDecision);
   return value.state==="withdrawn"?decision&&/取消|暂不做|不再|搁置|撤回|无需|不需要|\b(?:cancel|drop|withdraw|defer)\b/iu.test(quote):decision||status.report&&!status.plan;
  });
  const accepted=selected.filter(source=>{
   if(!knowledgeScopesAgree(proof.quote,quote,scope??""))return false;
   const artifact=/页面|界面|按钮|文档|示例|设计图|\b(?:mock|documentation|button|page|sample)\b/iu;
   const status=statementEvidence(source.text,quote);
   if(status.report&&!status.explicitDecision&&artifact.test(quote)&&!artifact.test(proof.quote))return false;
   if(proof.evidenceIds.includes(source.id)&&proof.quote===quote)return true;
   const after=historyProofPosition(session,[source],{quote,evidenceIds:[source.id]});
   return anchors.some(before=>{
    const prior=historyProofPosition(session,[before],proof);
    if((compareHistoryPositions(after,prior)??-1)<=0)return false;
    const overlap=knowledgeOverlap(proof.quote,quote);
    if(overlap.length>=2)return true;
    // An unambiguous adjacent short choice can answer its immediately preceding
    // question. A generic completion report cannot use this exception.
    return after?.conversationId===prior?.conversationId&&after!.messageIndex-prior!.messageIndex<=2&&/^(?:我(?:决定)?(?:选|用|采用)(?:第[一二三123]个|前者|后者)|(?:就|那)?按(?:第[一二三123]个|前者|后者)|我决定(?:暂不做|先不做|取消))[。！.!]?$/u.test(quote.trim());
   });
  });
  if(accepted.length)return {...base,state:value.state as "settled"|"withdrawn",settlement:{text:settlement.text.trim(),quote:quote.trim(),evidenceIds:[...new Set(accepted.map(source=>source.id))]}};
 }
 return {...base,state:pending?"open":"context"};
}
