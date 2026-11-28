import { useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { PencilLine } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import type { ProjectMaintenance } from "../../shared/project-state";
import { ReaderGuide } from "./ReaderGuide";
import type { WikiClaimMarkerPoint } from "../../shared/wiki-claim-markers";
export function ProjectOverviewIntro({session,text,readingText,zh,onMaintain,editTarget,onBeginEdit,claimMarkers}:{session:FocusSession;text:string;readingText:string;zh:boolean;onMaintain?:(value:ProjectMaintenance)=>Promise<void>;claimMarkers?:WikiClaimMarkerPoint[];editTarget?:HTMLElement|null;onBeginEdit?:()=>void}){
  const [editing,setEditing]=useState(false),[draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const personal=Boolean(session.briefUserEdited||session.projectMaintenance?.overview!==undefined);
  const maxLength=Math.max(1600,text.length);
  const save=async()=>{if(!onMaintain||busy)return;setBusy(true);setError("");try{await onMaintain({...session.projectMaintenance,overview:draft.trim()});setEditing(false);}catch{setError(zh?"保存失败，请重试。":"Could not save. Try again.");}finally{setBusy(false);}};
  const onKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.nativeEvent.isComposing)return;if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="s"){event.preventDefault();void save();}else if(event.key==="Escape"&&!busy){event.preventDefault();setEditing(false);}};
  const editLabel=text?zh?"编辑说明":"Edit description":zh?"添加项目说明":"Add description";
  const edit=editTarget&&onMaintain&&!editing?createPortal(<button type="button" className="wiki-tool" aria-label={editLabel} title={editLabel} onClick={()=>{onBeginEdit?.();setDraft(text);setEditing(true);}}><PencilLine size={17} aria-hidden="true"/></button>,editTarget):null;
  return <section className="project-outcome-summary project-overview-intro">{edit}<>{editing?<form className="overview-intro-editor" onSubmit={event=>{event.preventDefault();void save();}}>
    <textarea autoFocus aria-label={zh?"项目说明":"Project description"} placeholder={zh?"用几句话概括这个项目的目标、范围与核心原则…":"Summarize this project's goal, scope, and core principles…"} maxLength={maxLength} rows={4} value={draft} disabled={busy} onKeyDown={onKeyDown} onChange={event=>setDraft(event.target.value)}/>
    <div className="overview-intro-editor-footer">
      <small>{zh?`${draft.trim().length} / ${maxLength} 字 · Ctrl+S 保存`:`${draft.trim().length} / ${maxLength} · Ctrl+S to save`}</small>
      <div className="overview-intro-editor-actions">
        <button type="button" disabled={busy} onClick={()=>setEditing(false)}>{zh?"取消":"Cancel"}</button>
        <button type="submit" className="primary" disabled={busy}>{busy?(zh?"保存中…":"Saving…"):(zh?"保存":"Save")}</button>
      </div>
    </div>
  </form>:<>{text?<ReaderGuide content={readingText} zh={zh} complete hideEvidenceMarkers={!personal} claimMarkers={personal?undefined:claimMarkers}/>:null}</>}</>{error?<p className="overview-intro-error" role="alert">{error}</p>:null}</section>;
}
