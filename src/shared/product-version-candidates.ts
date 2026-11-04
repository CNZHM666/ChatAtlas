import type { FocusEvidence, FocusSession } from "./focus-session";
import type { ProjectHistoryEvent } from "./project-state";
import type { ConversationMessage } from "./types";
import { sourceMessageSignature } from "./source-signature";
import { productReleaseLabelPattern } from "./product-release-signals";

export type ProductVersion = ProjectHistoryEvent & { body?: string; sourceRefs?: FocusEvidence[]; sectionIds: string[] };
const marker = new RegExp(`^(?:#{1,6}\\s+|[-*]\\s+)?(?:\\*\\*)?(?:(?:项目|产品|方案|设计)\\s*)?(${productReleaseLabelPattern})(?:\\*\\*)?(?:\\s*[：:·—-]\\s*|\\s+|$)(.*)$`, "iu");
const normalize = (value: string) => value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();

/** Read only the original messages included in this saved scope, never the whole library. */
export function historyScopeMessageIds(session: FocusSession, conversationId: string) {
  const blockIds = session.scope?.kind === "goal" ? session.scope.blocks?.filter(block => block.conversationId === conversationId).flatMap(block => block.messageIds) ?? [] : undefined;
  const savedIds = session.sourceMessageOrder?.[conversationId] ?? Object.keys(session.sourceSignatures?.[conversationId] ?? {});
  return [...new Set(blockIds ?? (savedIds.length ? savedIds : [
    ...session.evidence.filter(ref => ref.conversationId === conversationId).map(ref => ref.messageId),
    ...(session.sourceOutlines?.filter(outline => outline.conversationId === conversationId).flatMap(outline => outline.chapters.flatMap(chapter => chapter.messageIds)) ?? []),
  ]))];
}
export function historyScopeMessages(session: FocusSession, conversationId: string, messages: ConversationMessage[]) {
  if (!session.sourceConversationIds.includes(conversationId)) return [];
  const ids = new Set(historyScopeMessageIds(session, conversationId));
  return messages.filter(message => {
    const signature = session.sourceSignatures?.[conversationId]?.[message.id] ?? session.scope?.blocks?.find(block => block.conversationId === conversationId && block.messageIds.includes(message.id))?.messageSignatures[message.id] ?? session.sourceOutlines?.find(outline => outline.conversationId === conversationId)?.messageSignatures?.[message.id];
    const role = session.sourceRoles?.[conversationId]?.[message.id];
    return message.conversationId === conversationId && ids.has(message.id) && (!signature || signature === sourceMessageSignature(message.content)) && (!role || role === message.role);
  }).sort((a, b) => a.messageIndex - b.messageIndex);
}

/** Explicit version blocks remain quotations; no inferred release date, implementation or diff. */
export function productHistoryCandidates(session: FocusSession, originals: ConversationMessage[] = []): ProductVersion[] {
  const events: ProductVersion[] = [];
  for (const conversationId of session.sourceConversationIds) for (const message of historyScopeMessages(session, conversationId, originals)) {
    const lines = message.content.split("\n");
    const signature = sourceMessageSignature(message.content);
    let fence = "";
    for (let i = 0; i < lines.length; i++) {
      const code = lines[i].trim().match(/^(`{3,}|~{3,})/u)?.[1]?.[0];
      if (code) { fence = fence === code ? "" : fence || code; continue; }
      if (fence) continue;
      const found = lines[i].trim().match(marker);
      if (!found) continue;
      let end = i + 1, blockFence = "";
      const depth = lines[i].trim().match(/^(#{1,6})\s/u)?.[1].length;
      // Subheadings (新增 / 修改) belong to the version, the next version does not.
      while (end < lines.length) {
        const next = lines[end].trim(), code = next.match(/^(`{3,}|~{3,})/u)?.[1]?.[0];
        if (code) { blockFence = blockFence === code ? "" : blockFence || code; end++; continue; }
        if (!blockFence && (next.match(marker) || depth && (next.match(/^(#{1,6})\s/u)?.[1].length ?? 99) <= depth)) break;
        end++;
      }
      const body = lines.slice(i + 1, end).join("\n").trim();
      const title = found[2].replace(/\*\*/gu, "").trim() || found[1];
      if (!body && !found[2].trim()) continue;
      const quote = lines.slice(i, end).join("\n").trim();
      // Repeated accounts of a version do not become additional releases.
      const existing = events.find(event => normalize(event.version) === normalize(found[1]) && (event.evidenceIds.some(id => session.evidence.some(ref => ref.id === id && ref.conversationId === conversationId && ref.messageId === message.id)) || normalize(event.quote) === normalize(quote)));
      const related = session.evidence.filter(ref => ref.conversationId === conversationId && ref.messageId === message.id);
      const ref: FocusEvidence = { id: `version-source:${conversationId}:${message.id}:${i}`, conversationId, messageId: message.id, title: related[0]?.title || title, excerpt: quote, sourceSignature: signature, sourceVersionId: session.sourceVersionIds?.[conversationId] };
      const versionPattern = new RegExp(found[1].replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "(?![\\d.])", "iu");
      const sections = session.sections.filter(section => section.evidenceIds.some(id => related.some(item => item.id === id)) || versionPattern.test(`${section.title}\n${section.body}`)).map(section => section.id);
      if (existing) { existing.body ??= body; existing.sourceRefs = [...(existing.sourceRefs ?? []), ref]; existing.sectionIds = [...new Set([...existing.sectionIds, ...sections])]; continue; }
      events.push({ id: ref.id, title, version: found[1], body, before: "", after: title, reason: "", quote, status: "uncertain", evidenceIds: related.map(item => item.id), beforeQuote: "", beforeEvidenceIds: [], discussedAt: message.createdAt > 0 ? message.createdAt : undefined, sectionIds: sections, sourceRefs: [ref] });
      i = end - 1;
    }
  }
  return events.map((item, index) => ({ ...item, index })).sort((a, b) => a.discussedAt && b.discussedAt ? a.discussedAt - b.discussedAt || a.index - b.index : a.discussedAt ? -1 : b.discussedAt ? 1 : a.index - b.index);
}
