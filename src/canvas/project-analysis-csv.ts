import type { FocusSession } from "../shared/focus-session";
import { analyzeOrganizationRuns, organizationAnalysisCsv } from "../ai/usage-analysis";
import { listAnalysisDiagnostics } from "../ai/semantic-analysis";
import { listOrganizationRuns } from "../storage/organization-runs";
import { listAIUsage } from "../storage/ai-usage";
import { listFocusSessions } from "../storage/focus-sessions";

/** This project's generation runs as the analysis CSV the settings export writes for every task: the run that wrote
 * the saved version, and the other runs over the same conversations, newest first (an evaluation reads the first
 * row as the latest run). Undefined when the project has no run on record. */
export async function projectAnalysisCsv(session: FocusSession): Promise<string | undefined> {
  const [runs, events, diagnostics, focus] = await Promise.all([listOrganizationRuns(), listAIUsage(), listAnalysisDiagnostics(), listFocusSessions()]);
  const sources = [...new Set(session.sourceConversationIds)].sort().join("\u0000");
  const own = runs.filter(run => run.id === session.runId || run.targetType === "conversation" && !run.diagnosticOnly && [...new Set(run.targetIds)].sort().join("\u0000") === sources && run.pipelineSpans?.some(span => span.feature === "wiki"));
  if (!own.length) return undefined;
  const rows = analyzeOrganizationRuns(own, events, diagnostics, focus).sort((a, b) => b.run.startedAt - a.run.startedAt);
  return rows.length ? organizationAnalysisCsv(rows) : undefined;
}
