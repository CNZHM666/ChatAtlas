import type {
  Conversation,
  ConversationChapter,
  ConversationGraph,
  ConversationGraphEdge,
  ConversationGraphNode,
  ConversationMessage,
} from "../shared/types";
import { getStoredConversationGraph, saveStoredConversationGraph } from "../storage/conversation-graphs";
import { buildConversationStructure, questionDisplayTitle, refineChapterGroups, type ConversationStructure } from "./conversation-structurer";
import { COMPOSITION_BUDGET } from "../ai/composition-guard";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";

const LEGACY_STORAGE_PREFIX = "atlas-conversation-graph:";

function compact(text: string, length = 88): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  return normalized.length > length ? `${normalized.slice(0, length - 1)}…` : normalized;
}

/** Build once per message list so moving cards never has to sort the transcript again. */
export function indexAnswersByQuestion(messages: ConversationMessage[]): Map<string, ConversationMessage[]> {
  const ordered = [...messages].sort((a, b) => a.messageIndex - b.messageIndex);
  const answers = new Map<string, ConversationMessage[]>(ordered.filter((item) => item.role === "user").map((item) => [item.id, []]));
  const userByPlatformId = new Map(ordered.filter((item) => item.role === "user" && item.platformMessageId).map((item) => [item.platformMessageId!, item.id]));
  let question: ConversationMessage | undefined;
  for (const item of ordered) {
    if (item.role === "user") question = item;
    else if (item.role === "assistant" && item.content.trim() && !isInternalSearchQueryMessage(item)) {
      const target = item.replyToMessageId && (answers.has(item.replyToMessageId) ? item.replyToMessageId : userByPlatformId.get(item.replyToMessageId));
      const id = target ?? (question && item.messageIndex > question.messageIndex ? question.id : undefined);
      if (id && answers.has(id)) answers.get(id)!.push(item);
    }
  }
  return answers;
}

/** Stored relation wins while it still resolves; otherwise use the first visible assistant before the next user turn. */
export function findAnswerForQuestion(messages: ConversationMessage[], question: ConversationMessage, preferredId?: string, indexed?: Map<string, ConversationMessage[]>): ConversationMessage | undefined {
  const candidates = (indexed ?? indexAnswersByQuestion(messages)).get(question.id) ?? [];
  return candidates.find((item) => item.id === preferredId || item.platformMessageId === preferredId) ?? candidates[0];
}

export function compactConversationPosition(index: number): { x: number; y: number } {
  const rank = index + 1;
  const lane = Math.floor(rank / 4);
  return { x: 60 + (lane % 2 ? 3 - rank % 4 : rank % 4) * 304, y: 64 + lane * 182 };
}

/** Compact ranks for a linear follow-up, with siblings stacked only when the graph branches. */
export function layoutConversationGraph(graph: ConversationGraph): ConversationGraph {
  const root = graph.nodes.find((node) => node.kind === "conversation-root") ?? graph.nodes[0];
  if (!root) return graph;
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const source = queue.shift()!;
    for (const edge of graph.edges.filter((item) => item.source === source)) {
      if (depth.has(edge.target)) continue;
      depth.set(edge.target, (depth.get(source) ?? 0) + 1);
      queue.push(edge.target);
    }
  }
  const rows = new Map<number, number>();
  return { ...graph, nodes: graph.nodes.map((node) => {
    const rank = depth.get(node.id) ?? Math.max(1, ...depth.values()) + 1;
    const lane = Math.floor(rank / 4);
    const column = lane % 2 ? 3 - rank % 4 : rank % 4;
    const row = rows.get(rank) ?? 0;
    rows.set(rank, row + 1);
    return { ...node, x: 60 + column * 304, y: 64 + lane * 182 + row * 164, positionSource: "auto" as const };
  }) };
}

