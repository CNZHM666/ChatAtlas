import { useState } from "react";
import { createPortal } from "react-dom";
import { Pencil } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import type { ProjectMaintenance } from "../../shared/project-state";
import { ReaderGuide } from "./ReaderGuide";
import type { WikiClaimMarkerPoint } from "../../shared/wiki-claim-markers";
import { projectOverviewContent,projectOverviewReadingText } from "../../shared/project-overview";

export function ProjectOverviewIntro({session,zh,onMaintain,preview,editTarget,claimMarkers}:{session:FocusSession;zh:boolean;onMaintain?:(value:ProjectMaintenance)=>Promise<void>;preview:boolean;compact?:boolean;claimMarkers?:WikiClaimMarkerPoint[];editTarget?:HTMLElement|null}){
  const overview=projectOverviewContent(session);
  const text=overview.text,readingText=projectOverviewReadingText(session,overview),[editing,setEditing]=useState(false),[draft,setDraft]=useState(""),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const personal=Boolean(session.briefUserEdited||session.projectMaintenance?.overview!==undefined);
  const save=async()=>{if(!onMaintain||busy)return;setBusy(true);setError("");try{await onMaintain({...session.projectMaintenance,overview:draft.trim()});setEditing(false);}catch{setError(zh?"保存失败，请重试。":"Could not save. Try again.");}finally{setBusy(false);}};
  const edit=!preview&&onMaintain&&!editing?<button type="button" className="project-intro-edit" aria-label={text?zh?"编辑说明":"Edit description":zh?"添加项目说明":"Add description"} title={text?zh?"编辑说明":"Edit description":zh?"添加项目说明":"Add description"} onClick={()=>{setDraft(text);setEditing(true);}}><Pencil size={15} aria-hidden="true"/>{!text?<span>{zh?"添加项目说明":"Add description"}</span>:null}</button>:null;
  return <section className="project-outcome-summary project-overview-intro">{editTarget&&edit?createPortal(edit,editTarget):edit}<>{editing?<form onSubmit={event=>{event.preventDefault();void save();}}><textarea autoFocus aria-label={zh?"项目说明":"Project description"} maxLength={Math.max(1600,text.length)} rows={4} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/><div><button type="submit" className="primary" disabled={busy}>{zh?"保存":"Save"}</button><button type="button" disabled={busy} onClick={()=>setEditing(false)}>{zh?"取消":"Cancel"}</button></div></form>:<>{text?<ReaderGuide content={readingText} zh={zh} complete hideEvidenceMarkers={!personal} claimMarkers={personal?undefined:claimMarkers}/>:null}</>}</>{error?<p role="alert">{error}</p>:null}</section>;
}
