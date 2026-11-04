import { statementEvidence, confirmsProposal } from "./statement-evidence";
import { evolutionAnalysis } from "./product-evolution";
import type { FocusSession, FocusEvidence } from "./focus-session";
import { projectHistoryProofs, type ProjectHistoryEvent } from "./project-state";
import { projectHistorySignature } from "./project-history";
import { sourceMessageSignature } from "./source-signature";
import { wikiQuoteRange } from "./wiki-claims";
import type { ConversationMessage } from "./types";
import { compareHistoryPositions, historyTime, type HistoryPosition } from "./history-order";
import { historyReplacementTargets, historyStateKey, productReleaseKey } from "./project-history-links";
import { productReleaseEvents } from "./product-releases";
import {projectSubjectGroups,projectSubjectKey} from "./project-subjects";
export { productReleaseKey } from "./project-history-links";

export const evolutionKinds = { adopt: ["采用", "Adopted"], add: ["新增", "Added"], change: ["调整", "Changed"], retire: ["放弃", "Retired"] } as const;
export const evolutionStateKey = historyStateKey;
export interface EffectiveEvolution { event: ProjectHistoryEvent; evidence: FocusEvidence[]; previous: ProjectHistoryEvent[] }

/** Explicit subject identity, scoped originals and user approval; never 'newest mention wins'. */
export function effectiveProjectEvolution(session: FocusSession, messages: ConversationMessage[]): EffectiveEvolution[] {
  const analysis = evolutionAnalysis(session) ?? session.projectHistoryAnalysis;
  if (!analysis || ![4, 5, 6].includes(analysis.version) || analysis.signature !== projectHistorySignature(session)) return [];
  const pool = new Set(session.sourceConversationIds), originals = new Map(messages.map(message => [message.id, message]));
  const refs = [...session.evidence, ...analysis.evidence];
  const proofRefs = (quote: string, ids: string[]) => ids.flatMap(id => {
    const ref = refs.find(ref => ref.id === id), raw = ref && originals.get(ref.messageId);
    const signature = ref?.sourceSignature ?? analysis.sources.find(source => source.id === ref?.id)?.signature ?? (ref && session.sourceSignatures?.[ref.conversationId]?.[ref.messageId]);
    const saved = analysis.sources.find(source => source.id === ref?.id);
    return ref && raw && pool.has(ref.conversationId) && raw.conversationId === ref.conversationId &&
      (session.scope?.kind !== "goal" || session.scope.blocks?.some(block => block.conversationId === raw.conversationId && block.messageIds.includes(raw.id))) &&
      signature === sourceMessageSignature(raw.content) && (!saved || saved.role === raw.role && (saved.messageIndex === undefined || saved.messageIndex === raw.messageIndex) && (saved.discussedAt === undefined || saved.discussedAt === raw.createdAt)) && wikiQuoteRange(raw.content, quote) ? [{ ...ref, excerpt: quote }] : [];
  });
  const position = (ref: FocusEvidence): HistoryPosition | undefined => {
    const raw = originals.get(ref.messageId)!;
    if (!Number.isFinite(raw.messageIndex)) return;
    return { conversationId: raw.conversationId, messageId: raw.id, messageIndex: raw.messageIndex,
      offset: wikiQuoteRange(raw.content, ref.excerpt)?.start, discussedAt: raw.createdAt };
  };
  const proofValid = (quote: string, ids: string[]) => !quote || proofRefs(quote, ids).length > 0;
  const subjects=projectSubjectGroups(analysis.events.filter(event=>proofRefs(event.quote,event.evidenceIds).length&&!session.projectMaintenance?.evolutionEvents?.[event.id]?.edited&&!session.projectMaintenance?.evolutionEvents?.[event.id]?.hidden));
  const subject=(event:ProjectHistoryEvent)=>projectSubjectKey(event,subjects);
  const releaseMaintenance = new Map(analysis.version===5?productReleaseEvents(session,true).map(release=>[release.id,release]):[]);
  const maintained = (event: ProjectHistoryEvent) => releaseMaintenance.get(productReleaseKey(event.version));
  const byArea = new Map<string, Array<EffectiveEvolution & { position: HistoryPosition }>>();
  const blockedAreas = new Set<string>();
  for (const event of analysis.events) {
    if (event.recordKind&&event.recordKind!=="event" || !event.area?.trim() || !event.changeKind || event.status !== "documented" || event.decisionStatus !== "confirmed") continue;
    if(analysis.kind==="evolution"&&(session.projectMaintenance?.evolutionEvents?.[event.id]?.hidden||session.projectMaintenance?.evolutionEvents?.[event.id]?.edited)){blockedAreas.add(subject(event));continue;}
    const maintenance = maintained(event);
    if (maintenance && (maintenance.hidden || maintenance.editedFields.some(field => field !== "version"))) { blockedAreas.add(subject(event)); continue; }
    const evidence = proofRefs(event.quote, event.evidenceIds), stagePosition = evidence[0] && position(evidence[0]);
    const directUser = evidence.some(ref => originals.get(ref.messageId)?.role === "user" && statementEvidence(originals.get(ref.messageId)!.content,event.quote).decision);
    const approvals = event.confirmationQuote ? proofRefs(event.confirmationQuote, event.confirmationEvidenceIds ?? []).filter(ref => originals.get(ref.messageId)?.role === "user" && (compareHistoryPositions(position(ref), stagePosition) ?? -1) > 0 && evidence.some(proof=>confirmsProposal(originals.get(ref.messageId)!,event.confirmationQuote!,originals.get(proof.messageId)!,event.quote))) : [];
    const effectivePosition = approvals[0] ? position(approvals[0]) : directUser ? stagePosition : undefined;
    if (!effectivePosition || event.confirmationQuote && !approvals.length || analysis.version === 5 && (!event.version || !wikiQuoteRange(event.quote, event.version)) || !projectHistoryProofs(event).every(proof => proofValid(proof.quote, proof.evidenceIds))) { blockedAreas.add(subject(event)); continue; }
    for (const proof of projectHistoryProofs(event)) for (const ref of proofRefs(proof.quote, proof.evidenceIds)) {
      if (!evidence.some(item => item.id === ref.id && item.excerpt === ref.excerpt)) evidence.push(ref);
    }
    const list = byArea.get(subject(event)) ?? [];
    list.push({ event, evidence, previous: [], position: effectivePosition });
    byArea.set(subject(event), list);
  }
  return [...byArea.values()].flatMap(items => {
    if (blockedAreas.has(subject(items[0].event))) return [];
    // Different conversations with unknown dates cannot be put into a trustworthy final order.
    if (new Set(items.map(item => item.position.conversationId)).size > 1 && items.some(item => historyTime(item.position.discussedAt) === undefined)) return [];
    if (items.some((item, index) => items.slice(0, index).some(other => compareHistoryPositions(item.position, other.position) === undefined))) return [];
    items.sort((a, b) => compareHistoryPositions(a.position, b.position) ?? 0);
    const latest = items.at(-1)!;
    const unresolved = analysis.events.some(event => subject(event) === subject(latest.event) && event.status === "uncertain" && event.id !== latest.event.id && !maintained(event));
    if (unresolved) return [];
    const active: EffectiveEvolution[] = [];
    for (const item of items) {
      const targets = historyReplacementTargets(item.event, active.map(previous => previous.event));
      const replacements = active.filter(previous => targets.includes(previous.event));
      if (replacements.some(previous => {
        const earlier = items.find(entry => entry.event.id === previous.event.id);
        return !earlier || (compareHistoryPositions(item.position, earlier.position) ?? 0) <= 0;
      })) return [];
      // An unresolvable replacement remains visible in history, but cannot silently rewrite current context.
      if ((item.event.changeKind === "change" || item.event.changeKind === "retire") && active.length && !replacements.length) return [];
      if (item.event.changeKind === "adopt" && active.some(previous => previous.event.changeKind !== "retire")) return [];
      for (const replacement of replacements) active.splice(active.indexOf(replacement), 1);
      active.push({ event: item.event, evidence: item.evidence, previous: replacements.flatMap(previous => [...previous.previous, previous.event]) });
    }
    // Additions are cumulative. Explicit replacements/retirements remove only the matching previous state.
    return active;
  });
}