function normalizeGraph(graph: ConversationGraph): ConversationGraph {
  const legacyAnswers = new Set(graph.nodes.filter((node) => (node.kind as string) === "message" && node.role === "assistant").map((node) => node.id));
  const legacyNodes = graph.nodes.filter((node) => !legacyAnswers.has(node.id));
  const migratedNodes = legacyNodes.map((node, index) => {
    const legacyKind = node.kind as string;
    const next = graph.nodes.find((item) => item.id === graph.edges.find((edge) => edge.source === node.id)?.target);
    const answer = next && legacyAnswers.has(next.id) ? next : graph.nodes.find((item) => legacyAnswers.has(item.id) && item.y >= node.y && item.y < node.y + 174);
    return {
      ...node,
      kind: legacyKind === "root" ? "conversation-root" : legacyKind === "message" ? "question" : node.kind,
      ...(legacyKind === "message" && answer ? { answerMessageId: answer.sourceMessageId, answerPreview: answer.description ?? answer.title, answerCharCount: (answer.description ?? answer.title).length } : {}),
      ...(legacyKind === "message" && !node.role && index > 0 ? { role: "user" as const } : {}),
    };
  });
  const legacyGraph = legacyAnswers.size > 0;
  const questionNodes = migratedNodes.filter((node) => node.kind === "question");
  const preservedEdges = graph.edges.filter((edge) => !legacyAnswers.has(edge.source) && !legacyAnswers.has(edge.target));
  const repairedEdges = legacyGraph ? questionNodes.map((node, index) => ({
    id: `migrated-edge-${graph.conversationId}-${index}`,
    conversationId: graph.conversationId,
    source: index ? questionNodes[index - 1].id : migratedNodes.find((item) => item.kind === "conversation-root")?.id ?? node.id,
    target: node.id,
    relation: "structural" as const,
  })).filter((edge) => edge.source !== edge.target && !preservedEdges.some((item) => item.source === edge.source && item.target === edge.target)) : [];
  return {
    ...graph,
    nodes: migratedNodes,
    edges: [...preservedEdges, ...repairedEdges].map((edge) => ({ ...edge, relation: edge.relation ?? "structural" })),
  };
}

const QUESTION_SPACING = 132;

/** Center each chapter's auto-positioned questions around its own center line. */
export function layoutChapterMembers(graph: ConversationGraph, startY = 112): ConversationGraph {
  if (!graph.chapters?.length) return graph;
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const ordered = [...graph.chapters].sort((a, b) => a.order - b.order);
  const positions = new Map<string, { x: number; y: number }>();
  let previousY = startY;
  let previousCount = 1;
  for (const [index, chapter] of ordered.entries()) {
    const chapterNode = nodesById.get(chapter.id);
    const count = Math.max(1, chapter.questionIds.length);
    const suggestedY = index ? previousY + 176 + (previousCount + count - 2) * QUESTION_SPACING / 2 : startY;
    const y = chapterNode?.positionSource === "user" ? chapterNode.y : suggestedY;
    const x = chapterNode?.x ?? chapter.x ?? 104;
    if (chapterNode && chapterNode.positionSource !== "user") positions.set(chapter.id, { x, y });
    chapter.questionIds.forEach((id, questionIndex) => {
      const question = nodesById.get(id);
      if (question?.kind === "question" && question.positionSource !== "user") {
        positions.set(id, { x: x + 348, y: y + (questionIndex - (count - 1) / 2) * QUESTION_SPACING });
      }
    });
    previousY = y;
    previousCount = count;
  }
  const first = ordered[0];
  const firstY = positions.get(first.id)?.y ?? nodesById.get(first.id)?.y;
  const root = graph.nodes.find((node) => node.kind === "conversation-root");
  if (root && root.positionSource !== "user" && firstY !== undefined) positions.set(root.id, { x: root.x, y: firstY - 11 });
  return { ...graph, chapterLayoutVersion: 6, chapters: graph.chapters.map((chapter) => ({ ...chapter, x: positions.get(chapter.id)?.x ?? nodesById.get(chapter.id)?.x ?? chapter.x, y: positions.get(chapter.id)?.y ?? nodesById.get(chapter.id)?.y ?? chapter.y })), nodes: graph.nodes.map((node) => positions.has(node.id) ? { ...node, ...positions.get(node.id)!, positionSource: "auto" as const } : node) };
}

