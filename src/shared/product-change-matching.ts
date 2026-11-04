import type { ProjectHistoryEvent } from "./project-state";
import { sourceMessageSignature } from "./source-signature";
import type { ProjectHistoryAnalysis } from "./project-history";
import { projectHistoryProofs } from "./project-state";
import {sameChangeSubject} from "./project-subjects";

export const changeText=(value:string|undefined)=>(value??"").normalize("NFKC").toLowerCase().replace(/[\p{P}\p{Z}\s]+/gu,"");
export const resumesChange=(event:ProjectHistoryEvent)=>/恢复|重新启用|重启|再次采用|重新采用|re[- ]?adopt|resume|restart|reintroduc/iu.test(event.quote);
export function sameChangeState(a:ProjectHistoryEvent,b:ProjectHistoryEvent) {
 return changeText(a.version)===changeText(b.version)&&a.changeKind===b.changeKind&&a.status===b.status&&(a.decisionStatus??"unknown")===(b.decisionStatus??"unknown")&&(a.workStatus??"unknown")===(b.workStatus??"unknown");
}
/** Only literal meaning matches are free. Paraphrases require a separate review. */
export function literalSameChange(a:ProjectHistoryEvent,b:ProjectHistoryEvent) {
 return sameChangeState(a,b)&&(sameChangeSubject(a,b)||!a.area&&!b.area)&&changeText(a.after)===changeText(b.after)&&changeText(a.before)===changeText(b.before)&&(!a.reason||!b.reason||changeText(a.reason)===changeText(b.reason))&&(!resumesChange(a)||a.quote===b.quote);
}
/** An intervening changed choice/retirement makes a later repeated choice a new stage. */
export function changeBarrier(events:ProjectHistoryEvent[],target:ProjectHistoryEvent,next:ProjectHistoryEvent) {
 const index=events.findIndex(event=>event.id===target.id);
 return events.slice(index+1).some(event=>(sameChangeSubject(event,next)||!event.area&&!next.area)&&(!sameChangeState(event,next)||changeText(event.after)!==changeText(next.after)));
}
export function evolutionUpdateId(analysis:{signature:string;sourceSignature:string;events:ProjectHistoryEvent[];pendingBatches?:number;matches?:unknown}) {
 return `changes:${sourceMessageSignature(JSON.stringify([analysis.signature,analysis.sourceSignature,analysis.events,analysis.matches??[],analysis.pendingBatches??0]))}`;
}
/** An operation survives model IDs, batch regrouping and changes to pending counts. */
export function evolutionOperationId(event:ProjectHistoryEvent,analysis:ProjectHistoryAnalysis){
 const proofs=projectHistoryProofs(event).filter(proof=>proof.quote).flatMap(proof=>proof.evidenceIds.map(id=>{const ref=analysis.evidence.find(ref=>ref.id===id),source=analysis.sources.find(source=>source.id===id);return JSON.stringify([ref?.conversationId??source?.conversationId,ref?.messageId??source?.messageId,ref?.sourceSignature??source?.signature,source?.role,source?.messageIndex,source?.discussedAt,proof.quote]);}));
 return `operation:${sourceMessageSignature(JSON.stringify([...(event.recordKind?[event.recordKind]:[]),changeText(event.area),changeText(event.before),changeText(event.after),changeText(event.reason),event.changeKind,event.status,event.decisionStatus??"unknown",event.workStatus??"unknown",changeText(event.version),[...new Set(proofs)].sort(),...(event.areaAliases?.length?[[...event.areaAliases].sort()]:[])]))}`;
}
