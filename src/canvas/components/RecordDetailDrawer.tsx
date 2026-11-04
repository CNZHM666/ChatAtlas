import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { WorkspacePaneResize } from "./WorkspacePaneResize";
import "../workspace-details.css";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";
import type { FocusEvidence } from "../../shared/focus-session";
import type { FocusSession } from "../../shared/focus-session";

const FooterContext=createContext<HTMLElement|null>(null);
/** Action placement is shared by reading and editing, separate from the scrollable content. */
export function RecordDetailActions({children}:{children:ReactNode}) {
  const footer=useContext(FooterContext);
  return footer?createPortal(<div className="record-detail-actions">{children}</div>,footer):null;
}

/** In a workspace, details take their own column. Standalone and narrow views remain modal. */
export function RecordDetailDrawer({ title, label, metadata, zh, onClose, locked = false, children, session, compactHeader=false }: {
  title: string; label: string; metadata?: ReactNode; zh: boolean; onClose: () => void; locked?: boolean; children: ReactNode;
  session?:FocusSession; compactHeader?:boolean;
}) {
  const anchor=useRef<HTMLSpanElement>(null),panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null),titleId=useId();
  const evidence=useContext(WorkspaceEvidenceContext),evidenceRef=useRef(evidence);evidenceRef.current=evidence;
  const [review,setReview]=useState<WorkspaceEvidenceOptions & {reference:FocusEvidence}>();
  const trigger=useRef<HTMLElement|null>(null);
  const returnToDetail=()=>{setReview(undefined);requestAnimationFrame(()=>trigger.current?.isConnected&&trigger.current.focus({preventScroll:true}));};
  const reviewContext=session?{open:(reference:FocusEvidence,options?:WorkspaceEvidenceOptions)=>{trigger.current=document.activeElement as HTMLElement|null;setReview({reference,...options});},close:returnToDetail}:evidence;
  useLayoutEffect(()=>{evidenceRef.current?.close?.();},[]);
  const [surface,setSurface]=useState<{container:HTMLElement;workspace:HTMLElement|null}>(),[overlay,setOverlay]=useState(true),[footer,setFooter]=useState<HTMLElement|null>(null);
  useLayoutEffect(()=>{
    const workspace=anchor.current?.closest<HTMLElement>(".focus-workspace")??null;
    if(!workspace){setSurface({container:document.body,workspace:null});return;}
    const container=document.createElement("div");container.className="workspace-record-slot";workspace.appendChild(container);workspace.classList.add("has-record-panel");setSurface({container,workspace});
    const update=()=>setOverlay(workspace.getBoundingClientRect().width<940);update();
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):undefined;observer?.observe(workspace);
    return()=>{observer?.disconnect();container.remove();if(!workspace.querySelector(".workspace-record-slot"))workspace.classList.remove("has-record-panel");};
  },[]);
  useLayoutEffect(()=>{if(surface?.workspace)surface.container.classList.toggle("is-overlay",overlay);},[surface,overlay]);
  useEffect(()=>{
    if(!surface)return;
    const active=document.activeElement as HTMLElement|null;
    const previous=active?.closest("details:not([open])")?.querySelector<HTMLElement>("summary")??active;
    if(!panel.current?.contains(previous))close.current?.focus({preventScroll:true});
    return()=>{if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[surface]);
  useEffect(()=>{
    if(!surface||!overlay&&!locked)return;
    const roots=surface.workspace?Array.from(surface.workspace.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==surface.container&&!node.hasAttribute("inert")):Array.from(document.body.children).filter((node):node is HTMLElement=>node instanceof HTMLElement&&node!==panel.current?.parentElement&&!node.hasAttribute("inert"));
    roots.forEach(node=>node.setAttribute("inert",""));return()=>roots.forEach(node=>node.removeAttribute("inert"));
  },[surface,overlay,locked]);
  return <><span hidden ref={anchor}/>{surface?createPortal(<div className={surface.workspace?"record-detail-surface":"record-detail-backdrop"} onMouseDown={event=>{if(!surface.workspace&&event.target===event.currentTarget&&!locked)onClose();}}>
    <section ref={panel} className={`record-detail-drawer${compactHeader?" is-compact-detail":""}`} role={overlay?"dialog":"complementary"} aria-modal={overlay||undefined} aria-labelledby={titleId} onKeyDown={event=>{
      if(event.key==="Escape"){event.stopPropagation();if(!locked)onClose();}
      if((overlay||locked)&&event.key==="Tab"){const nodes=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),summary,a[href],[tabindex="0"]')??[]).filter(node=>node.getClientRects().length&&!node.closest("details:not([open]) > :not(summary)"));const first=nodes[0],last=nodes.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    }}><WorkspacePaneResize enabled={!overlay&&Boolean(surface.workspace)} zh={zh}/><header style={review?{display:"none"}:undefined}><div>{label?<small>{label}</small>:null}<h2 id={titleId}>{title}</h2>{metadata?<p className="record-detail-status">{metadata}</p>:null}</div><button ref={close} type="button" className="workspace-pane-close" aria-label={zh?"关闭详情":"Close details"} disabled={locked} onClick={onClose}><X size={19} aria-hidden="true"/></button></header><WorkspaceEvidenceContext.Provider value={reviewContext}><FooterContext.Provider value={footer}><div className="record-detail-body" style={review?{display:"none"}:undefined}>{children}</div></FooterContext.Provider></WorkspaceEvidenceContext.Provider><footer ref={setFooter} className="record-detail-footer" style={review?{display:"none"}:undefined}/>{review&&session?<WorkspaceSourcePanel embedded returnLabel={zh?"返回详情":"Back to details"} session={session} reference={review.reference} references={review.references} sectionId={review.sectionId} quote={review.quote} claim={review.claim} zh={zh} onSelect={reference=>setReview({...review,reference,quote:undefined,claim:undefined})} onClose={returnToDetail}/>:null}</section>
  </div>,surface.container):null}</>;
}