export function generateConversationGraph(
  conversation: Conversation,
  messages: ConversationMessage[],
  structureOverride?: ConversationStructure,
): ConversationGraph {
  const rootId = `conversation-root-${conversation.id}`;
  const questions = messages.filter((message) => message.role === "user");
  const answerIndex = indexAnswersByQuestion(messages);
  const root: ConversationGraphNode = {
    id: rootId,
    conversationId: conversation.id,
    kind: "conversation-root",
    title: conversation.title,
    description: conversation.summary,
    x: 60,
    y: 64,
  };
  const nodes = questions.map<ConversationGraphNode>((message, index) => {
    const answer = findAnswerForQuestion(messages, message, undefined, answerIndex);
    return {
      id: `conversation-message-${message.id}`,
      conversationId: conversation.id,
      kind: "question",
      title: compact(message.preview || message.content),
      sourceMessageId: message.id,
      answerMessageId: answer?.id,
      answerPreview: answer ? compact(answer.content, 180) : undefined,
      answerCharCount: answer?.content.length,
      sourceCreatedAt: message.createdAt,
      role: "user",
      ...compactConversationPosition(index),
    };
  });
  const edges = nodes.map<ConversationGraphEdge>((node, index) => ({
    id: `conversation-edge-${conversation.id}-${index}`,
    conversationId: conversation.id,
    source: index === 0 ? rootId : nodes[index - 1].id,
    target: node.id,
    relation: "structural",
  }));
  return upgradeConversationStructure(layoutConversationGraph({ conversationId: conversation.id, nodes: [root, ...nodes], edges, updatedAt: Date.now() }), conversation, messages, structureOverride);
}

/** A legacy first-open timeline has no chosen organization mode or authored structure. */
export function isUntouchedConversationTimeline(graph: ConversationGraph): boolean {
  if (graph.organizationMode || graph.userEdited || graph.analysisVersion || graph.chapters?.length || graph.episodes?.length) return false;
  if (graph.nodes.some((node) => node.kind !== "conversation-root" && node.kind !== "question" || node.positionSource === "user")) return false;
  const root = graph.nodes.find((node) => node.kind === "conversation-root");
  const questions = graph.nodes.filter((node) => node.kind === "question");
  if (!root || graph.edges.length !== questions.length) return false;
  return questions.every((question, index) => graph.edges.some((edge) => edge.source === (index ? questions[index - 1].id : root.id) && edge.target === question.id && edge.relation === "structural"));
}

/** Manual organization starts with a source anchor; questions are added only by the user. */
export function createManualConversationGraph(conversation: Conversation): ConversationGraph {
  return {
    conversationId: conversation.id,
    organizationMode: "manual",
    nodes: [{ id: `conversation-root-${conversation.id}`, conversationId: conversation.id, kind: "conversation-root", title: conversation.title, description: conversation.summary, x: 80, y: 100, positionSource: "auto" }],
    edges: [], chapters: [], questionRelations: [], chapterLayoutVersion: 6, userEdited: true, updatedAt: Date.now(),
  };
}

export function addManualChapter(graph: ConversationGraph, title: string, now = Date.now()): ConversationGraph {
  const name = title.trim();
  if (!name) return graph;
  const chapters = graph.chapters ?? [];
  const order = chapters.length;
  const id = `conversation-chapter-${crypto.randomUUID()}`;
  const chapter: ConversationChapter = { id, conversationId: graph.conversationId, title: name.slice(0, 52), questionIds: [], order, collapsed: true, source: "user", createdManually: true, createdAt: now, updatedAt: now };
  return materializeManualChapterCards({ ...graph, chapters: [...chapters, chapter], chapterLayoutVersion: 6, userEdited: true, updatedAt: now });
}

/** A chapter created in the sidebar is immediately part of the canvas. Existing placed cards keep their layout and links. */
export function materializeManualChapterCards(graph: ConversationGraph): ConversationGraph {
  if (!graph.chapters?.length) return graph;
  const root = graph.nodes.find((node) => node.kind === "conversation-root");
  if (!root) return graph;
  const nodes = [...graph.nodes];
  const edges = [...graph.edges];
  const chapters = graph.chapters.map((chapter) => {
    if (graph.organizationMode !== "manual" && !chapter.createdManually) return chapter;
    if (nodes.some((node) => node.id === chapter.id)) return chapter;
    const x = root.x + 360;
    let y = root.y + chapter.order * 132;
    while (nodes.some((node) => Math.abs(node.x - x) < 260 && Math.abs(node.y - y) < 110)) y += 132;
    nodes.push({ id: chapter.id, conversationId: graph.conversationId, kind: "chapter", title: chapter.title, x, y, positionSource: "auto" });
    edges.push({ id: `chapter-edge-${chapter.id}`, conversationId: graph.conversationId, source: root.id, target: chapter.id, relation: "structural" });
    return { ...chapter, x, y };
  });
  return nodes.length === graph.nodes.length ? graph : layoutChapterMembers({ ...graph, nodes, edges, chapters }, root.y + 11);
}

