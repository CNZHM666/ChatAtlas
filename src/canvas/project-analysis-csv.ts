import type { FocusSession } from "../shared/focus-session";
import { analyzeOrganizationRuns, organizationAnalysisCsv } from "../ai/usage-analysis";
import { getDatabase } from "../storage/db";
import { listDeletedProjects } from "../storage/project-deletion";
import type { wikiQualityCsvMetrics } from "../shared/wiki-quality-metrics";

export type ProjectAnalysisTarget = Pick<FocusSession, "runId" | "sourceConversationIds"> & {
  quality?: { sessionId: string; updatedAt: number; metrics: ReturnType<typeof wikiQualityCsvMetrics> };
};

/** This project's generation runs as the analysis CSV the settings export writes for every task: the run that wrote
 * the saved version, and the other runs over the same conversations, newest first (an evaluation reads the first
 * row as the latest run). Undefined when the project has no run on record. */
export async function projectAnalysisCsv(session: ProjectAnalysisTarget): Promise<string | undefined> {
  const db = await getDatabase();
  const [current, related] = await Promise.all([
    session.runId ? db.get("organizationRuns", session.runId) : undefined,
    session.sourceConversationIds.length ? db.getAllFromIndex("organizationRuns", "by-source", session.sourceConversationIds[0]) : [],
  ]);
  const runs = [...new Map([...(current ? [current] : []), ...related].map(run => [run.id, run])).values()];
  const sources = [...new Set(session.sourceConversationIds)].sort().join("\u0000");
  const own = runs.filter(run => run.id === session.runId || sources && run.targetType === "conversation" && !run.diagnosticOnly && [...new Set(run.targetIds)].sort().join("\u0000") === sources && run.pipelineSpans?.some(span => span.feature === "wiki"));
  if (!own.length) return undefined;
  const [data, deleted] = await Promise.all([Promise.all(own.map(run => Promise.all([
    db.getAllFromIndex("aiUsageEvents", "by-run", run.id), db.getAllFromIndex("analysisDiagnostics", "by-run", run.id), db.getAllFromIndex("focusSessions", "by-run", run.id),
  ]))), listDeletedProjects()]);
  const deletedIds = new Set(deleted.map(project => project.id));
  const events = data.flatMap(([items]) => items).sort((a, b) => b.createdAt - a.createdAt);
  const diagnostics = data.flatMap(([, items]) => items).sort((a, b) => b.createdAt - a.createdAt);
  const focus = data.flatMap(([, , items]) => items).filter(item => !item.deletedAt && !item.ledgerTest && (!item.canvasId || !deletedIds.has(item.canvasId))).sort((a, b) => b.updatedAt - a.updatedAt);
  const rows = analyzeOrganizationRuns(own, events, diagnostics, focus, { preparedQuality: session.quality });
  return rows.length ? organizationAnalysisCsv(rows) : undefined;
}
