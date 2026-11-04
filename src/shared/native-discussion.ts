import type { ConversationMessage } from "./types";
import { webConversation } from "./web-capture";
export function isCurrentNativeConversation(url:string|undefined,id:string):boolean {
  return isCurrentChatGPTConversation(url,id)||Boolean(url&&webConversation(url)?.id===id);
}

export interface NativeMessageIdentity {
  messageId?: string;
  contentHash: string;
  preview: string;
  messageIndex?: number;
  role?: "user" | "assistant";
  /** ID anchors connect stored order to a virtualized native window. No prose. */
  anchors?:Array<{messageId:string;messageIndex:number}>;
  /** The saved question text (bounded). The page renders text differently from the stored source (Markdown,
   * attachments, labels), so IDs and hashes can disagree while the same question is on screen. */
  text?:string;
  textTruncated?:boolean;
  /** Saved message count: with messageIndex, where the question sits in a page that marks no messages. */
  messageCount?:number;
}

const QUESTION_TEXT_LIMIT=4000;
/** The question text a page locate may compare with what it renders. */
export function nativeQuestionText(content:string):Pick<NativeMessageIdentity,"text"|"textTruncated">{
  if(!content.trim())return {};
  return content.length>QUESTION_TEXT_LIMIT?{text:content.slice(0,QUESTION_TEXT_LIMIT),textTruncated:true}:{text:content};
}

export function nativeQuestionAnchors(messages:ConversationMessage[],question:ConversationMessage){
 const rows=messages.filter(message=>message.role==="user"&&message.platformMessageId&&message.id!==question.id).sort((a,b)=>a.messageIndex-b.messageIndex);
 const stride=Math.max(1,Math.ceil(rows.length/2000));
 const nearest=rows.findIndex(row=>row.messageIndex>question.messageIndex),center=nearest<0?rows.length:nearest;
 return rows.filter((_,index)=>index%stride===0||Math.abs(index-center)<16||index===rows.length-1).map(message=>({messageId:message.platformMessageId!,messageIndex:message.messageIndex}));
}

/** Resolve assistant evidence to its actual question, including stored branch ownership. */
export function discussionQuestion(messages: ConversationMessage[], messageId: string): ConversationMessage | undefined {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const index = ordered.findIndex(item => item.id === messageId || item.platformMessageId === messageId);
  if (index < 0) return undefined;
  const message = ordered[index];
  if (message.role === "user") return message;
  if (message.replyToMessageId) return ordered.find(item => item.role === "user" && (item.id === message.replyToMessageId || item.platformMessageId === message.replyToMessageId));
  return ordered.slice(0, index).reverse().find(item => item.role === "user");
}

export function isCurrentChatGPTConversation(url: string | undefined, conversationId: string): boolean {
  try { const value = new URL(url ?? ""); return value.origin === "https://chatgpt.com" && chatGPTConversationId(value.pathname) === encodeURIComponent(conversationId); }
  catch { return false; }
}

/** ChatGPT uses the same thread identity inside project/custom-GPT routes. */
export function chatGPTConversationId(pathname: string): string | undefined {
  return /^\/(?:g\/[^/]+\/)?c\/([^/]+)\/?$/u.exec(pathname)?.[1];
}
