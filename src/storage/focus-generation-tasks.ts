import type { FocusMode, FocusScope } from "../shared/focus-session";
import type { FocusAnalysisProgress } from "../shared/focus-progress";
import { getDatabase } from "./db";
import type { AIUsageEvent } from "../shared/types";
import {focusTaskResult} from "../shared/focus-task-result";

export interface FocusGenerationTask {
  id: string; runId: string; goal: string; mode: FocusMode; sourceIds: string[];
  scope?: FocusScope; scopeCanvasId?: string;
  status: "running" | "paused" | "failed" | "preview";
  progress?: FocusAnalysisProgress; errorCode?: string; sessionId?: string;
  /** Old versions logged batches but did not persist the user's goal/scope. */
  needsConfirmation?: boolean;
  createdAt: number; updatedAt: number;
}
const changed = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-focus-tasks-changed")); };

export async function listFocusGenerationTasks(): Promise<FocusGenerationTask[]> {
  const db=await getDatabase(),tx=db.transaction(["focusGenerationTasks","focusSessions"],"readonly");
  const tasks=await tx.objectStore("focusGenerationTasks").index("by-updated").getAll();
  // Progress refreshes must not reload every full Wiki. New saves complete the
  // job atomically; only old unresolved explicit result IDs need a lookup here.
  const ids=[...new Set(tasks.flatMap(task=>task.status!=="preview"&&task.sessionId?[task.sessionId]:[]))];
  const sessions=(await Promise.all(ids.map(id=>tx.objectStore("focusSessions").get(id)))).filter((session):session is NonNullable<typeof session>=>Boolean(session));
  await tx.done;
  // Recover a missed task-status write from the saved result, including legacy
  // results linked by sessionId. Never guess completion from project similarity.
  return tasks.reverse().map(task=>{
    const result=focusTaskResult(task,sessions);
    return result?{...task,status:"preview" as const,sessionId:result.id,errorCode:undefined}:task;
  });
}

export async function recoverLegacyFocusTasks(): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(["focusGenerationTasks", "aiUsageEvents", "focusSessions", "organizationRuns"], "readwrite");
  const [tasks, events, sessions, runs] = await Promise.all([tx.objectStore("focusGenerationTasks").getAll(), tx.objectStore("aiUsageEvents").getAll(), tx.objectStore("focusSessions").getAll(), tx.objectStore("organizationRuns").getAll()]);
  const known = new Set([...tasks.map(task => task.runId), ...sessions.map(session => session.runId), ...runs.map(run => run.id)]);
  const groups = new Map<string, AIUsageEvent[]>();
  for (const event of events) if (event.taskType === "focus_session" && event.runId && !known.has(event.runId)) {
    const group = groups.get(event.runId) ?? []; group.push(event); groups.set(event.runId, group);
  }
  for (const [runId, group] of groups) {
    if (group.some(event => event.stage?.endsWith(":final") && event.status !== "failed")) continue;
    const latest = group.reduce((a, b) => a.createdAt >= b.createdAt ? a : b);
    const sourceIds = [...new Set(group.flatMap(event => event.conversationIds))];
    if (!sourceIds.length) continue;
    await tx.objectStore("focusGenerationTasks").put({ id: runId, runId, goal: "", mode: "review", sourceIds, status: latest.status === "failed" ? "failed" : "paused", needsConfirmation: true, errorCode: latest.errorCode, createdAt: Math.min(...group.map(event => event.createdAt)), updatedAt: latest.createdAt });
  }
  await tx.done; changed();
}

export async function beginFocusGenerationTask(input: Omit<FocusGenerationTask, "status" | "createdAt" | "updatedAt">): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction("focusGenerationTasks", "readwrite");
  const previous = await tx.store.get(input.id);
  await tx.store.put({ ...input, status: "running", createdAt: previous?.createdAt ?? Date.now(), updatedAt: Date.now() });
  await tx.done; changed();
}

export async function updateFocusGenerationTask(id: string, patch: Partial<Pick<FocusGenerationTask, "status" | "progress" | "errorCode" | "sessionId">>): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction("focusGenerationTasks", "readwrite");
  const task = await tx.store.get(id);
  // A delayed progress/cleanup callback must not hide a completed preview.
  if (task && task.status !== "preview" && !(task.status === "failed" && patch.status === "paused")) await tx.store.put({ ...task, ...patch, updatedAt: Date.now() });
  await tx.done; changed();
}
