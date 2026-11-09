import { ledgerDecisionsPending } from "./wiki-key-decisions";
import {savedWikiProjectBoundary} from "../shared/wiki-project-boundary";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { FocusScope, FocusSession } from "../shared/focus-session";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";
import { getDatabase } from "../storage/db";
import { carryReviewNotes } from "../canvas/review-notes";
import { sourceChange } from "../canvas/source-freshness";
import { asLearningDocument, generateFocusSession, ledgerDocumentSession, requireLedgerDirectory } from "./focus-session";
import { learningUnitsOwn } from "./wiki-learning";
import { keptLearnerCode } from "./wiki-learning-code";
import { ledgerPipelineEnabled } from "./wiki-ledger-document";
import { datedSources, reextractSessionKnowledge, withStoredSections } from "./wiki-knowledge-session";
import { organizeLedger } from "./wiki-knowledge-organize";
import { writeLedgerDraft } from "./wiki-knowledge-write";
import { wikiLedgerUnits, type WikiProgress } from "../shared/wiki-knowledge";
import { readingTitle } from "../shared/reading-title";
import { mapSemanticEvidence } from "../shared/semantic-structure";
import { reconcileWikiTopics } from "./wiki-topic-update";
import { getMessagesForConversation } from "../storage/messages";
import { retainSourceVersions } from "../storage/source-versions";
import { loadKnowledgeIndex } from "../storage/knowledge-index";
import { autoOrganizeWiki,requireOrganizedWiki } from "./wiki-auto-organize";
import { embeddingsFor } from "./embedding-provider";
import { createAtlasAI } from "./atlas-ai";
import { effectiveAISettings } from "./ai-mode";
import { getAISettings } from "../storage/knowledge-graph";
import {editableWikiTopic} from "../shared/wiki-directory";
import {mergeWikiScopeReview} from "../shared/wiki-scope-review";
import {remapWikiClaimEvidence} from "../shared/wiki-source-reading";
import {consolidateWikiExplanations} from "./wiki-explanation-repair";
import { withWikiSources } from "../shared/wiki-sources";
import {previousWikiDirectory} from "./wiki-topic-plan";
import {WIKI_SEMANTIC_VERSION} from "../shared/wiki-explanations";

export interface FocusUpdatePlan { fallback: boolean; changed: boolean; affectedSectionIds: string[]; scope: FocusScope; removedKeys: string[]; addedConversationIds?: string[] }
const key = (conversationId: string, messageId: string) => JSON.stringify([conversationId, messageId]);