export function attachQuestionToChapter(graph: ConversationGraph, chapterId: string, questionId: string, questionOrder: ReadonlyMap<string, number> = new Map()): ConversationGraph {
  if (!graph.chapters?.some((chapter) => chapter.id === chapterId) || !questionId.startsWith("conversation-message-")) return graph;
  const chapterIds = new Set(graph.chapters.map((chapter) => chapter.id));
  const affectedChapterIds = new Set(graph.chapters.filter((chapter) => chapter.id === chapterId || chapter.questionIds.includes(questionId)).map((chapter) => chapter.id));
  const chapters = graph.chapters.map((chapter) => {
    const without = chapter.questionIds.filter((id) => id !== questionId);
    return chapter.id === chapterId ? { ...chapter, questionIds: [...without, questionId].sort((a, b) => (questionOrder.get(a) ?? Infinity) - (questionOrder.get(b) ?? Infinity)), updatedAt: Date.now() } : { ...chapter, questionIds: without };
  });
  const placed = graph.nodes.some((node) => node.id === questionId && node.kind === "question") && graph.nodes.some((node) => node.id === chapterId && node.kind === "chapter");
  return layoutChapterMembers({ ...graph, chapters, edges: [...graph.edges.filter((edge) => !(edge.target === questionId && (chapterIds.has(edge.source) && edge.id.startsWith("chapter-member-") || edge.source === chapterId && edge.id.startsWith("chapter-reference-")))), ...(placed ? [{ id: `chapter-member-${questionId}`, conversationId: graph.conversationId, source: chapterId, target: questionId, relation: "structural" as const }] : [])], episodes: graph.episodes?.filter((episode) => !affectedChapterIds.has(episode.chapterId)), userEdited: true, updatedAt: Date.now() }, graph.chapters[0]?.y ?? graph.nodes.find((node) => node.kind === "conversation-root")?.y ?? 112);
}

/** The first chapter owns the question's reading order; further chapter links are visual references. */
export function linkQuestionToChapter(graph: ConversationGraph, chapterId: string, questionId: string, questionOrder: ReadonlyMap<string, number> = new Map()): ConversationGraph {
  const owner = graph.chapters?.find((chapter) => chapter.questionIds.includes(questionId));
  if (!owner) return attachQuestionToChapter(graph, chapterId, questionId, questionOrder);
  if (owner.id === chapterId || !graph.chapters?.some((chapter) => chapter.id === chapterId) || graph.edges.some((edge) => edge.source === chapterId && edge.target === questionId)) return graph;
  return { ...graph, edges: [...graph.edges, { id: `chapter-reference-${crypto.randomUUID()}`, conversationId: graph.conversationId, source: chapterId, target: questionId, relation: "attachment" }], userEdited: true, updatedAt: Date.now() };
}

/** The initial manual anchor is a choice, not yet an authored structure. */
export function isEmptyManualConversationGraph(graph: ConversationGraph, conversation: Conversation): boolean {
  const root = graph.nodes[0];
  return graph.organizationMode === "manual" && graph.nodes.length === 1 && graph.edges.length === 0
    && !graph.chapters?.length
    && root.kind === "conversation-root" && root.title === conversation.title && root.description === conversation.summary
    && root.x === 80 && root.y === 100 && root.positionSource === "auto";
}

