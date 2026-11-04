import type { FocusSession, FocusSourceOutline } from "../shared/focus-session";
import type { ConversationChapter, ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import { isInternalSearchQueryMessage } from "../shared/conversation-text";

/** Source notes win; old reviews supply only a position-based outline fallback. */
export function sourceReviewOutline(conversationId: string, messages: ConversationMessage[], reviews: FocusSession[]): { chapters: ConversationChapter[]; anchors: Record<string, string>; outline?: FocusSourceOutline } {
  const readable = messages.filter((message) => !isInternalSearchQueryMessage(message));
  // A topic review must never become the complete original-conversation outline.
  const orderedReviews = reviews.filter((review) => review.scope?.kind !== "goal").map((review) => ({ ...review, sourceOutlines: review.sourceOutlines?.filter((outline) => outline.scope !== "partial") })).sort((a, b) => b.createdAt - a.createdAt);
  const outline = orderedReviews.flatMap((review) => review.sourceOutlines ?? []).find((item) => item.conversationId === conversationId && item.chapters.length && (!item.messageSignatures || Object.keys(item.messageSignatures).length === readable.length && readable.every((message) => item.messageSignatures?.[message.id] === sourceMessageSignature(message.content))) && (!item.messageOrder || item.messageOrder.join("\0") === [...readable].sort((a, b) => a.messageIndex - b.messageIndex).map(message => message.id).join("\0")) && (!item.messageRoles || readable.every(message => item.messageRoles?.[message.id] === message.role)));
  const stages = outline ? outline.chapters : (() => {
    if (orderedReviews.some((review) => review.sourceOutlines?.some((item) => item.conversationId === conversationId))) return [];
    const review = orderedReviews.find((item) => item.evidence.some((ref) => ref.conversationId === conversationId));
    if (!review) return [];
    const positions = new Map(readable.map((message) => [message.id, message.messageIndex]));
    const byId = new Map(review.evidence.filter((ref) => ref.conversationId === conversationId).map((ref) => [ref.id, ref]));
    const groups = new Map<number, { id: string; title: string; summary: string }>();
    for (const section of review.sections) {
      const indices = section.evidenceIds.flatMap((id) => { const ref = byId.get(id); return ref && positions.has(ref.messageId) ? [positions.get(ref.messageId)!] : []; });
      if (!indices.length) continue;
      const first = Math.min(...indices);
      const existing = groups.get(first);
      if (existing) { existing.summary += `\n\n## ${section.title}\n\n${section.body}`; }
      else groups.set(first, { id: `review-source:${review.id}:${section.id}`, title: section.title, summary: section.body });
    }
    const starts = [...groups.keys()].sort((a, b) => a - b);
    return starts.map((start, index) => ({ ...groups.get(start)!, messageIds: readable.filter((message) => message.messageIndex >= (index === 0 && review.coverage?.method !== "sampled" ? 0 : start) && message.messageIndex < (starts[index + 1] ?? Infinity)).map((message) => message.id) }));
  })();
  // A long answer can span several AI batches. Keep its continuation in the
  // same source chapter rather than creating empty question rows per fragment.
  const questionIds = new Set(readable.filter((message) => message.role === "user").map((message) => message.id));
  const seen = new Set<string>();
  const grouped: typeof stages = [];
  for (const stage of stages) {
    const introducesQuestion = stage.messageIds.some((id) => questionIds.has(id) && !seen.has(id));
    const previous = grouped.at(-1);
    if (previous && !introducesQuestion) {
      previous.messageIds = [...new Set([...previous.messageIds, ...stage.messageIds])];
      previous.summary += `\n\n${stage.title}\n${stage.summary}`;
    } else grouped.push({ ...stage, messageIds: [...stage.messageIds] });
    stage.messageIds.forEach((id) => { if (questionIds.has(id)) seen.add(id); });
  }
  const assigned = new Set<string>();
  return { outline, anchors: Object.fromEntries(grouped.filter((stage) => stage.messageIds.length).map((stage) => [stage.id, stage.messageIds[0]])), chapters: grouped.map((stage, index) => {
    const ids = new Set(stage.messageIds);
    const questionIds = readable.filter((message) => message.role === "user" && ids.has(message.id) && !assigned.has(message.id)).map((message) => { assigned.add(message.id); return `conversation-message-${message.id}`; });
    return { id: stage.id, conversationId, title: stage.title, summary: stage.summary, ...("phase" in stage && typeof stage.phase === "string" ? { phase: stage.phase } : {}), ...("transition" in stage && typeof stage.transition === "string" ? { transition: stage.transition } : {}), questionIds, order: index, collapsed: true, source: "auto", createdAt: 0, updatedAt: 0 };
  }) };
}
