import type {FocusSession} from "../shared/focus-session";
import type {ConversationMessage} from "../shared/types";
import {readProjectAssertion,overstatesProjectEvidence} from "../shared/project-assertion";
import {wikiQuoteRange} from "../shared/wiki-claims";

/** A deterministic rejection guard, not a replacement for semantic review.
 * Saving a draft and an assistant's own claim cannot establish user approval. */
export function assertQueryAttribution(session:FocusSession,originals:ConversationMessage[]):void {
 for(const section of session.sections)for(const claim of section.claims??[]){
  const proofs=claim.evidenceIds.flatMap(id=>{
   const ref=session.evidence.find(ref=>ref.id===id&&section.evidenceIds.includes(id));
   const message=ref&&originals.find(message=>message.conversationId===ref.conversationId&&[message.id,message.platformMessageId].includes(ref.messageId));
   return message&&wikiQuoteRange(message.content,claim.quote)?[{message,quote:claim.quote}]:[];
  });
  if(!proofs.length)continue; // Missing anchors retain the existing explicit review path.
  const contexts=originals.filter(message=>message.role==="user"&&proofs.some(proof=>proof.message.conversationId===message.conversationId&&(message.replyToMessageId===proof.message.id||message.messageIndex===proof.message.messageIndex+1)));
  const reading=readProjectAssertion(proofs,contexts);
  if(overstatesProjectEvidence(claim.text,reading.status))throw new Error(session.locale==="en"?"The answer overstates approval or implementation in its originals. It was not saved; retry the question.":"回答把历史建议或计划写成了已确认、已实现，未通过原文校验，尚未保存。请重试提问。");
 }
}
