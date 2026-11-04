import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ProjectEvolutionEdit, ProjectHistoryEvent } from "./project-state";
import type { ProjectHistoryAnalysis } from "./project-history";
import { historyTime, orderHistoryMessages, compareHistoryPositions } from "./history-order";
import { projectHistoryProofs } from "./project-state";
import { changeBarrier, evolutionUpdateId, evolutionOperationId, literalSameChange, sameChangeState, resumesChange } from "./product-change-matching";
import { sourceMessageSignature } from "./source-signature";
import {changeSubjectNames,reviewedSubjectAliases} from "./project-subjects";

export const evolutionAnalysis=(session:FocusSession)=>session.projectEvolutionAnalysis??(session.projectHistoryAnalysis?.kind!=="releases"?session.projectHistoryAnalysis:undefined);
export const evolutionWorkLabels={unknown:["讨论记录","Discussed"],planned:["构思 / 规划","Planned"],in_progress:["用户报告推进","User reports progress"],reported_complete:["用户报告完成","User reports completion"],released:["明确发布记录","Explicit release record"]} as const;
export function evolutionEdit(event:ProjectHistoryEvent):ProjectEvolutionEdit {
  return {title:event.title,version:event.version,before:event.before,after:event.after,reason:event.reason,decisionStatus:event.decisionStatus??"unknown",workStatus:event.workStatus??"unknown"};
}
export interface EvolutionRecord {id:string;event:ProjectHistoryEvent;original?:ProjectHistoryEvent;personal:boolean;hidden:boolean;sources:FocusEvidence[];sourceStale:boolean;sectionIds:string[];orderUncertain:boolean}
/** Read-only timeline. Personal changes never inherit original proof or implementation claims. */
export function evolutionRecords(session:FocusSession,includeHidden=false):EvolutionRecord[] {
  const analysis=evolutionAnalysis(session),refs=analysis?.evidence??[],raw=analysis?.events??[];
  const records:EvolutionRecord[]=raw.map(original=>{
    const maintenance=session.projectMaintenance?.evolutionEvents?.[original.id],edit=maintenance?.edited;
    const personal=Boolean(edit),event={...original,...(original.status!=="documented"||!original.workQuote?.trim()||!original.workEvidenceIds?.length?{workStatus:"unknown" as const}:{}),...edit,...(personal?{quote:"",evidenceIds:[],beforeQuote:"",beforeEvidenceIds:[],reasonQuote:"",reasonEvidenceIds:[],confirmationQuote:"",confirmationEvidenceIds:[],workQuote:"",workEvidenceIds:[],position:undefined,confirmationPosition:undefined,discussedAt:edit?.discussedAt}:{} )};
    const proofs=projectHistoryProofs(original);
    const sources=personal?[]:refs.filter(ref=>proofs.some(proof=>proof.evidenceIds.includes(ref.id))).map(ref=>({...ref,excerpt:proofs.find(proof=>proof.quote&&proof.evidenceIds.includes(ref.id))?.quote||ref.excerpt}));
    const sourceStale=!personal&&(!sources.length||sources.some(ref=>{const snapshot=analysis?.sources.find(source=>source.id===ref.id),current=session.sourceSignatures?.[ref.conversationId]?.[ref.messageId];const baseline=session.sourceSignatures?.[ref.conversationId];return !session.sourceConversationIds.includes(ref.conversationId)||Boolean(baseline&&(!Object.hasOwn(baseline,ref.messageId)||snapshot&&current!==snapshot.signature))||Boolean(snapshot&&session.sourceRoles?.[ref.conversationId]?.[ref.messageId]&&snapshot.role!==session.sourceRoles[ref.conversationId][ref.messageId]);}));
    return {id:original.id,event,original,personal,hidden:Boolean(maintenance?.hidden),sources,sourceStale,sectionIds:edit?.sectionIds??[],orderUncertain:!event.position&&!historyTime(event.discussedAt)};
  });
  for(const[id,maintenance]of Object.entries(session.projectMaintenance?.evolutionEvents??{}))if(maintenance.personal&&maintenance.edited&&!raw.some(event=>event.id===id)) {
    const edit=maintenance.edited;records.push({id,event:{id,...edit,status:"documented",quote:"",evidenceIds:[],beforeQuote:"",beforeEvidenceIds:[]},personal:true,hidden:Boolean(maintenance.hidden),sources:[],sourceStale:false,sectionIds:edit.sectionIds??[],orderUncertain:!historyTime(edit.discussedAt)});
  }
  const visible=records.filter(record=>includeHidden||!record.hidden);
  const ordered=orderHistoryMessages(visible.map((record,index)=>({...record,conversationId:record.event.position?.conversationId??`personal:${index}`,messageIndex:record.event.position?.messageIndex??0,offset:record.event.position?.offset,discussedAt:record.event.position?.discussedAt??record.event.discussedAt})));
  return ordered.map((record,index)=>({...record,orderUncertain:record.orderUncertain||index>0&&compareHistoryPositions(ordered[index-1].event.position,record.event.position)===undefined&&(!historyTime(ordered[index-1].event.discussedAt)||!historyTime(record.event.discussedAt))}));
}

