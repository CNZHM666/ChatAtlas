import "./sheet.css";
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

/** A single bounded settings surface; closing restores the reading position and focus. */
export function SidecarSheet({title,zh,onClose,children,footer,variant}:{title:string;zh:boolean;onClose:()=>void;children:ReactNode;footer?:ReactNode;variant?:"menu"}) {
  const root=useRef<HTMLDivElement>(null),panel=useRef<HTMLElement>(null),close=useRef<HTMLButtonElement>(null);
  useLayoutEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const siblings=Array.from(document.body.children).filter(node=>node!==root.current).map(node=>({node,inert:node.hasAttribute("inert"),hidden:node.getAttribute("aria-hidden")}));
    siblings.forEach(({node})=>{node.setAttribute("inert","");node.setAttribute("aria-hidden","true");});
    close.current?.focus();
    return()=>{siblings.forEach(({node,inert,hidden})=>{if(!inert)node.removeAttribute("inert");if(hidden===null)node.removeAttribute("aria-hidden");else node.setAttribute("aria-hidden",hidden);});if(previous?.isConnected)previous.focus({preventScroll:true});};
  },[]);
  useLayoutEffect(()=>{close.current?.focus();},[title]);
  return createPortal(<div ref={root} className="sidecar-sheet-backdrop" onPointerDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section ref={panel} className={`sidecar-sheet${variant==="menu"?" sidecar-sheet-menu":""}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();onClose();}
      if(event.key!=="Tab")return;
      const items=Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary,[tabindex="0"]')??[]).filter(node=>node.getClientRects().length);
      const first=items[0]??close.current,last=items.at(-1)??close.current;
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }}>
      <header><h2>{title}</h2><button ref={close} type="button" aria-label={zh?"关闭面板":"Close panel"} onClick={onClose}><X size={18}/></button></header>
      <div className="sidecar-sheet-body">{children}</div>
      {footer?<footer className="sidecar-sheet-footer">{footer}</footer>:null}
    </section>
  </div>,document.body);
}