/** Upgrade older saved graphs in place; user positioned graphs remain under user control. */
export function upgradeConversationStructure(graph: ConversationGraph, conversation: Conversation, messages: ConversationMessage[], structureOverride?: ConversationStructure): ConversationGraph {
  if (graph.chapters) {
    if (!graph.userEdited && graph.chapterLayoutVersion !== 5 && graph.chapterLayoutVersion !== 6) {
      const contexts = new Map(messages.filter((message) => message.role === "user").map((message) => [`conversation-message-${message.id}`, message.content]));
      const questionCount = contexts.size;
      const minimumGroups = questionCount <= 12 ? 2 : questionCount <= 25 ? 3 : 5;
      const refined = refineChapterGroups(graph.chapters, contexts, { minimumGroups });
      const chapters = refined.map<ConversationChapter>((chapter, order) => ({ ...graph.chapters![0], id: `conversation-chapter-${conversation.id}-${order + 1}`, title: chapter.title, summary: chapter.summary, questionIds: chapter.questionIds, order, collapsed: true, source: "auto", updatedAt: Date.now() }));
      return generateConversationGraph(conversation, messages, { chapters, questionRelations: graph.questionRelations ?? [], bridges: [] });
    }
    return upgradeChapterLayout(graph);
  }
  const titles = new Map(messages.filter((message) => message.role === "user").map((message) => [message.id, questionDisplayTitle(message.content)]));
  const questions = graph.nodes.map((node) => node.kind === "question" && !node.displayTitle ? { ...node, displayTitle: titles.get(node.sourceMessageId ?? "") ?? node.title, displayTitleSource: "fallback" as const } : node);
  const legacyCustom = graph.nodes.some((node) => node.positionSource === "user" || node.kind === "topic" || node.kind === "bridge" || node.kind === "question" && (
    node.positionSource !== "auto" || node.title !== compact(messages.find((message) => message.id === node.sourceMessageId)?.preview || messages.find((message) => message.id === node.sourceMessageId)?.content || node.title)
  ));
  const oldQuestionIds = graph.nodes.filter((node) => node.kind === "question").map((node) => node.id);
  const rootId = graph.nodes.find((node) => node.kind === "conversation-root")?.id;
  const customEdges = oldQuestionIds.some((id, index) => !graph.edges.some((edge) => edge.target === id && edge.source === (index ? oldQuestionIds[index - 1] : rootId)));
  if (graph.userEdited || legacyCustom || customEdges) return { ...graph, nodes: questions, chapters: [], questionRelations: [] };
  const structure = structureOverride ?? buildConversationStructure(conversation, messages);
  if (!structure.chapters.length) return { ...graph, nodes: questions, chapters: [], questionRelations: structure.questionRelations };
  const root = questions.find((node) => node.kind === "conversation-root");
  const nodeById = new Map(questions.map((node) => [node.id, node]));
  const validBridges = (structure.bridges ?? []).filter((bridge) => bridge.toOrder === bridge.fromOrder + 1 && bridge.fromOrder >= 0 && bridge.toOrder < structure.chapters.length && bridge.questionIds.length > 0).slice(0, COMPOSITION_BUDGET.conversation.bridges);
  const chapters = structure.chapters.map((chapter, index) => {
    const x = 104;
    const y = 112 + index * 126 + validBridges.filter((bridge) => bridge.toOrder <= index).length * 74;
    return { ...chapter, x, y };
  });
  const chapterNodes = chapters.map((chapter) => ({
    id: chapter.id, conversationId: conversation.id, kind: "chapter" as const,
    title: chapter.title, description: chapter.summary, x: chapter.x, y: chapter.y,
  }));
  const questionPositions = new Map(chapters.flatMap((chapter) => chapter.questionIds.map((id, index) => [id, { x: 452, y: (chapter.y ?? 116) + index * 132 }] as const)));
  const moved = questions.map((node) => node.kind === "conversation-root" ? { ...node, x: -300, y: 98, positionSource: "auto" as const } : questionPositions.has(node.id) ? { ...node, ...questionPositions.get(node.id)!, positionSource: "auto" as const } : node);
  const bridgeNodes: ConversationGraphNode[] = validBridges.map((bridge, index) => ({
    id: `conversation-bridge-${conversation.id}-${index}`, conversationId: conversation.id, kind: "bridge", title: bridge.explanation,
    description: bridge.explanation, evidenceRefs: bridge.questionIds.map((questionId) => ({ conversationId: conversation.id, questionId: questionId.replace(/^conversation-message-/u, ""), messageId: questionId.replace(/^conversation-message-/u, "") })),
    x: 188, y: ((chapters[bridge.fromOrder].y ?? 116) + (chapters[bridge.toOrder].y ?? 116)) / 2 + 38,
  }));
  const validFreeCards = (structure.freeCards ?? []).filter((card) => chapters[card.afterOrder] && card.questionIds.length).slice(0, COMPOSITION_BUDGET.conversation.freeCards);
  const freeNodes: ConversationGraphNode[] = validFreeCards.map((card, index) => ({
    id: `conversation-${card.type}-${conversation.id}-${index}`, conversationId: conversation.id, kind: card.type,
    title: card.title, description: card.body, x: 480, y: (chapters[card.afterOrder].y ?? 116) + 18,
    evidenceRefs: card.questionIds.map((id) => ({ conversationId: conversation.id, questionId: id.replace(/^conversation-message-/u, ""), messageId: id.replace(/^conversation-message-/u, "") })),
  }));
  const freeEdges: ConversationGraphEdge[] = freeNodes.map((node, index) => ({ id: `conversation-free-edge-${node.id}`, conversationId: conversation.id, source: chapters[validFreeCards[index].afterOrder].id, target: node.id, relation: "attachment" }));
  const chapterEdges = chapters.flatMap<ConversationGraphEdge>((chapter, index) => {
    if (!index) return root ? [{ id: `chapter-edge-${conversation.id}-${index}`, conversationId: conversation.id, source: root.id, target: chapter.id, relation: "structural" as const }] : [];
    const bridge = validBridges.find((item) => item.toOrder === index);
    const bridgeNode = bridge && bridgeNodes[validBridges.indexOf(bridge)];
    return bridgeNode ? [
      { id: `chapter-edge-${conversation.id}-${index}-a`, conversationId: conversation.id, source: chapters[index - 1].id, target: bridgeNode.id, relation: "bridge" as const },
      { id: `chapter-edge-${conversation.id}-${index}-b`, conversationId: conversation.id, source: bridgeNode.id, target: chapter.id, relation: "bridge" as const },
    ] : [{ id: `chapter-edge-${conversation.id}-${index}`, conversationId: conversation.id, source: chapters[index - 1].id, target: chapter.id, relation: "structural" as const }];
  });
  const membershipEdges = chapters.flatMap((chapter) => chapter.questionIds.filter((id) => nodeById.has(id)).map((id) => ({
    id: `chapter-member-${id}`, conversationId: conversation.id, source: chapter.id, target: id, relation: "structural" as const,
  })));
  const relationEdges = structure.questionRelations.filter((relation) => nodeById.has(relation.sourceId) && nodeById.has(relation.targetId)).map((relation) => ({
    id: `question-relation-${relation.targetId}`, conversationId: conversation.id, source: relation.sourceId, target: relation.targetId, relation: "structural" as const,
  }));
  const manualEdges = graph.edges.filter((edge) => edge.relation !== "structural" || !nodeById.has(edge.target));
  return layoutChapterMembers({ ...graph, nodes: [...moved, ...chapterNodes, ...bridgeNodes, ...freeNodes], edges: [...chapterEdges, ...freeEdges, ...membershipEdges, ...relationEdges, ...manualEdges], chapters, questionRelations: structure.questionRelations, chapterLayoutVersion: 6 });
}

