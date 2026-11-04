import type { OrganizationRun } from "../../shared/types";
import { usePreferences } from "../preferences";
import { WorkspaceBackButton } from "./WorkspaceBackButton";

const statuses = {
  queued: ["Queued", "等待中"], running: ["Running", "进行中"], waiting_review: ["Review", "待确认"],
  completed: ["Completed", "已完成"], failed: ["Failed", "未完成"], cancelled: ["Cancelled", "已取消"],
} as const;

export function OrganizationHistory({ runs, onBack, onSelect }: { runs: OrganizationRun[]; onBack: () => void; onSelect: (id: string) => void }) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const date = new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" });
  return <section className="organization-workspace organization-history">
    <WorkspaceBackButton className="organization-back" onClick={onBack} />
    <main className="organization-main"><div className="organization-reading">
      <header className="organization-header"><h1>{zh ? "整理历史" : "Organization history"}</h1></header>
      <div className="organization-history-list">
        {runs.map((run) => <button type="button" key={run.id} onClick={() => onSelect(run.id)}>
          <span className="organization-history-title">{run.title}</span>
          <small><time dateTime={new Date(run.startedAt).toISOString()}>{date.format(run.startedAt)}</time> · {statuses[run.status][zh ? 1 : 0]}</small>
        </button>)}
        {!runs.length ? <p className="organization-history-empty">{zh ? "还没有整理记录" : "No organization tasks yet"}</p> : null}
      </div>
    </div></main>
  </section>;
}
