import type {ProjectState,ProjectHistoryEvent} from "./project-state";
import {historyReplacementTargets,historyStateKey,productReleaseKey} from "./project-history-links";
import {compareHistoryPositions} from "./history-order";
import {wikiQuoteRange} from "./wiki-claims";
import {statementEvidence} from "./statement-evidence";
import {resolveHistoryRelations,retiredByRelations,historyProofPosition,historyConfirmation,confirmedHistoryEvent} from "./project-claim-relations";
import type {ProjectHistoryRelation} from "./project-state";
import {sameChangeSubject} from "./project-subjects";

export interface WikiFactSource {id:string;text:string;role?:string;conversationId:string;messageId:string;messageIndex?:number;discussedAt?:number}
export interface WikiRetiredProof {quote:string;evidenceIds:string[];reason:"superseded"|"replaced"|"rejected"}
type Proof={quote:string;evidenceIds:string[]};
const grounded=(proof:Proof,sources:WikiFactSource[])=>sources.some(source=>proof.evidenceIds.includes(source.id)&&Boolean(wikiQuoteRange(source.text,proof.quote)));
const position=historyProofPosition;

/** A writing projection, never a mutation of the ledger or a code audit.
 * No replacement is inferred from recency, repeated titles or a model's ID. */
export function currentWikiFacts(states:Array<ProjectState|undefined>,sources:WikiFactSource[]) {
 // Relations are resolved once across every batch, by stable claim ID; the
 // literal before/after match below remains for older single-batch records.
 const resolution=resolveHistoryRelations(states,sources);states=resolution.states;
 const byRelation=retiredByRelations(resolution.relations);
 const events=states.flatMap(state=>state?.history??[]),replaced=new Set<ProjectHistoryEvent>(),rejected=new Set<ProjectHistoryEvent>();
 for(const event of events){const reason=event.claimId?byRelation.get(event.claimId):undefined;if(reason==="rejected")rejected.add(event);else if(reason==="replaced")replaced.add(event);}
 const byState=new Map<string,ProjectHistoryEvent[]>();for(const event of events){const key=historyStateKey(event.after);byState.set(key,[...byState.get(key)??[],event]);}
 const confirmation=historyConfirmation,confirmed=(event:ProjectHistoryEvent)=>confirmedHistoryEvent(event,sources);
 for(const later of events.filter(confirmed)){
  if(!["change","retire"].includes(later.changeKind??""))continue;
  const candidates=(byState.get(historyStateKey(later.before))??[]).filter(old=>later.subjectId&&old.subjectId?later.subjectId===old.subjectId:sameChangeSubject(later,old));
  for(const old of historyReplacementTargets(later,candidates)){
   if(old.version&&later.version&&productReleaseKey(old.version)!==productReleaseKey(later.version))continue;
   if(confirmed(old)){
    if((compareHistoryPositions(position(confirmation(later),sources),position(confirmation(old),sources))??0)>0)replaced.add(old);
    continue;
   }
   // An explicitly withdrawn assistant proposal was never an adopted design.
   // Require literal prior proof, the same known scope, a named withdrawal
   // (or actual adjacent reply), and original order. A model's status alone
   // cannot remove an alternative from current writing material.
   if(old.status!=="proposal"&&old.decisionStatus!=="proposed")continue;
   if(productReleaseKey(old.version)!==productReleaseKey(later.version))continue;
   const prior=sources.find(source=>source.role==="assistant"&&old.evidenceIds.includes(source.id)&&later.beforeEvidenceIds.includes(source.id)&&wikiQuoteRange(source.text,old.quote)&&later.beforeQuote&&wikiQuoteRange(old.quote,later.beforeQuote));
   const proof=confirmation(later),decision=proof.quote;
   if(!prior||!/(?:不再|取消|移除|删除|去掉|撤销|废弃|改为|改用|\b(?:replace|remove|retire|drop)\b|switch to)/iu.test(decision))continue;
   const before=position(old,sources,false),after=position(proof,sources);
   const namesSubject=[later.area,later.before].some(name=>Boolean(name?.trim()&&historyStateKey(decision).includes(historyStateKey(name))));
   const adjacent=before&&after&&before.conversationId===after.conversationId&&after.messageIndex===before.messageIndex+1;
   if((namesSubject||adjacent)&&(compareHistoryPositions(after,before)??0)>0)rejected.add(old);
  }
 }
 const retired:WikiRetiredProof[]=[];
 const retire=(proof:Proof,reason:WikiRetiredProof["reason"])=>{if(grounded(proof,sources)&&!retired.some(item=>item.quote===proof.quote&&JSON.stringify(item.evidenceIds)===JSON.stringify(proof.evidenceIds)))retired.push({quote:proof.quote,evidenceIds:[...proof.evidenceIds],reason});};
 for(const state of states)if(state){
  for(const item of [...state.modules,...state.decisions,...state.constraints,...state.questions??[]])if(item.status==="superseded"){
   const source=sources.find(source=>source.role==="user"&&item.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,item.quote));
   if(source&&statementEvidence(source.text,item.quote).decision)retire(item,"superseded");
  }
 }
 for(const event of replaced)retire(event,"replaced");
 for(const event of rejected)if(!replaced.has(event))retire(event,"rejected");
 const isRetired=(item:Proof)=>retired.some(proof=>proof.quote===item.quote&&proof.evidenceIds.some(id=>item.evidenceIds.includes(id)));
 const uncertain=<T extends {status:string}>(item:T):T=>item.status==="superseded"?{...item,status:"uncertain"}:item;
 const projected=states.map(state=>{
  if(!state)return state;
  const modules=state.modules.filter(item=>!isRetired(item)).map(uncertain),ids=new Set(modules.map(item=>item.id));
  const histories=(state.history??[]).filter(item=>!replaced.has(item)&&!rejected.has(item)).map(item=>item.decisionStatus==="confirmed"&&!confirmed(item)?{...item,decisionStatus:"unknown" as const}:item);
  for(const item of [...state.modules,...state.decisions,...state.constraints])if(isRetired(item))retire(item,"replaced");
  return {...state,modules,relations:state.relations.filter(item=>!isRetired(item)&&ids.has(item.from)&&ids.has(item.to)),decisions:state.decisions.filter(item=>!isRetired(item)).map(uncertain),constraints:state.constraints.filter(item=>!isRetired(item)).map(uncertain),questions:state.questions?.filter(item=>!isRetired(item)).map(uncertain),history:histories};
 });
 // Retired events stay available as history for writing, never as current facts.
 const changes=resolution.relations.filter(relation=>relation.resolution==="supported");
 const unresolved:ProjectHistoryRelation[]=resolution.relations.filter(relation=>relation.resolution==="unresolved");
 return {states:projected,retired,changes,unresolved,history:[...replaced,...rejected]};
}

/** A claimed current fact cannot use only known retired original proof. Both
 * IDs and literal quote must match, so unrelated facts in that message survive. */
export function retiredWikiClaim(claim:Proof,retired:WikiRetiredProof[]) {
 return claim.evidenceIds.length>0&&claim.evidenceIds.every(id=>retired.some(proof=>proof.evidenceIds.includes(id)&&Boolean(wikiQuoteRange(proof.quote,claim.quote))));
}
