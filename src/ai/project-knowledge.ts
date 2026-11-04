import type { FocusSession } from "../shared/focus-session";
import { projectAnalysisScopeSignature, projectStateSignature, legacyProjectStateSignature, type ProjectState } from "../shared/project-state";
import { sourceMessageSignature } from "../shared/source-signature";
import { projectProofBlocks } from "../shared/atlas/project-knowledge.js";
import { validateProjectDraft } from "./project-output";
import type { ProjectOriginalSource } from "./project-sources";
import { wikiQuoteRange } from "../shared/wiki-claims";

/** Reuse reviewed Wiki interpretations as navigation; the cited original remains the proof. */
export function reusableWikiNavigation(session: FocusSession, originals: ProjectOriginalSource[]) {
  return session.sections.filter(section => !section.origin && !section.userEdited && !section.reviewIssue && section.evidenceReview?.status === "verified").flatMap(section => {
    const claims = (section.claims ?? []).filter(claim => claim.verification === "supported").flatMap(claim => {
      const evidenceIds = claim.evidenceIds.filter(id => {
        const source = originals.find(source => source.id === id);
        return source && section.evidenceIds.includes(id) && session.sourceSignatures?.[source.conversationId]?.[source.messageId] === source.signature && session.sourceRoles?.[source.conversationId]?.[source.messageId] === source.role && wikiQuoteRange(source.text, claim.quote);
      });
      return evidenceIds.length ? [{ text: claim.text, quote: claim.quote, evidenceIds }] : [];
    });
    return claims.length ? [{ sectionId: section.id, title: section.title, claims }] : [];
  });
}

/** A fully verified unchanged analysis can be returned without repeating extraction or review. */
export function reusableProjectState(session: FocusSession, originals: ProjectOriginalSource[], kind?: "architecture" | "decisions") {
  const state = session.projectState;
  if (!state || state.verification !== "original" || !state.summary.trim() || state.reviewNotes?.some(note => note.category !== "merge_recovery") || !state.sources?.length || !originals.length || originals.some(source => source.partial)) return;
  if (kind && state.analyzedParts && !state.analyzedParts.includes(kind)) return;
  const signature=kind?state.partSignatures?.[kind]??state.signature:state.signature,currentSignature=projectStateSignature(session);
  if (signature !== currentSignature&&signature!==legacyProjectStateSignature(session)) return;
  const identity = (source: { conversationId: string; messageId: string }) => JSON.stringify([source.conversationId, source.messageId]);
  const saved = new Map(state.sources.map(source => [identity(source), source])), current = new Map(originals.map(source => [identity(source), source]));
  if (saved.size !== current.size || [...current].some(([id, source]) => {
    const old = saved.get(id);
    return !old || old.signature !== source.signature || old.role !== source.role || old.messageIndex !== source.messageIndex || old.discussedAt !== source.discussedAt;
  })) return;
  try {
    const validated = validateProjectDraft(state, originals, session);
    if (validated.reviewNotes?.length) return;
    return state.signature===currentSignature?state:{...state,signature:currentSignature,partSignatures:state.partSignatures?Object.fromEntries(Object.entries(state.partSignatures).map(([part,value])=>[part,value===signature?currentSignature:value])):undefined};
  } catch { return; }
}

export function projectKnowledgeSignature(session: Pick<FocusSession, "scope" | "sourceConversationIds" | "sourceSignatures" | "sourceRoles" | "sourceMessageOrder">) {
  return sourceMessageSignature(JSON.stringify([1, session.scope, session.sourceConversationIds, session.sourceSignatures, session.sourceRoles, session.sourceMessageOrder]));
}
export const projectKnowledgeScopeSignature = (session: Pick<FocusSession, "scope"|"goal">) => sourceMessageSignature(JSON.stringify([session.goal,session.scope ?? { kind: "all" }]));

