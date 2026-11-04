import {getDatabase} from "../storage/db";
import {getAISettings} from "../storage/knowledge-graph";
import {resolveEmbeddingProvider} from "../ai/embedding-provider";
import {hasProviderPermission} from "../ai/provider";
import {semanticDocumentFingerprint, semanticQueryVector} from "../search/semantic-index";
import {isInternalSearchQueryMessage} from "../shared/conversation-text";
import type {Conversation, ConversationMessage} from "../shared/types";
import type {MessageSearchOptions,MessageSearchHit} from "../search/message-fulltext";

export interface SemanticMemoryReport {
 status: "ready" | "unconfigured" | "permission" | "no-index" | "timeout" | "error" | "exact";
 indexedMessages?: number;
}
/** Query-only retrieval. Missing historical vectors require a separate, explicit indexing action. */
export async function searchSemanticMemory(query:string,conversations:Conversation[],options:MessageSearchOptions={},signal?:AbortSignal):Promise<{hits:MessageSearchHit[];report:SemanticMemoryReport}> {
 const empty=(status:SemanticMemoryReport["status"])=>({hits:[],report:{status}});
 if(/["“]/u.test(query))return empty("exact");
 const settings=await getAISettings();if(!settings?.embeddingModel?.trim())return empty("unconfigured");
 const provider=await resolveEmbeddingProvider(settings,signal);if(!provider)return empty("unconfigured");
 if(!await hasProviderPermission(settings.baseUrl))return empty("permission");
 const db=await getDatabase(),saved=await db.getAll("semanticVectors"),prefix=`${provider.modelKey}:passage:`;
 const allowed=conversations.filter(item=>(!options.conversationIds||options.conversationIds.includes(item.id))&&(!options.platforms||options.platforms.includes(item.platform))).sort((a,b)=>b.id.length-a.id.length);
 const messages=new Map<string,ConversationMessage|undefined>();
 const candidates=saved.filter(row=>row.modelKey===provider.modelKey&&row.id.startsWith(prefix)&&row.values.length&&row.values.every(Number.isFinite)).flatMap(row=>{
  const suffix=row.id.slice(prefix.length),conversation=allowed.find(item=>suffix.startsWith(item.id+":")),last=suffix.lastIndexOf(":"),start=Number(suffix.slice(last+1));
  return conversation&&Number.isInteger(start)&&start>=0?[{row,conversation,messageId:suffix.slice(conversation.id.length+1,last),start}]:[];
 });
 const valid=async(item:typeof candidates[number])=>{
  signal?.throwIfAborted();if(!messages.has(item.messageId))messages.set(item.messageId,await db.get("messages",item.messageId));
  const message=messages.get(item.messageId);
  if(!message||message.conversationId!==item.conversation.id||isInternalSearchQueryMessage(message)||options.from!==undefined&&message.createdAt<options.from||options.to!==undefined&&message.createdAt>options.to)return;
  const body=message.content.slice(item.start,item.start+2000),document={id:item.row.id.slice(provider.modelKey.length+1),conversationId:message.conversationId,episodeId:"",title:"",body,terms:""};
  return body&&semanticDocumentFingerprint(document)===item.row.textHash?{message,body}:undefined;
 };
 // Verify that at least one in-scope, current original exists before spending a query request.
 // The rest are hydrated after vector ranking, rather than loading the full library on every query.
 let first:typeof candidates[number]|undefined;
 for(const item of candidates){if(await valid(item)){first=item;break;}}
 if(!first)return empty("no-index");
 const vector=await semanticQueryVector(query,provider,first.row.values.length,signal);signal?.throwIfAborted();
 const cosine=(values:number[])=>{if(values.length!==vector.length)return 0;let dot=0,a=0,b=0;for(let i=0;i<vector.length;i++){dot+=vector[i]*values[i];a+=vector[i]**2;b+=values[i]**2;}return a&&b?dot/Math.sqrt(a*b):0;};
 const scored:Array<typeof candidates[number]&{score:number}>=[];
 for(const [index,candidate] of candidates.entries()){
  signal?.throwIfAborted();const score=cosine(candidate.row.values);if(score>=0.6)scored.push({...candidate,score});
  if(index>0&&index%256===0)await new Promise(resolve=>setTimeout(resolve,0));
 }
 const seen=new Set<string>(),hits:MessageSearchHit[]=[];
 for(const item of scored.sort((a,b)=>b.score-a.score)){
  if(seen.has(item.messageId))continue;
  const source=await valid(item);if(!source)continue;
  // Revalidate after the query request: imports/edits may have changed the source meanwhile.
  const current=await db.get("messages",item.messageId);
  if(!current||current.conversationId!==source.message.conversationId||current.content!==source.message.content||current.role!==source.message.role)continue;
  seen.add(current.id);hits.push({messageId:current.id,conversationId:current.conversationId,message:current,score:item.score,platform:item.conversation.platform,timestamp:current.createdAt,summary:source.body.slice(0,210),sourceRange:{start:item.start,end:item.start+source.body.length,part:"content",excerpt:source.body}});
  if(hits.length>=12)break;
 }
 return {hits,report:{status:"ready",indexedMessages:seen.size}};
}
export async function semanticMemory(query:string,conversations:Conversation[],options:MessageSearchOptions={},signal?:AbortSignal):Promise<MessageSearchHit[]> {
 return (await searchSemanticMemory(query,conversations,options,signal)).hits;
}
