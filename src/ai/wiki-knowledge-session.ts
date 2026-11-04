import type { FocusSession } from "../shared/focus-session";
import type { WikiKnowledgeLedger, WikiProgressFn } from "../shared/wiki-knowledge";
import type { StructuredAIRequest } from "./provider";
import { getConversation } from "../storage/conversations";
import { loadFullReadingPassages } from "./focus-source-text";
import { scopedFocusPassages } from "./focus-scope";
import { coverageMaterials } from "./focus-coverage";
import { measureAILocalStep } from "./pipeline-timing";
import { extractWikiKnowledge, type WikiKnowledgeReport } from "./wiki-knowledge-units";
import { organizeLedger } from "./wiki-knowledge-organize";
import { writeLedgerDraft } from "./wiki-knowledge-write";

type AI = { generateStructured?: <T>(request: StructuredAIRequest<T>) => Promise<T> };

/** Redesign P1 again on a saved document: the same sources and scope as its
 * generation, without rewriting the Wiki. The new ledger has no organization
 * or draft, since both were built from the units it replaces. With previous,
 * batches whose material is unchanged keep their units. */
export async function reextractSessionKnowledge(session: FocusSession, ai: AI, signal: AbortSignal, previous?: WikiKnowledgeLedger, progress?: WikiProgressFn): Promise<WikiKnowledgeLedger> {
  const sources = (await Promise.all(session.sourceConversationIds.map(id => getConversation(id)))).filter(source => source !== undefined);
  if (!sources.length || sources.length < session.sourceConversationIds.length) throw new Error("Some source conversations are no longer stored");
  const loaded = await loadFullReadingPassages(sources, signal);
  if (loaded.missing) throw new Error("Some source conversations have no local text");
  const passages = session.scope ? scopedFocusPassages(loaded.passages, session.scope) : loaded.passages;
  const included = new Set(passages.map(passage => passage.document.conversationId));
  const report: Partial<WikiKnowledgeReport> = {};
  const work = async () => { const result = await extractWikiKnowledge({ materials: coverageMaterials(passages, sources.filter(source => included.has(source.id))).materials, locale: session.locale ?? "zh-CN", signal, ai, previous, project: session.wikiProjectBoundary?.name ?? session.title, progress }); Object.assign(report, result.report); return result.ledger; };
  return session.runId ? measureAILocalStep(session.runId, "wiki", "wiki:knowledge-units", work, () => ({ ...report } as Record<string, number>)) : work();
}

/** Redesign P4: bring a saved ledger up to date with its sources. Unchanged batches,
 * subjects, merges, directory and chapters are kept; only new or changed material
 * is read, organized and written. */
export async function updateSessionKnowledge(session: FocusSession, ai: AI, signal: AbortSignal, options: { names: Array<string | undefined>; project?: string; progress?: WikiProgressFn }): Promise<WikiKnowledgeLedger> {
  const previous = session.wikiKnowledge, locale = session.locale ?? "zh-CN", runId = session.runId;
  const extracted = await reextractSessionKnowledge(session, ai, signal, previous, options.progress);
  const organized = await organizeLedger(extracted, { ai, locale, signal, runId, names: options.names, conversations: session.sourceConversationIds.length, previous: previous?.organization, progress: options.progress });
  // Organizing failed: the new batches are kept with the earlier directory and draft, nothing is written.
  if (organized.lastFailure?.step === "organize" && !organized.organization) return { ...organized, ...(previous?.organization ? { organization: previous.organization } : {}), ...(previous?.draft ? { draft: previous.draft } : {}) };
  return writeLedgerDraft(organized, { ai, locale, signal, runId, project: options.project, previous: previous?.draft, progress: options.progress });
}
