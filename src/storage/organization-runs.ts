import type { OrganizationRun } from "../shared/types";
import { getDatabase } from "./db";

export async function saveOrganizationRun(run: OrganizationRun): Promise<void> {
  const db = await getDatabase();
  const transaction = db.transaction("organizationRuns", "readwrite");
  const existing = await transaction.store.get(run.id);
  const pipelineSpans=[...new Map([...(existing?.pipelineSpans??[]),...(run.pipelineSpans??[])].map(span=>[span.id,span])).values()];
  await transaction.store.put({ ...run, executionStartedAt:run.executionStartedAt??existing?.executionStartedAt,firstReadableAt:run.firstReadableAt??existing?.firstReadableAt, ...(pipelineSpans.length?{pipelineSpans}:{}), evaluation: run.evaluation ?? existing?.evaluation });
  await transaction.done;
}

export async function getOrganizationRun(id: string): Promise<OrganizationRun | undefined> {
  return (await getDatabase()).get("organizationRuns", id);
}

export async function listOrganizationRuns(): Promise<OrganizationRun[]> {
  return (await (await getDatabase()).getAllFromIndex("organizationRuns", "by-updated")).reverse();
}

export async function saveOrganizationEvaluation(id: string, score: number | undefined, note: string): Promise<OrganizationRun> {
  const db = await getDatabase();
  const transaction = db.transaction("organizationRuns", "readwrite");
  const run = await transaction.store.get(id);
  if (!run) throw new Error("Organization task not found");
  const evaluation = score === undefined && !note.trim() ? undefined : { score: score ?? 0, note: note.trim().slice(0, 300) };
  const updated = { ...run, evaluation };
  await transaction.store.put(updated);
  await transaction.done;
  return updated;
}
