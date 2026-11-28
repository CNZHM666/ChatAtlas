import type { ProviderRequestDiagnostics } from "./provider-transport";

export interface WorkbenchRequestActivity {
  operationId: string;
  operation: string;
  modelId: string;
  attempt: number;
  startedAt: number;
  state: "waiting" | "validating" | "finished";
  diagnostics?: ProviderRequestDiagnostics;
  excerpt?: string;
  outputLength?: number;
}

const recordedRuns = new Map<string, WorkbenchRequestActivity[]>();

/** The open workbench owns this recording. Model text is kept only in memory. */
export function keepWorkbenchRunActivity(runId: string) {
  const records = recordedRuns.get(runId) ?? [];
  recordedRuns.set(runId, records);
  return () => { if (recordedRuns.get(runId) === records) recordedRuns.delete(runId); };
}

export function workbenchRunActivity(runId: string) {
  return (recordedRuns.get(runId) ?? []).map(item => ({ ...item }));
}

export function startWorkbenchRequest(runId: string, initial: Omit<WorkbenchRequestActivity, "state">) {
  const records = recordedRuns.get(runId);
  if (!records) return undefined;
  const entry: WorkbenchRequestActivity = { ...initial, state: "waiting" };
  records.push(entry);
  while (records.length > 16) {
    const finished = records.findIndex(record => record.state === "finished");
    if (finished < 0) break;
    records.splice(finished, 1);
  }
  return entry;
}
