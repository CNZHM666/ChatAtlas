import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ConversationMessage } from "./types";
import { sourceMessageSignature } from "./source-signature";

export interface KnowledgeFact {
  id: string; sectionId: string; topic: string; text: string; quote: string;
  status: "discussed" | "proposal" | "uncertain" | "superseded";
  sources: Array<{ conversationId: string; messageId: string; signature: string; role: string; sourceVersionId?: string }>;
}
export interface KnowledgeIndex {
  id: string; revision: string; facts: KnowledgeFact[];
  dependencies: Record<string, string[]>; updatedAt: number;
}
export const canonicalTopic = (title: string) => title.normalize("NFKC").toLocaleLowerCase().replace(/^(?:\d+[.、\s]+|第.+?章\s*)/u, "").replace(/[\s\p{P}]/gu, "");
export function knowledgeRevision(session: FocusSession): string {
  return sourceMessageSignature(JSON.stringify([3, session.scope, session.sourceSignatures, session.sourceVersionIds, session.evidence, session.sections.map(section => [section.id, section.wikiOriginalTitle ?? section.title, section.body, section.claims, section.evidenceIds, section.userEdited, section.origin]), session.projectState, session.projectHistoryAnalysis]));
}
/** Schema is derived from quote-verified Raw/Wiki anchors, never an alternative original. */
export function buildKnowledgeIndex(session: FocusSession, messages: ConversationMessage[]): KnowledgeIndex {
  const originals = new Map(messages.map(message => [JSON.stringify([message.conversationId, message.id]), message]));
  const refs = new Map([...session.evidence, ...(session.projectHistoryAnalysis?.evidence ?? [])].map(ref => [ref.id, ref]));
  const dependencies: Record<string, string[]> = {}, facts: KnowledgeFact[] = [];
  const normalize = (text: string) => text.replace(/\s+/gu, " ").trim();
  const anchors = (ids: string[], quote: string) => ids.flatMap(id => {
    const ref = refs.get(id), message = ref && originals.get(JSON.stringify([ref.conversationId, ref.messageId]));
    if (!ref || !message || !quote.trim() || !normalize(message.content).includes(normalize(quote))) return [];
    const signature = sourceMessageSignature(message.content);
    if (ref.sourceSignature && signature !== ref.sourceSignature) return [];
    return [{ conversationId: message.conversationId, messageId: message.id, signature, role: message.role, sourceVersionId: ref.sourceVersionId }];
  });
  for (const section of session.sections) {
    dependencies[section.id] = [...new Set(section.evidenceIds.flatMap(id => { const ref = refs.get(id); return ref ? [JSON.stringify([ref.conversationId, ref.messageId])] : []; }))];
    if (section.userEdited || section.origin === "user") continue;
    for (const claim of section.claims ?? []) {
      const sources = anchors(claim.evidenceIds.filter(id => section.evidenceIds.includes(id)), claim.quote);
      if (sources.length) facts.push({ id: sourceMessageSignature(JSON.stringify([section.id, claim.text, claim.quote, sources])), sectionId: section.id, topic: canonicalTopic(section.wikiOriginalTitle ?? section.title), text: claim.text, quote: claim.quote, status: claim.verification === "uncertain" || section.kind === "open_question" ? "uncertain" : section.kind === "proposal" ? "proposal" : "discussed", sources });
    }
  }
  if (session.projectState?.verification === "original") {
    const state = session.projectState;
    const records = [
      ...state.modules.map(item => ({ ...item, text: `${item.title}: ${item.purpose}`, topic: canonicalTopic(item.title) })),
      ...state.decisions.map(item => ({ ...item, topic: "decision" })),
      ...state.constraints.map(item => ({ ...item, topic: "constraint" })),
      ...(state.questions ?? []).map(item => ({ ...item, topic: "open-question" })),
    ];
    for (const record of records) {
      const sources = anchors(record.evidenceIds, record.quote);
      const sectionId = session.sections.find(section => section.evidenceIds.some(id => record.evidenceIds.includes(id)))?.id;
      if (!sources.length || !sectionId) continue;
      if (facts.some(fact => fact.text === record.text && fact.quote === record.quote)) continue;
      facts.push({ id: `project:${record.id}`, sectionId, topic: record.topic, text: record.text, quote: record.quote, status: record.status === "documented" ? "discussed" : record.status, sources });
    }
  }
  const history = session.projectHistoryAnalysis?.events ?? (session.projectState?.verification === "original" ? session.projectState.history ?? [] : []);
  for (const event of history) {
    const records = [{ id: event.id, text: `${event.version} ${event.after}`.trim(), quote: event.quote, evidenceIds: event.evidenceIds },
      ...(event.before ? [{ id: `${event.id}:before`, text: event.before, quote: event.beforeQuote, evidenceIds: event.beforeEvidenceIds }] : []),
      ...(event.additions ?? []).map((item, i) => ({ ...item, id: `${event.id}:added:${i}` })),
      ...(event.modifications ?? []).map((item, i) => ({ ...item, id: `${event.id}:modified:${i}` })),
      ...(event.reasonQuote ? [{ id: `${event.id}:reason`, text: event.reason, quote: event.reasonQuote, evidenceIds: event.reasonEvidenceIds ?? [] }] : [])];
    for (const record of records) {
      const sources = anchors(record.evidenceIds, record.quote);
      const sectionId = session.sections.find(section => section.evidenceIds.some(id => sources.some(source => refs.get(id)?.conversationId === source.conversationId && refs.get(id)?.messageId === source.messageId)))?.id;
      if (!sources.length || !sectionId) continue;
      facts.push({ id: `project:${record.id}`, sectionId, topic: "version-history", text: record.text, quote: record.quote, status: event.status === "documented" ? "discussed" : event.status, sources });
      dependencies[sectionId] = [...new Set([...dependencies[sectionId], ...sources.map(source => JSON.stringify([source.conversationId, source.messageId]))])];
    }
  }
  return { id: session.id, revision: knowledgeRevision(session), facts, dependencies, updatedAt: Date.now() };
}

export function factEvidence(fact: KnowledgeFact, evidence: FocusEvidence[]): FocusEvidence[] {
  return evidence.filter(ref => fact.sources.some(source => source.conversationId === ref.conversationId && source.messageId === ref.messageId));
}
