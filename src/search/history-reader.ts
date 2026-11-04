import type {ConversationMessage} from "../shared/types";
import type {ReaderSearchContext} from "../shared/message-location";
import {sourceMessageSignature} from "../shared/source-signature";
import type {HistoryMatch} from "./home-history";
import {messageQueryRange,planMessageQuery} from "./message-query";
import {memoryQueryVariants} from "./memory-query";

/** Revalidate every hit; use the actual matching slice, never an entire reply as a quote. */
export function historyReaderContext(match:HistoryMatch,query:string,originals:ConversationMessage[]):ReaderSearchContext{
 const seen=new Set<string>();
 return {query,hits:match.messages.flatMap((snapshot,index)=>{
  if(seen.has(snapshot.id))return [];seen.add(snapshot.id);
  const message=originals.find(message=>message.id===snapshot.id&&message.conversationId===match.conversation.id);
  if(!message||sourceMessageSignature(message.content)!==sourceMessageSignature(snapshot.content))return [];
  const hit=match.hits?.find(hit=>hit.messageId===message.id);
  let range=hit?.sourceRange??(index===0?match.sourceRange:undefined);
  const field=range?.part==="ui"?message.uiParts?.[range.partIndex??-1]?.fallbackText:message.content;
  if(range&&(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start||!field||range.end>field.length||range.excerpt&&field.slice(range.start,range.end)!==range.excerpt))range=undefined;
  if(!range)for(const variant of memoryQueryVariants(query)){const found=messageQueryRange(planMessageQuery(variant),message.content);if(found){range={...found,excerpt:message.content.slice(found.start,found.end)};break;}}
  const text=range?.part==="ui"?message.uiParts?.[range.partIndex??-1]?.fallbackText??"":message.content;
  const excerpt=range?text.slice(range.start,range.end):"";
  return [{messageId:message.id,sourceSignature:sourceMessageSignature(message.content),sourceRange:range?{...range,excerpt}:undefined,excerpt}];
 })};
}
