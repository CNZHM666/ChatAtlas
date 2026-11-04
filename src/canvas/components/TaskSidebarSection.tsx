import {isPendingOrganizationTask} from "./task-sidebar-visibility";
import type { OrganizationRun } from "../../shared/types";
import { usePreferences } from "../preferences";
import { TaskProgressMark } from "./TaskProgressMark";
import { organizationStepPosition } from "../../organize/organization-task";

export function TaskSidebarSection({ runs, activeId, onSelect }: { runs: OrganizationRun[]; activeId: string | null; onSelect: (id: string) => void; onHistory?: () => void }) {
  const { locale } = usePreferences();
  const priority: Record<OrganizationRun["status"], number> = { waiting_review: 0, failed: 1, running: 2, queued: 3, completed: 4, cancelled: 5 };
  const visible = runs.filter(isPendingOrganizationTask)
    .sort((a, b) => priority[a.status] - priority[b.status] || b.updatedAt - a.updatedAt).slice(0, 3);
  if (!visible.length) return null;
  return <section className="task-sidebar-section" aria-label={locale === "zh-CN" ? "任务" : "Tasks"}>
    <h2>{locale === "zh-CN" ? "任务" : "Tasks"}</h2>
    {visible.map((run) => <button type="button" key={run.id} className={`task-sidebar-row ${activeId === run.id ? "active" : ""}`} onClick={() => onSelect(run.id)} title={run.title}><TaskProgressMark run={run} /><span>{run.title}</span><small>{run.status === "running" ? `${organizationStepPosition(run).current}/${organizationStepPosition(run).total}` : run.status === "queued" ? locale === "zh-CN" ? "等待中" : "Queued" : run.status === "waiting_review" ? locale === "zh-CN" ? "待审核" : "Review" : run.status === "failed" ? run.errorCode === "DEMO_BUDGET_EXHAUSTED" ? locale === "zh-CN" ? "额度不足" : "Budget low" : locale === "zh-CN" ? "需处理" : "Attention" : ""}</small></button>)}
  </section>;
}
