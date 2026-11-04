import { sourceExcerpts } from "./source-evidence";
import type { AtlasAIProvider } from "./provider";
import type { CanvasMembership, Conversation, ConversationMessage, ConversationSemanticProfile, KnowledgeCanvas, KnowledgeProposal, KnowledgeRelation, OrganizationTaskEvent, SourceRelation } from "../shared/types";
import { getDatabase } from "../storage/db";
import { listAllKnowledgeCards, listAllKnowledgeRelations, listAllMemberships, listAllSourceRelations } from "../storage/knowledge-graph";
import { ensureSemanticArtifacts, recordProviderUsage, saveAnalysisDiagnostics, type AnalysisMode } from "./semantic-analysis";
import { planCanvases, stableId } from "./canvas-planner";
import { extractConcepts } from "./concept-extractor";
import { canonicalConceptTitle, canonicalizeConcepts, conceptKey } from "./concept-canonicalizer";
import { generateRelations } from "./relation-generator";
import { synthesizeBridges } from "./bridge-synthesizer";
import { selectRelationEvidence, verifyRelationCandidates } from "./relation-verifier";
import { planKnowledgeComposition } from "./knowledge-composition";
import { selectHistoricalProfiles } from "./profile-retrieval";
import { COMPOSITION_BUDGET, compositionKey } from "./composition-guard";
import { placeNewMemberships } from "../layout/knowledge-layout";
import type { PlannedKnowledgeDomain } from "./knowledge-composition";

const normalized = (value: string) => value.toLocaleLowerCase().replace(/[\s·与和及/_-]/gu, "");

export type KnowledgeOrganizeProgress = { stage: "profiles" | "summaries" | "planning" | "quality" | "relations" | "finishing"; completed: number; total: number; cached?: number };

