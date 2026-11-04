import type { ConversationGraph, KnowledgeProposal, OrganizationRun, OrganizationTaskEvent, OrganizationTaskStage, SourceRef } from "../shared/types";
import type { Conversation } from "../shared/types";
import type { KnowledgeOrganizeProgress } from "../ai/proposal-builder";

const stageMap: Record<KnowledgeOrganizeProgress["stage"], OrganizationTaskStage> = {
  profiles: "conversation_profiles", summaries: "conversation_profiles", planning: "domain_planning",
  quality: "structure_validation", relations: "relation_analysis", finishing: "bridge_insight_generation",
};
const weights: Record<KnowledgeOrganizeProgress["stage"], [number, number]> = {
  profiles: [4, 22], summaries: [22, 38], planning: [38, 56], quality: [56, 64], relations: [64, 88], finishing: [88, 94],
};

export function knowledgeProgress(progress: KnowledgeOrganizeProgress): Pick<OrganizationRun, "stage" | "progress" | "work"> {
  const [start, end] = weights[progress.stage];
  const ratio = progress.total > 0 ? Math.min(1, progress.completed / progress.total) : progress.completed > 0 ? 1 : 0;
  return { stage: stageMap[progress.stage], progress: Math.round(start + (end - start) * ratio), work: { current: progress.completed, total: progress.total } };
}

export const organizationSteps = {
  conversation: ["preparing", "question_analysis", "structure_planning", "structure_validation", "proposal_ready"],
  knowledge: ["preparing", "conversation_profiles", "domain_planning", "relation_analysis", "proposal_ready"],
} as const satisfies Record<string, readonly OrganizationTaskStage[]>;

/** Rough first-run request count for an explicit Knowledge Space source scope. */
export function estimateKnowledgeRequests(conversations: Conversation[], mode: "fast" | "balanced" | "deep" = "balanced"): { core: number; withOptionalChecks: number } {
  if (!conversations.length) return { core: 0, withOptionalChecks: 0 };
  const sampleLimit = mode === "fast" ? 8 : mode === "deep" ? 24 : 12;
  const questions = conversations.reduce((total, conversation) => total + Math.min(sampleLimit, Math.max(1, Math.ceil((conversation.messageCount ?? 2) / 2))), 0);
  const core = Math.ceil(questions / 12) + Math.ceil(conversations.length / 8) + Math.ceil(conversations.length / 24);
  return { core, withOptionalChecks: core + 5 + Number(conversations.length > 24) };
}

export function organizationStepPosition(run: OrganizationRun): { current: number; total: number; stages: readonly OrganizationTaskStage[] } {
  const stages = run.targetType === "conversation" ? organizationSteps.conversation : organizationSteps.knowledge;
  const stage = run.targetType === "conversation" ? run.stage : run.stage === "structure_planning" ? "conversation_profiles" : run.stage === "structure_validation" ? "domain_planning" : run.stage === "bridge_insight_generation" ? "relation_analysis" : run.stage;
  const index = stages.indexOf(stage as never);
  return { current: run.status === "completed" ? stages.length : Math.max(1, index + 1), total: stages.length, stages };
}

export function upsertProgressEvent(events: OrganizationTaskEvent[], message: string, current: number, total: number, timestamp = Date.now()): OrganizationTaskEvent[] {
  const next = events.filter((event) => event.type !== "progress" || event.message !== message);
  return [...next, { type: "progress", message, current, total, timestamp }];
}

export function mergeTaskEvents(existing: OrganizationTaskEvent[], incoming: OrganizationTaskEvent[]): OrganizationTaskEvent[] {
  const key = (event: OrganizationTaskEvent) => event.type === "progress" ? `${event.type}:${event.message}`
    : "title" in event ? `${event.type}:${event.title}`
      : event.type === "relation_found" ? `${event.type}:${event.from}:${event.to}:${event.relationType}`
        : event.type === "concept_merged" ? `${event.type}:${event.from.join("|")}:${event.to}`
          : event.type === "proposal_ready" ? `${event.type}:${event.proposalId}`
            : event.type === "structure_revision" ? `${event.type}:${event.message}` : event.type;
  const next = [...existing];
  for (const event of incoming) {
    const index = next.findIndex((item) => key(item) === key(event));
    if (index < 0) next.push(event);
    else if ("sourceRefs" in event && event.sourceRefs && (("sourceRefs" in next[index] ? (next[index] as { sourceRefs?: SourceRef[] }).sourceRefs?.length ?? 0 : 0) < event.sourceRefs.length)) next[index] = event;
  }
  return next;
}

