import { messageTurns } from "./message-turns";
import type { ConversationMessage } from "./types";

/** Label a citation with its real user turn; never substitute an unrelated question. */
export function sourceQuestion(messages: ConversationMessage[], messageId: string) {
  const target = messages.find(message => message.id === messageId || message.platformMessageId === messageId);
  if (!target) return undefined;
  return sourceQuestions(messages.filter(message=>message.conversationId===target.conversationId)).get(target.id);
}

/** Build once for large context packs; message indices are only ordered within their conversation. */
export function sourceQuestions(messages: ConversationMessage[]) {
  const conversations=new Map<string,ConversationMessage[]>(),questions=new Map<string,string>();
  for(const message of messages){const group=conversations.get(message.conversationId)??[];group.push(message);conversations.set(message.conversationId,group);}
  for(const group of conversations.values())for(const turn of messageTurns(group)){
    const question=turn.find(message=>message.role==="user")?.content.replace(/\s+/gu," ").trim();
    if(question)for(const message of turn)questions.set(message.id,question);
  }
  return questions;
}