/** Revisit the changed chapter and subsequent discussion, including dependent corrections. */
export function planFocusUpdate(previous: FocusSession, input: ConversationMessage[]): FocusUpdatePlan {
  const messages = input.filter(item => item.content.trim() && !isInternalSearchQueryMessage(item)).sort((a, b) => a.messageIndex - b.messageIndex);
  const addedConversationIds = [...new Set(messages.map(item => item.conversationId))].filter(id => !previous.sourceConversationIds.includes(id));
  const changes = previous.sourceConversationIds.map(id => sourceChange(previous, id, messages.filter(item => item.conversationId === id)));
  const fallback = previous.scope?.kind === "goal" || previous.coverage?.method === "sampled" || !previous.coverage || changes.some(item => item.unknown) || previous.sourceConversationIds.some(id => !(previous.sourceMessageOrder?.[id] ?? previous.sourceOutlines?.find(outline => outline.conversationId === id)?.messageOrder) || !(previous.sourceRoles?.[id] ?? previous.sourceOutlines?.find(outline => outline.conversationId === id)?.messageRoles));
  const changed = fallback || addedConversationIds.length > 0 || changes.some(item => item.added || item.changed || item.removed || item.reordered);
  const selected = new Set<string>(), removedKeys: string[] = [];
  const blocks = [...previous.sourceConversationIds, ...addedConversationIds].flatMap(conversationId => {
    const current = messages.filter(item => item.conversationId === conversationId);
    const saved = previous.sourceSignatures?.[conversationId] ?? previous.sourceOutlines?.find(item => item.conversationId === conversationId)?.messageSignatures ?? {};
    const roles = previous.sourceRoles?.[conversationId];
    const removed = Object.keys(saved).filter(id => !current.some(item => item.id === id));
    removedKeys.push(...removed.map(id => key(conversationId, id)));
    const change = changes.find(item => item.conversationId === conversationId) ?? { added: current.length, changed: 0, removed: 0, reordered: false };
    if (!fallback && !change.added && !change.changed && !change.removed && !change.reordered) return [];
    let start = 0;
    if (!fallback && !change.reordered && previous.sourceMessageOrder?.[conversationId]) {
      const touched = current.filter(item => !Object.hasOwn(saved, item.id) || saved[item.id] !== sourceMessageSignature(item.content) || roles?.[item.id] !== undefined && roles[item.id] !== item.role).map(item => item.messageIndex);
      const oldOrder = previous.sourceMessageOrder[conversationId];
      for (const id of removed) { const next = oldOrder.slice(oldOrder.indexOf(id) + 1).find(candidate => current.some(item => item.id === candidate)); touched.push(next ? current.find(item => item.id === next)!.messageIndex : current.at(-1)?.messageIndex ?? 0); }
      start = Math.min(...touched);
      const chapters = previous.sourceOutlines?.find(item => item.conversationId === conversationId)?.chapters ?? [];
      const chapter = chapters.find(item => item.messageIds.some(id => { const position = current.find(message => message.id === id)?.messageIndex; return position !== undefined && position >= start; })) ?? chapters.at(-1);
      if (chapter) start = Math.min(start, ...chapter.messageIds.flatMap(id => { const item = current.find(message => message.id === id); return item ? [item.messageIndex] : []; }));
      // When no neutral chapter exists (short direct generation), retain the whole turn.
      const question = [...current].reverse().find(item => item.role === "user" && item.messageIndex <= start);
      if (question) start = Math.min(start, question.messageIndex);
    }
    const included = current.filter(item => item.messageIndex >= start);
    included.forEach(item => selected.add(key(conversationId, item.id)));
    return included.length ? [{ conversationId, title: "更新的讨论及后续上下文", messageIds: included.map(item => item.id), messageSignatures: Object.fromEntries(included.map(item => [item.id, sourceMessageSignature(item.content)])) }] : [];
  });
  const affected = new Set([...selected, ...removedKeys]);
  const affectedSectionIds = previous.sections.filter(section => fallback || previous.evidence.some(ref => section.evidenceIds.includes(ref.id) && affected.has(key(ref.conversationId, ref.messageId)))).map(section => section.id);
  return { fallback, changed, affectedSectionIds, scope: { kind: "goal", blocks }, removedKeys, addedConversationIds };
}

/** Whether a saved document already carries the current explanation semantics. */
export const wikiSemanticsCurrent=(session:FocusSession)=>session.mode!=="work"||session.wikiSemanticVersion===WIKI_SEMANTIC_VERSION;

/** Upgrade only during an explicitly requested update, preserving the exact
 * source scope. Reuses neutral notes; normal reading never schedules a rebuild. */
export function planWikiEditionUpdate(previous:FocusSession,messages:ConversationMessage[],plan:FocusUpdatePlan):FocusUpdatePlan {
  if(previous.mode!=="work"||previous.wikiEdition==="current-v2"&&previous.wikiMainlineVersion===1||previous.sections.every(section=>!editableWikiTopic(section)))return plan;
  return {...plan,changed:true,fallback:true,affectedSectionIds:previous.sections.map(section=>section.id),scope:{...plan.scope,kind:previous.scope?.kind??"all",blocks:[...new Set(messages.map(message=>message.conversationId))].map(conversationId=>({conversationId,title:"",messageIds:messages.filter(message=>message.conversationId===conversationId).map(message=>message.id),messageSignatures:Object.fromEntries(messages.filter(message=>message.conversationId===conversationId).map(message=>[message.id,sourceMessageSignature(message.content)]))}))}};
}

