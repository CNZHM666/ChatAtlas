import type { ConversationMessage } from "./types";

/** Boundaries are real user messages, never adjacency of citations or invented replies. */
export function messageTurns(messages: ConversationMessage[]) {
  const groups: ConversationMessage[][]=[];
  const ordered=messages.every(message=>Number.isFinite(message.messageIndex))?[...messages].sort((a,b)=>a.messageIndex-b.messageIndex):messages;
  for(const message of ordered){const previous=groups.at(-1);if(message.role==="user"||!previous||previous[0].conversationId!==message.conversationId)groups.push([message]);else previous.push(message);}
  return groups;
}
export function messageTurn(messages:ConversationMessage[],target:ConversationMessage) {
  return messageTurns(messages.filter(message=>message.conversationId===target.conversationId)).find(turn=>turn.some(message=>message.id===target.id))??[];
}
