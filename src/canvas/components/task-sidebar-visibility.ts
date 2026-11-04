import type { OrganizationRun } from "../../shared/types";

/** Instrumentation records describe AI calls; they are never resumable jobs. */
export function isPendingOrganizationTask(run:OrganizationRun):boolean {
  return !run.diagnosticOnly && ["queued","running","waiting_review","failed"].includes(run.status);
}
