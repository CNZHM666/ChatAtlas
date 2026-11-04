import {useEffect,useRef,useState,type ReactNode} from "react";
import {ChevronLeft,ChevronRight,X} from "lucide-react";
import type {FocusEvidence,FocusSession,WikiScopeReview} from "../../shared/focus-session";
import {wikiScopeContent} from "../../shared/wiki-scope-content";
import {readerPromptLayout} from "../reader-prompt-layout";
import {ReaderMarkdown} from "./ReaderConversation";
import {WorkspacePaneResize} from "./WorkspacePaneResize";
import {WikiScopeOriginals} from "./WikiScopeOriginals";
import "../workspace-source-panel.css";

type Material=WikiScopeReview["materials"][number];

/** Same split pane as evidence. Why the material was flagged comes first, then
 * its originals; the membership choice stays at the bottom, so reading and
 * deciding happen in one place. */
export function WikiScopeReaderPanel({material,materials,session,zh,tag,decision,onSelect,onClose,onSource}:{material:Material;materials:Material[];session:FocusSession;zh:boolean;tag?:string;decision?:ReactNode;onSelect:(key:string)=>void;onClose:()=>void;onSource:(ref:FocusEvidence)=>void}){
 const panel=useRef<HTMLElement>(null),body=useRef<HTMLDivElement>(null);
 const [overlay,setOverlay]=useState(false);
 const index=materials.findIndex(item=>item.key===material.key);
 useEffect(()=>{
  const workspace=panel.current?.closest(".focus-workspace,.focus-preview");
  if(!workspace)return;
  const update=()=>setOverlay(workspace.getBoundingClientRect().width<940);update();
  const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(update):undefined;observer?.observe(workspace);return()=>observer?.disconnect();
 },[]);
 useEffect(()=>{
  if(!overlay)return;
  const base=panel.current?.closest(".focus-workspace,.focus-preview")?.querySelector<HTMLElement>(".project-reading-base,.focus-preview-scroll");
  const previous=document.activeElement as HTMLElement|null,wasInert=base?.inert;
  if(base)base.inert=true;
  panel.current?.querySelector<HTMLButtonElement>(".workspace-source-close")?.focus({preventScroll:true});
  return()=>{if(base)base.inert=wasInert??false;if(previous?.isConnected)previous.focus({preventScroll:true});};
 },[overlay]);
 useEffect(()=>{if(body.current)body.current.scrollTop=0;},[material.key]);
 const refs=material.evidenceIds.flatMap(id=>session.evidence.filter(ref=>ref.id===id));
 const content=readerPromptLayout(wikiScopeContent(material.body));
 return <aside ref={panel} className={`workspace-source-panel wiki-scope-reader${overlay?" is-overlay":""}`} role={overlay?"dialog":"complementary"} aria-modal={overlay||undefined} aria-label={zh?"材料阅读":"Material reading"} onKeyDown={event=>{
  if(event.key==="Escape"){event.stopPropagation();onClose();}
  if(overlay&&event.key==="Tab"){
   const controls=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]')??[]),first=controls[0],last=controls.at(-1);
   if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
  }
 }}>
  <WorkspacePaneResize enabled={!overlay} zh={zh}/>
  <header><div><small>{zh?"内容范围核对":"Scope review"}{materials.length>1?<span aria-live="polite">{` · ${index+1} / ${materials.length}`}</span>:null}</small><h2>{material.title}</h2></div>
   <div className="wiki-scope-reader-tools">{materials.length>1?<nav className="wiki-scope-reader-steps" aria-label={zh?"材料导航":"Material navigation"}><button type="button" disabled={index<=0} aria-label={zh?"上一项材料":"Previous material"} onClick={()=>onSelect(materials[index-1].key)}><ChevronLeft size={16}/></button><button type="button" disabled={index>=materials.length-1} aria-label={zh?"下一项材料":"Next material"} onClick={()=>onSelect(materials[index+1].key)}><ChevronRight size={16}/></button></nav>:null}<button type="button" className="workspace-source-close" aria-label={zh?"关闭材料阅读":"Close material reading"} onClick={onClose}><X size={19} aria-hidden="true"/></button></div></header>
  <div ref={body} className="workspace-source-body">
   <section className="wiki-scope-reader-basis" aria-label={zh?"核对依据":"Review basis"}><h3>{zh?"为什么标出这项":"Why this is flagged"}{tag?<span className="wiki-scope-tag">{tag}</span>:null}</h3>{material.reason?<p>{material.reason}</p>:null}
    {!refs.length?<p className="muted">{zh?"这项材料没有保存对应的原文引用。":"No source citations were saved for this material."}</p>:null}
   </section>
   {refs.length?<><WikiScopeOriginals session={session} references={refs} zh={zh} onSource={onSource}/>{content?<details className="wiki-scope-generated"><summary>{zh?"整理摘要":"Organized summary"}</summary><div className="wiki-scope-reader-content conversation-answer-markdown"><ReaderMarkdown content={content} zh={zh} hideImages/></div></details>:null}</>:<div className="wiki-scope-reader-content conversation-answer-markdown">{content?<ReaderMarkdown content={content} zh={zh} hideImages/>:null}</div>}
  </div>
  {decision?<footer className="wiki-scope-reader-decision">{decision}</footer>:null}
 </aside>;
}
