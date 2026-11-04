import type { ConversationMessage } from "./types";
import type { ProjectHistoryAnalysis } from "./project-history";
import { projectHistoryProofs } from "./project-state";
import { sourceMessageSignature } from "./source-signature";
import {implementationRequest} from "./statement-evidence";

export type EvolutionSourceManifest=Record<string,{signature:string;contextSignature:string}>;
export const evolutionMessageKey=(conversationId:string,messageId:string)=>JSON.stringify([conversationId,messageId]);
/** Linear preparation replaces repeated filtering/hashing for each source window. */
export function evolutionSourcePlan(messages:ConversationMessage[], previous?:ProjectHistoryAnalysis) {
  const manifest:EvolutionSourceManifest={},turns=new Map<string,ConversationMessage[]>();
  for(const message of messages){const list=turns.get(message.conversationId)??[];list.push(message);turns.set(message.conversationId,list);}
  const signatures=new Map(messages.map(message=>[evolutionMessageKey(message.conversationId,message.id),sourceMessageSignature(message.content)]));
  for(const conversation of turns.values())for(const [index,message] of conversation.entries()){
    const key=evolutionMessageKey(message.conversationId,message.id);
    manifest[key]={signature:signatures.get(key)!,contextSignature:sourceMessageSignature(JSON.stringify(conversation.slice(Math.max(0,index-2),index+3).map(turn=>[turn.id,turn.role,turn.messageIndex,turn.createdAt,signatures.get(evolutionMessageKey(turn.conversationId,turn.id))])))};
  }
  const old=previous?.sourceManifest??{};
  const added=Object.keys(manifest).filter(key=>!old[key]);
  const changed=Object.keys(manifest).filter(key=>old[key]&&(old[key].signature!==manifest[key].signature||old[key].contextSignature!==manifest[key].contextSignature));
  const removed=Object.keys(old).filter(key=>!manifest[key]),affected=new Set([...changed,...removed]);
  const sourceKeys=new Map((previous?.sources??[]).map(source=>[source.id,evolutionMessageKey(source.conversationId,source.messageId)]));
  const affectedEventIds=(previous?.events??[]).filter(event=>projectHistoryProofs(event).some(proof=>proof.evidenceIds.some(id=>affected.has(sourceKeys.get(id)??"")))).map(event=>event.id);
  return {manifest,added,changed,removed,affectedEventIds,context:(conversationId:string,messageId:string)=>manifest[evolutionMessageKey(conversationId,messageId)]?.contextSignature??""};
}

/** Recall signal only, never confirmation. Keep antecedents and following corrections. */
export function shortDecisionReply(message:ConversationMessage){return message.role==="user"&&message.content.trim().length<=240&&(/^(?:可以|好(?:的)?|同意|就(?:这样|这么|这个|按)|按这个|先不|暂不|不改|不做|还是|维持|继续沿用|yes\b|ok(?:ay)?\b|agreed\b|keep\b|not now\b)/iu.test(message.content.trim())||implementationRequest(message.content));}
