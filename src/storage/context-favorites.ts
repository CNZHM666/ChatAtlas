import { getDatabase } from "./db";
import type {Conversation,ConversationMessage} from "../shared/types";
import {sourceMessageSignature} from "../shared/source-signature";
import type {ContextBundle} from "../context/types";

export interface ContextMessageSnapshot {
  conversationId:string;messageId:string;title:string;platform:string;url:string;
  content:string;role:"user"|"assistant";messageIndex:number;createdAt:number;signature:string;
  uiParts?:ConversationMessage["uiParts"];
}

export interface ContextFavorite {
  id: string;
  kind: "message" | "context";
  contentKind?:"original_selection"|"project_knowledge"|"edited"|"saved_text";
  title: string;
  createdAt: number;
  updatedAt: number;
  conversationId?: string;
  messageId?: string;
  contentHash?: string;
  text?: string;
  projectId?: string;
  projectUpdatedAt?: number;
  collectionVersion?:1;
  note?:string;
  messages?:ContextMessageSnapshot[];
  bundle?:ContextBundle;
  projectSignature?:string;
}

/** Explicit user selection only. Snapshots are durable even when an original disappears. */
export function contextCollection(groups:Array<{conversation:Conversation;messages:ConversationMessage[]}>,options:{id?:string;title?:string;note?:string;text?:string;projectId?:string}={}):ContextFavorite {
 const messages=[...new Map(groups.flatMap(({conversation,messages})=>messages.filter(message=>message.conversationId===conversation.id).map(message=>[JSON.stringify([conversation.id,message.id]),{conversationId:conversation.id,messageId:message.id,title:conversation.title,platform:conversation.platform,url:conversation.url,content:message.content,...(message.uiParts?.length?{uiParts:structuredClone(message.uiParts)}:{}),role:message.role,messageIndex:message.messageIndex,createdAt:message.createdAt,signature:sourceMessageSignature(message.content)}] as const))).values()];
 const conversationIds=[...new Set(messages.map(message=>message.conversationId))];
 const now=Date.now();return {id:options.id??crypto.randomUUID(),kind:"context",collectionVersion:1,title:options.title?.trim()||groups[0]?.conversation.title||"上下文",note:options.note??"",messages,...(conversationIds.length===1?{conversationId:conversationIds[0]}:{}),...(options.text?{text:options.text}:{}),...(options.projectId?{projectId:options.projectId}:{}),createdAt:now,updatedAt:now};
}

export async function saveContextCollection(favorite:ContextFavorite) {
 const db=await getDatabase(),previous=await db.get("contextFavorites",favorite.id);
 const saved={...favorite,createdAt:previous?.createdAt??favorite.createdAt,updatedAt:Date.now()};await db.put("contextFavorites",saved);return saved;
}
export interface SidecarSearch { id: string; query: string; updatedAt: number }

export async function rememberSidecarSearch(query: string) {
  const db = await getDatabase(), value = query.trim();
  if (!value) return;
  const tx = db.transaction("sidecarSearches", "readwrite");
  await tx.store.put({ id: value.toLocaleLowerCase(), query: value, updatedAt: Date.now() });
  const all = (await tx.store.getAll()).sort((a, b) => b.updatedAt - a.updatedAt);
  for (const row of all.slice(8)) await tx.store.delete(row.id);
  await tx.done;
}