const uniqueRefs = (refs: SourceRef[]) => refs.filter((ref, index, all) => all.findIndex((item) => `${item.conversationId}:${item.questionId ?? ""}:${item.messageId ?? ""}` === `${ref.conversationId}:${ref.questionId ?? ""}:${ref.messageId ?? ""}`) === index);

export function eventsFromKnowledgeProposal(proposal: KnowledgeProposal, timestamp = Date.now()): OrganizationTaskEvent[] {
  const cards = new Map(proposal.cards.map((card) => [card.id, card]));
  const refsForCard = (cardId: string) => cards.get(cardId)?.evidenceRefs?.length ? cards.get(cardId)!.evidenceRefs! : proposal.sources.filter((source) => source.cardId === cardId).map((source) => ({ conversationId: source.conversationId }));
  const refsForCanvas = (canvasId: string) => uniqueRefs(proposal.memberships.filter((item) => item.canvasId === canvasId).flatMap((item) => refsForCard(item.cardId)));
  const topics: OrganizationTaskEvent[] = proposal.canvases.map((canvas) => ({ type: "topic_found", title: canvas.title, sourceRefs: refsForCanvas(canvas.id), timestamp }));
  const visibleCards = [
    ...proposal.cards.filter((card) => card.type === "concept").slice(0, 8),
    ...proposal.cards.filter((card) => card.type !== "concept"),
  ];
  const discoveries: OrganizationTaskEvent[] = visibleCards.flatMap<OrganizationTaskEvent>((card) => {
    const refs = uniqueRefs(refsForCard(card.id));
    if (card.type === "bridge") return [{ type: "bridge_created" as const, title: card.title, body: card.body ?? card.title, sourceRefs: refs, timestamp }];
    if (card.type === "insight") return [{ type: "insight_created" as const, title: card.title, body: card.body ?? "", sourceRefs: refs, timestamp }];
    if (card.type === "draft") return [{ type: "draft_suggested" as const, title: card.title, body: card.body, sourceRefs: refs, timestamp }];
    return [{ type: "concept_found" as const, title: card.title, sourceRefs: refs, timestamp }];
  });
  const relations: OrganizationTaskEvent[] = proposal.relations.slice(0, 8).flatMap((relation) => {
    const from = cards.get(relation.fromCardId)?.title;
    const to = cards.get(relation.toCardId)?.title;
    return from && to ? [{ type: "relation_found" as const, from, to, relationType: relation.label ?? relation.type, sourceRefs: uniqueRefs(relation.evidenceRefs), timestamp }] : [];
  });
  const conceptCount = proposal.cards.filter((card) => card.type === "concept").length;
  const summaries: OrganizationTaskEvent[] = [
    ...(conceptCount > 8 ? [{ type: "progress" as const, message: "concept_found", current: conceptCount, total: conceptCount, timestamp }] : []),
    ...(proposal.relations.length > 8 ? [{ type: "progress" as const, message: "relation_found", current: proposal.relations.length, total: proposal.relations.length, timestamp }] : []),
  ];
  return [...topics, ...summaries, ...discoveries, ...relations, { type: "proposal_ready", proposalId: proposal.id, timestamp }];
}

export function eventsFromConversationGraph(graph: ConversationGraph, timestamp = Date.now()): OrganizationTaskEvent[] {
  const questionCount = graph.nodes.filter((node) => node.kind === "question").length;
  const progress: OrganizationTaskEvent = { type: "progress", message: "question_analysis", current: questionCount, total: questionCount, timestamp };
  const topics: OrganizationTaskEvent[] = (graph.chapters ?? []).map((chapter) => ({
    type: "topic_found", title: chapter.title,
    sourceRefs: chapter.questionIds.flatMap((id) => { const node = graph.nodes.find((item) => item.id === id); return node?.sourceMessageId ? [{ conversationId: graph.conversationId, questionId: id, messageId: node.sourceMessageId }] : []; }),
    timestamp,
  }));
  const compositions: OrganizationTaskEvent[] = graph.nodes.flatMap<OrganizationTaskEvent>((node) => {
    const refs = node.evidenceRefs ?? [];
    if (node.kind === "bridge") return [{ type: "bridge_created" as const, title: node.title, body: node.description ?? node.title, sourceRefs: refs, timestamp }];
    if (node.kind === "insight") return [{ type: "insight_created" as const, title: node.title, body: node.description ?? "", sourceRefs: refs, timestamp }];
    if (node.kind === "draft") return [{ type: "draft_suggested" as const, title: node.title, body: node.description, sourceRefs: refs, timestamp }];
    return [];
  });
  return [progress, ...topics, ...compositions];
}