export function evolutionRevision(session:FocusSession) {
 return sourceMessageSignature(JSON.stringify([evolutionAnalysis(session)?.events??[],session.projectMaintenance?.evolutionEvents??{}]));
}
export interface EvolutionReviewOperation {event:ProjectHistoryEvent;savedId:string;kind:"new"|"evidence"}
export function evolutionReviewOperations(session:FocusSession,draft:ProjectHistoryAnalysis) {
 const old=evolutionAnalysis(session),known=[...(old?.events??[])],set=draft.updateSetId??evolutionUpdateId(draft),receipts=new Set(old?.appliedOperations??[]);
 return draft.events.flatMap<EvolutionReviewOperation>(event=>{
  if(receipts.has(`${set}:${event.id}`)||receipts.has(evolutionOperationId(event,draft)))return [];
    const presentation=known.find(old=>old.id===event.id&&sameChangeState(old,event));
    if(draft.presentationChanges?.includes(event.id)&&presentation)return [{event,savedId:presentation.id,kind:"evidence" as const}];
  const link=draft.matches?.find(match=>match.eventId===event.id&&match.kind==="duplicate"),linked=link&&known.find(item=>item.id===link.targetId);
  const target=linked&&sameChangeState(linked,event)&&!resumesChange(event)&&!changeBarrier(known,linked,event)?linked:[...known].reverse().find(item=>literalSameChange(event,item)&&!changeBarrier(known,item,event));
  if(target){
   const proofKeys=(item:ProjectHistoryEvent,refs:FocusEvidence[],snapshots:ProjectHistoryAnalysis["sources"])=>projectHistoryProofs(item).filter(proof=>proof.quote).flatMap(proof=>proof.evidenceIds.map(id=>{const ref=refs.find(ref=>ref.id===id);return JSON.stringify([ref?.conversationId,ref?.messageId,ref?.sourceSignature??snapshots.find(source=>source.id===id)?.signature,...snapshots.filter(source=>source.id===id).flatMap(source=>[source.role,source.messageIndex,source.discussedAt]),proof.quote]);}));
   const before=new Set(proofKeys(target,old?.evidence??[],old?.sources??[])),after=proofKeys(event,draft.evidence,draft.sources);
   const names=new Set(changeSubjectNames(target));
   if((!event.recordKind||event.recordKind===target.recordKind)&&after.every(key=>before.has(key))&&changeSubjectNames(event).every(name=>names.has(name)))return [];
   return [{event,savedId:target.id,kind:"evidence" as const}];
  }
  const savedId=known.some(item=>item.id===event.id)?`${event.id}:stage:${sourceMessageSignature(JSON.stringify([event.after,event.quote,event.status,event.workStatus,event.before]))}`:event.id;
  known.push({...event,id:savedId});return [{event,savedId,kind:"new" as const}];
 });
}