export function mergeFocusUpdate(previous: FocusSession, patch: FocusSession, plan: FocusUpdatePlan, input: ConversationMessage[], locale: string): FocusSession {
  const zh = locale === "zh-CN", affected = new Set(plan.affectedSectionIds), protectedSections = previous.sections.filter(section => previous.mode==="work"?!editableWikiTopic(section):section.origin === "user" || section.userEdited || section.structureEdited);
  const replaceable = previous.sections.filter(section => affected.has(section.id) && !protectedSections.includes(section));
  const prefix = `update:${patch.id}:`;
  // Namespaced provenance prevents different excerpt fragments sharing one ID.
  const evidenceMap = new Map(patch.evidence.map(ref => [ref.id, `${prefix}${ref.id}`]));
  const evidence = [...previous.evidence, ...patch.evidence.map(ref => ({ ...ref, id: evidenceMap.get(ref.id)! }))];
  const used = new Set<string>();
  const replacements = patch.sections.map(section => {
    const refs = new Set(patch.evidence.filter(ref => section.evidenceIds.includes(ref.id)).map(ref => key(ref.conversationId, ref.messageId)));
    const exact = replaceable.filter(old => !used.has(old.id) && (old.id === section.id || (old.wikiOriginalTitle ?? old.title).trim() === section.title.trim()));
    const candidates = exact.length === 1 ? exact : replaceable.filter(old => !used.has(old.id) && previous.evidence.some(ref => old.evidenceIds.includes(ref.id) && refs.has(key(ref.conversationId, ref.messageId))));
    const match = candidates.length === 1 ? candidates[0] : replaceable.length === 1 && patch.sections.length === 1 ? replaceable[0] : undefined;
    if (match) used.add(match.id);
    return { ...section, ...(match?.relatedKnowledgeIds?{relatedKnowledgeIds:match.relatedKnowledgeIds}:{}), ...(match?.matterLinks?{matterLinks:match.matterLinks}:{}), ...(match?.wikiDisplayTitle !== undefined ? { wikiDisplayTitle:match.wikiDisplayTitle } : {}), id: match?.id ?? `${prefix}${section.id}`, evidenceIds: section.evidenceIds.map(id => evidenceMap.get(id)!), claims: section.claims?.map(claim => remapWikiClaimEvidence(claim, evidenceMap)), semanticStructure: mapSemanticEvidence(section.semanticStructure, ids => ids.flatMap(id => evidenceMap.has(id) ? [evidenceMap.get(id)!] : [])), understandingPath: undefined };
  });
  const mapped = new Map(replacements.filter(section => replaceable.some(old => old.id === section.id)).map(section => [section.id, section]));
  const sections = previous.sections.flatMap(section => replaceable.includes(section) ? mapped.has(section.id) ? [mapped.get(section.id)!] : [] : [section]);
  const newSections = replacements.filter(section => !mapped.has(section.id));
  const anchor = replacements.find(section => mapped.has(section.id))?.id ?? previous.sections.find(section => affected.has(section.id) && protectedSections.includes(section))?.id;
  const insertion = anchor ? sections.findIndex(section => section.id === anchor) + 1 : sections.length;
  sections.splice(insertion, 0, ...newSections);
  // A changed successor invalidates an old transition, without changing personal reading order.
  const withTransitions = sections.map((section, index) => {
    const oldIndex = previous.sections.findIndex(old => old.id === section.id);
    const generatedIndex = replacements.findIndex(item => item.id === section.id);
    const changedSuccessor = generatedIndex >= 0 ? replacements[generatedIndex + 1]?.id !== sections[index + 1]?.id : oldIndex >= 0 && (previous.sections[oldIndex + 1]?.id !== sections[index + 1]?.id || affected.has(sections[index + 1]?.id));
    return changedSuccessor ? { ...section, transition: "" } : section;
  });
  const readable = input.filter(item => item.content.trim() && !isInternalSearchQueryMessage(item)).sort((a, b) => a.messageIndex - b.messageIndex);
  const sourceIds = [...previous.sourceConversationIds, ...(plan.addedConversationIds ?? [])];
  const sourceSignatures = Object.fromEntries(sourceIds.map(id => [id, Object.fromEntries(readable.filter(item => item.conversationId === id).map(item => [item.id, sourceMessageSignature(item.content)]))]));
  const sourceMessageOrder = Object.fromEntries(sourceIds.map(id => [id, readable.filter(item => item.conversationId === id).map(item => item.id)]));
  const sourceRoles = Object.fromEntries(sourceIds.map(id => [id, Object.fromEntries(readable.filter(item => item.conversationId === id).map(item => [item.id, item.role]))]));
  const sourceOutlines = sourceIds.map(id => {
    const old = previous.sourceOutlines?.find(item => item.conversationId === id), fresh = patch.sourceOutlines?.find(item => item.conversationId === id);
    const updated = new Set(plan.scope.blocks?.find(item => item.conversationId === id)?.messageIds ?? []), removed = new Set(plan.removedKeys);
    // A direct short generation has no neutral notes. Use original turn headings locally.
    const turns: ConversationMessage[][] = [];
    if (fresh && !fresh.chapters.length) for (const message of readable.filter(item => item.conversationId === id && (plan.fallback || updated.has(item.id)))) {
      if (!turns.length || message.role === "user") turns.push([]);
      turns.at(-1)!.push(message);
    }
    const newChapters = fresh?.chapters.length ? fresh.chapters : turns.map((turn, index) => ({ id: `turn:${index}`, title: readingTitle(turn[0].content.replace(/\s+/gu, " "), 36), summary: turn.map(message => `${message.role}: ${message.content}`).join("\n").slice(0, 600), messageIds: turn.map(message => message.id) }));
    const chapters = [...(plan.fallback ? [] : old?.chapters ?? []).filter(chapter => !chapter.messageIds.some(messageId => updated.has(messageId) || removed.has(key(id, messageId)))), ...newChapters.map(chapter => ({ ...chapter, id: `${prefix}${chapter.id}` }))].sort((a, b) => Math.min(...a.messageIds.map(messageId => sourceMessageOrder[id].indexOf(messageId))) - Math.min(...b.messageIds.map(messageId => sourceMessageOrder[id].indexOf(messageId))));
    return { conversationId: id, messageSignatures: sourceSignatures[id], messageOrder: sourceMessageOrder[id], messageRoles: sourceRoles[id], chapters };
  });
  const validClaim = (claim: { evidenceIds: string[] }) => claim.evidenceIds.length > 0 && claim.evidenceIds.every(id => { const ref = previous.evidence.find(item => item.id === id); return ref && !plan.removedKeys.includes(key(ref.conversationId, ref.messageId)) && !plan.scope.blocks?.some(block => block.conversationId === ref.conversationId && block.messageIds.includes(ref.messageId)); });
  const patchedClaims = (claims: NonNullable<FocusSession["brief"]>["confirmed"] = []) => claims.map(claim => ({ ...claim, evidenceIds: claim.evidenceIds.map(id => evidenceMap.get(id)!) }));
  // A partial update reads only changed messages; its ledger is partial too (P4 merges ledgers).
  const next: FocusSession = { ...patch, wikiKnowledge: plan.fallback ? patch.wikiKnowledge : previous.wikiKnowledge, wikiProjectBoundary:previous.mode==="work"?patch.wikiProjectBoundary??savedWikiProjectBoundary(previous):previous.wikiProjectBoundary, wikiScopeReview:mergeWikiScopeReview(previous,patch,plan.scope,plan.removedKeys,plan.fallback,evidenceMap), projectState: undefined, semanticOverview: undefined, title: previous.title, goal: previous.goal, mode: previous.mode, scope: previous.scope, sourceConversationIds: sourceIds, sourceSignatures, sourceMessageOrder, sourceRoles, sourceOutlines, evidence, sections: withTransitions, canvasId: previous.canvasId, wikiSectionAliases:previous.wikiSectionAliases, wikiMergeHistory:previous.wikiMergeHistory,
    rootSessionId: previous.rootSessionId ?? previous.id, previousSessionId: previous.id, wikiSuggestions: { ...previous.wikiSuggestions, ...Object.fromEntries(Object.entries(patch.wikiSuggestions ?? {}).map(([id, suggestion]) => [id, { ...suggestion, evidenceIds: suggestion.evidenceIds.map(ref => evidenceMap.get(ref)!) }])) },
    activeSectionId: sections.some(section => section.id === previous.activeSectionId) ? previous.activeSectionId : sections[0]?.id ?? "",
    completedSectionIds: previous.completedSectionIds.filter(id => !affected.has(id) && sections.some(section => section.id === id)), visitedSectionIds: previous.visitedSectionIds?.filter(id => sections.some(section => section.id === id)),
    // Recompute orientation locally; an old overall summary may contain a superseded decision.
    briefUserEdited: previous.briefUserEdited, brief: previous.briefUserEdited ? previous.brief : { summary: "", turningPoints: [...(previous.brief?.turningPoints.filter(validClaim) ?? []), ...patchedClaims(patch.brief?.turningPoints)].slice(-4), confirmed: [...(previous.brief?.confirmed.filter(validClaim) ?? []), ...patchedClaims(patch.brief?.confirmed)].slice(-4), openQuestions: [...new Set([...(previous.brief?.openQuestions ?? []), ...(patch.brief?.openQuestions ?? [])].map(text => text.trim()).filter(Boolean))] },
    coverage: { method: plan.fallback ? patch.coverage?.method ?? "sampled" : "full_batched", sourceCount: sourceIds.length, processedSegments: readable.length, totalSegments: readable.length, elapsedMs: patch.coverage?.elapsedMs, batchCount: patch.coverage?.batchCount },
  };
  const personal = { ...previous, sections: previous.sections.map(section => affected.has(section.id) && !section.userEdited && !section.structureEdited && section.origin !== "user" ? { ...section, understandingPath: section.understandingPath?.filter(step => step.origin === "user" || step.userEdited || step.structureEdited) } : section) };
  const carried = carryReviewNotes(personal, next, true);
  const reviewNeeds = { ...carried.reviewNeeds, ...patch.reviewNeeds };
  for (const section of protectedSections) if (affected.has(section.id)) reviewNeeds[section.id] = zh ? "来源已更新，保留了你的修改，请核对" : "Sources changed. Your edits are preserved; please check.";
  const result={ ...next, ...carried, reviewNeeds };
  if(previous.mode==="work"&&(previous.wikiEdition!=="current-v2"||previous.wikiMainlineVersion!==1)&&(patch.wikiEdition==="current-v1"||patch.wikiEdition==="current-v2")){
    const aliases={...result.wikiSectionAliases};
    for(const old of previous.sections.filter(section=>!protectedSections.includes(section))){
      const refs=new Set(previous.evidence.filter(ref=>old.evidenceIds.includes(ref.id)).map(ref=>key(ref.conversationId,ref.messageId)));
      const owners=result.sections.filter(section=>!protectedSections.some(personal=>personal.id===section.id)).map(section=>({section,score:result.evidence.filter(ref=>section.evidenceIds.includes(ref.id)&&refs.has(key(ref.conversationId,ref.messageId))).length})).filter(item=>item.score>0).sort((a,b)=>b.score-a.score);
      if(owners[0]&&owners[0].section.id!==old.id)aliases[old.id]=owners[0].section.id;
    }
    return {...result,wikiSectionAliases:aliases,wikiMergeHistory:[...previous.wikiMergeHistory??[],{at:Date.now(),sections:previous.sections,sectionNotes:previous.sectionNotes,wikiOrder:previous.wikiOrder}]};
  }
  return result;
}

