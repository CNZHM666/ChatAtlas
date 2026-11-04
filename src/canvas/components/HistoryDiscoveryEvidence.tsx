import { useState } from "react";
import type { FocusSession } from "../../shared/focus-session";
import type { ConversationMessage } from "../../shared/types";
import type { HistoryCandidate } from "../../search/home-history";
import { getDatabase } from "../../storage/db";
import { sourceMessageSignature } from "../../shared/source-signature";
import { RecordDetailDrawer } from "./RecordDetailDrawer";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";

export function HistoryDiscoveryEvidence({candidate,zh,onClose,onRead}:{candidate:HistoryCandidate;zh:boolean;onClose:()=>void;onRead?:(id:string,message:ConversationMessage)=>void}) {
  const [reference,setReference]=useState(candidate.evidence?.[0]),[error,setError]=useState("");
  const session:FocusSession={id:"discovery-preview",goal:candidate.title,title:candidate.title,mode:"answer",sourceConversationIds:candidate.sourceIds,evidence:candidate.evidence??[],sections:[],activeSectionId:"",completedSectionIds:[],notes:"",createdAt:0,updatedAt:0};
  return <RecordDetailDrawer zh={zh} title={candidate.title} label={zh?"推荐依据 · 尚未创建项目":"Recommendation sources · no project created"} onClose={onClose}>{candidate.reason?<p className="muted">{candidate.reason}</p>:null}{error?<p role="alert">{error}</p>:null}{reference?<div className="home-discovery-evidence focus-workspace"><WorkspaceSourcePanel session={session} reference={reference} references={candidate.evidence} zh={zh} onSelect={setReference} onClose={onClose} onReader={()=>{void getDatabase().then(db=>db.get("messages",reference.messageId)).then(message=>{if(!message||message.conversationId!==reference.conversationId||reference.sourceSignature!==sourceMessageSignature(message.content))throw new Error(zh?"来源已变化，请重新发现主题。":"Source changed; discover again.");if(onRead){onClose();onRead(reference.conversationId,message);}}).catch(failure=>setError(failure instanceof Error?failure.message:String(failure)));}}/></div>:<p>{zh?"尚无可定位的推荐依据，请重新发现主题。":"No traceable recommendation evidence. Discover again."}</p>}</RecordDetailDrawer>;
}