/** Preserve old records and their proof snapshots; applying the same operation is idempotent. */
export function mergeEvolutionReview(session:FocusSession,draft:ProjectHistoryAnalysis,selectedIds:string[]):ProjectHistoryAnalysis {
  const old=evolutionAnalysis(session),set=draft.updateSetId??evolutionUpdateId(draft),prefix=`evolution:${draft.updateSetId??draft.generatedAt}:`,operations=evolutionReviewOperations(session,draft).filter(op=>selectedIds.includes(op.event.id));
  const evidence=[...old?.evidence??[]],sources=[...old?.sources??[]],mapping=new Map<string,string>();
  for(const ref of draft.evidence){
   const snapshot=draft.sources.find(source=>source.id===ref.id),signature=snapshot?.signature??ref.sourceSignature;
   const existing=evidence.find(item=>item.conversationId===ref.conversationId&&item.messageId===ref.messageId&&signature&&sources.some(source=>source.id===item.id&&source.signature===signature&&source.role===snapshot?.role&&source.messageIndex===snapshot?.messageIndex&&source.discussedAt===snapshot?.discussedAt));
   const id=existing?.id??prefix+ref.id;mapping.set(ref.id,id);
  }
  const ids=(values:string[]|undefined)=>(values??[]).map(id=>mapping.get(id)??prefix+id);
  const remap=(event:ProjectHistoryEvent):ProjectHistoryEvent=>({...event,evidenceIds:ids(event.evidenceIds),beforeEvidenceIds:ids(event.beforeEvidenceIds),reasonEvidenceIds:ids(event.reasonEvidenceIds),confirmationEvidenceIds:ids(event.confirmationEvidenceIds),workEvidenceIds:ids(event.workEvidenceIds),corroborations:event.corroborations?.map(proof=>({...proof,evidenceIds:ids(proof.evidenceIds)})),additions:event.additions?.map(detail=>({...detail,evidenceIds:ids(detail.evidenceIds)})),modifications:event.modifications?.map(detail=>({...detail,evidenceIds:ids(detail.evidenceIds)}))});
  const byId=new Map((old?.events??[]).map(event=>[event.id,event]));
  for(const operation of operations){
   const event=remap(operation.event),retained=byId.get(operation.savedId);
   if(operation.kind==="evidence"&&retained){
    const proofs=[...retained.corroborations??[],...projectHistoryProofs(event).filter(proof=>proof.quote)];
    const corroborations=[...new Map(proofs.map(proof=>[JSON.stringify([proof.quote,proof.evidenceIds]),{quote:proof.quote,evidenceIds:proof.evidenceIds}])).values()];
    const areaAliases=reviewedSubjectAliases(retained,event);
    const translated=draft.presentationChanges?.includes(operation.event.id)&&!session.projectMaintenance?.evolutionEvents?.[retained.id]?.edited?{title:event.title,after:event.after,before:event.before,beforeQuote:event.beforeQuote,beforeEvidenceIds:event.beforeEvidenceIds,reason:event.reason,reasonQuote:event.reasonQuote,reasonEvidenceIds:event.reasonEvidenceIds,area:event.area}:{};
    byId.set(retained.id,{...retained,...translated,...(event.recordKind?{recordKind:event.recordKind}:{}),corroborations,...(areaAliases.length?{areaAliases}:{})});
   }else byId.set(operation.savedId,{...event,id:operation.savedId});
  }
  const needed=new Set([...byId.values()].flatMap(event=>projectHistoryProofs(event).flatMap(proof=>proof.evidenceIds)));
  for(const ref of draft.evidence){const id=mapping.get(ref.id)!;if(needed.has(id)&&!evidence.some(item=>item.id===id)){evidence.push({...ref,id,sourceSignature:draft.sources.find(source=>source.id===ref.id)?.signature??ref.sourceSignature});const snapshot=draft.sources.find(source=>source.id===ref.id);if(snapshot)sources.push({...snapshot,id});}}
  return {...draft,kind:"evolution",version:6,events:[...byId.values()],evidence,sources,matches:undefined,checkpointEvents:undefined,baseRevision:undefined,appliedOperations:[...new Set([...(old?.appliedOperations??[]),...draft.events.flatMap(event=>[`${set}:${event.id}`,evolutionOperationId(event,draft)])])]};
}
