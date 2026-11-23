import { Search } from "lucide-react";
import { ReaderSidebarToggle } from "./ReaderSidebarToggle";
import { useMemo, useState } from "react";
import type { ConversationMessage } from "../../shared/types";
import type { ReaderSearchContext, ReaderSearchHit } from "../../shared/message-location";
import { ReaderBackButton } from "./ReaderBackButton";
import { HistorySearchText } from "./HistorySearchText";
import { historySearchSnippet } from "../../search/history-search-display";

function hitPreview(hit: ReaderSearchHit, message: ConversationMessage): string {
  const field = hit.sourceRange?.part === "ui" ? message.uiParts?.[hit.sourceRange.partIndex ?? -1]?.fallbackText ?? "" : message.content;
  const start = hit.sourceRange?.start ?? Math.max(0, field.indexOf(hit.excerpt));
  const from = Math.max(0, start - 18), to = Math.min(field.length, start + Math.max(95, Math.min(hit.excerpt.length, 130)));
  return `${from ? "…" : ""}${field.slice(from, to).replace(/\s+/gu, " ")}${to < field.length ? "…" : ""}`;
}

export function ReaderSearchOutline({ context, title, messages, hits, selectedId, collapsed, hidden, zh, onToggle, onReturn, onSelect }: {
  context: ReaderSearchContext; title: string; messages: ConversationMessage[]; hits: ReaderSearchHit[]; selectedId?: string; collapsed: boolean; hidden?: boolean; zh: boolean; onToggle: () => void; onReturn: () => void; onSelect: (hit: ReaderSearchHit) => void;
}) {
  const [filter, setFilter] = useState("");
  const byId = useMemo(() => new Map(messages.map(message => [message.id, message])), [messages]);
  if (hidden) return null;
  const needle = filter.trim().normalize("NFKC").toLocaleLowerCase();
  const rows = hits.flatMap(hit => {
    const message = byId.get(hit.messageId);
    if (!message) return [];
    const label = hitPreview(hit, message);
    return !needle || label.normalize("NFKC").toLocaleLowerCase().includes(needle) ? [{ hit, label }] : [];
  });
  return <aside className={`conversation-sidebar is-question-navigation reader-search-outline${collapsed ? " is-collapsed" : ""}`} aria-label={zh ? "命中目录" : "Search matches"}>
    <div className="conversation-sidebar-top">{!collapsed ? <ReaderBackButton onClick={onReturn} label={zh ? "返回原目录" : "Original outline"} /> : null}<ReaderSidebarToggle zh={zh} collapsed={collapsed} onToggle={onToggle} /></div>
    {!collapsed ? <>
      <div className="conversation-outline-intro"><h2 title={title}>{title}</h2></div>
      <label className="conversation-outline-search"><Search size={16}/><input aria-label={zh ? "筛选命中" : "Filter matches"} placeholder={context.query} value={filter} onChange={event => setFilter(event.target.value)}/></label>
      <div className="conversation-outline-list">
        <div className="conversation-message-list">
          <div className="conversation-question-heading"><span>{zh ? "命中目录" : "Search matches"}</span><span className="conversation-question-count">{rows.length}</span></div>
          <ol className="reader-search-matches">{rows.map(({ hit, label }, index) => <li key={hit.messageId}>
            <button className={`conversation-message-item${selectedId === hit.messageId ? " is-current" : ""}`} type="button" aria-current={selectedId === hit.messageId ? "location" : undefined} onClick={() => onSelect(hit)} title={historySearchSnippet(label, context.query)}>
              <span className="message-number">{String(index + 1).padStart(2, "0")}</span>
              <span className="message-list-copy"><small><HistorySearchText text={label} query={context.query}/></small></span>
            </button>
          </li>)}</ol>
          {!rows.length ? <p className="conversation-question-empty" role="status">{zh ? hits.length ? "没有匹配的结果" : "命中原文已变化，请重新搜索。" : hits.length ? "No filtered matches" : "Matches changed. Search again."}</p> : null}
        </div>
      </div>
    </> : null}
  </aside>;
}