/** Move only auto-positioned chapters from the old grid to the ordered mainline. */
export function upgradeChapterLayout(graph: ConversationGraph): ConversationGraph {
  if (!graph.chapters?.length || graph.chapterLayoutVersion === 6) return graph;
  const chapters = graph.chapters.map((chapter, index) => {
    const node = graph.nodes.find((item) => item.id === chapter.id);
    return node?.positionSource === "user" ? chapter : { ...chapter, x: 104, y: 112 + index * 126 };
  });
  const positions = new Map(chapters.map((chapter) => [chapter.id, chapter]));
  const questionPositions = new Map(chapters.flatMap((chapter) => chapter.questionIds.map((id, index) => [id, { x: 452, y: (chapter.y ?? 116) + index * 132 }] as const)));
  const migrated = { ...graph, chapterLayoutVersion: 6, chapters, nodes: graph.nodes.map((node) => {
    const chapter = positions.get(node.id);
    if (chapter && node.positionSource !== "user") return { ...node, x: chapter.x ?? node.x, y: chapter.y ?? node.y, positionSource: "auto" as const };
    const question = questionPositions.get(node.id);
    return question && node.positionSource !== "user" ? { ...node, ...question } : node;
  }) };
  return layoutChapterMembers(migrated, 112);
}

/** Reconnect the visible chapter chain and its member questions after a manual merge or split. */
export function rebuildChapterEdges(graph: ConversationGraph): ConversationGraph {
  if (!graph.chapters) return graph;
  const root = graph.nodes.find((node) => node.kind === "conversation-root");
  const placedIds = new Set(graph.nodes.map((node) => node.id));
  const chapters = [...graph.chapters].filter((chapter) => placedIds.has(chapter.id)).sort((a, b) => a.order - b.order);
  const ordered = chapters.flatMap((chapter, index) => [
    { id: `chapter-edge-${chapter.id}`, conversationId: graph.conversationId, source: graph.organizationMode === "manual" || chapter.createdManually ? root?.id ?? chapter.id : index ? chapters[index - 1].id : root?.id ?? chapter.id, target: chapter.id, relation: "structural" as const },
    ...chapter.questionIds.filter((id) => placedIds.has(id)).map((id) => ({ id: `chapter-member-${id}`, conversationId: graph.conversationId, source: chapter.id, target: id, relation: "structural" as const })),
  ]).filter((edge) => edge.source !== edge.target);
  const relations = (graph.questionRelations ?? []).filter((relation) => placedIds.has(relation.sourceId) && placedIds.has(relation.targetId)).map((relation) => ({ id: `question-relation-${relation.targetId}`, conversationId: graph.conversationId, source: relation.sourceId, target: relation.targetId, relation: "structural" as const }));
  const preserved = graph.edges.filter((edge) => !edge.id.startsWith("chapter-edge-") && !edge.id.startsWith("chapter-question-edge-") && !edge.id.startsWith("chapter-question-") && !edge.id.startsWith("chapter-member-") && !edge.id.startsWith("question-relation-") && !edge.id.startsWith("merged-"))
    .filter((edge) => graph.nodes.some((node) => node.id === edge.source) && graph.nodes.some((node) => node.id === edge.target));
  return { ...graph, edges: [...ordered, ...relations, ...preserved] };
}

