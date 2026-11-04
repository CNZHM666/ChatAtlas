import {useState,useRef,useEffect} from "react";
import {SidecarSheet} from "../../sidecar/SidecarSheet";
import {validateContextHandoff,type ContextHandoff} from "../../storage/context-handoff";
import type {Conversation} from "../../shared/types";
import {isCurrentHydrationComplete} from "../../sync/import-state";

export function ContextHandoffDialog({request,zh,onClose,onStart,onSync}:{request:ContextHandoff;zh:boolean;onClose:()=>void;onStart:(task:string,sources:Conversation[])=>void;onSync:(ids:string[])=>Promise<unknown>}){
 const [task,setTask]=useState(request.task),[busy,setBusy]=useState(false),[error,setError]=useState(""),[needsSync,setNeedsSync]=useState(false);
 const live=useRef(true),working=useRef(false);useEffect(()=>{live.current=true;return()=>{live.current=false;};},[]);
 const close=()=>{live.current=false;onClose();};
 const start=async()=>{if(working.current)return;working.current=true;setBusy(true);setError("");try{const sources=await validateContextHandoff(request);if(!live.current)return;if(sources.some(source=>!isCurrentHydrationComplete(source))){setNeedsSync(true);setError(zh?"来源尚未同步完成":"Source sync incomplete");return;}onStart(task.trim()||(zh?"整理所选历史讨论":"Organize the selected discussions"),sources);}catch{if(live.current)setError(zh?"来源已变化，请从侧栏重新选择。":"Sources changed. Select them again in the sidebar.");}finally{working.current=false;if(live.current)setBusy(false);}};
 return <SidecarSheet title={zh?"深度整理":"Deep analysis"} zh={zh} onClose={close}><label className="context-handoff-task">{zh?"整理目标":"Goal"}<input aria-label={zh?"整理目标":"Goal"} value={task} maxLength={500} disabled={busy} onChange={event=>setTask(event.target.value)}/></label><ul className="context-handoff-sources">{request.scope.blocks?.map(block=><li key={block.conversationId}>{block.title}<small>{zh?`${block.messageIds.length} 条消息`:`${block.messageIds.length} messages`}</small></li>)}</ul>{error?<p role="alert">{error}</p>:null}<div className="context-handoff-actions">{needsSync?<button disabled={busy} onClick={()=>{if(working.current)return;working.current=true;setBusy(true);void onSync(request.scope.blocks!.map(block=>block.conversationId)).catch(()=>{if(live.current)setError(zh?"同步未完成":"Sync incomplete");}).finally(()=>{working.current=false;if(live.current)setBusy(false);});}}>{zh?"同步来源":"Sync sources"}</button>:null}<button className="primary" disabled={busy} onClick={()=>void start()}>{busy?(zh?"处理中…":"Working…"):(zh?"AI 深度整理":"Analyze with AI")}</button></div></SidecarSheet>;
}