/** Publishing a preview from a changed source would mix two different realities. */
async function assertSourcesUnchanged(sources: Conversation[], read: ConversationMessage[], locale: string) {
  const db = await getDatabase();
  const fresh = (await Promise.all(sources.map(source => db.getAllFromIndex("messages", "by-conversation", source.id)))).flat();
  const fingerprint = (items: ConversationMessage[]) => sourceMessageSignature(JSON.stringify(items.map(message => [message.conversationId, message.id, message.role, message.messageIndex, message.content]).sort((a, b) => String(a[0]).localeCompare(String(b[0])) || String(a[1]).localeCompare(String(b[1])))));
  if (fingerprint(fresh) !== fingerprint(read)) throw new Error(locale === "zh-CN" ? "分析期间原始讨论有更新，请重新生成。原稿仍保留。" : "Original discussions changed during analysis. Retry; your original is retained.");
}

/** Share of new units above which an update organizes the ledger afresh (keeping the directory where it fits)
 * instead of placing the new units into the earlier subjects. */
const REORGANIZE_SHARE = .5;

/** A document written from the ledger, updated through it: unchanged batches are reused, the ledger organized
 * again and only changed chapters written anew. Every generated chapter then takes the ledger's version, while
 * personally edited chapters stay and are flagged for a check; the result is a preview the user accepts. */