export async function loadConversationGraph(conversationId: string): Promise<ConversationGraph | null> {
  const stored = await getStoredConversationGraph(conversationId);
  if (stored) return materializeManualChapterCards(normalizeGraph(stored));
  try {
    const value = localStorage.getItem(`${LEGACY_STORAGE_PREFIX}${conversationId}`);
    if (!value) return null;
    const parsed = JSON.parse(value) as ConversationGraph;
    if (parsed.conversationId !== conversationId || !Array.isArray(parsed.nodes) || !Array.isArray(parsed.edges)) return null;
    const migrated = materializeManualChapterCards(normalizeGraph(parsed));
    await saveStoredConversationGraph(migrated);
    localStorage.removeItem(`${LEGACY_STORAGE_PREFIX}${conversationId}`);
    return migrated;
  } catch {
    return null;
  }
}

export async function saveConversationGraph(graph: ConversationGraph): Promise<void> {
  await saveStoredConversationGraph(normalizeGraph(graph));
}

export const conversationDragType = "application/x-atlas-conversation-node";
export const libraryConversationDragType = "application/x-atlas-library-conversation";

export interface ConversationDragPayload {
  kind: "conversation-root" | "question" | "chapter";
  conversationId: string;
  messageId?: string;
  chapterId?: string;
}

export function parseConversationDragPayload(value: string): ConversationDragPayload | null {
  try {
    const raw = JSON.parse(value) as ConversationDragPayload & { kind: string };
    const legacyKind = raw.kind as string;
    const kind = legacyKind === "root" ? "conversation-root" : legacyKind === "message" ? "question" : raw.kind;
    if ((kind !== "conversation-root" && kind !== "question" && kind !== "chapter") || !raw.conversationId) return null;
    if (kind === "question" && !raw.messageId) return null;
    if (kind === "chapter" && !raw.chapterId) return null;
    return { kind, conversationId: raw.conversationId, messageId: raw.messageId, chapterId: raw.chapterId };
  } catch {
    return null;
  }
}

export function parseLibraryConversationDrag(value: string): { conversationId: string } | null {
  try {
    const payload = JSON.parse(value) as { conversationId?: string };
    return payload.conversationId ? { conversationId: payload.conversationId } : null;
  } catch {
    return null;
  }
}
