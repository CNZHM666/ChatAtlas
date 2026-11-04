import { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Grid2X2 } from "lucide-react";
import { createPortal } from "react-dom";
import { AIPlatformIcon } from "./AIPlatformIcon";
import type { Conversation } from "../../shared/types";
import { conversationPlatformGroup, platformName } from "../../shared/platforms";
import "../ai-platform-filter.css";

const PRIMARY = ["chatgpt", "claude", "gemini", "deepseek", "zhipu"];
const MORE = ["kimi", "doubao", "qwen", "grok", "yuanbao", "perplexity", "copilot", "mistral", "other"];

export function AIPlatformFilter({ conversations, value, onChange, zh }: { conversations: Conversation[]; value: string; onChange: (value: string) => void; zh: boolean }) {
  const [open,setOpen]=useState(false),[position,setPosition]=useState<{left:number;top:number;maxHeight:number;width:number}>();
  const trigger=useRef<HTMLButtonElement>(null), menu=useRef<HTMLDivElement>(null), menuId=useId();
  const counts = useMemo(() => {
    const result = new Map<string, number>();
    for (const item of conversations) { const key = conversationPlatformGroup(item.platform); result.set(key,(result.get(key) ?? 0)+1); }
    return result;
  }, [conversations]);
  const more = [...new Set([...MORE,...counts.keys(),...(value ? [value] : [])])].filter(id=>!PRIMARY.includes(id));
  const moreSelected = Boolean(value && !PRIMARY.includes(value));
  const close=(focus=false)=>{setOpen(false);if(focus)trigger.current?.focus({preventScroll:true});};
  useLayoutEffect(()=>{
    if(!open)return;
    const place=()=>{
      const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
      const width=Math.min(280,window.innerWidth-24), below=window.innerHeight-rect.bottom-12, above=rect.top-12;
      const maxHeight=Math.min(360,Math.max(below,above)), height=Math.min(more.length*44+12,maxHeight);
      setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top:below>=height?rect.bottom+6:Math.max(12,rect.top-height-6),maxHeight,width});
    };
    const outside=(event:PointerEvent)=>{if(event.target instanceof Node&&!menu.current?.contains(event.target)&&!trigger.current?.contains(event.target))setOpen(false);};
    place();
    const frame=requestAnimationFrame(()=>{
      const list=menu.current, options=list?.querySelectorAll<HTMLButtonElement>('[role="option"]'), target=list?.querySelector<HTMLButtonElement>('[aria-selected="true"]')??options?.[0];
      target?.focus({preventScroll:true});
      if(list&&target&&target.offsetTop+target.offsetHeight>list.scrollTop+list.clientHeight)list.scrollTop=target.offsetTop+target.offsetHeight-list.clientHeight;
    });
    document.addEventListener("pointerdown",outside);window.addEventListener("resize",place);window.addEventListener("scroll",place,true);
    return()=>{cancelAnimationFrame(frame);document.removeEventListener("pointerdown",outside);window.removeEventListener("resize",place);window.removeEventListener("scroll",place,true);};
  },[open,more.length]);
  const menuKeys=(event:React.KeyboardEvent)=>{
    if(event.key==="Escape"){event.preventDefault();event.stopPropagation();close(true);return;}
    if(event.key==="Tab"){close(true);return;}
    const options=[...menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]')??[]], index=options.indexOf(document.activeElement as HTMLButtonElement);
    const next=event.key==="Home"?0:event.key==="End"?options.length-1:event.key==="ArrowDown"?(index+1)%options.length:event.key==="ArrowUp"?(index-1+options.length)%options.length:-1;
    if(next>=0){event.preventDefault();options[next]?.focus();}
  };
  return <div className="ai-platform-filter" role="group" aria-label={zh ? "按 AI 平台分类" : "Filter by AI platform"}>
    <div className="ai-platform-tabs">
      {["",...PRIMARY].map(id => {
        const label=id ? platformName(id,zh?"zh-CN":"en") : zh?"全部 AI":"All AIs", count=id ? counts.get(id) ?? 0 : conversations.length;
        return <button type="button" key={id} aria-label={`${label} ${count}`} aria-pressed={value===id} onClick={()=>{onChange(id);close();}}><AIPlatformIcon platform={id}/><span>{label}</span>{count ? <small aria-hidden="true">{count}</small> : null}</button>;
      })}
    </div>
    <div className={`ai-platform-more${moreSelected ? " is-active" : ""}`}>
      <button ref={trigger} type="button" className="ai-platform-more-trigger" aria-label={zh?"更多 AI 分类":"More AI categories"} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?menuId:undefined} onClick={()=>setOpen(!open)} onKeyDown={event=>{if(event.key==="ArrowDown"||event.key==="ArrowUp"){event.preventDefault();setOpen(true);}else if(event.key==="Escape")close();}}>
        {moreSelected?<AIPlatformIcon platform={value}/>:<Grid2X2 size={18} aria-hidden="true"/>}<span>{moreSelected?platformName(value,zh?"zh-CN":"en"):zh?"更多 AI":"More AIs"}</span>{moreSelected&&counts.get(value)?<small>{counts.get(value)}</small>:null}<ChevronDown size={14} aria-hidden="true"/>
      </button>
    </div>
    {open?createPortal(<div ref={menu} id={menuId} className="ai-platform-menu" role="listbox" aria-label={zh?"选择 AI 平台":"Choose AI platform"} style={position?{...position,visibility:"visible"}:{visibility:"hidden"}} onKeyDown={menuKeys}>
      {more.map(id=><button key={id} type="button" role="option" aria-selected={value===id} onClick={()=>{onChange(id);close(true);}}><AIPlatformIcon platform={id}/><span title={platformName(id,zh?"zh-CN":"en")}>{platformName(id,zh?"zh-CN":"en")}</span>{counts.get(id)?<small>{counts.get(id)}</small>:null}{value===id?<Check size={15} aria-hidden="true"/>:null}</button>)}
    </div>,document.body):null}
  </div>;
}