/** A verified architecture already covered its old originals; unchanged passages can seed a later update. */
function retainedArchitectureFacts(session: FocusSession, originals: ProjectOriginalSource[], kind?: "architecture" | "decisions" | "history") {
  const state = session.projectState;
  if (kind === "history" || !state || state.verification !== "original" || !state.sources?.length || state.reviewNotes?.some(note => note.category !== "merge_recovery")) return [];
  if (state.analysisScopeSignature ? state.analysisScopeSignature !== projectAnalysisScopeSignature(session) : state.signature !== projectStateSignature(session)) return [];
  if (state.analyzedParts && (kind ? !state.analyzedParts.includes(kind) : !["architecture", "decisions"].every(part => state.analyzedParts!.includes(part as "architecture" | "decisions")))) return [];
  if (kind && state.partSignatures?.[kind] && state.partSignatures[kind] !== state.signature) return [];
  const unchanged = originals.filter(source => !source.partial && state.sources!.some(old => old.id === source.id && old.conversationId === source.conversationId && old.messageId === source.messageId && old.signature === source.signature && old.role === source.role && old.messageIndex === source.messageIndex && old.discussedAt === source.discussedAt));
  if (!unchanged.length) return [];
  const ids = new Set(unchanged.map(source => source.id));
  const supported = (item: { evidenceIds: string[] }) => item.evidenceIds.length > 0 && item.evidenceIds.every(id => ids.has(id));
  const modules = state.modules.filter(supported), moduleIds = new Set(modules.map(module => module.id));
  const facts = { ...state, modules, relations: state.relations.filter(edge => supported(edge) && moduleIds.has(edge.from) && moduleIds.has(edge.to)), decisions: state.decisions.filter(supported), constraints: state.constraints.filter(supported), actions: [], questions: state.questions?.filter(supported), history: [] };
  try { const checked = validateProjectDraft(facts, unchanged, session); return checked.reviewNotes?.length ? [] : [{ sourceIds: [...ids], facts: checked }]; } catch { return []; }
}
/** Resolve immutable original ranges locally, avoiding copied quote/ID errors. */
export function resolveProjectProofs(value: unknown, sources: Array<{ id: string; text: string }>): unknown {
  const proofs = new Map<string, { start: number; end: number; text: string; id: string }>(sources.flatMap(source => projectProofBlocks(source.text).map((block, index) => [`${source.id}:${index + 1}`, { ...block, id: source.id }] as const)));
  const visit = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(visit);
    if (!input || typeof input !== "object") return input;
    const row = Object.fromEntries(Object.entries(input).map(([key, field]) => [key, visit(field)]));
    for (const prefix of ["", "before", "reason", "confirmation"]) {
      const field = (name: string) => prefix ? `${prefix}${name[0].toUpperCase()}${name.slice(1)}` : name;
      const keys = row[field("quoteKeys")] ?? (row[field("quoteKey")] ? [row[field("quoteKey")]] : undefined);
      if (!Array.isArray(keys) || !keys.length || keys.length > 2 || keys.some(key => typeof key !== "string" || !proofs.has(key))) continue;
      const ranges = keys.map(key => proofs.get(key as string)!);
      if (ranges.some((range, index) => range.id !== ranges[0].id || index > 0 && ranges[index - 1].end !== range.start)) continue;
      let quote = ranges.map(range => range.text).join("");
      if (ranges[0].start === 0) quote = quote.replace(/^(?:user|assistant|system|tool): /u, "");
      if (!quote.trim() || quote.length > 350) continue;
      row[field("quote")] = quote.trim(); row[prefix ? `${prefix}EvidenceIds` : "evidenceIds"] = [ranges[0].id];
    }
    return row;
  };
  return visit(value);
}
/** Optional facts never reject a usable Wiki; failed batches remain repairable. */
export function readProjectKnowledge(value: unknown, sources: Array<{ id: string; text: string; role?: string; conversationId?: string; messageId?: string; messageIndex?: number; discussedAt?: number }>): ProjectState | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  // A passage ID names an evidence slice, never a conversation or message. Only
  // passages carrying their real message identity can prove a later confirmation;
  // older notes without it stay isolated instead of borrowing a guessed order.
  const original: ProjectOriginalSource[] = sources.map(source => {
    const known = Boolean(source.conversationId && source.messageId && source.messageIndex !== undefined);
    return { id: source.id, text: source.text, conversationId: known ? source.conversationId! : source.id, messageId: known ? source.messageId! : source.id, role: (source.role ?? source.text.match(/^(user|assistant|system|tool): /u)?.[1]) as ProjectOriginalSource["role"], messageIndex: known ? source.messageIndex : undefined, ...(known && source.discussedAt ? { discussedAt: source.discussedAt } : {}), signature: sourceMessageSignature(source.text), partial: true };
  });
  const basis: FocusSession = { id: "reading-facts", mode: "work", title: "", goal: "", sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 0, updatedAt: 0, sourceConversationIds: [...new Set(original.map(source => source.conversationId))], evidence: original.map(source => ({ id: source.id, conversationId: source.conversationId, messageId: source.messageId, title: "", excerpt: "" })) };
  const row = resolveProjectProofs(value, sources) as Record<string, unknown>;
  if (["modules", "relations", "decisions", "constraints", "history"].some(field => !Array.isArray(row[field]))) return;
  const normalize = (field: string) => Array.isArray(row[field]) ? (row[field] as Record<string, unknown>[]).map(item => ({ ...item, reason: item.reason ?? "", ...(field === "history" ? { version: item.version ?? "", before: item.before ?? "", beforeQuote: item.beforeQuote ?? "", beforeEvidenceIds: item.beforeEvidenceIds ?? [], reasonQuote: item.reasonQuote ?? "", reasonEvidenceIds: item.reasonEvidenceIds ?? [] } : {}) })) : [];
  try { return validateProjectDraft({ ...row, summary: typeof row.summary === "string" && row.summary.trim() ? row.summary : "项目讨论", modules: normalize("modules"), relations: normalize("relations"), decisions: normalize("decisions"), constraints: normalize("constraints"), questions: normalize("questions"), history: normalize("history"), actions: [] }, original, basis); }
  catch { return; }
}
/** Current raw messages are the authority for reusing derived facts. */
export function reusableProjectKnowledge(session: FocusSession, originals: ProjectOriginalSource[], kind?: "architecture" | "decisions" | "history") {
  const cache = session.projectKnowledge;
  if (!cache || cache.version !== 1 || !Array.isArray(cache.batches) || cache.batches.some(batch => !batch || !Array.isArray(batch.sourceIds) || !batch.sourceIds.length || batch.sourceIds.some(id => typeof id !== "string"))) {const retained=retainedArchitectureFacts(session, originals, kind);return retained.length?retained:undefined;}
  const legacyCurrent = cache.signature === projectKnowledgeSignature(session);
  if(!legacyCurrent&&!cache.batches.some(batch=>batch.sources)){const retained=retainedArchitectureFacts(session, originals, kind);return retained.length?retained:undefined;}
  const retained = cache.batches.map(batch => {
    const sources = originals.filter(source => batch.sourceIds.includes(source.id));
    if (batch.sources ? batch.scopeSignature !== projectKnowledgeScopeSignature(session) || batch.sources.length !== sources.length || batch.sources.some(old => !sources.some(source => old.id === source.id && old.conversationId === source.conversationId && old.messageId === source.messageId && old.signature === source.signature && old.role === source.role && old.messageIndex === source.messageIndex && old.discussedAt === source.discussedAt)) : !legacyCurrent) return { ...batch, facts: undefined };
    if (!batch.facts || batch.sourceIds.some(id => !sources.some(source => source.id === id))) return { ...batch, facts: undefined };
    if (sources.some(source => session.sourceSignatures?.[source.conversationId]?.[source.messageId] !== source.signature || session.sourceRoles?.[source.conversationId]?.[source.messageId] !== source.role)) return { ...batch, facts: undefined };
    try { const facts = validateProjectDraft(batch.facts, sources, session); return { sourceIds: batch.sourceIds, facts: facts.reviewNotes?.length || batch.facts.reviewNotes?.length ? undefined : {...facts,...(batch.facts.matterAnalysisVersion===1?{matterAnalysisVersion:1 as const}:{})} }; }
    catch { return { ...batch, facts: undefined }; }
  });
  // Old caches cannot establish a changed baseline; a verified saved plan can still cover unrelated originals.
  const covered = new Set(retained.filter(batch => batch.facts).flatMap(batch => batch.sourceIds));
  const additional = retainedArchitectureFacts(session, originals.filter(source => !covered.has(source.id)), kind);
  const restored = new Set(additional.flatMap(batch => batch.sourceIds));
  return [...retained.filter(batch => batch.facts || !batch.sourceIds.every(id => restored.has(id))), ...additional];
}
