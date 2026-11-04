import type {FocusSession} from "./focus-session";
import type {ConversationMessage} from "./types";
import type {ProjectModule,ProjectRecord,ProjectState} from "./project-state";
import {sourceMessageSignature} from "./source-signature";
import {wikiQuoteRange} from "./wiki-claims";

/** Already-paid extraction becomes candidates, never approval. No second editable store.
 * Legacy batches without source metadata cannot establish reuse. */
export function retainedProjectKnowledge(session:FocusSession,messages:ConversationMessage[]) {
 const records:{decisions:ProjectRecord[];constraints:ProjectRecord[];modules:ProjectModule[];relations:ProjectState["relations"]}={decisions:[],constraints:[],modules:[],relations:[]};
 const scope=sourceMessageSignature(JSON.stringify([session.goal,session.scope??{kind:"all"}]));
 const originals=new Map(messages.map(message=>[JSON.stringify([message.conversationId,message.id]),message]));
 const seen=new Set<string>();
 for(const batch of session.projectKnowledge?.version===1&&Array.isArray(session.projectKnowledge.batches)?session.projectKnowledge.batches:[]){
  if(!batch?.facts||!Array.isArray(batch.sources)||!batch.sources.length||!Array.isArray(batch.sourceIds)||batch.scopeSignature!==scope||batch.sourceIds.length!==batch.sources.length||new Set(batch.sources.map(source=>source.id)).size!==batch.sources.length||!batch.sourceIds.every(id=>batch.sources!.some(source=>source.id===id)))continue;
  if(batch.sources.some(source=>{
   const raw=originals.get(JSON.stringify([source.conversationId,source.messageId]));
   return !raw||!session.sourceConversationIds.includes(raw.conversationId)||session.scope?.kind==="goal"&&!session.scope.blocks?.some(block=>block.conversationId===raw.conversationId&&block.messageIds.includes(raw.id))||source.signature!==sourceMessageSignature(raw.content)||source.role!==raw.role||source.messageIndex!==undefined&&source.messageIndex!==raw.messageIndex||source.discussedAt!==undefined&&source.discussedAt!==raw.createdAt;
  }))continue;
  const grounded=(record:{quote:string;evidenceIds:string[]})=>typeof record.quote==="string"&&Array.isArray(record.evidenceIds)&&record.evidenceIds.length>0&&!record.evidenceIds.some(id=>!batch.sourceIds.includes(id))&&record.evidenceIds.some(id=>{const source=batch.sources!.find(source=>source.id===id),raw=source&&originals.get(JSON.stringify([source.conversationId,source.messageId]));return raw&&wikiQuoteRange(raw.content,record.quote);});
  for(const kind of ["decisions","constraints"] as const)for(const record of Array.isArray(batch.facts[kind])?batch.facts[kind]:[]){
   if(!record||typeof record.text!=="string"||!grounded(record))continue;
   const key=JSON.stringify([kind,record.text,record.quote,record.evidenceIds]);if(seen.has(key))continue;seen.add(key);records[kind].push(record);
  }
  // Batch-local model IDs can collide across independent reads. Namespace them
  // without changing stored knowledge or manufacturing cross-batch relations.
  const prefix=`retained:${sourceMessageSignature(JSON.stringify(batch.sourceIds))}:`,ids=new Map<string,string>();
  for(const module of Array.isArray(batch.facts.modules)?batch.facts.modules:[]){
   if(!module||!grounded(module)||typeof module.id!=="string"||typeof module.title!=="string"||!module.title.trim()||typeof module.purpose!=="string"||!module.purpose.trim()||!Array.isArray(module.inputs)||!Array.isArray(module.outputs)||[...module.inputs,...module.outputs].some(value=>typeof value!=="string"))continue;
   const id=prefix+module.id;ids.set(module.id,id);
   if(!records.modules.some(item=>item.id===id))records.modules.push({...module,id});
  }
  for(const edge of Array.isArray(batch.facts.relations)?batch.facts.relations:[]){
   const from=ids.get(edge.from),to=ids.get(edge.to);
   if(!from||!to||!edge.label||!grounded(edge))continue;
   if(!records.relations.some(item=>item.from===from&&item.to===to&&item.label===edge.label))records.relations.push({...edge,from,to});
  }
 }
 return records;
}
