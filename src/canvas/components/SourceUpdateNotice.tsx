import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { hasSourceChange, sourceChangeLabels, type SourceChange } from "../source-freshness";
import type { Conversation } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";

export function SourceUpdateNotice({ changes, conversations, zh, onUpdate, updateLabel, session }: { changes: SourceChange[]; conversations: Conversation[]; zh: boolean; onUpdate: () => void; updateLabel?: string; session?: FocusSession }) {
  const [details, setDetails] = useState(false);
  const detailsId = useId();
  const changed = changes.filter(hasSourceChange);
  const pending = [...new Set(session?.sidecarConversationIds ?? [])].filter(id => !session?.sourceConversationIds.includes(id));
  if (!changed.length && !pending.length) return null;
  const totals = changed.reduce((sum, item) => ({
    added: sum.added + item.added, changed: sum.changed + item.changed, removed: sum.removed + item.removed,
    reordered: sum.reordered || Boolean(item.reordered),
  }), { added: 0, changed: 0, removed: 0, reordered: false });
  const summary = [
    pending.length ? zh ? `${pending.length} 条新关联对话待整理` : `${pending.length} linked chats to organize` : "",
    ...sourceChangeLabels(totals, zh),
  ].filter(Boolean).join(" · ");
  return <aside className="source-update-notice">
    <div className="source-update-row">
      <span className="source-update-dot" aria-hidden="true"/>
      <div className="source-update-copy" role="status">
        <strong>{pending.length ? zh ? "项目有新材料" : "New project material" : zh ? "来源有更新" : "Sources changed"}</strong>
        <span>{summary}</span>
      </div>
      <div className="source-update-controls">
        <button type="button" className="source-update-detail" aria-expanded={details} aria-controls={detailsId} onClick={() => setDetails(open => !open)}>
          {zh ? "明细" : "Details"}<ChevronDown size={14} aria-hidden="true"/>
        </button>
        <button type="button" className="source-update-action" onClick={onUpdate}>
          {updateLabel ?? (pending.length ? zh ? "选择材料" : "Choose sources" : zh ? "预览更新" : "Preview update")}
        </button>
      </div>
    </div>
    <ul id={detailsId} className="source-update-details" hidden={!details}>
      {pending.map(id => <li key={id}><span>{conversations.find(item => item.id === id)?.title ?? id}</span><small>{zh ? "待纳入 Wiki" : "Ready to add to the Wiki"}</small></li>)}
      {changed.map(item => <li key={item.conversationId}>
        <span>{conversations.find(conversation => conversation.id === item.conversationId)?.title ?? item.conversationId}</span>
        <small>{sourceChangeLabels(item, zh).join(" · ")}</small>
        {item.affectedChapterTitles?.length ? <small>{zh ? "涉及章节：" : "Affected chapters: "}{item.affectedChapterTitles.join(" · ")}</small> : null}
      </li>)}
    </ul>
  </aside>;
}
