import { useContext } from "react";
import { Quote } from "lucide-react";
import type { FocusEvidence } from "../../shared/focus-session";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";

/** Reading evidence never confirms or edits a fact. Keep the caller's view mounted. */
export function EvidenceReviewButton({ sources, zh, onLocate, disabled=false, historical=false, claim, quote, label, showUnavailable=false, iconOnly=false }: {
  sources:FocusEvidence[];zh:boolean;onLocate:(ref:FocusEvidence)=>void;disabled?:boolean;historical?:boolean;claim?:string;quote?:string;label?:string;showUnavailable?:boolean;
  /** A compact header button: the label becomes its accessible name and tooltip. */
  iconOnly?:boolean;
}) {
  const panel=useContext(WorkspaceEvidenceContext);
  const references=sources.filter(ref=>ref.conversationId&&ref.messageId);
  if(!references.length)return showUnavailable ? <button type="button" className="evidence-review-button" disabled title={zh?"此事项没有关联的原文依据":"No original evidence is linked to this matter"}><Quote size={15} aria-hidden="true"/>{label ?? (zh?"查看依据":"View sources")}</button> : null;
  const reference=references.find(ref=>quote&&ref.excerpt.includes(quote))??references[0];
  const text=label ?? (historical?(zh?"回看历史依据":"Review historical evidence"):(zh?"核对依据":"Review evidence"));
  return <button type="button" className={`evidence-review-button${iconOnly?" is-icon":""}`} disabled={disabled} {...(iconOnly?{"aria-label":text,title:text}:{})} onClick={()=>{
    if(panel)panel.open(reference,{references,claim:historical?undefined:claim,quote});else onLocate(reference);
  }}><Quote size={15} aria-hidden="true"/>{iconOnly?null:text}</button>;
}
