import type { ConversationGraph, ConversationGraphEdge } from "../shared/types";

export function visibleConversationNodeIds(graph: ConversationGraph, editable: boolean, hiddenIds: Set<string>, focusChapterId: string | null): Set<string> {
  const chapters = graph.chapters ?? [];
  const showTitleCard = graph.organizationMode === "manual" || chapters.some((chapter) => chapter.createdManually);
  const visible = new Set<string>();
  for (const node of graph.nodes) {
    if (node.kind === "conversation-root" && !editable && graph.nodes.some((item) => item.kind !== "conversation-root") && (!showTitleCard || Boolean(focusChapterId))) continue;
    if (!editable && chapters.length && node.kind === "chapter" && focusChapterId && node.id !== focusChapterId) continue;
    if (!editable && chapters.length && (node.kind === "bridge" || node.kind === "insight" || node.kind === "draft") && focusChapterId) continue;
    if (graph.organizationMode !== "manual" && chapters.length && node.kind === "question") {
      const chapter = chapters.find((item) => item.questionIds.includes(node.id));
      if (editable && (!chapter || chapter.collapsed)) continue;
      if (!editable && (!focusChapterId || chapter?.id !== focusChapterId)) continue;
    }
    if (!hiddenIds.has(node.id)) visible.add(node.id);
  }
  return visible;
}

/** A chapter owns its member questions, not the following chapters on the mainline. */
export function hiddenConversationNodeIds(graph: ConversationGraph, collapsedIds: Set<string>, editable: boolean): Set<string> {
  const hidden = new Set<string>();
  const chapterIds = new Set(graph.chapters?.map((chapter) => chapter.id) ?? []);
  const descendantsOf = (root: string) => {
    const queue = graph.edges.filter((edge) => edge.source === root).map((edge) => edge.target);
    const visited = new Set<string>([root]);
    while (queue.length) {
      const id = queue.shift()!;
      if (visited.has(id)) continue;
      visited.add(id);
      hidden.add(id);
      queue.push(...graph.edges.filter((edge) => edge.source === id).map((edge) => edge.target));
    }
  };
  for (const id of collapsedIds) if (!chapterIds.has(id)) descendantsOf(id);
  if (editable) for (const chapter of graph.chapters ?? []) if (chapter.collapsed) {
    for (const id of chapter.questionIds) hidden.add(id);
  }
  return hidden;
}

export function visibleConversationEdges(graph: ConversationGraph, visibleIds: Set<string>, editable: boolean, focusChapterId: string | null): ConversationGraphEdge[] {
  return graph.edges.filter((edge) => {
    if (!visibleIds.has(edge.source) || !visibleIds.has(edge.target)) return false;
    if (graph.chapters?.length && !editable) {
      if (focusChapterId) return edge.id.startsWith("question-relation-") && graph.questionRelations?.some((relation) => `question-relation-${relation.targetId}` === edge.id && relation.type !== "continue");
      return edge.id.startsWith("chapter-edge-") || edge.id.startsWith("conversation-free-edge-") || graph.organizationMode === "manual" && (edge.relation === "attachment" || graph.nodes.some((node) => node.id === edge.target && node.kind === "chapter"));
    }
    return true;
  });
}
