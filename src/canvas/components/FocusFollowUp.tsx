import { useEffect, useRef, useState } from "react";
import {ChevronDown,Sparkles,X} from "lucide-react";

export type RevisionScope = "section" | "selected" | "whole";
type RevisionChapter = {id:string;title:string;disabled?:boolean};

export function FocusFollowUp({ zh, title, instruction, scope, onInstruction, onScope, onClose, onSubmit, onExplain, chapters, selectedIds = [], onSelection, currentId }: { zh: boolean; title: string; instruction: string; scope: RevisionScope; onInstruction: (value: string) => void; onScope: (value: RevisionScope) => void; onClose: () => void; onSubmit: () => void; onExplain?: () => void; chapters?:RevisionChapter[]; selectedIds?:string[]; onSelection?:(ids:string[])=>void; currentId?:string }) {
  const hasChapters=chapters!==undefined;
  const available=chapters?.filter(chapter=>!chapter.disabled);
  const count=available ? available.filter(chapter=>scope==="whole"||scope==="section"&&chapter.id===currentId||scope==="selected"&&selectedIds.includes(chapter.id)).length : undefined;
  const canSubmit=(Boolean(chapters)||Boolean(instruction.trim()))&&(count===undefined||count>0);
  const [extraOpen,setExtraOpen]=useState(Boolean(instruction.trim()));
  const dialog = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>(hasChapters?"select":"textarea")?.focus();
    return () => { if (previous?.isConnected) previous.focus(); };
  }, [hasChapters]);
  return <div className="focus-followup-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} className="focus-followup-dialog" role="dialog" aria-modal="true" aria-labelledby="followup-title" onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") { const items = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled),textarea,select,input:not(:disabled)") ?? []); const first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}>
    <header><div><h2 id="followup-title">{zh ? "AI 调整内容" : "Revise with AI"}</h2><small>{title}</small></div><button type="button" aria-label={zh ? "关闭调整" : "Close revision"} onClick={onClose}><X size={19}/></button></header>
    <form onSubmit={event => { event.preventDefault(); if (canSubmit) onSubmit(); }}>
      {chapters?<div className="focus-revision-recommended"><Sparkles size={19} aria-hidden="true"/><div><strong>{zh?"推荐整理":"Recommended revision"}</strong><p>{zh?"理顺章节归属、减少重复、统一标题和 AI 称呼，并突出关键结论。无需填写提示词。":"Reconcile topics, reduce repetition, clarify titles and AI narration, and highlight key conclusions. No prompt needed."}</p><small>{zh?"先预览再采用，保留原版本、个人正文和手动总览。":"Review before applying. Previous versions, personal writing and your overview are retained."}</small></div></div>:null}
      {chapters&&scope==="selected"?<fieldset className="focus-revision-chapters"><legend>{zh?"选择章节":"Select chapters"}</legend><div className="focus-revision-selection"><button type="button" onClick={()=>onSelection?.(available!.map(chapter=>chapter.id))}>{zh?"全选":"Select all"}</button><button type="button" onClick={()=>onSelection?.([])}>{zh?"清空":"Clear"}</button><span>{zh?`已选 ${count} 章`:`${count} selected`}</span></div><div className="focus-revision-chapter-list">{chapters.map(chapter=><label key={chapter.id}><input type="checkbox" disabled={chapter.disabled} checked={!chapter.disabled&&selectedIds.includes(chapter.id)} onChange={event=>onSelection?.(event.target.checked?[...selectedIds,chapter.id]:selectedIds.filter(id=>id!==chapter.id))}/><span>{chapter.title}</span>{chapter.disabled?<small>{zh?"个人编辑":"Personal edits"}</small>:null}</label>)}</div></fieldset>:null}
      {chapters?<details className="focus-revision-extra" open={extraOpen} onToggle={event=>setExtraOpen(event.currentTarget.open)}><summary>{zh?"补充要求（选填）":"Additional instructions (optional)"}<ChevronDown size={15}/></summary><textarea maxLength={500} value={instruction} onChange={event=>onInstruction(event.target.value)} aria-label={zh?"补充要求":"Additional instructions"} placeholder={zh?"例如：保留所有代码示例，重点说明失败时的处理。":"For example: retain all code examples and clarify failure behavior."} rows={3}/></details>:<textarea maxLength={500} value={instruction} onChange={event=>onInstruction(event.target.value)} aria-label={zh?"调整要求":"Revision instructions"} placeholder={zh?"想如何修改这份内容？":"How should this content change?"} rows={5}/>}
      <footer><select aria-label={zh ? "调整范围" : "Revision scope"} value={scope} onChange={event => onScope(event.target.value as RevisionScope)}><option value="section" disabled={Boolean(chapters&&!available?.some(chapter=>chapter.id===currentId))}>{zh ? "当前章节" : "Current section"}</option>{chapters?<option value="selected">{zh?"选择章节":"Selected chapters"}</option>:null}<option value="whole">{zh ? chapters?"全部 AI 章节":"整个回顾" : chapters?"All AI chapters":"Whole result"}</option></select>{onExplain ? <button type="button" onClick={onExplain}>{zh ? "解释本节" : "Explain section"}</button> : null}<button className="primary" type="submit" disabled={!canSubmit}>{zh ? "生成修改预览" : "Preview revision"}{count!==undefined?` · ${count}`:""}</button></footer></form>
  </div></div>;
}
