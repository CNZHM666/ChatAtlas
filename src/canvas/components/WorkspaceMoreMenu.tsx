import { useEffect, useRef, type ReactNode } from "react";
import { MoreHorizontal } from "lucide-react";

/** Native disclosure keeps keyboard behavior; its floating menu never moves the reading flow. */
export function WorkspaceMoreMenu({label,children}:{label:string;children:ReactNode}) {
  const menu=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const close=(event:PointerEvent)=>{if(menu.current?.open&&event.target instanceof Node&&!menu.current.contains(event.target))menu.current.open=false;};document.addEventListener("pointerdown",close);return()=>document.removeEventListener("pointerdown",close);},[]);
  return <details ref={menu} className="knowledge-more" onKeyDown={event=>{if(event.key==="Escape"&&menu.current?.open){menu.current.open=false;menu.current.querySelector("summary")?.focus();event.stopPropagation();}}}><summary aria-label={label}><MoreHorizontal size={18} aria-hidden="true"/></summary><div>{children}</div></details>;
}
