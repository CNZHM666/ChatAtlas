import type { FocusSession } from "../../shared/focus-session";
import { groupFocusVersions } from "../focus-versions";
import { FolderOpen } from "lucide-react";

export function RelatedProjects({ sessions, zh, onOpen, compact = false }: { sessions: FocusSession[]; zh: boolean; onOpen: (id: string) => void; compact?: boolean }) {
  const byProject = new Map<string, FocusSession>();
  for (const { latest } of groupFocusVersions(sessions.filter(session => session.canvasId && session.status !== "preview"))) {
    if (latest.canvasId && !byProject.has(latest.canvasId)) byProject.set(latest.canvasId, latest);
  }
  const projects = [...byProject.values()];
  if (!projects.length) return null;
  const label = zh ? "查看项目" : "View project";
  const groupLabel = zh ? `关联项目 ${projects.length}` : `${projects.length} related projects`;
  if (projects.length === 1) return <button className={`source-project-link${compact ? " is-compact" : ""}`} type="button" aria-label={label} title={compact ? `${label} · ${projects[0].title}` : projects[0].title} onClick={() => onOpen(projects[0].id)}>{compact ? <FolderOpen size={17} aria-hidden="true" /> : label}</button>;
  return <details className={`source-project-picker${compact ? " is-compact" : ""}`}><summary aria-label={groupLabel} title={groupLabel}>{compact ? <><FolderOpen size={17} aria-hidden="true" /><span aria-hidden="true">{projects.length}</span></> : groupLabel}</summary><div>{projects.map(project => <button type="button" key={project.id} onClick={() => onOpen(project.id)}>{project.title}</button>)}</div></details>;
}