export async function buildKnowledgeProposal(input: {
  conversations: Conversation[];
  intent?: string;
  intentTitle?: string;
  scopeCanvasId?: string;
  runId?: string;
  loadMessages: (conversationId: string) => Promise<ConversationMessage[]>;
  existingCanvases: KnowledgeCanvas[];
  provider?: AtlasAIProvider;
  mode?: AnalysisMode;
  enrich?: boolean;
  now?: number;
  signal?: AbortSignal;
  onProgress?: (progress: KnowledgeOrganizeProgress) => void;
  onDiscoveries?: (events: OrganizationTaskEvent[]) => void;
  requireAI?: boolean;
}): Promise<KnowledgeProposal> {
  const now = input.now ?? Date.now();
  const usageBefore = input.provider?.getUsageSnapshot?.();
  const db = await getDatabase();
  const messageCache = new Map<string, Promise<ConversationMessage[]>>();
  const loadMessages = (id: string) => { let messages = messageCache.get(id); if (!messages) { messages = input.loadMessages(id); messageCache.set(id, messages); } return messages; };
  const semantic = await ensureSemanticArtifacts({ conversations: input.conversations, runId: input.runId, intent: input.intent, loadMessages, provider: input.provider, mode: input.mode, preferCachedArtifacts: Boolean(input.intent), requireAI: input.requireAI, now, signal: input.signal, onProgress: (completed, total, cached) => input.onProgress?.({ stage: "profiles", completed, total, cached }), onProfileProgress: (completed, total) => input.onProgress?.({ stage: "summaries", completed, total }) });
  input.signal?.throwIfAborted();
  const freshIds = new Set(semantic.freshConversationIds);
  const [existingSourceSnapshot, existingCardSnapshot] = await Promise.all([listAllSourceRelations(), listAllKnowledgeCards()]);
  input.signal?.throwIfAborted();
  const aiCardIds = new Set(existingCardSnapshot.filter((card) => card.origin === "ai").map((card) => card.id));
  if (!input.intent && !freshIds.size && input.conversations.every((conversation) => existingSourceSnapshot.some((source) => source.conversationId === conversation.id && aiCardIds.has(source.cardId)))) {
    semantic.diagnostics.cacheHits = semantic.diagnostics.cachedQuestionsReused;
    recordProviderUsage(semantic.diagnostics, usageBefore, input.provider?.getUsageSnapshot?.());
    await saveAnalysisDiagnostics(semantic.diagnostics);
    input.onProgress?.({ stage: "finishing", completed: 1, total: 1 });
    return { id: stableId("proposal", `${now}:unchanged`), status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], analyzedConversationIds: [], reviewConversationIds: [], createdAt: now, updatedAt: now };
  }
  // An explicit organize action can recompose cached profiles without reloading their transcripts.
  // During normal incremental imports only changed conversations enter the planner.
  const patchIds = freshIds.size ? freshIds : new Set(semantic.profiles.map((profile) => profile.conversationId));
  const linkedConversationIds = new Set(existingSourceSnapshot.map((source) => source.conversationId));
  const historicalProfiles = input.provider && !input.intent ? selectHistoricalProfiles(semantic.profiles, semantic.cachedProfiles, linkedConversationIds) : [];
  input.onProgress?.({ stage: "planning", completed: 0, total: patchIds.size });
  const enrich = input.enrich ?? input.mode === "deep";
  const planned = await planKnowledgeComposition({ enrich, loadEvidence: async (id, query) => sourceExcerpts(await loadMessages(id), query), profiles: semantic.profiles, historicalProfiles, freshIds: patchIds, existingDomainTitles: input.existingCanvases.map((canvas) => canvas.title), intent: input.intent, provider: input.provider, requireAI: input.requireAI, signal: input.signal, onProgress: (completed, total) => input.onProgress?.({ stage: "planning", completed, total }), onPhase: () => input.onProgress?.({ stage: "quality", completed: 0, total: 0 }), onRequest: (characters, output, failed) => { semantic.diagnostics.aiRequests += 1; semantic.diagnostics.synthesisCalls = (semantic.diagnostics.synthesisCalls ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += Math.ceil(characters / 4); semantic.diagnostics.estimatedOutputTokens += Math.ceil(output / 4); if (failed) semantic.diagnostics.schemaFailures = (semantic.diagnostics.schemaFailures ?? 0) + 1; }, onJudgeRequest: (characters, output, failed) => { semantic.diagnostics.aiRequests += 1; semantic.diagnostics.decisionCalls = (semantic.diagnostics.decisionCalls ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += Math.ceil(characters / 4); semantic.diagnostics.estimatedOutputTokens += Math.ceil(output / 4); if (failed) semantic.diagnostics.schemaFailures = (semantic.diagnostics.schemaFailures ?? 0) + 1; } });
  const scopedCanvas = input.scopeCanvasId ? input.existingCanvases.find((canvas) => canvas.id === input.scopeCanvasId) : undefined;
  const intentTitle = scopedCanvas?.title ?? input.intentTitle?.trim();
  const intentConcepts = [...new Set(planned.domains.flatMap((domain) => domain.concepts))];
  if (input.intent && input.requireAI && !intentConcepts.length) throw new Error("AI could not find supported concepts for this goal. Review the sources and retry.");
  const intentDomains: PlannedKnowledgeDomain[] = intentTitle ? [{ title: intentTitle, conversationIds: input.conversations.map((item) => item.id), concepts: (intentConcepts.length ? intentConcepts : planned.profiles.flatMap((profile) => profile.concepts)).filter((concept, index, all) => all.indexOf(concept) === index).slice(0, 22), backbone: [...new Set(planned.domains.flatMap((domain) => domain.backbone))].slice(0, 12), bridgeCandidates: planned.domains.flatMap((domain) => domain.bridgeCandidates).slice(0, 5), freeCardCandidates: planned.domains.flatMap((domain) => domain.freeCardCandidates).slice(0, 3) }] : planned.domains;
  const plan = intentTitle ? { profiles: planned.profiles.map((profile) => ({ ...profile, domains: [intentTitle] })), domains: intentDomains } : planned;
  input.signal?.throwIfAborted();
  const evidenceProfiles = [...plan.profiles, ...historicalProfiles];
  input.onDiscoveries?.(plan.domains.slice(0, 6).map((domain) => ({ type: "topic_found", title: domain.title, sourceRefs: evidenceProfiles.filter((profile) => domain.conversationIds.includes(profile.conversationId)).flatMap((profile) => profile.evidenceRefs).slice(0, 8), timestamp: Date.now() })));
  const selectedConcepts = new Map<string, Set<string>>();
  const domainConcepts = new Map<string, Map<string, Set<string>>>();
  const originalProfiles = new Map(plan.profiles.map((profile) => [profile.conversationId, profile]));
  for (const domain of plan.domains) for (const id of domain.conversationIds) {
    const profile = originalProfiles.get(id);
    if (!profile) continue;
    const ownConcepts = new Set(profile.concepts.map(conceptKey));
    const supported = new Set(domain.concepts.map(conceptKey).filter((key) => ownConcepts.has(key)));
    const byDomain = domainConcepts.get(id) ?? new Map<string, Set<string>>();
    byDomain.set(normalized(domain.title), supported);
    domainConcepts.set(id, byDomain);
    if (patchIds.has(id)) selectedConcepts.set(id, new Set([...(selectedConcepts.get(id) ?? []), ...supported]));
  }
  const profiles: ConversationSemanticProfile[] = plan.profiles.map((profile) => selectedConcepts.has(profile.conversationId) ? { ...profile, concepts: profile.concepts.filter((concept) => selectedConcepts.get(profile.conversationId)!.has(conceptKey(concept))) } : profile);
  const fresh = profiles.filter((profile) => freshIds.has(profile.conversationId));
  const canvases = intentTitle ? [scopedCanvas ?? { id: stableId("canvas-user", `${input.runId ?? now}:${intentTitle}`), title: intentTitle, description: input.intent, type: "topic" as const, origin: "user" as const, userEdited: false, createdAt: now, updatedAt: now }] : planCanvases(profiles, input.existingCanvases, now);
  const [existingMemberships, existingRelations] = await Promise.all([listAllMemberships(), listAllKnowledgeRelations()]);
  const existingCards = existingCardSnapshot;
  const existingSources = existingSourceSnapshot;
  const conceptProfiles = fresh.length ? fresh : profiles;
  const conceptSnapshots = (await Promise.all(conceptProfiles.map((profile) => db.getAllFromIndex("questionSnapshots", "by-conversation", profile.conversationId)))).flat();
  const extracted = extractConcepts(conceptProfiles, now, conceptSnapshots);
  const canonical = canonicalizeConcepts(extracted, existingCards);
  input.onDiscoveries?.([
    ...canonical.cards.slice(0, 8).map((card) => ({ type: "concept_found" as const, title: card.title, sourceRefs: card.evidenceRefs ?? [], timestamp: Date.now() })),
    ...extracted.filter((card) => canonical.idMap.get(card.id) && canonical.cards.some((item) => item.id === canonical.idMap.get(card.id) && item.title !== card.title)).slice(0, 4).map((card) => ({ type: "concept_merged" as const, from: [card.title], to: canonical.cards.find((item) => item.id === canonical.idMap.get(card.id))!.title, sourceRefs: card.evidenceRefs ?? [], timestamp: Date.now() })),
  ]);
  const relevantConceptKeys = new Set(extracted.map((card) => conceptKey(card.title)));
  const cardsForRelations = [...(input.intent ? existingCards.filter((card) => relevantConceptKeys.has(conceptKey(card.title))) : existingCards), ...canonical.cards];
  const canvasByTitle = new Map([...input.existingCanvases, ...canvases].map((canvas) => [normalized(canvas.title), canvas]));
  const cardByKey = new Map(cardsForRelations.map((card) => [conceptKey(card.title), card]));
  const refsForConceptPair = (ids: string[], fromTitle: string, toTitle: string) => {
    const matching = evidenceProfiles.filter((profile) => ids.includes(profile.conversationId));
    const hasConcept = (profile: ConversationSemanticProfile, title: string) => profile.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === conceptKey(canonicalConceptTitle(title)));
    const refs = [...matching.filter((profile) => hasConcept(profile, fromTitle)).slice(0, 2), ...matching.filter((profile) => hasConcept(profile, toTitle)).slice(0, 2)].flatMap((profile) => profile.evidenceRefs.slice(0, 1));
    return [...new Map(refs.map((ref) => [`${ref.conversationId}:${ref.questionId ?? ref.messageId ?? ""}`, ref])).values()].slice(0, 8);
  };
  const backbonePositions = new Map(plan.domains.map((domain) => [normalized(domain.title), new Map(domain.backbone.map((title, index) => [conceptKey(canonicalConceptTitle(title)), index]))]));
  const memberships: CanvasMembership[] = [];
  const sources: SourceRelation[] = [];
  const seenMembership = new Set(existingMemberships.map((item) => item.id));
  for (const profile of profiles) {
    for (const rawConcept of profile.concepts) {
      const card = cardByKey.get(conceptKey(canonicalConceptTitle(rawConcept)));
      if (!card) continue;
      for (const rawDomain of profile.domains) {
        const supported = domainConcepts.get(profile.conversationId)?.get(normalized(rawDomain));
        if (supported && !supported.has(conceptKey(rawConcept))) continue;
        const canvas = canvasByTitle.get(normalized(rawDomain)) ?? [...canvasByTitle.values()].find((item) => normalized(item.title).includes(normalized(rawDomain)) || normalized(rawDomain).includes(normalized(item.title)));
        if (!canvas) continue;
        const id = `${canvas.id}:${card.id}`;
        if (!seenMembership.has(id)) {
          const cardIndex = memberships.filter((item) => item.canvasId === canvas.id).length;
          const backboneRank = backbonePositions.get(normalized(canvas.title))?.get(conceptKey(card.title));
          memberships.push({ id, canvasId: canvas.id, cardId: card.id, ...(backboneRank === undefined ? { x: 440 + cardIndex % 2 * 310, y: 100 + Math.floor(cardIndex / 2) * 190 } : { x: 96, y: 100 + backboneRank * 172 }), userPositioned: false, createdAt: now, updatedAt: now });
          seenMembership.add(id);
        }
      }
      const source: SourceRelation = { id: `${card.id}:conversation:${profile.conversationId}`, cardId: card.id, sourceType: "conversation", sourceId: profile.conversationId, conversationId: profile.conversationId, createdAt: now };
      if (!sources.some((item) => item.id === source.id)) sources.push(source);
    }
  }
  const mode = input.mode ?? "balanced";
  // Co-occurrence is a fallback, not the primary graph generator when structure planning succeeded.
  const proposedRelations = !plan.domains.length && (fresh.length || !existingCards.length) ? generateRelations(cardsForRelations, profiles, now, mode === "fast" ? 2 : mode === "deep" ? 5 : 3) : [];
  const plannedRelations: KnowledgeRelation[] = plan.domains.flatMap((domain) => domain.bridgeCandidates.flatMap((bridge) => {
    const from = cardByKey.get(conceptKey(canonicalConceptTitle(bridge.from)));
    const to = cardByKey.get(conceptKey(canonicalConceptTitle(bridge.to)));
    if (!from || !to || from.id === to.id) return [];
    const refs = refsForConceptPair(bridge.conversationIds, from.title, to.title);
    if (!refs.length) return [];
    return [{ id: stableId("relation-ai", `${from.id}:${to.id}:explains`), fromCardId: from.id, toCardId: to.id, type: "explains" as const, label: bridge.text, requiresExplanation: true, origin: "ai" as const, status: "proposed" as const, evidenceRefs: refs, createdAt: now, updatedAt: now }];
  }));
  const parentId = (id: string) => id.replace(/:[ab]$/u, "");
  const rejected = new Set(existingRelations.filter((relation) => relation.userRejected || relation.status === "rejected").flatMap((relation) => [relation.id, parentId(relation.id)]));
  const existingRelationIds = new Set(existingRelations.flatMap((relation) => [relation.id, parentId(relation.id)]));
  const candidatePool = (enrich ? [...plannedRelations, ...proposedRelations] : []).filter((relation, index, all) => all.findIndex((item) => [item.fromCardId, item.toCardId].sort().join(":") === [relation.fromCardId, relation.toCardId].sort().join(":")) === index && !existingRelationIds.has(relation.id) && !rejected.has(relation.id) && (!existingCards.length || relation.evidenceRefs.some((ref) => patchIds.has(ref.conversationId)))).slice(0, mode === "fast" ? 20 : mode === "deep" ? 100 : 45);
  semantic.diagnostics.candidatePairs = candidatePool.length;
  const evidenceConversations = [...new Set(candidatePool.flatMap((relation) => relation.evidenceRefs.map((ref) => ref.conversationId)))];
  const cachedSnapshots = (await Promise.all(evidenceConversations.map((id) => db.getAllFromIndex("questionSnapshots", "by-conversation", id)))).flat();
  semantic.diagnostics.snapshotsRead = cachedSnapshots.length;
  const candidates = candidatePool.map((relation) => selectRelationEvidence(relation, cardsForRelations, cachedSnapshots)).filter((relation): relation is KnowledgeRelation => Boolean(relation));
  semantic.diagnostics.judgedPairs = input.provider ? candidates.length : 0;
  input.onProgress?.({ stage: "relations", completed: 0, total: candidates.length });
  const verified = await verifyRelationCandidates({ relations: candidates, cards: cardsForRelations, snapshots: cachedSnapshots, loadEvidence: async (id, questionId, query) => sourceExcerpts(await loadMessages(id), query, questionId), provider: input.provider, rejectedIds: rejected, requireAI: input.requireAI, signal: input.signal, onProgress: (completed, total) => input.onProgress?.({ stage: "relations", completed, total }), onRequest: (inputCharacters, outputCharacters, failed) => { semantic.diagnostics.aiRequests += 1; semantic.diagnostics.decisionCalls = (semantic.diagnostics.decisionCalls ?? 0) + 1; semantic.diagnostics.estimatedInputTokens += Math.ceil(inputCharacters / 4); semantic.diagnostics.estimatedOutputTokens += Math.ceil(outputCharacters / 4); if (failed) semantic.diagnostics.schemaFailures = (semantic.diagnostics.schemaFailures ?? 0) + 1; } });
  input.signal?.throwIfAborted();
  input.onDiscoveries?.(verified.slice(0, 8).flatMap((relation) => {
    const from = cardsForRelations.find((card) => card.id === relation.fromCardId)?.title;
    const to = cardsForRelations.find((card) => card.id === relation.toCardId)?.title;
    return from && to ? [{ type: "relation_found" as const, from, to, relationType: relation.label ?? relation.type, sourceRefs: relation.evidenceRefs, timestamp: Date.now() }] : [];
  }));
  const bridged = synthesizeBridges(verified, canonical.cards, [...existingMemberships, ...memberships], now, existingCards);
  const canvasForDomain = (title: string) => canvasByTitle.get(normalized(title)) ?? [...canvasByTitle.values()].find((canvas) => compositionKey(canvas.title) === compositionKey(title));
  const freeCards = plan.domains.flatMap((domain) => {
    const canvas = canvasForDomain(domain.title);
    if (!canvas) return [];
    const existingInCanvas = [...existingMemberships, ...memberships].filter((membership) => membership.canvasId === canvas.id).length;
    const existingFreeCount = existingCards.filter((card) => (card.type === "insight" || card.type === "draft") && existingMemberships.some((membership) => membership.canvasId === canvas.id && membership.cardId === card.id)).length;
    const budget = Math.max(0, Math.min(COMPOSITION_BUDGET.knowledge.freeCards, Math.ceil(existingInCanvas / 5)) - existingFreeCount);
    return domain.freeCardCandidates.slice(0, budget).flatMap((candidate, index) => {
      const id = stableId(`${candidate.type}-ai`, `${canvas.id}:${candidate.title}`);
      if (existingCards.some((card) => card.id === id || card.homeCanvasId === canvas.id && compositionKey(card.title) === compositionKey(candidate.title))) return [];
      return [{ card: { id, homeCanvasId: canvas.id, type: candidate.type, title: candidate.title, body: candidate.body, evidenceRefs: evidenceProfiles.filter((profile) => candidate.conversationIds.includes(profile.conversationId)).flatMap((profile) => profile.evidenceRefs.slice(0, 2)).slice(0, 6), tags: [], origin: "ai" as const, userEdited: false, createdAt: now, updatedAt: now }, membership: { id: `${canvas.id}:${id}`, canvasId: canvas.id, cardId: id, x: 740, y: 100 + index * 170, userPositioned: false, createdAt: now, updatedAt: now }, conversationIds: candidate.conversationIds }];
    });
  });
  const bridgeSources = bridged.cards.filter((card) => card.type === "bridge").flatMap((card) => {
    const relation = verified.find((item) => stableId("bridge-ai", `${item.fromCardId}:${item.toCardId}:${item.label}`) === card.id);
    return relation ? [...new Set(relation.evidenceRefs.map((ref) => ref.conversationId))].map((conversationId) => ({ id: `${card.id}:conversation:${conversationId}`, cardId: card.id, sourceType: "conversation" as const, sourceId: conversationId, conversationId, createdAt: now })) : [];
  });
  const freeSources = freeCards.flatMap((item) => [...new Set(item.conversationIds)].map((conversationId) => ({ id: `${item.card.id}:conversation:${conversationId}`, cardId: item.card.id, sourceType: "conversation" as const, sourceId: conversationId, conversationId, createdAt: now })));
  input.onDiscoveries?.([
    ...bridged.cards.filter((card) => card.type === "bridge").map((card) => ({ type: "bridge_created" as const, title: card.title, body: card.body ?? card.title, sourceRefs: card.evidenceRefs ?? [], timestamp: Date.now() })),
    ...freeCards.map(({ card }) => card.type === "insight" ? ({ type: "insight_created" as const, title: card.title, body: card.body ?? "", sourceRefs: card.evidenceRefs ?? [], timestamp: Date.now() }) : ({ type: "draft_suggested" as const, title: card.title, body: card.body, sourceRefs: card.evidenceRefs ?? [], timestamp: Date.now() })),
  ]);
  const relations = bridged.relations.filter((relation) => !existingRelationIds.has(relation.id));
  semantic.diagnostics.relationsVerified = verified.length;
  semantic.diagnostics.bridgesGenerated = bridged.cards.filter((card) => card.type === "bridge").length;
  semantic.diagnostics.topicCount = canvases.length;
  semantic.diagnostics.relationCount = relations.length;
  semantic.diagnostics.bridgeCount = semantic.diagnostics.bridgesGenerated;
  semantic.diagnostics.conceptCount = canonical.cards.length;
  semantic.diagnostics.cacheHits = semantic.diagnostics.cachedQuestionsReused;
  semantic.diagnostics.unsupportedRelationRate = candidates.length ? (candidates.length - verified.length) / candidates.length : 0;
  semantic.diagnostics.needsReviewRate = verified.length ? verified.filter((relation) => relation.confidenceBand === "medium").length / verified.length : 0;
  recordProviderUsage(semantic.diagnostics, usageBefore, input.provider?.getUsageSnapshot?.());
  input.onProgress?.({ stage: "finishing", completed: 1, total: 1 });
  await saveAnalysisDiagnostics(semantic.diagnostics);
  const reviewConversationIds = profiles.filter((profile) => !profile.domains.length || !profile.concepts.length).map((profile) => profile.conversationId);
  const existingCardIds = new Set(existingCards.map((card) => card.id));
  const cardsWithHomes = [...bridged.cards, ...freeCards.map((item) => item.card)].filter((card) => !existingCardIds.has(card.id)).map((card) => ({ ...card, homeCanvasId: card.homeCanvasId ?? bridged.memberships.find((membership) => membership.cardId === card.id)?.canvasId }));
  const evidenceUpdates = existingCards.flatMap((card) => {
    const linkedIds = new Set(sources.filter((source) => source.cardId === card.id).map((source) => source.conversationId));
    if (!linkedIds.size) return [];
    const refs = conceptSnapshots.filter((snapshot) => linkedIds.has(snapshot.conversationId) && snapshot.concepts.some((concept) => conceptKey(canonicalConceptTitle(concept)) === conceptKey(canonicalConceptTitle(card.title))))
      .slice(0, 8).map((snapshot) => ({ conversationId: snapshot.conversationId, questionId: snapshot.questionId, messageId: snapshot.questionId }));
    return refs.length ? [{ cardId: card.id, refs }] : [];
  });
  const proposalMemberships = placeNewMemberships([...bridged.memberships, ...freeCards.map((item) => item.membership)], existingMemberships, [...existingCards, ...cardsWithHomes]);
  const scopeUpdates: NonNullable<KnowledgeProposal["scopeUpdates"]> = [];
  if (input.intent) for (const canvas of canvases) {
    const domain = plan.domains.find((item) => normalized(item.title) === normalized(canvas.title));
    const generatedPath = [...new Set((domain?.backbone ?? []).map((title) => cardByKey.get(conceptKey(canonicalConceptTitle(title)))?.id).filter((id): id is string => Boolean(id)))];
    const existing = input.existingCanvases.find((item) => item.id === canvas.id);
    const sourceConversationIds = [...new Set([...(existing?.sourceConversationIds ?? []), ...input.conversations.map((item) => item.id)])];
    const readingPathCardIds = existing?.readingPathUserEdited ? existing.readingPathCardIds ?? [] : [...new Set([...(existing?.readingPathCardIds ?? []), ...generatedPath])];
    if (existing) scopeUpdates.push({ canvasId: existing.id, intent: input.intent, sourceConversationIds, readingPathCardIds, baselineUpdatedAt: existing.updatedAt, before: { intent: existing.intent, sourceConversationIds: existing.sourceConversationIds, readingPathCardIds: existing.readingPathCardIds } });
    else { canvas.intent = input.intent; canvas.sourceConversationIds = sourceConversationIds; canvas.readingPathCardIds = readingPathCardIds; }
  }
  return {
    id: stableId("proposal", `${now}:${semantic.freshConversationIds.join(",")}`),
    status: "preview", mode: existingCards.length ? "incremental" : "initial",
    canvases: canvases.filter((canvas) => !input.existingCanvases.some((existing) => existing.id === canvas.id)),
    cards: cardsWithHomes, memberships: proposalMemberships, relations, sources: [...sources, ...bridgeSources, ...freeSources].filter((source) => !existingSources.some((item) => item.id === source.id)), evidenceUpdates,
    scopeUpdates, analyzedConversationIds: semantic.freshConversationIds, reviewConversationIds, analysisWarnings: semantic.diagnostics.schemaFailures,
    createdAt: now, updatedAt: now,
  };
}
