import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { evidencePresentation } from "./evidence-presentation";
import { reviewLead } from "./review-presentation";

export function uniqueUnderstandingText(items: string[]): string[] {
  const seen = new Set<string>();
  return items.map(evidencePresentation).map(text => text.trim()).filter(text => {
    const key = text.normalize("NFKC").replace(/[\p{P}\s]/gu, "").toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function overviewModel(session: FocusSession, zh: boolean, sourcesOnly = false) {
  const crossConversation = session.sourceConversationIds.length > 1;
  const sourceStages = session.sourceConversationIds.flatMap(conversationId => {
    const outline = session.sourceOutlines?.find(item => item.conversationId === conversationId);
    const allowed = session.scope?.kind === "goal" ? new Set(session.scope.blocks?.filter(block => block.conversationId === conversationId).flatMap(block => block.messageIds)) : undefined;
    const messageOrder = outline?.messageOrder ?? session.sourceMessageOrder?.[conversationId] ?? [];
    const refs = distinctEvidence(session.evidence.filter(ref => ref.conversationId === conversationId && (!allowed || allowed.has(ref.messageId)))).sort((a, b) => {
      const left = messageOrder.indexOf(a.messageId), right = messageOrder.indexOf(b.messageId);
      return (left < 0 ? Infinity : left) - (right < 0 ? Infinity : right);
    });
    const chapters = outline?.chapters.filter(chapter => !allowed || chapter.messageIds.some(id => allowed.has(id))) ?? [];
    const sourceLabel = crossConversation ? zh ? `对话 ${session.sourceConversationIds.indexOf(conversationId) + 1}` : `Conversation ${session.sourceConversationIds.indexOf(conversationId) + 1}` : undefined;
    if (chapters.length) return chapters.map(chapter => ({
      id: crossConversation ? `${conversationId}:${chapter.id}` : chapter.id, title: evidencePresentation(chapter.title), phase: chapter.phase,
      body: chapter.summary, sectionId: session.sections.find(section => refs.some(ref => section.evidenceIds.includes(ref.id) && chapter.messageIds.includes(ref.messageId)))?.id,
      evidence: refs.find(ref => chapter.messageIds.includes(ref.messageId)), conversationId, messageIds: chapter.messageIds, sourceLabel,
    }));
    // Legacy multi-source projects keep original citation passages. Wiki titles
    // and generated article text must not impersonate the discussion history.
    return crossConversation || sourcesOnly ? refs.filter(ref => ref.excerpt.trim()).map(ref => ({
      id: `discussion:${conversationId}:${ref.messageId}`, title: evidencePresentation(ref.excerpt).split(/\n/u)[0].replace(/^\s*#{1,6}\s*/u, "").slice(0, 100), phase: undefined,
      body: ref.excerpt, sectionId: undefined, evidence: ref, conversationId, messageIds: [ref.messageId], sourceLabel,
    })) : [];
  });
  const stages = sourceStages.length ? sourceStages : crossConversation || sourcesOnly ? [] : session.sections.filter(section => section.origin !== "user" && ["review", "finding"].includes(section.kind)).map(section => ({
    id: section.id, title: evidencePresentation(section.title), phase: section.phase, body: section.body,
    sectionId: section.id, evidence: session.evidence.find(ref => section.evidenceIds.includes(ref.id)), conversationId: undefined, messageIds: [] as string[], sourceLabel: undefined,
  }));
  const groups = stages.map(stage => ({ id: stage.id, title: stage.title, items: [stage] }));
  const topics = groups.map((group, index) => evidencePresentation(group.title) || (zh ? `阶段 ${index + 1}` : `Stage ${index + 1}`));
  const summary = session.brief?.summary ? evidencePresentation(session.brief.summary) : uniqueUnderstandingText(stages.map(stage => reviewLead(stage.body))).slice(0, 3).join(" ");
  const open = uniqueUnderstandingText([...(session.brief?.openQuestions ?? []), ...session.sections.filter(section => section.kind === "open_question").map(section => section.title), ...Object.values(session.reviewNeeds ?? {})]);
  const milestones = [...(session.brief?.turningPoints ?? []).map(claim => ({ ...claim, kind: "turn" as const })), ...(session.brief?.confirmed ?? []).map(claim => ({ ...claim, kind: "confirmed" as const }))].flatMap(claim => {
    const references = session.evidence.filter(ref => claim.evidenceIds.includes(ref.id));
    const matches = stages.filter(stage => stage.conversationId ? references.some(ref => ref.conversationId === stage.conversationId && stage.messageIds.includes(ref.messageId)) : session.sections.find(section => section.id === stage.id)?.evidenceIds.some(id => claim.evidenceIds.includes(id)));
    // Reused references can belong to several chapters. Keep ambiguous claims in Brief.
    if (matches.length !== 1) return [];
    const evidence = references.find(ref => matches[0].conversationId ? ref.conversationId === matches[0].conversationId && matches[0].messageIds.includes(ref.messageId) : true);
    return [{ stageId: matches[0].id, kind: claim.kind, text: evidencePresentation(claim.text), evidence }];
  }).filter((item, index, items) => item.text && items.findIndex(other => other.stageId === item.stageId && other.kind === item.kind && uniqueUnderstandingText([other.text, item.text]).length === 1) === index);
  return { stages, groups, topics, summary, open, milestones, chronological: sourceStages.length > 0 };
}

export function distinctEvidence(items: FocusEvidence[]) {
  return [...new Map(items.map(ref => [JSON.stringify([ref.conversationId, ref.messageId]), ref])).values()];
}
