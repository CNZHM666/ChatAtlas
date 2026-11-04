import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { ConversationMessage } from "../../shared/types";
import type { ReaderSearchContext, ReaderSearchHit } from "../../shared/message-location";
import { ReaderBackButton } from "./ReaderBackButton";

function hitPreview(hit: ReaderSearchHit, message: ConversationMessage): string {
  const field = hit.sourceRange?.part === "ui" ? message.uiParts?.[hit.sourceRange.partIndex ?? -1]?.fallbackText ?? "" : message.content;
  const start = hit.sourceRange?.start ?? Math.max(0, field.indexOf(hit.excerpt));
  const from = Math.max(0, start - 36), to = Math.min(field.length, start + Math.max(72, Math.min(hit.excerpt.length, 100)));
  return `${from ? "…" : ""}${field.slice(from, to).replace(/\s+/gu, " ")}${to < field.length ? "…" : ""}`;
}

export function ReaderSearchOutline({ context, messages, hits, selectedId, collapsed, zh, onToggle, onReturn, onSelect }: {
  context: ReaderSearchContext; messages: ConversationMessage[]; hits: ReaderSearchHit[]; selectedId?: string; collapsed: boolean; zh: boolean; onToggle: () => void; onReturn: () => void; onSelect: (hit: ReaderSearchHit) => void;
}) {
  return <aside className={`conversation-sidebar reader-search-outline${collapsed ? " is-collapsed" : ""}`} aria-label={zh ? "命中目录" : "Search matches"}>
    <div className="reader-search-outline-tools">{!collapsed ? <ReaderBackButton onClick={onReturn} label={zh ? "返回原目录" : "Original outline"} /> : null}<button type="button" onClick={onToggle} aria-label={zh ? collapsed ? "展开侧边栏" : "收起侧边栏" : collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={18}/> : <PanelLeftClose size={18}/>}</button></div>
    {!collapsed ? <><h2>{zh ? "命中目录" : "Search matches"}<small>{hits.length}</small></h2><p className="reader-search-query" title={context.query}>{context.query}</p><ol>{hits.map(hit => { const message = messages.find(message => message.id === hit.messageId)!; const label = hitPreview(hit, message); return <li key={hit.messageId}><button type="button" aria-current={selectedId === hit.messageId ? "location" : undefined} onClick={() => onSelect(hit)} title={label}><small>{message.role === "user" ? zh ? "用户" : "You" : "AI"} · {message.messageIndex + 1}</small><span>{label}</span></button></li>; })}</ol>{!hits.length ? <p role="status">{zh ? "命中原文已变化，请重新搜索。" : "Matches changed. Search again."}</p> : null}</> : null}
  </aside>;
}