async function ledgerUpdate(previous: FocusSession, sources: Conversation[], messages: ConversationMessage[], allMessages: ConversationMessage[], plan: FocusUpdatePlan, locale: string, signal: AbortSignal, onState?: Parameters<typeof generateFocusSession>[6], runId?: string, onProgress?: Parameters<typeof generateFocusSession>[8], decisionsOnly = false): Promise<FocusSession> {
  const id = runId ?? `focus-${crypto.randomUUID()}`, earlier = previous.wikiKnowledge!, boundary = savedWikiProjectBoundary(previous);
  const ai = createAtlasAI(effectiveAISettings(await getAISettings()), signal, id, onState);
  const progress = (next: WikiProgress) => onProgress?.(next.done, Math.max(next.total, 1), next.stage === "extract" ? "reading" : "synthesis");
  // Only the user's verdicts changed: the extracted units and the directory stand, and only chapters whose statuses moved
  // are written again (unchanged chapters keep their text through the draft's signatures).
  const extracted = withWikiSources(decisionsOnly ? earlier : await reextractSessionKnowledge({ ...previous, runId: id, sourceConversationIds: sources.map(source => source.id) }, ai, signal, earlier, progress), await datedSources(sources));
  const known = new Set(wikiLedgerUnits(earlier).map(unit => unit.id)), units = wikiLedgerUnits(extracted), fresh = units.filter(unit => !known.has(unit.id)).length;
  const common = { ai, ...embeddingsFor(effectiveAISettings(await getAISettings()), id), locale, signal, runId: id, conversations: sources.length, names: [boundary.name, previous.goal.length <= 32 ? previous.goal : undefined, ...sources.map(source => source.title)], progress };
  // An update keeps the document's type; a learning document's roles are read again for the points it now has.
  const typed: typeof extracted = keptLearnerCode(learningUnitsOwn(earlier.documentType ? { ...extracted, documentType: earlier.documentType, ...(earlier.documentTypeBy ? { documentTypeBy: earlier.documentTypeBy } : {}) } : extracted), earlier);
  const reorganized = decisionsOnly && earlier.organization ? earlier : await organizeLedger(typed, fresh > units.length * REORGANIZE_SHARE ? { ...common, directory: earlier.organization } : { ...common, previous: earlier.organization });
  requireLedgerDirectory(reorganized, locale);
  const organized = decisionsOnly ? reorganized : await asLearningDocument(reorganized, { ai, locale, signal });
  const ledger = await writeLedgerDraft(await withStoredSections(organized), { ai, locale, signal, runId: id, project: boundary.name, previous: earlier.draft, progress });
  const patch = await ledgerDocumentSession(ledger, { id: crypto.randomUUID(), runId: id, goal: previous.goal, mode: previous.mode, strategy: previous.strategy, scope: previous.scope, title: previous.title, locale: previous.locale, sourceConversationIds: sources.map(source => source.id), wikiProjectBoundary: boundary,
    coverage: { method: "full_batched", sourceCount: sources.length, processedSegments: units.length, totalSegments: units.length, batchCount: ledger.batches.length } }, sources, messages, ai, signal, id);
  signal.throwIfAborted();
  // A chapter the user edited keeps their text; the ledger's new version of it is offered beside it as a suggestion,
  // never added as a second chapter of the same name.
  const personal = new Map(previous.sections.filter(section => !editableWikiTopic(section)).map(section => [section.id, section]));
  const suggested = patch.sections.filter(section => personal.has(section.id));
  const offered: FocusSession = { ...patch, sections: patch.sections.filter(section => !personal.has(section.id)), wikiSuggestions: { ...patch.wikiSuggestions, ...Object.fromEntries(suggested.map(section => [section.id, { ...section, title: personal.get(section.id)!.title }])) } };
  const merged = mergeFocusUpdate(previous, offered, { ...plan, fallback: true, affectedSectionIds: previous.sections.map(section => section.id) }, messages, locale);
  merged.title = previous.title;
  merged.wikiKnowledge = ledger;
  merged.sourceVersionIds = await retainSourceVersions(allMessages);
  await assertSourcesUnchanged(sources, allMessages, locale);
  await loadKnowledgeIndex(merged, messages);
  return merged;
}

