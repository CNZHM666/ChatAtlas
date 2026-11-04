import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { Conversation } from "../../shared/types";
import { isCurrentHydrationComplete } from "../../sync/import-state";

export function ProjectSourcePicker({ conversations, existingIds, suggestedIds = [], zh, onClose, onConfirm, onSync }: { conversations: Conversation[]; existingIds: string[]; suggestedIds?: string[]; zh: boolean; onClose: () => void; onConfirm: (ids: string[]) => void; onSync?:()=>void }) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>(() => suggestedIds.filter(id => !existingIds.includes(id)));
  const dialog = useRef<HTMLDivElement>(null), titleId = useId();
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; dialog.current?.querySelector<HTMLInputElement>("input")?.focus(); return () => { if (prior?.isConnected) prior.focus({ preventScroll: true }); }; }, []);
  const candidates = conversations.filter(source => !existingIds.includes(source.id) && source.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const ready = selected.filter(id => conversations.some(source => source.id === id && !existingIds.includes(id) && isCurrentHydrationComplete(source)));
  return <div className="focus-followup-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><div ref={dialog} className="project-source-picker" role="dialog" aria-modal="true" aria-labelledby={titleId} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); onClose(); }
    if (event.key === "Tab") { const items = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)') ?? [])], first = items[0], last = items.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
  }}><header><h2 id={titleId}>{zh ? "添加对话" : "Add conversations"}</h2><button type="button" aria-label={zh ? "关闭添加对话" : "Close source picker"} onClick={onClose}><X size={18} /></button></header>
    <input type="search" aria-label={zh ? "搜索可添加的对话" : "Search conversations to add"} placeholder={zh ? "搜索对话" : "Search conversations"} value={query} onChange={event => setQuery(event.target.value)} />
    <div className="project-source-choices">{candidates.map(source => <label key={source.id}><input type="checkbox" disabled={!isCurrentHydrationComplete(source)} checked={ready.includes(source.id)} onChange={event => setSelected(ids => event.target.checked ? [...ids, source.id] : ids.filter(id => id !== source.id))} /><span>{source.title}{!isCurrentHydrationComplete(source) ? <small>{zh ? "需同步正文" : "Sync required"}</small> : null}</span></label>)}{!candidates.length ? <p className="muted">{zh ? "没有可添加的对话" : "No conversations found"}</p> : null}</div>
    <footer>{onSync&&suggestedIds.some(id=>conversations.some(source=>source.id===id&&!isCurrentHydrationComplete(source)))?<button type="button" onClick={onSync}>{zh?"同步新增对话正文":"Sync new conversation content"}</button>:null}<span>{zh ? `已选 ${ready.length} 条` : `${ready.length} selected`}</span><button type="button" className="primary" disabled={!ready.length} onClick={() => onConfirm(ready)}>{zh ? "生成更新预览" : "Preview update"}</button></footer>
  </div></div>;
}
