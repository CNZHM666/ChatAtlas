import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { sourceMessageSignature } from "../shared/source-signature";
import type { ProjectSource } from "../shared/project-state";

export interface ProjectOriginalSource extends ProjectSource { text: string; partial: boolean }

/** Read bounded, anchored original context. Never use generated prose as proof. */
export function projectOriginalSources(session: FocusSession, messages: ConversationMessage[], previous?: FocusSession, sectionIds?: string[]): ProjectOriginalSource[] {
  const sections = sectionIds ? session.sections.filter(section => sectionIds.includes(section.id)) : session.sections;
  const used = new Set(sections.flatMap(section => section.evidenceIds));
  if (session.mode === "work" && !sectionIds) session.evidence.forEach(ref => used.add(ref.id));
  session.evidence.filter(ref => ref.id.startsWith("history-source:") || ref.id.startsWith("architecture-source:")).forEach(ref => used.add(ref.id));
  const state = previous?.projectState;
  const claims = state ? [...state.modules, ...state.relations, ...state.decisions, ...state.constraints, ...(state.questions ?? []), ...(state.history ?? []).flatMap(item => [item, { quote: item.beforeQuote, evidenceIds: item.beforeEvidenceIds }])] : [];
  claims.forEach(item => item.evidenceIds.forEach(id => used.add(id)));
  return session.evidence.filter(ref => used.has(ref.id)).flatMap(ref => {
    const message = messages.find(item => item.conversationId === ref.conversationId && item.id === ref.messageId);
    if (!message?.content.trim() || !session.sourceConversationIds.includes(message.conversationId) || session.scope?.kind === "goal" && !session.scope.blocks?.some(block => block.conversationId === message.conversationId && block.messageIds.includes(message.id))) return [];
    const content = message.content;
    const anchors = [ref.excerpt, ...claims.filter(item => item.evidenceIds.includes(ref.id)).map(item => item.quote)].filter(Boolean);
    const ranges = anchors.flatMap(anchor => {
      const at = content.indexOf(anchor);
      return at < 0 ? [] : [{ start: Math.max(0, at - 1500), end: Math.min(content.length, at + anchor.length + 1500) }];
    });
    for (const match of [...content.matchAll(/\bV\d+(?:\.\d+)*\b|\bMilestone\s*\d+\b|\bM\d+\b|第[一二三四五六七八九十百\d]+版|初版|新版|最终版本/giu)].slice(0, 24)) ranges.push({ start: Math.max(0, match.index! - 500), end: Math.min(content.length, match.index! + match[0].length + 1000) });
    // Long originals can describe interfaces far from the chapter's citation.
    // Include bounded transfer windows within already selected source messages;
    // this never expands the user's source scope or adds another model request.
    if (session.mode === "work") for (const match of [...content.matchAll(/→|->|传递给|提交给|反馈(?:给|至|到)|输入[：:]|输出[：:]/gu)].slice(0, 12)) ranges.push({ start: Math.max(0, match.index! - 450), end: Math.min(content.length, match.index! + 650) });
    const merged: Array<{ start: number; end: number }> = [];
    for (const range of ranges.sort((a, b) => a.start - b.start)) {
      const last = merged.at(-1);
      if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
      else merged.push({ ...range });
    }
    // Architecture uses all confirmed messages. Budget splitting happens on discussion units later.
    const windows = session.mode === "work" ? [content] : content.length <= 6000 ? [content] : merged.map(range => content.slice(range.start, range.end));
    if (content.length > 6000 && !ranges.length && !ref.id.startsWith("architecture-source:")) return [];
    if (!windows.length) return [];
    return [{ id: ref.id, conversationId: ref.conversationId, messageId: ref.messageId, role: message.role, messageIndex: message.messageIndex, signature: sourceMessageSignature(content), discussedAt: message.createdAt, text: windows.join("\n[…]\n"), partial: session.mode !== "work" && content.length > 6000 && !(merged.length === 1 && merged[0].start === 0 && merged[0].end === content.length) }];
  });
}
