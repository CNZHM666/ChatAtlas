import type { Conversation, ConversationMessage } from "../shared/types";
import type { HistoryCandidate } from "../search/home-history";
import { getDatabase } from "./db";
import { cacheAIResult } from "./ai-result-cache";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiQuoteRange } from "../shared/wiki-claims";

const poolKey = (sources: Conversation[], zh: boolean, goal = "") => sourceMessageSignature(JSON.stringify([2, zh, sources.slice().sort((a,b) => b.updatedAt-a.updatedAt).slice(0,80).map(source => [source.id,source.title,source.rawRevision,source.sourceRevision,source.updatedAt,source.messageCount,source.hydrationState,source.importState]), ...(goal.trim()?[goal.trim()]:[])]));
const revision = (rows: ConversationMessage[]) => sourceMessageSignature(JSON.stringify(rows.slice().sort((a,b) => a.messageIndex-b.messageIndex).map(row => [row.id,row.role,row.messageIndex,row.createdAt,row.updatedAt,row.content,row.uiParts])));
async function sourceSnapshots(ids: string[]) {
  const db = await getDatabase(), tx = db.transaction(["messages", "conversations"], "readonly");
  const snapshots = await Promise.all(ids.map(async id => ({id, conversation: await tx.objectStore("conversations").get(id), messages: await tx.objectStore("messages").index("by-conversation").getAll(id)})));
  await tx.done;
  return new Map(snapshots.map(snapshot => [snapshot.id,snapshot]));
}
export async function historyDiscoveryRevisions(ids: string[]) {
  return Object.fromEntries([...(await sourceSnapshots(ids))].map(([id,snapshot]) => [id, revision(snapshot.messages)]));
}
/** Recheck original references before restoring or using a recommendation. Never generate replacement proof. */
export async function currentHomeDiscoveries(sources: Conversation[], candidates: HistoryCandidate[]): Promise<HistoryCandidate[]> {
  const shape = candidates.filter(candidate => candidate && candidate.basis === "recommendation" && typeof candidate.title === "string" && ["project","review"].includes(candidate.kind) && Array.isArray(candidate.sourceIds) && new Set(candidate.sourceIds).size >= 2 && candidate.sourceIds.every(id => typeof id === "string" && sources.some(source => source.id === id)) && Array.isArray(candidate.evidence));
  const snapshots = await sourceSnapshots([...new Set(shape.flatMap(candidate => candidate.sourceIds))]);
  return shape.flatMap(candidate => {
    if (candidate.sourceIds.some(id => !snapshots.get(id)?.conversation || candidate.sourceRevisions?.[id] && candidate.sourceRevisions[id] !== revision(snapshots.get(id)!.messages))) return [];
    const evidence = candidate.evidence!.filter(ref => {
      if (!ref || typeof ref.id !== "string" || typeof ref.title !== "string" || !candidate.sourceIds.includes(ref.conversationId) || typeof ref.messageId !== "string" || typeof ref.excerpt !== "string" || !ref.excerpt.trim() || !ref.sourceSignature) return false;
      const message = snapshots.get(ref.conversationId)?.messages.find(row => row.id === ref.messageId);
      return Boolean(message && ref.sourceSignature === sourceMessageSignature(message.content) && wikiQuoteRange(message.content, ref.excerpt));
    });
    return candidate.sourceIds.every(id => evidence.some(ref => ref.conversationId === id)) ? [{...candidate,evidence}] : [];
  });
}
export async function saveHomeDiscoveries(sources: Conversation[], candidates: HistoryCandidate[], zh: boolean, goal = "") {
  const grounded = await currentHomeDiscoveries(sources,candidates);
  // Only snapshots captured before analysis may be cached; don't stamp stale results with fresh signatures.
  const cacheable = grounded.filter(candidate => candidate.sourceIds.every(id => candidate.sourceRevisions?.[id]));
  if (!cacheable.length) return;
  const key = poolKey(sources,zh,goal);
  await cacheAIResult({id:`home-discovery:${key}`,taskType:"decision",inputHash:key,analysisVersion:2,providerId:"home-discovery",modelId:"verified-sources",createdAt:Date.now(),result:{candidates:cacheable}});
}
export async function readHomeDiscoveries(sources: Conversation[], zh: boolean, goal = ""): Promise<HistoryCandidate[]> {
  if (sources.length < 2) return [];
  const row = await (await getDatabase()).get("semanticDecisionCache",`home-discovery:${poolKey(sources,zh,goal)}`);
  const saved = row?.result as {candidates?:HistoryCandidate[]}|undefined;
  if (!Array.isArray(saved?.candidates)) return [];
  return currentHomeDiscoveries(sources,saved.candidates);
}
