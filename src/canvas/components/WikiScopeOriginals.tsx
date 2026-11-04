import {useContext,useEffect,useState} from "react";
import type {FocusEvidence,FocusSession} from "../../shared/focus-session";
import type {ConversationMessage} from "../../shared/types";
import {readSessionSource} from "../../storage/source-versions";
import {ambiguousEvidenceVersion,evidenceVersion} from "../../shared/evidence-identity";
import {sourceMessageSignature} from "../../shared/source-signature";
import {ProjectExampleContext} from "../project-example-context";
import {readerPromptLayout} from "../reader-prompt-layout";
import {SourceMessageContent} from "./SourceMessageContent";

type Original={reference:FocusEvidence;message?:ConversationMessage;failed?:boolean};

/** Read retained source versions automatically; an excerpt is never called a
 * complete original. A switched material cannot receive a late previous load. */
export function WikiScopeOriginals({session,references,zh,onSource}:{session:FocusSession;references:FocusEvidence[];zh:boolean;onSource:(ref:FocusEvidence)=>void}){
 const example=useContext(ProjectExampleContext);
 const [loaded,setLoaded]=useState<{key:string;rows:Original[]}>(),[retry,setRetry]=useState(0);
 const key=JSON.stringify([session.id,references,session.sourceVersionIds,session.sourceSignatures,session.sourceRoles,session.sourceMessageOrder,session.sourceOutlines]);
 useEffect(()=>{
  let alive=true;
  const reads=new Map<string,Promise<ConversationMessage[]>>();
  const load=async(reference:FocusEvidence):Promise<Original>=>{
   if(ambiguousEvidenceVersion(session,reference))return {reference};
   const version=evidenceVersion(session,reference),id=JSON.stringify([reference.conversationId,version]);
   try{
    let read=reads.get(id);
    if(!read){read=example?Promise.resolve(example.knowledge(session).messages.filter(message=>message.conversationId===reference.conversationId)):readSessionSource(session,reference.conversationId,reference.messageId,version);reads.set(id,read);}
    const messages=await read;
    return {reference,message:messages.find(message=>message.id===reference.messageId||message.platformMessageId===reference.messageId)};
   }catch{return {reference,failed:true};}
  };
  void Promise.all(references.map(load)).then(rows=>{if(alive)setLoaded({key,rows});});
  return()=>{alive=false;};
  // Exact source identities and versions, rather than changing object references,
  // govern local reads. No model or remote request is made here.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[key,example,retry]);
 const loading=loaded?.key!==key;
 const rows=loading?references.map(reference=>({reference} as Original)):loaded.rows;
 const seen=new Set<string>();
 // One conversation title for the whole list; each message names only its author.
 const titles=[...new Set(references.map(reference=>reference.title).filter(Boolean))],shared=titles.length===1?titles[0]:undefined;
 return <section className="wiki-scope-originals" aria-label={zh?"材料原文":"Material originals"} aria-busy={loading}>
  <h3>{zh?"原文":"Originals"}{shared?<small>{zh?`来自「${shared}」`:`From “${shared}”`}</small>:null}</h3>
  {loading?<p className="workspace-source-notice" role="status">{zh?"正在读取完整原文…":"Loading complete originals…"}</p>:null}
  {rows.flatMap(({reference,message,failed})=>{
   const id=JSON.stringify([reference.conversationId,evidenceVersion(session,reference),message?.id??reference.messageId]);if(seen.has(id))return [];seen.add(id);
   const role=message?.role??session.sourceRoles?.[reference.conversationId]?.[reference.messageId];
   const changed=message&&reference.sourceSignature&&reference.sourceSignature!==sourceMessageSignature(message.content);
   return [<article key={id} className="wiki-scope-original-message"><h4>{role==="user"?zh?"你":"You":role==="assistant"?"AI":zh?"原文":"Original"}{shared?null:` · ${reference.title}`}</h4>
    {!message?<p className="workspace-source-notice">{loading?zh?"已保存的摘录":"Saved excerpt":failed?zh?"原文读取失败，以下为已保存摘录。":"Could not read the original. Saved excerpt follows.":zh?"原文暂不可用，以下仅为已保存摘录。":"Original unavailable. Only the saved excerpt follows."}</p>:changed?<p className="workspace-source-notice">{zh?"原文版本与引用有变化，请核对。":"The original differs from the citation. Review the source version."}</p>:null}
    <div className="wiki-scope-reader-content conversation-answer-markdown"><SourceMessageContent message={message} content={readerPromptLayout(message?.content??reference.excerpt)} zh={zh}/></div>
    {!loading&&failed?<button type="button" onClick={()=>{setLoaded(undefined);setRetry(value=>value+1);}}>{zh?"重新读取原文":"Retry loading original"}</button>:null}
    <button type="button" className="wiki-scope-original-link" onClick={()=>onSource(reference)}>{zh?"在对话中查看":"View in conversation"}</button>
   </article>];
  })}
 </section>;
}
