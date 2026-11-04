import { Check } from "lucide-react";
import type { OrganizationRun } from "../../shared/types";

export function TaskProgressMark({ run }: { run: OrganizationRun }) {
  if (run.status === "waiting_review") return <span className="task-status-glyph" aria-hidden="true">◇</span>;
  if (run.status === "completed") return <Check size={15} aria-hidden="true" />;
  if (run.status === "failed") return <span className="task-status-glyph" aria-hidden="true">!</span>;
  if (run.status === "cancelled") return <span className="task-status-glyph" aria-hidden="true">×</span>;
  if (run.status === "queued") return <span className="task-status-glyph" aria-hidden="true">○</span>;
  return <span className="task-status-glyph task-status-running" aria-hidden="true">●</span>;
}
