import type {ProjectState,ProjectHistoryEvent,ProjectHistoryRelation,ProjectHistoryRelationKind} from "./project-state";
import type {WikiFactSource} from "./wiki-current-facts";
import {historyStateKey,productReleaseKey} from "./project-history-links";
import {compareHistoryPositions,type HistoryPosition} from "./history-order";
import {wikiQuoteRange} from "./wiki-claims";
import {statementEvidence,confirmsProposal} from "./statement-evidence";
import {sameChangeSubject,changeSubjectNames} from "./project-subjects";
import {knowledgeTerms} from "./knowledge-subject";
import {sourceMessageSignature} from "./source-signature";

type Proof={quote:string;evidenceIds:string[]};
const key=(value:string)=>value.normalize("NFKC").toLowerCase().replace(/\s+/gu,"");

export function historyProofPosition(proof:Proof,sources:WikiFactSource[],userOnly=true):HistoryPosition|undefined{
 const source=sources.find(source=>(!userOnly||source.role==="user")&&proof.evidenceIds.includes(source.id)&&source.messageIndex!==undefined&&wikiQuoteRange(source.text,proof.quote));
 return source?{conversationId:source.conversationId,messageId:source.messageId,messageIndex:source.messageIndex!,discussedAt:source.discussedAt,offset:wikiQuoteRange(source.text,proof.quote)!.start}:undefined;
}
export const historyConfirmation=(event:ProjectHistoryEvent):Proof=>({quote:event.confirmationQuote||event.quote,evidenceIds:event.confirmationEvidenceIds?.length?event.confirmationEvidenceIds:event.evidenceIds});

/** An original user decision, directly or as the approval of the proposal it cites. */
export function confirmedHistoryEvent(event:ProjectHistoryEvent,sources:WikiFactSource[]){
 if(event.status!=="documented"||event.decisionStatus!=="confirmed"||!historyProofPosition(historyConfirmation(event),sources))return false;
 const proof=historyConfirmation(event),approval=sources.find(source=>source.role==="user"&&proof.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,proof.quote));
 if(!approval)return false;
 // A model can label a refusal as a confirmed change. Keeping the existing
 // design confirms continuity, not the proposed replacement in event.after.
 if(event.changeKind==="change"&&/(?:先不改|暂不改|继续沿用|维持现状|keep (?:using|the current)|do not change|don't change)/iu.test(proof.quote)&&!/(?:改为|改用|不再|取消|switch to|replace)/iu.test(proof.quote))return false;
 if(statementEvidence(approval.text,proof.quote).decision)return true;
 const proposal=sources.find(source=>event.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,event.quote));
 return Boolean(proposal&&confirmsProposal({...approval,content:approval.text},proof.quote,{...proposal,content:proposal.text},event.quote));
}

/** Stable across batches, cache reuse and rewording: the cited original message
 * and its quotation, plus the subject. Final prose never takes part. */
export function historyClaimId(event:ProjectHistoryEvent,sources:WikiFactSource[]){
 const source=sources.find(source=>event.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,event.quote));
 const origin=source?[source.conversationId,source.messageId]:[...event.evidenceIds].sort();
 return `claim:${sourceMessageSignature(JSON.stringify([origin,key(event.quote),changeSubjectNames(event).map(key).sort()[0]??""]))}`;
}

// Parallel operating modes are scopes, not successive states.
function operatingMode(text:string){
 const value=text.normalize("NFKC").toLowerCase();
 if(/byok|自带(?:密钥|key)|用户.{0,12}(?:密钥|api\s*key)|user.{0,15}(?:key|credential)/u.test(value))return "user-key";
 if(/内置|平台(?:自带|提供)|平台.{0,12}(?:密钥|api\s*key)|built-?in|platform.{0,15}(?:key|credential|provided)/u.test(value))return "platform";
 return "";
}
const CHANGE=/不再|取消|移除|删除|去掉|撤销|废弃|放弃|改为|改用|改成|换成|替换|代替|取代|不用|不要|否决|拒绝|\b(?:replace[sd]?|remove[sd]?|retire[sd]?|drop(?:ped)?|switch(?:ed)? to|instead|reject(?:ed)?|no longer)\b/iu;

/** The prior state is named, not merely near: most of its own distinctive terms
 * recur in the later wording. Similarity only finds candidates; the user's
 * change language, subject, scope and original order decide support. */
function namesState(state:string,mention:string){
 const own=knowledgeTerms(state),other=knowledgeTerms(mention);
 const shared=[...own].filter(term=>other.has(term));
 return own.size>0&&shared.length>=Math.min(2,own.size)&&shared.length*2>=own.size;
}

export interface HistoryRelationResolution {states:Array<ProjectState|undefined>;relations:ProjectHistoryRelation[]}

/** Cross-batch relation pass over all saved readings. Each later change with a
 * named prior state (wire pointer, before, or explicit target) is matched to
 * stable claim IDs. Recency, titles and overlap alone never prove replacement;
 * assistant revisions and unknown order stay unresolved with their reason. */
