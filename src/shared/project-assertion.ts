import type {ConversationMessage} from "./types";
import {confirmsProposal,statementEvidence} from "./statement-evidence";
import {wikiQuoteRange} from "./wiki-claims";

export interface AssertionProof {message:ConversationMessage;quote:string}
export interface AssertionReading {
 status:"confirmed"|"recorded"|"proposal"|"preference"|"reported"|"planned"|"uncertain";
 confirmation?:AssertionProof;
}
/** Read-only semantics shared by knowledge projections. Models cannot supply roles or approvals.
 * Only literal, scoped originals enter here. This is not semantic entailment or a code audit. */
export function readProjectAssertion(proofs:AssertionProof[],context:ConversationMessage[]=[]):AssertionReading {
 const valid=proofs.filter(proof=>wikiQuoteRange(proof.message.content,proof.quote));
 const users=valid.filter(proof=>proof.message.role==="user");
 const intents=users.map(proof=>statementEvidence(proof.message.content,proof.quote));
 if(intents.some(intent=>intent.explicitDecision))return {status:"confirmed"};
 if(intents.some(intent=>intent.report))return {status:"reported"};
 if(intents.some(intent=>intent.preference))return {status:"preference"};
 for(const proof of valid.filter(proof=>proof.message.role==="assistant")){
  const approval=context.find(message=>message.role==="user"&&message.messageIndex>proof.message.messageIndex&&confirmsProposal(message,message.content,proof.message,proof.quote));
  if(approval)return {status:"confirmed",confirmation:{message:approval,quote:approval.content}};
 }
 if(users.some(proof=>statementEvidence(proof.message.content,proof.quote).plan))return {status:"planned"};
 if(valid.length&&valid.every(proof=>proof.message.role==="assistant")||valid.some(proof=>statementEvidence(proof.message.content,proof.quote).suggestion))return {status:"proposal"};
 return {status:valid.length?"recorded":"uncertain"};
}

/** Strong generated language needs corresponding original evidence, not a confident Wiki tone. */
export function overstatesProjectEvidence(text:string,status:AssertionReading["status"]|string):boolean {
 // An explicit lack-of-evidence statement does not assert the quoted approval.
 // Split clauses so a later affirmative assertion still gets checked.
 text=text.split(/[。！？!?；;，,\n]/u).filter(clause=>!/(?:无法|不能|不足以)(?:据此)?(?:证明|确认|认定)|(?:没有|尚无|缺乏)证据(?:表明|证明)|尚未确认|未确认是否|\b(?:no evidence (?:that|of)|cannot (?:confirm|establish)|unverified whether)\b/iu.test(clause)).join("。");
 const approval=/(?:用户|团队|我们)(?:已经|已|最终)?确认|(?:最终|正式)(?:确定|确立|采用|采纳|选定|决定|定案)|(?:已|已经)(?:确认|采纳|采用)|采用了|确定.{0,15}(?:选用|采用)|\b(?:user|team) (?:has |have )?(?:confirmed|approved)|\b(?:finally decided|officially adopted)\b/iu.test(text);
 const implementation=/(?:已(?:经)?(?:全部|正式)?(?:实现|完成|通过|发布|上线|接入)|(?:代码|测试)(?:已)?(?:验证|通过))|\b(?:implemented|completed|tests? passed|verified implementation|released|shipped)\b/iu.test(text);
 // No current source represents independently verified code, tests or deployment.
 return approval&&status!=="confirmed"||implementation&&!['reported','personal'].includes(status);
}
