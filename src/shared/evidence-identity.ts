import type { FocusEvidence, FocusSection, FocusSession } from "./focus-session";
import type {ConversationMessage} from "./types";
import {messageTurns} from "./message-turns";

/** Resolve metadata aliases only when the retained snapshot is unambiguous. */
export function evidenceVersion(session:FocusSession,ref:FocusEvidence,refs=session.evidence):string|undefined {
  if(ref.sourceVersionId)return ref.sourceVersionId;
  const peers=refs.filter(item=>item.conversationId===ref.conversationId&&item.messageId===ref.messageId);
  const versions=[...new Set(peers.filter(item=>!ref.sourceSignature||item.sourceSignature===ref.sourceSignature).flatMap(item=>item.sourceVersionId?[item.sourceVersionId]:[]))];
  if(versions.length===1)return versions[0];
  if(versions.length>1)return;
  const saved=session.sourceVersionIds?.[ref.conversationId];
  // An unknown signature must never be silently attached to a different saved version.
  return !ref.sourceSignature||session.sourceSignatures?.[ref.conversationId]?.[ref.messageId]===ref.sourceSignature?saved:undefined;
}
export function evidenceSnapshotKey(session:FocusSession,ref:FocusEvidence):string {
  return JSON.stringify([ref.conversationId,evidenceVersion(session,ref)??(ref.sourceSignature?`signature:${ref.sourceSignature}`:"unresolved")]);
}
export function ambiguousEvidenceVersion(session:FocusSession,ref:FocusEvidence):boolean {
  return !ref.sourceVersionId&&!evidenceVersion(session,ref)&&new Set(session.evidence.filter(item=>item.conversationId===ref.conversationId&&item.messageId===ref.messageId).flatMap(item=>item.sourceVersionId?[item.sourceVersionId]:[])).size>1;
}

/** Citation IDs identify excerpt relationships; reading navigation identifies original messages. */
export function evidenceMessageKey(ref: FocusEvidence,session?:FocusSession): string {
  return JSON.stringify([ref.conversationId, ref.messageId, session?evidenceSnapshotKey(session,ref):ref.sourceVersionId ?? ref.sourceSignature ?? ""]);
}

export function uniqueEvidenceMessages(refs: FocusEvidence[],session?:FocusSession): FocusEvidence[] {
  return [...new Map(refs.filter(ref => ref.conversationId && ref.messageId).map(ref => [evidenceMessageKey(ref,session), ref])).values()];
}

export interface EvidenceReadingGroup {key:string;reference:FocusEvidence;references:FocusEvidence[];turn?:ConversationMessage[]}
/** Navigation groups real question turns; all message/quote relationships remain inside each group. */
export function evidenceReadingGroups(session:FocusSession,refs:FocusEvidence[],originals:ReadonlyMap<string,ConversationMessage[]>):EvidenceReadingGroup[] {
  const groups=new Map<string,EvidenceReadingGroup>();
  const turns=new Map<string,Map<string,ConversationMessage[]>>();
  for(const ref of refs){
    const snapshot=evidenceSnapshotKey(session,ref);
    if(!turns.has(snapshot)){const map=new Map<string,ConversationMessage[]>();for(const turn of messageTurns(originals.get(snapshot)??[]))for(const message of turn){map.set(message.id,turn);if(message.platformMessageId)map.set(message.platformMessageId,turn);}turns.set(snapshot,map);}
    const turn=turns.get(snapshot)!.get(ref.messageId),key=JSON.stringify([snapshot,turn?.[0].id??ref.messageId]);
    const group=groups.get(key)??{key,reference:ref,references:[],turn};group.references.push(ref);groups.set(key,group);
  }
  return [...groups.values()];
}

export function chapterEvidence(session: FocusSession, section: FocusSection): FocusEvidence[] {
  const ids = new Set([...section.evidenceIds, ...(section.claims ?? []).flatMap(claim => claim.evidenceIds)]);
  return session.evidence.filter(ref => ids.has(ref.id));
}
