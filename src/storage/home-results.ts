import type { FocusSession } from "../shared/focus-session";
import type { HistoryCandidate } from "../search/home-history";
import { getDatabase } from "./db";

export interface HomeAnswerResult {
  kind?: "answer";
  id: string;
  question: string;
  topicGoal: string;
  poolIds: string[];
  answer: FocusSession;
  createdAt: number;
  previousId?: string;
}
export interface HomeActivity {
  id: string;
  kind: "search" | "discovery";
  question: string;
  topicGoal: string;
  poolIds: string[];
  createdAt: number;
  status: "started" | "completed" | "failed";
  matchCount?: number;
  capped?: boolean;
  candidates?: HistoryCandidate[];
}
/** Existing answers keep their shape; activities use the same store without a schema migration. */
export type HomeResult = HomeAnswerResult | HomeActivity;
/** Local records only. Originals and projects are never overwritten. */
export async function saveHomeResult(record: HomeResult, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  const db = await getDatabase(); signal?.throwIfAborted();
  const tx = db.transaction("homeResults", "readwrite");
  const cancel = () => { try { tx.abort(); } catch { /* Already committed. */ } };
  signal?.addEventListener("abort", cancel, { once: true });
  try { await tx.store.put(record); await tx.done; } finally { signal?.removeEventListener("abort", cancel); }
}
export async function listHomeResults(): Promise<HomeResult[]> {
  return (await (await getDatabase()).getAll("homeResults")).sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
}

export async function listHiddenHistorySessionIds(): Promise<string[]> {
  return (await (await getDatabase()).getAll("focusSessions")).filter(session => session.historyHiddenAt).map(session => session.id);
}

/** Clear the reviewed snapshot, retaining documents and records created meanwhile. */
export async function clearHomeHistory(recordIds: string[], sessionIds: string[]): Promise<void> {
  const db = await getDatabase(), tx = db.transaction(["homeResults", "focusSessions"], "readwrite");
  const now = Date.now();
  for (const id of new Set(recordIds)) await tx.objectStore("homeResults").delete(id);
  for (const id of new Set(sessionIds)) {
    const session = await tx.objectStore("focusSessions").get(id);
    if (session) await tx.objectStore("focusSessions").put({ ...session, historyHiddenAt: now });
  }
  await tx.done;
}
