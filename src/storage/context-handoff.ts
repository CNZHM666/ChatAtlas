import type {FocusScope} from "../shared/focus-session";
import type {Conversation,ConversationMessage} from "../shared/types";
import {sourceMessageSignature} from "../shared/source-signature";
import {getDatabase} from "./db";

export interface ContextHandoff {id:string;createdAt:number;task:string;scope:FocusScope;roles:Record<string,string>;fingerprints:Record<string,string>}
const key=(id:string)=>`atlas-context-handoff:${id}`;
export function makeContextHandoff(task:string,groups:Array<{conversation:Conversation;messages:ConversationMessage[]}>):ContextHandoff{
 const rows=new Map<string,{conversation:Conversation;messages:Map<string,ConversationMessage>}>();
 for(const group of groups){let row=rows.get(group.conversation.id);if(!row){row={conversation:group.conversation,messages:new Map()};rows.set(group.conversation.id,row);}for(const message of group.messages)if(message.conversationId===group.conversation.id)row.messages.set(message.id,message);}
 return {id:crypto.randomUUID(),createdAt:Date.now(),task:task.trim(),roles:Object.fromEntries([...rows.values()].flatMap(row=>[...row.messages.values()].map(message=>[message.id,message.role]))),fingerprints:Object.fromEntries([...rows.values()].flatMap(row=>[...row.messages.values()].map(message=>[message.id,sourceMessageSignature(JSON.stringify([message.content,message.role,message.messageIndex,message.replyToMessageId,message.uiParts]))]))),scope:{kind:"goal",sourceConversationIds:[...rows.keys()],blocks:[...rows.values()].map(row=>({conversationId:row.conversation.id,title:row.conversation.title,messageIds:[...row.messages.keys()],messageSignatures:Object.fromEntries([...row.messages.values()].map(message=>[message.id,sourceMessageSignature(message.content)]))}))}};
}
export async function saveContextHandoff(value:ContextHandoff){if(!chrome.storage?.session)throw Error("Workbench handoff is unavailable.");await chrome.storage.session.set({[key(value.id)]:value});}
export async function readContextHandoff(id:string):Promise<ContextHandoff|undefined>{
 if(!/^[\w-]{1,100}$/u.test(id)||!chrome.storage?.session)return;
 const value=(await chrome.storage.session.get(key(id)))[key(id)] as ContextHandoff|undefined;
 if(!value||value.id!==id||!Number.isFinite(value.createdAt)||Date.now()-value.createdAt>86400000||typeof value.task!=="string"||value.task.length>500||value.scope?.kind!=="goal"||!Array.isArray(value.scope.blocks)||!value.scope.blocks.length||!value.roles||!value.fingerprints)return;
 if(value.scope.blocks.some(block=>typeof block.conversationId!=="string"||!Array.isArray(block.messageIds)||!block.messageIds.length||block.messageIds.some(messageId=>typeof messageId!=="string"||typeof block.messageSignatures?.[messageId]!=="string"||typeof value.fingerprints[messageId]!=="string"||!["user","assistant"].includes(value.roles[messageId]))))return;
 if(JSON.stringify([...new Set(value.scope.blocks.map(block=>block.conversationId))].sort())!==JSON.stringify([...(value.scope.sourceConversationIds??[])].sort()))return;
 return value;
}
export async function removeContextHandoff(id:string){await chrome.storage.session.remove(key(id));}
export async function validateContextHandoff(value:ContextHandoff){
 const db=await getDatabase(),conversations:Conversation[]=[];
 for(const block of value.scope.blocks??[]){const source=await db.get("conversations",block.conversationId);if(!source)throw Error("SOURCE_CHANGED");conversations.push(source);
  for(const id of block.messageIds){const message=await db.get("messages",id);if(!message||message.conversationId!==block.conversationId||message.role!==value.roles[id]||sourceMessageSignature(message.content)!==block.messageSignatures[id]||sourceMessageSignature(JSON.stringify([message.content,message.role,message.messageIndex,message.replyToMessageId,message.uiParts]))!==value.fingerprints[id])throw Error("SOURCE_CHANGED");}
 }
 return conversations;
}
