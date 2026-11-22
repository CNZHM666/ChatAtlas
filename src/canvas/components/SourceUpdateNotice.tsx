import { RefreshCw, X } from "lucide-react";
import { ledgerDecisionsPending } from "../../ai/wiki-key-decisions";
import { hasSourceChange, sourceChangeLabels, type SourceChange } from "../source-freshness";
import type { Conversation } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import { sourceMessageSignature } from "../../shared/source-signature";
import { useNoticeDismissal } from "../../shared/use-notice-dismissal";
import { wikiUnitChapterHomes } from "../../shared/wiki-chapter-links";

function decisionChanges(session: FocusSession | undefined, chapterId?: string) {
  const ledger = session?.wikiKnowledge;
  if (!ledger?.draft || !ledgerDecisionsPending(ledger)) return;
  const since = ledger.draft.generatedAt;
  const receipts = Object.entries(ledger.decisionArbitrations ?? {}).filter(([, entry]) => entry.at > since);
  const local = receipts.filter(([, entry]) => entry.locallyApplied);
  const units = new Set(Object.entries(ledger.decisions ?? {}).filter(([id, verdict]) => verdict.at > since
    && !local.some(([, entry]) => entry.at === verdict.at && entry.unitIds?.includes(id))).map(([id]) => id));
  for (const answer of ledger.userAnswers ?? []) if (answer.at > since && !local.some(([id]) => id === answer.questionId)) {
    for (const id of answer.unitIds) units.add(id);
  }
  const homes = wikiUnitChapterHomes(ledger.organization);
  const chapterIds = new Set([...units].map(id => homes.get(id)));
  const unapplied = receipts.filter(([, entry]) => !entry.locallyApplied);
  for (const [, entry] of unapplied) if (entry.chapterId) chapterIds.add(session?.wikiSectionAliases?.[entry.chapterId] ?? entry.chapterId);
  if (local.length && !units.size && !unapplied.length) return;
  const chapters = session?.sections.filter(section => chapterIds.has(section.id)
    || section.claims?.some(claim => claim.unitIds?.some(id => units.has(id)))) ?? [];
  if (chapterId && !chapters.some(chapter => chapter.id === chapterId)) return;
  return { revision: ledger.decisionsAt, titles: [...new Set(chapters.map(chapter => chapter.wikiDisplayTitle || chapter.title))] };
}

export function SourceUpdateNotice({ changes, conversations, zh, onUpdate, updateLabel, session, overview = false, decisionChapterId, disabled = false }: {
  changes: SourceChange[]; conversations: Conversation[]; zh: boolean; onUpdate: () => void; updateLabel?: string; session?: FocusSession;
  overview?: boolean; decisionChapterId?: string; disabled?: boolean;
}) {
  const { dismissedRevision, rememberDismissal } = useNoticeDismissal();
  const changed = changes.filter(hasSourceChange);
  const pending = decisionChapterId ? [] : [...new Set(session?.sidecarConversationIds ?? [])].filter(id => !session?.sourceConversationIds.includes(id));
  const decisions = overview || decisionChapterId ? decisionChanges(session, decisionChapterId) : undefined;
  if (!changed.length && !pending.length && !decisions) return null;
  const key = `atlas-workspace-source-update:${session?.canvasId ?? session?.rootSessionId ?? session?.id ?? ""}${decisionChapterId ? `:${decisionChapterId}` : ""}`;
  const revision = sourceMessageSignature(JSON.stringify([
    session?.id, pending.slice().sort(), decisions?.revision,
    changed.map(item => [item.conversationId, item.fingerprint ?? sourceChangeLabels(item, false)])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  ]));
  if (dismissedRevision(key) === revision) return null;
  if (decisionChapterId) return <button type="button" className="wiki-decision-source" disabled={disabled} onClick={onUpdate}>
    <RefreshCw size={13} aria-hidden="true"/>{zh ? "预览正文更新" : "Preview article update"}
  </button>;
  const totals = changed.reduce((sum, item) => ({
    added: sum.added + item.added, changed: sum.changed + item.changed, removed: sum.removed + item.removed,
    reordered: sum.reordered || Boolean(item.reordered),
  }), { added: 0, changed: 0, removed: 0, reordered: false });
  const summary = [
    pending.length ? zh ? `${pending.length} 条新关联对话待整理` : `${pending.length} linked chats to organize` : "",
    ...sourceChangeLabels(totals, zh),
    decisions ? zh ? "已保存的决定待写入正文" : "Saved decisions need to be applied" : "",
  ].filter(Boolean).join(" · ");
  const titleOf = (id: string) => conversations.find(item => item.id === id)?.title ?? session?.evidence.find(item => item.conversationId === id)?.title ?? id;
  const chapterLabels = (titles: string[]) => zh ? `涉及章节：${titles.join("、")}` : `Affected chapters: ${titles.join(", ")}`;
  const action = pending.length ? zh ? "选择材料" : "Choose sources"
    : overview ? zh ? "开始更新" : "Start update" : zh ? "预览更新" : "Preview update";
  return <aside className="source-update-notice">
    <div className="source-update-row">
      <RefreshCw className="source-update-icon" size={16} aria-hidden="true"/>
      <div className="source-update-copy" role="status">
        <strong>{pending.length ? zh ? "项目有新材料" : "New project material" : zh ? "检测到改动" : "Changes detected"}</strong>
        <span>{summary}</span>
      </div>
      <div className="source-update-controls">
        <button type="button" className="source-update-action" disabled={disabled} onClick={onUpdate}>
          {updateLabel ?? action}
        </button>
        <button type="button" className="source-update-dismiss" aria-label={zh ? "关闭更新提醒" : "Dismiss source update"}
          title={zh ? "关闭提醒" : "Dismiss notice"} onClick={() => rememberDismissal(key, revision)}><X size={15} aria-hidden="true"/></button>
      </div>
    </div>
    <ul className="source-update-details">
      {pending.map(id => <li key={id}><span>{titleOf(id)}</span><small>{zh ? "待纳入 Wiki" : "Ready to add to the Wiki"}</small></li>)}
      {changed.map(item => {
        const details = changed.length > 1 ? sourceChangeLabels(item, zh) : [];
        if (item.affectedChapterTitles?.length) {
          details.push(chapterLabels(item.affectedChapterTitles));
        }
        return <li key={item.conversationId}>
          <span>{titleOf(item.conversationId)}</span>
          {details.length ? <small>{details.join(" · ")}</small> : null}
        </li>;
      })}
      {decisions && <li><span>{zh ? "整理决定" : "Project decisions"}</span><small>{decisions.titles.length ? chapterLabels(decisions.titles) : zh ? "Wiki 正文" : "Wiki article"}</small></li>}
    </ul>
  </aside>;
}
