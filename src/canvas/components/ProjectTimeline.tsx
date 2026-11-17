import { useEffect, useState } from "react";
import { ambiguousEvidenceVersion, evidenceSnapshotKey, evidenceVersion } from "../../shared/evidence-identity";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { historyTime, orderHistoryMessages } from "../../shared/history-order";
import { projectMilestoneLabel, projectTimeline, type ProjectMilestone } from "../../shared/project-timeline";
import { sourceMessageSignature } from "../../shared/source-signature";
import type { ConversationMessage } from "../../shared/types";
import { wikiQuoteRange } from "../../shared/wiki-claims";
import { readSessionSource } from "../../storage/source-versions";
import { useProjectReadingCache } from "../project-reading-cache";
import { readWikiTimeline } from "../wiki-reading-background";
import { ReaderGuide } from "./ReaderGuide";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";

async function dateMilestones(session: FocusSession, milestones: ProjectMilestone[]) {
  const versions = new Map<string, Promise<ConversationMessage[]>>();
  const dated = await Promise.all(milestones.map(async item => {
    const ref = item.source;
    if (item.discussedAt || ambiguousEvidenceVersion(session, ref)) return item;
    const version = evidenceVersion(session, ref);
    const key = evidenceSnapshotKey(session, ref);
    let messages = versions.get(key);
    if (!messages) {
      messages = readSessionSource(session, ref.conversationId, ref.messageId, version).catch(() => []);
      versions.set(key, messages);
    }
    const message = (await messages).find(message => message.id === ref.messageId || message.platformMessageId === ref.messageId);
    if (!message || (ref.sourceSignature && ref.sourceSignature !== sourceMessageSignature(message.content))
      || !wikiQuoteRange(message.content, ref.excerpt)) return item;
    return { ...item, messageIndex: message.messageIndex, discussedAt: historyTime(message.sourceCreatedAt) };
  }));
  return orderHistoryMessages(dated);
}

export function ProjectTimeline({ session, prepared, zh, onLocate }: {
  session: FocusSession; prepared?: ProjectMilestone[]; zh: boolean; onLocate: (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;
}) {
  const cache = useProjectReadingCache();
  const basis = cache.get(session, "timeline-basis", () => ({ session }));
  const [dated, setDated] = useState<{ basis: typeof basis; items: ProjectMilestone[] }>();
  useEffect(() => {
    const source = basis.session;
    if (source.mode !== "work" || source.wikiKnowledge?.documentType === "learning") return;
    let active = true;
    const requests = cache.get(source, "timeline-date-requests", () => new Map<ProjectMilestone[] | undefined, Promise<ProjectMilestone[]>>());
    let rows = requests.get(prepared);
    if (!rows) {
      rows = prepared ? dateMilestones(source, prepared)
        : Promise.resolve(readWikiTimeline(source)).then(items => dateMilestones(source, items ?? projectTimeline(source)));
      requests.set(prepared, rows);
    }
    void rows.then(items => {
      if (active) setDated(current => items.length || current ? { basis, items } : current);
    }).catch(() => undefined);
    return () => { active = false; };
  }, [basis, cache, prepared]);
  const items = dated?.basis === basis ? dated.items : [];
  const plan = session.projectMaintenance?.currentPlan?.trim();
  if (!items.length && !plan) return null;
  const format = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { year: "numeric", month: "short", day: "numeric" });
  return <>
    {items.length > 0 && <section className="document-timeline" aria-label={zh ? "产品演进" : "Product evolution"}>
      <h2>{zh ? "产品演进" : "Product evolution"}</h2>
      <ol>
        {items.map(({ id, source, text, status, discussedAt, relatedSources, reason }) => <li key={id} className={`is-${status}`}>
          <div className="document-timeline-meta">
            {discussedAt ? <time dateTime={new Date(discussedAt).toISOString()} title={zh ? "来源日期" : "Source date"}>{format.format(discussedAt)}</time>
              : <span>{zh ? "日期未记录" : "Date unavailable"}</span>}
            <span className="document-timeline-status">{projectMilestoneLabel(status, zh)}</span>
          </div>
          <p>{text} <button type="button" onClick={() => relatedSources?.length
            ? onLocate(source, { references: [source, ...relatedSources], mode: "view" })
            : onLocate(source)}>{relatedSources?.length
            ? zh ? `来源 ${relatedSources.length + 1}` : `Sources ${relatedSources.length + 1}`
            : zh ? "来源" : "Source"}</button></p>
          {reason && <p className="document-timeline-reason">{reason}</p>}
        </li>)}
      </ol>
    </section>}
    {plan && <details className="document-saved-plan">
      <summary>{zh ? "已保存的规划" : "Saved plan"}</summary>
      <ReaderGuide content={plan} zh={zh} complete/>
    </details>}
  </>;
}
