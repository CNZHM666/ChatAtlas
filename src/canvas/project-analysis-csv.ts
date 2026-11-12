import type { FocusSession } from "../shared/focus-session";
import { analyzeOrganizationRuns, organizationAnalysisCsv } from "../ai/usage-analysis";
import { listAnalysisDiagnostics } from "../ai/semantic-analysis";
import { listOrganizationRuns } from "../storage/organization-runs";
import { listAIUsage } from "../storage/ai-usage";
import { listFocusSessions } from "../storage/focus-sessions";

export type ProjectAnalysisTarget = Pick<FocusSession, "runId" | "sourceConversationIds">;

/** This project's generation runs as the analysis CSV the settings export writes for every task: the run that wrote
 * the saved version, and the other runs over the same conversations, newest first (an evaluation reads the first
 * row as the latest run). Undefined when the project has no run on record. */
export async function projectAnalysisCsv(session: ProjectAnalysisTarget): Promise<string | undefined> {
  const runs = await listOrganizationRuns();
  const sources = [...new Set(session.sourceConversationIds)].sort().join("\u0000");
  const own = runs.filter(run => run.id === session.runId || sources && run.targetType === "conversation" && !run.diagnosticOnly && [...new Set(run.targetIds)].sort().join("\u0000") === sources && run.pipelineSpans?.some(span => span.feature === "wiki"));
  if (!own.length) return undefined;
  const ids = new Set(own.map(run => run.id));
  const belongs = (item: {runId?: string}) => item.runId !== undefined && ids.has(item.runId);
  const [events, diagnostics, focus] = await Promise.all([listAIUsage(), listAnalysisDiagnostics(), listFocusSessions()]);
  // The shared analyzer fills in missing runs from events. Scope its inputs before
  // it can synthesize unrelated runs or render their saved documents.
  const rows = analyzeOrganizationRuns(own, events.filter(belongs), diagnostics.filter(belongs), focus.filter(belongs));
  return rows.length ? organizationAnalysisCsv(rows) : undefined;
}