export function resolveHistoryRelations(states:Array<ProjectState|undefined>,sources:WikiFactSource[]):HistoryRelationResolution{
 const rows=states.flatMap((state,stateIndex)=>(state?.history??[]).map(event=>({event,stateIndex,claimId:event.claimId??historyClaimId(event,sources)})));
 const relations:ProjectHistoryRelation[]=[],byClaim=new Map<string,ProjectHistoryRelation[]>();
 const anyPosition=(event:ProjectHistoryEvent)=>historyProofPosition(event,sources,false);
 for(const later of rows){
  const event=later.event,pending=event.pendingRelation;
  const mention=pending?.hint||event.before;
  if(!pending&&!(["change","retire"].includes(event.changeKind??"")&&event.before.trim()))continue;
  const decision=historyConfirmation(event),user=confirmedHistoryEvent(event,sources);
  const at=historyProofPosition(decision,sources)??anyPosition(event);
  const targeted=pending?.targetId?rows.filter(row=>row.stateIndex===later.stateIndex&&row.event.id===pending.targetId&&row!==later):[];
  let unknownOrder=false;
  const eligible=rows.filter(row=>{
   const old=row.event;
   if(row===later||row.claimId===later.claimId)return false;
   if(!targeted.includes(row)&&!(event.subjectId&&old.subjectId?event.subjectId===old.subjectId:sameChangeSubject(event,old)))return false;
   if(old.version&&event.version&&productReleaseKey(old.version)!==productReleaseKey(event.version))return false;
   // A suggestion scoped to a version is declined only within that same known version.
   if(!confirmedHistoryEvent(old,sources)&&productReleaseKey(old.version)!==productReleaseKey(event.version))return false;
   const modes=[operatingMode(`${old.area??""} ${old.after} ${old.quote}`),operatingMode(`${event.area??""} ${event.after} ${event.quote}`)];
   if(modes[0]&&modes[1]&&modes[0]!==modes[1])return false;
   const order=compareHistoryPositions(at,anyPosition(old));
   if(order===undefined){unknownOrder||=Boolean(targeted.includes(row)||mention&&namesState(old.after,mention));return false;}
   return order>0;
  });
  const exact=mention?eligible.filter(row=>historyStateKey(row.event.after)===historyStateKey(mention)):[];
  const named=exact.length?exact:eligible.filter(row=>targeted.includes(row)||Boolean(mention&&namesState(row.event.after,mention))||namesState(row.event.after,decision.quote));
  // The same prior state read in several batches is one target, not ambiguity.
  const states=new Set(named.map(row=>historyStateKey(row.event.after)));
  const base={fromClaimId:later.claimId,evidenceIds:[...event.evidenceIds],confirmationEvidenceIds:user?[...decision.evidenceIds]:[],reasonEvidenceIds:[...event.reasonEvidenceIds??[]],...(mention?{hint:mention}:{})};
  const record=(relation:Omit<ProjectHistoryRelation,"id">)=>{
   const value={...relation,id:`relation:${sourceMessageSignature(JSON.stringify([relation.fromClaimId,relation.toClaimId??"",relation.kind]))}`};
   if(relations.some(item=>item.id===value.id))return;
   relations.push(value);
   for(const claimId of [value.fromClaimId,value.toClaimId])if(claimId)byClaim.set(claimId,[...byClaim.get(claimId)??[],value]);
  };
  const requested:ProjectHistoryRelationKind=pending?.kind??"replaces";
  if(!named.length){record({...base,kind:requested,resolution:"unresolved",reason:unknownOrder?"order_unknown":"no_candidate"});continue;}
  if(states.size>1){record({...base,kind:requested,resolution:"unresolved",reason:"ambiguous"});continue;}
  for(const target of named){
   const old=target.event,adopted=confirmedHistoryEvent(old,sources);
   // A user declining a suggestion that was never adopted rejects it; it was
   // never a current design that later got replaced.
   const kind:ProjectHistoryRelationKind=requested==="replaces"&&!adopted&&(old.status==="proposal"||old.decisionStatus!=="confirmed")?"rejects":requested==="rejects"&&adopted?"replaces":requested;
   const retires=kind==="replaces"||kind==="rejects";
   const literal=Boolean(mention&&historyStateKey(old.after)===historyStateKey(mention));
   const reason:ProjectHistoryRelation["reason"]=!user?"not_user_decision":retires&&!literal&&!CHANGE.test(decision.quote)?"no_change_language":undefined;
   record({...base,toClaimId:target.claimId,kind,resolution:reason?"unresolved":"supported",...(reason?{reason}:{})});
  }
 }
 const projected=states.map((state,stateIndex)=>state&&{...state,history:(state.history??[]).map(event=>{
  const row=rows.find(row=>row.stateIndex===stateIndex&&row.event===event)!;
  const own=byClaim.get(row.claimId);
  return {...event,claimId:row.claimId,...(own?.length?{relations:own}:{})};
 })});
 return {states:projected,relations};
}

/** Claim IDs a supported relation retires from the current view, with why. */
export function retiredByRelations(relations:ProjectHistoryRelation[]){
 const retired=new Map<string,"replaced"|"rejected">();
 for(const relation of relations)if(relation.resolution==="supported"&&relation.toClaimId&&(relation.kind==="replaces"||relation.kind==="rejects"))retired.set(relation.toClaimId,relation.kind==="rejects"?"rejected":"replaced");
 return retired;
}
