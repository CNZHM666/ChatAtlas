import type {FocusEvidence,FocusSession} from "./focus-session";
import type {ConversationMessage} from "./types";
import {wikiQuoteRange,type WikiClaim} from "./wiki-claims";
import {readProjectAssertion,type AssertionReading} from "./project-assertion";
import {statementEvidence,referenceEvidence} from "./statement-evidence";
import {sourceMessageSignature} from "./source-signature";
import {historyTime,type HistoryPosition} from "./history-order";

export interface WikiSourceReading {
 signature:string;status:AssertionReading["status"];reported:boolean;currentStage:boolean;
 /** Local reading of explicit change language; model fields cannot set it. */
 replacement?:boolean;
 sources:Array<{id:string;signature:string;role:string;conversationId:string;messageId:string;messageIndex:number;discussedAt:number}>;
}
const signature=(claim:WikiClaim)=>sourceMessageSignature(JSON.stringify([claim.text,claim.quote,claim.evidenceIds,claim.overviewRole,claim.workStatus,claim.subject,claim.scope,...(claim.relation?[claim.relation]:[]),...(claim.formulations?.length?[claim.formulations]:[])]));
function stageReport(content:string,quote:string){
 const range=wikiQuoteRange(content,quote);if(!range)return false;
 const before=content.slice(0,range.start),after=content.slice(range.end),stop=after.search(/[。！？!?\n]/u);
 const endsSentence=/[。！？!?]\s*$/u.test(quote);
 const sentence=content.slice(Math.max(before.lastIndexOf("。"),before.lastIndexOf("\n"),before.lastIndexOf("？"))+1,endsSentence?range.end:stop<0?content.length:range.end+stop+1);
 if(referenceEvidence(content,quote)||/[?？]|如果|假如|建议|计划|准备|尚未|还没|没有确认|未确认|可能|\b(?:if|suggest|plan|might|not yet)\b/iu.test(sentence))return false;
 return /(?:当前|目前|现在|已(?:经)?进入|正在).{0,45}(?:阶段|重点|里程碑|Milestone|Phase|\bM\d)|\b(?:currently|now|entered).{0,40}(?:phase|stage|milestone)\b/iu.test(quote);
}

/** Authorship/context receipt, not semantic verification or a repository audit. */
export function readWikiSources(claim:WikiClaim,evidence:FocusEvidence[],originals:ConversationMessage[]):WikiSourceReading {
 const proofs=claim.evidenceIds.flatMap(id=>{const ref=evidence.find(ref=>ref.id===id),message=ref&&originals.find(message=>message.id===ref.messageId&&message.conversationId===ref.conversationId);return message&&wikiQuoteRange(message.content,claim.quote)?[{id,message,quote:claim.quote}]:[];});
 // A short approval must itself be retained evidence in the selected material.
 const context=originals.filter(message=>evidence.some(ref=>ref.conversationId===message.conversationId&&ref.messageId===message.id));
 const assertion=readProjectAssertion(proofs,context),confirmation=assertion.confirmation;
 const approval=confirmation&&evidence.find(ref=>ref.conversationId===confirmation.message.conversationId&&ref.messageId===confirmation.message.id);
 const receipts=approval&&confirmation?[...proofs,{id:approval.id,message:confirmation.message,quote:confirmation.quote}]:proofs;
 return {signature:signature(claim),status:assertion.status,
  replacement:proofs.some(proof=>proof.message.role==="user"&&statementEvidence(proof.message.content,claim.quote).explicitDecision&&/改用|改为|替换|取代|不再|取消|最终(?:确认|采用|决定)|\b(?:switch to|replace|instead of|no longer|finally decided)\b/iu.test(claim.quote)),
  reported:proofs.some(proof=>proof.message.role==="user"&&statementEvidence(proof.message.content,claim.quote).report),
  currentStage:proofs.some(proof=>proof.message.role==="user"&&stageReport(proof.message.content,claim.quote)),
  sources:receipts.map(({id,message})=>({id,signature:sourceMessageSignature(message.content),role:message.role,conversationId:message.conversationId,messageId:message.id,messageIndex:message.messageIndex,discussedAt:historyTime(message.sourceCreatedAt)??0}))};
}

/** Renaming evidence IDs (update namespaces, topic revisions) keeps a receipt
 * valid: every cited message, approvals included, follows the same map and the
 * signature is rebuilt for the renamed claim. A receipt citing an unmapped ID is
 * dropped so it is read again from the current sources, never trusted stale. */
export function remapWikiClaimEvidence<T extends WikiClaim>(claim:T,ids:Map<string,string>):T {
 const next={...claim,evidenceIds:claim.evidenceIds.flatMap(id=>ids.has(id)?[ids.get(id)!]:[])};
 const saved=claim.sourceReading;
 if(!saved)return next;
 const fresh=saved.signature===signature(claim)&&saved.sources.every(source=>ids.has(source.id));
 if(!fresh){const rest={...next};delete rest.sourceReading;return rest;}
 return {...next,sourceReading:{...saved,signature:signature(next),sources:saved.sources.map(source=>({...source,id:ids.get(source.id)!}))}};
}

/** Validate saved receipts against the current source basis; old 240-character
 * excerpts do not erase a report whose full original was already inspected. */
export function wikiSourceReading(session:FocusSession,claim:WikiClaim):WikiSourceReading|undefined {
 const saved=claim.sourceReading;
 if(saved?.signature===signature(claim)&&saved.sources.length&&saved.sources.every(source=>{
  const ref=session.evidence.find(ref=>ref.id===source.id),current=session.sourceSignatures?.[source.conversationId]?.[source.messageId],expected=ref?.sourceSignature??current;
  return ref&&ref.conversationId===source.conversationId&&ref.messageId===source.messageId&&expected===source.signature&&(!current||current===source.signature)&&session.sourceConversationIds.includes(source.conversationId)&&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===source.conversationId&&block.messageIds.includes(source.messageId)))&&(!session.sourceRoles?.[source.conversationId]?.[source.messageId]||session.sourceRoles[source.conversationId][source.messageId]===source.role);
 }))return saved;
 if(saved)return;
 const evidence=session.evidence.filter(ref=>claim.evidenceIds.includes(ref.id)&&session.sourceConversationIds.includes(ref.conversationId)&&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===ref.conversationId&&block.messageIds.includes(ref.messageId))));
 const originals=evidence.flatMap(ref=>{const role=session.sourceRoles?.[ref.conversationId]?.[ref.messageId];return role&&wikiQuoteRange(ref.excerpt,claim.quote)?[{id:ref.messageId,conversationId:ref.conversationId,role,content:ref.excerpt,messageIndex:session.sourceMessageOrder?.[ref.conversationId]?.indexOf(ref.messageId)??-1,createdAt:0,updatedAt:0,preview:"",contentHash:""} as ConversationMessage]:[];});
 return originals.length?readWikiSources(claim,evidence,originals):undefined;
}
export function wikiClaimPosition(session:FocusSession,claim:WikiClaim):HistoryPosition|undefined {
 const reading=wikiSourceReading(session,claim),source=reading?.sources.find(source=>source.role==="user");if(!source)return;
 const index=session.sourceMessageOrder?.[source.conversationId]?.indexOf(source.messageId);
 const messageIndex=index!==undefined&&index>=0?index:source.messageIndex;
 if(messageIndex<0)return;
 return {conversationId:source.conversationId,messageId:source.messageId,messageIndex,discussedAt:source.discussedAt};
}
