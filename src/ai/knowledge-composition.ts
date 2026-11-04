import type { SourceExcerpt } from "./source-evidence";
import type { AtlasAIProvider } from "./provider";
import type { ConversationSemanticProfile } from "../shared/types";
import { COMPOSITION_BUDGET, compositionKey, selectCompositionCandidates, usefulCompositionText } from "./composition-guard";
import { canonicalConceptTitle, conceptKey } from "./concept-canonicalizer";

export interface PlannedKnowledgeDomain {
  title: string;
  conversationIds: string[];
  concepts: string[];
  backbone: string[];
  bridgeCandidates: Array<{ from: string; to: string; text: string; conversationIds: string[] }>;
  freeCardCandidates: Array<{ type: "insight" | "draft"; title: string; body?: string; conversationIds: string[] }>;
}

/** One compact structure request per profile batch. Failed batches retain their cached profile structure. */
export async function planKnowledgeComposition(input: {
  profiles: ConversationSemanticProfile[];
  historicalProfiles?: ConversationSemanticProfile[];
  freshIds: Set<string>;
  existingDomainTitles: string[];
  intent?: string;
  enrich?: boolean;
  loadEvidence?: (conversationId: string, query: string) => Promise<SourceExcerpt[]>;
  provider?: AtlasAIProvider;
  requireAI?: boolean;
  onRequest?: (inputLength: number, outputLength: number, failed: boolean) => void;
  onJudgeRequest?: (inputLength: number, outputLength: number, failed: boolean) => void;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
  onPhase?: () => void;
}): Promise<{ profiles: ConversationSemanticProfile[]; domains: PlannedKnowledgeDomain[] }> {
  if (!input.provider || !input.freshIds.size) return { profiles: input.profiles, domains: [] };
  const fresh = input.profiles.filter((profile) => input.freshIds.has(profile.conversationId));
  const fullRecomposition = fresh.length === input.profiles.length;
  const contextPool = [...input.profiles, ...(input.historicalProfiles ?? [])];
  const assignments = new Map<string, Set<string>>();
  const domains: PlannedKnowledgeDomain[] = [];
  for (let start = 0; start < fresh.length; start += 24) {
    input.signal?.throwIfAborted();
    const batch = fresh.slice(start, start + 24);
    const conceptSignal = new Set(batch.flatMap((profile) => profile.concepts.map((name) => conceptKey(canonicalConceptTitle(name)))));
    const domainSignal = new Set(batch.flatMap((profile) => profile.domains.map(compositionKey)));
    const batchIds = new Set(batch.map((profile) => profile.conversationId));
    const context = contextPool.filter((profile) => !batchIds.has(profile.conversationId) && (fullRecomposition ? fresh.indexOf(profile) < start : !input.freshIds.has(profile.conversationId))).map((profile) => ({ profile, score: profile.concepts.filter((name) => conceptSignal.has(conceptKey(canonicalConceptTitle(name)))).length * 3 + profile.domains.filter((name) => domainSignal.has(compositionKey(name))).length })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 8).map((item) => item.profile);
    const allowedIds = new Set([...batch, ...context].map((profile) => profile.conversationId));
    const knownConcepts = new Map([...batch, ...context].flatMap((profile) => profile.concepts.map((concept) => [compositionKey(concept), concept] as const)));
    const prompt = JSON.stringify({ intent: input.intent, enrich: input.enrich ?? true, existingDomains: input.existingDomainTitles.slice(0, 12), newProfiles: batch.map((profile) => ({ id: profile.conversationId, title: profile.title, summary: profile.summary.slice(0, 180), concepts: profile.concepts.slice(0, 9), currentDomains: profile.domains.slice(0, 3) })), relatedExistingProfiles: context.map((profile) => ({ id: profile.conversationId, summary: profile.summary.slice(0, 100), concepts: profile.concepts.slice(0, 7), domains: profile.domains.slice(0, 2) })), task: input.intent ? "Organize only the user's stated intent into one knowledge space. Select relevant supplied concepts and an evidence-grounded backbone. Do not classify unrelated domains or invent sources. Propose sparse bridges and insights. Return strict JSON." : "Infer long-term domains first, then choose the important sourced concepts and a concept backbone. Produce a patch involving newProfiles; relatedExistingProfiles may provide cross-conversation context and sources. Reuse an existing domain if semantically the same. Do not create a domain per conversation. Do not invent concepts or sources; use the supplied concept names and conversation IDs. Cross-domain or non-obvious bridges must explain why two concepts connect. Insight synthesizes at least two conversations; draft asks for the user's missing judgment without answering it. Omit low-value candidates. Per domain: 5–15 concepts when evidence supports them, at most 5 bridges and 3 insight/draft cards. Return strict JSON.", schema: { domains: [{ title: "meaningful domain", conversationIds: ["source conversation id"], concepts: ["supplied concept"], backbone: ["ordered supplied concept"], bridgeCandidates: [{ from: "concept", to: "concept", text: "specific explanatory link", conversationIds: ["source id"] }], freeCardCandidates: [{ type: "insight | draft", title: "short title or question", body: "only for insight", conversationIds: ["source ids"] }] }] } });
    try {
      const request = { taskType: "knowledge_planning" as const, conversationIds: [...allowedIds], system: "Plan an evidence-grounded knowledge composition from cached conversation profiles. Understand the domains and conceptual backbone before relations. Propose sparse cards, never fabricate sources. Return strict JSON.", prompt, validate: (value: unknown) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { domains?: unknown }).domains)) throw new Error("Invalid domain plan");
        return (value as { domains: Array<Record<string, unknown>> }).domains;
      } };
      const raw = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
      input.onRequest?.(prompt.length, JSON.stringify(raw).length, false);
      for (const item of raw) {
        if (typeof item.title !== "string" || item.title.trim().length < 2 || !Array.isArray(item.conversationIds) || !Array.isArray(item.concepts)) continue;
        const conversationIds = [...new Set((item.conversationIds as unknown[]).filter((id): id is string => typeof id === "string" && allowedIds.has(id)))];
        const concepts = [...new Set((item.concepts as unknown[]).filter((name): name is string => typeof name === "string").map((name) => knownConcepts.get(compositionKey(name))).filter((name): name is string => Boolean(name)))].slice(0, 15);
        if (!conversationIds.some((id) => input.freshIds.has(id)) || !concepts.length) continue;
        const conceptSet = new Set(concepts.map(compositionKey));
        const backbone = Array.isArray(item.backbone) ? (item.backbone as unknown[]).filter((name): name is string => typeof name === "string" && conceptSet.has(compositionKey(name))).map((name) => knownConcepts.get(compositionKey(name))!).slice(0, 15) : concepts;
        const context = [item.title, ...concepts];
        const bridgeCandidates = input.enrich === false ? [] : selectCompositionCandidates(Array.isArray(item.bridgeCandidates) ? item.bridgeCandidates as Array<Record<string, unknown>> : [], COMPOSITION_BUDGET.knowledge.bridges, (candidate) => [String(candidate.from), String(candidate.to)].sort().join(":"), (candidate) => typeof candidate.from === "string" && typeof candidate.to === "string" && candidate.from !== candidate.to && conceptSet.has(compositionKey(candidate.from)) && conceptSet.has(compositionKey(candidate.to)) && usefulCompositionText(candidate.text, context) && Array.isArray(candidate.conversationIds) && candidate.conversationIds.some((id) => conversationIds.includes(String(id)))).map((candidate) => ({ from: knownConcepts.get(compositionKey(String(candidate.from)))!, to: knownConcepts.get(compositionKey(String(candidate.to)))!, text: String(candidate.text).trim().slice(0, 160), conversationIds: (candidate.conversationIds as string[]).filter((id) => conversationIds.includes(id)) }));
        const freeCardCandidates = input.enrich === false ? [] : selectCompositionCandidates(Array.isArray(item.freeCardCandidates) ? item.freeCardCandidates as Array<Record<string, unknown>> : [], COMPOSITION_BUDGET.knowledge.freeCards, (candidate) => `${candidate.type}:${candidate.title}`, (candidate) => (candidate.type === "insight" || candidate.type === "draft") && typeof candidate.title === "string" && candidate.title.trim().length >= 4 && Array.isArray(candidate.conversationIds) && new Set(candidate.conversationIds.filter((id) => conversationIds.includes(String(id)))).size >= (candidate.type === "insight" ? 2 : 1) && (candidate.type === "draft" || usefulCompositionText(candidate.body, context))).map((candidate) => ({ type: candidate.type as "insight" | "draft", title: String(candidate.title).trim().slice(0, 50), body: candidate.type === "insight" ? String(candidate.body).trim().slice(0, 220) : undefined, conversationIds: (candidate.conversationIds as string[]).filter((id) => conversationIds.includes(id)) }));
        const domain = { title: item.title.trim().slice(0, 32), conversationIds, concepts, backbone: backbone.length ? backbone : concepts, bridgeCandidates, freeCardCandidates };
        domains.push(domain);
        for (const id of conversationIds) if (input.freshIds.has(id)) assignments.set(id, (assignments.get(id) ?? new Set()).add(domain.title));
      }
    } catch (error) { input.signal?.throwIfAborted(); input.onRequest?.(prompt.length, 0, true); if (input.requireAI) throw error; }
    input.onProgress?.(Math.min(fresh.length, start + batch.length), fresh.length);
  }
  input.onPhase?.();
  if (!input.intent && fresh.length > 24 && domains.length > 1) {
    const prompt = JSON.stringify({ domainCandidates: domains.map((domain) => ({ title: domain.title, concepts: domain.concepts.slice(0, 8), conversationCount: domain.conversationIds.length })), existingDomains: input.existingDomainTitles.slice(0, 12), task: "Globally compare all domain candidates, including non-adjacent batches. Return only merges for truly identical or highly overlapping long-term domains. Both from and to must exactly match supplied candidate titles; prefer an existing domain title when present. Do not merge merely related domains.", schema: { merges: [{ from: "candidate title", to: "candidate title" }] } });
    try {
      const request = { taskType: "global_merge" as const, conversationIds: [...new Set(domains.flatMap((domain) => domain.conversationIds))], system: "Conservative global semantic merge for a personal knowledge structure. Return strict JSON.", prompt, validate: (value: unknown) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { merges?: unknown }).merges)) throw new Error("Invalid domain merges");
        return (value as { merges: Array<Record<string, unknown>> }).merges;
      } };
      const merges = await (input.provider.synthesize?.(request) ?? input.provider.generateStructured(request));
      input.onRequest?.(prompt.length, JSON.stringify(merges).length, false);
      const titles = new Set(domains.map((domain) => domain.title));
      const redirects = new Map<string, string>();
      for (const item of merges) if (typeof item.from === "string" && typeof item.to === "string" && item.from !== item.to && titles.has(item.from) && titles.has(item.to) && !redirects.has(item.from) && !redirects.has(item.to)) redirects.set(item.from, item.to);
      const canonical = (title: string) => { const seen = new Set<string>(); while (redirects.has(title) && !seen.has(title)) { seen.add(title); title = redirects.get(title)!; } return title; };
      for (const domain of domains) domain.title = canonical(domain.title);
      for (const [id, titlesForConversation] of assignments) assignments.set(id, new Set([...titlesForConversation].map(canonical)));
    } catch { input.signal?.throwIfAborted(); input.onRequest?.(prompt.length, 0, true); }
  }
  const merged = new Map<string, PlannedKnowledgeDomain>();
  for (const domain of domains) {
    const key = compositionKey(domain.title);
    const previous = merged.get(key);
    if (!previous) { merged.set(key, domain); continue; }
    previous.conversationIds = [...new Set([...previous.conversationIds, ...domain.conversationIds])];
    previous.concepts = [...new Set([...previous.concepts, ...domain.concepts])].slice(0, 15);
    previous.backbone = [...new Set([...previous.backbone, ...domain.backbone])].slice(0, 15);
    previous.bridgeCandidates = selectCompositionCandidates([...previous.bridgeCandidates, ...domain.bridgeCandidates], COMPOSITION_BUDGET.knowledge.bridges, (candidate) => [candidate.from, candidate.to].sort().join(":"), () => true);
    previous.freeCardCandidates = selectCompositionCandidates([...previous.freeCardCandidates, ...domain.freeCardCandidates], COMPOSITION_BUDGET.knowledge.freeCards, (candidate) => `${candidate.type}:${candidate.title}`, () => true);
  }
  const mergedDomains = [...merged.values()];
  const insightCandidates = mergedDomains.flatMap((domain, domainIndex) => domain.freeCardCandidates.flatMap((card, cardIndex) => card.type === "insight" ? [{ id: `${domainIndex}:${cardIndex}`, domain, card }] : []));
  const accepted = new Set<string>();
  for (let start = 0; start < insightCandidates.length; start += 4) {
    const batch = insightCandidates.slice(start, start + 4);
    const originalEvidence = new Map<string, SourceExcerpt[]>();
    for (const { card } of batch) for (const id of card.conversationIds.slice(0, 3)) {
      if (input.loadEvidence) originalEvidence.set(`${id}:${card.title}`, (await input.loadEvidence(id, `${card.title} ${card.body ?? ""}`)).slice(0, 1).map((excerpt) => ({ ...excerpt, text: excerpt.text.slice(0, 400) })));
    }
    const prompt = JSON.stringify({ candidates: batch.map(({ id, domain, card }) => ({ id, domain: domain.title, title: card.title, claim: card.body, sources: card.conversationIds.slice(0, 2).map((conversationId) => ({ conversationId, summary: contextPool.find((profile) => profile.conversationId === conversationId)?.summary.slice(0, 350), excerpts: originalEvidence.get(`${conversationId}:${card.title}`) })) })), task: "For each proposed insight, judge if its exact claim is directly supported by the supplied summaries from at least two conversations and adds a useful synthesis beyond a domain label. Reject speculative claims. Return one decision per ID.", schema: { decisions: [{ id: "candidate id", supported: true, useful: true }] } });
    try {
      const request = { taskType: "insight_judge" as const, conversationIds: [...new Set(batch.flatMap(({ card }) => card.conversationIds))], system: "Conservative evidence judge. Reject unsupported or trivial cross-conversation insights. Return strict JSON.", prompt, validate: (value: unknown) => {
        if (!value || typeof value !== "object" || !Array.isArray((value as { decisions?: unknown }).decisions)) throw new Error("Invalid insight judgments");
        return (value as { decisions: Array<Record<string, unknown>> }).decisions;
      } };
      const decisions = await (input.provider.decide?.(request) ?? input.provider.generateStructured(request));
      input.onJudgeRequest?.(prompt.length, JSON.stringify(decisions).length, false);
      for (const decision of decisions) if (typeof decision.id === "string" && batch.some((item) => item.id === decision.id) && decision.supported === true && decision.useful === true) accepted.add(decision.id);
    } catch { input.signal?.throwIfAborted(); input.onJudgeRequest?.(prompt.length, 0, true); }
  }
  for (const [domainIndex, domain] of mergedDomains.entries()) domain.freeCardCandidates = domain.freeCardCandidates.filter((card, cardIndex) => card.type !== "insight" || accepted.has(`${domainIndex}:${cardIndex}`));
  return { profiles: input.profiles.map((profile) => assignments.has(profile.conversationId) ? { ...profile, domains: [...assignments.get(profile.conversationId)!] } : profile), domains: mergedDomains };
}
