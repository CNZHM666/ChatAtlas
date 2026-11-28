import type { ProjectAnswer, ProjectIncrement, ProjectIncrementResume } from "../sidecar/project-increment";
import type { FocusSession } from "../shared/focus-session";
import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import type { WikiProgress } from "../shared/wiki-knowledge";
import type { ProjectUpdateLogEntry } from "../sidecar/project-update-log";
import { getDatabase } from "./db";
import type { SourceVersion } from "./source-versions";

export interface SidecarReviewChoices {
  choices: Record<number, "include" | "decide" | "approve_edit">;
  destinations: Record<number, string>;
  answers: Record<number, ProjectAnswer>;
  questionIndices: number[];
  questionIndex?: number;
  answerChoice?: number | "custom";
  answerDraft: string;
  useOutline: boolean;
}

export interface SidecarUpdateDraft {
  id: string;
  revision: string;
  projectId: string;
  conversationId: string;
  title: string;
  updatedAt: number;
  batchRun?: ProjectIncrementResume["batchRun"];
  smallerBatches?: boolean;
  initialRun?: SidecarFirstRun;
  initialLog?: ProjectUpdateLogEntry[];
  initialDocument?: { project: FocusSession; document: FocusSession; version: SourceVersion };
  preview?: Omit<ProjectIncrement, "directoryError"> & { directoryError?: boolean };
  review?: SidecarReviewChoices;
}

export interface SidecarFirstRun {
  key: string;
  id: string;
  ledger?: WikiKnowledgeLedger;
  confirmed?: boolean;
  input?: { project: FocusSession; version: SourceVersion; zh: boolean };
  state?: "running" | "confirming" | "paused" | "failed";
  progress?: Pick<WikiProgress, "stage" | "done" | "total">;
  partial?: FocusSession;
  error?: string;
}

export const sidecarFirstRunActive = (draft: SidecarUpdateDraft) =>
  (draft.initialRun?.state === "running" || draft.initialRun?.state === "confirming") && Date.now() - draft.updatedAt < 90_000;

export const sidecarDraftId = (projectId: string, conversationId: string) => JSON.stringify([projectId, conversationId]);

export async function listSidecarDrafts(projectId: string) {
  return (await (await getDatabase()).getAllFromIndex("sidecarUpdateDrafts", "by-project", projectId)).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSidecarDraft(draft: SidecarUpdateDraft, expected?: string) {
  const tx = (await getDatabase()).transaction("sidecarUpdateDrafts", "readwrite");
  const current = await tx.store.get(draft.id);
  if (current?.revision !== expected) throw new Error("Sidecar draft changed");
  await tx.store.put(draft);
  await tx.done;
}

export async function discardSidecarDraft(draft: SidecarUpdateDraft) {
  const tx = (await getDatabase()).transaction("sidecarUpdateDrafts", "readwrite");
  if ((await tx.store.get(draft.id))?.revision !== draft.revision) throw new Error("Sidecar draft changed");
  await tx.store.delete(draft.id);
  await tx.done;
}

/** Update the same run without overwriting decisions edited in either interface. */
export async function updateSidecarFirstRun(id: string, runId: string, update: (run: SidecarFirstRun, draft: SidecarUpdateDraft) => Partial<SidecarUpdateDraft>) {
  const tx = (await getDatabase()).transaction("sidecarUpdateDrafts", "readwrite");
  const draft = await tx.store.get(id);
  if (!draft?.initialRun || draft.initialRun.id !== runId) { await tx.done; return undefined; }
  const next = { ...draft, ...update(draft.initialRun, draft), revision: crypto.randomUUID(), updatedAt: Date.now() };
  await tx.store.put(next);
  await tx.done;
  return next;
}