export async function generateFocusUpdate(previous: FocusSession, sources: Conversation[], locale: string, signal: AbortSignal, onState?: Parameters<typeof generateFocusSession>[6], runId?: string, onProgress?: Parameters<typeof generateFocusSession>[8]): Promise<FocusSession> {
  sources = [...new Set([...previous.sourceConversationIds, ...sources.map(source => source.id)])].map(id => { const source = sources.find(item => item.id === id); if (!source) throw new Error("项目来源缺失，请重新确认材料 / Confirm missing project sources."); return source; });
  const allMessages = (await Promise.all(sources.map(source => getMessagesForConversation(source.id)))).flat();
  const messages = allMessages.filter(message => previous.scope?.kind !== "goal" || !previous.sourceConversationIds.includes(message.conversationId) || previous.scope.blocks?.some(block => block.conversationId === message.conversationId && block.messageIds.includes(message.id)));
  if (sources.some(source => !messages.some(item => item.conversationId === source.id && item.content.trim() && !isInternalSearchQueryMessage(item)))) throw new Error(locale === "zh-CN" ? "部分项目来源已没有正文，请重新确认材料。原稿和笔记仍保留。" : "Some project sources have no text. Confirm materials again; your original and notes are preserved.");
  const plan = planWikiEditionUpdate(previous,messages,planFocusUpdate(previous, messages));
  if (previous.mode === "work" && previous.wikiKnowledge?.draft && ledgerPipelineEnabled()) {
    // Nothing new in the sources, but verdicts the user gave since the draft: only the chapters they touch are rewritten.
    if (!plan.changed && !ledgerDecisionsPending(previous.wikiKnowledge)) return { ...previous, id: crypto.randomUUID(), runId, createdAt: Date.now(), updatedAt: Date.now() };
    return ledgerUpdate(previous, sources, messages, allMessages, plan, locale, signal, onState, runId, onProgress, !plan.changed);
  }
  if (!plan.changed) {
    const next={...previous,id:crypto.randomUUID(),runId,createdAt:Date.now(),updatedAt:Date.now()};
    // Explicit update also backfills an old fragmented directory. Ordinary reads
    // never schedule paid work, and unchanged successful plans are reused.
    if(previous.mode!=="work")return next;
    const ai=createAtlasAI(effectiveAISettings(await getAISettings()),signal,runId,onState);
    const organized=requireOrganizedWiki(await autoOrganizeWiki(next,ai,signal,false,"suggest",previousWikiDirectory(previous)));
    // A document saved before the current explanation semantics is upgraded here,
    // locally and only on this explicit update; reading and export never do it.
    return wikiSemanticsCurrent(organized)?organized:consolidateWikiExplanations(organized,ai,signal,messages);
  }
  if (!plan.scope.blocks?.length) throw new Error(locale === "zh-CN" ? "来源正文已移除，请调整材料。原稿和笔记仍保留。" : "Source text was removed. Adjust materials; your original and notes are preserved.");
  const included = sources.filter(source => plan.scope.blocks?.some(block => block.conversationId === source.id));
  // An update keeps the existing directory where the material still fits it.
  const anchor = previous.mode === "work" ? previousWikiDirectory(previous) : [];
  const projectOptions = previous.mode === "work" ? { skipProjectState: true, wikiPreviousDirectory:anchor, wikiProjectBoundary:savedWikiProjectBoundary(previous), wikiScopeIncludeKeys:previous.wikiScopeReview?.includeKeys, wikiScopeExcludeKeys:previous.wikiScopeReview?.excludeKeys, wikiScopeIgnoredKeys:previous.wikiScopeReview?.ignoredKeys } : {};
  let patch = await generateFocusSession(previous.goal, previous.mode, included, locale, signal, undefined, onState, runId, onProgress, plan.fallback && previous.scope?.kind !== "goal" ? { complete: true, ...projectOptions } : { scope: plan.scope, ...projectOptions });
  if (!plan.fallback && previous.mode === "work") {
    const topics = await reconcileWikiTopics(previous, patch, messages, sources, signal);
    patch = topics.patch;
    plan.affectedSectionIds = [...new Set([...plan.affectedSectionIds, ...topics.affectedIds])];
  }
  signal.throwIfAborted();
  let merged = mergeFocusUpdate(previous, patch, plan, messages, locale);
  merged.title=previous.title;
  merged.sourceVersionIds = await retainSourceVersions(allMessages);
  if(previous.mode==="work"){
    const ai=createAtlasAI(effectiveAISettings(await getAISettings()),signal,patch.runId,onState);
    merged=requireOrganizedWiki(await autoOrganizeWiki(merged,ai,signal,false,"suggest",anchor));
    // New prose can repeat or contradict explanations in unchanged chapters.
    merged=await consolidateWikiExplanations(merged,ai,signal,messages);
  }
  if (previous.scope?.kind === "goal") merged.scope = { kind: "goal", blocks: sources.map(source => { const chosen = messages.filter(message => message.conversationId === source.id); return { conversationId: source.id, title: source.title, messageIds: chosen.map(message => message.id), messageSignatures: Object.fromEntries(chosen.map(message => [message.id, sourceMessageSignature(message.content)])) }; }) };
  await assertSourcesUnchanged(sources, allMessages, locale);
  await loadKnowledgeIndex(merged, messages);
  return merged;
}
