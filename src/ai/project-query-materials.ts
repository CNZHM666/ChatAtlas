import type { TranscriptPassage } from "../search/transcript-index";
import { searchQueriesMatcher } from "../search/query";
import { sampleReadingPassages } from "./focus-source-text";
import type { FocusEvidence } from "../shared/focus-session";

/** Scope filtering happens before windows are formed, so adjacent context cannot leak. */
export function projectQueryPassages(question: string, allowed: TranscriptPassage[], references: FocusEvidence[] = [], queries: string[] = []): TranscriptPassage[] {
  const windows = sampleReadingPassages(allowed);
  const score = searchQueriesMatcher([question, ...queries]);
  const hits = windows.map((passage, index) => ({ passage, index, score: score(passage.text) })).filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, 6);
  const selected = new Set<number>();
  const pinned = new Set<number>();
  // References bind only to scoped originals; chapter hints are never evidence.
  for (const ref of references.slice(0, 12)) {
    const group = windows.map((passage, index) => ({ passage, index, score: score(passage.text) })).filter(item => item.passage.document.conversationId === ref.conversationId && item.passage.evidence.messageId === ref.messageId);
    const overlap = (text: string) => { let matched = 0; for (let i = 0; i < ref.excerpt.length; i += 120) { const fragment = ref.excerpt.slice(i, i + 120); if (fragment.length >= 20 && text.includes(fragment)) matched += fragment.length; } return matched; };
    const strongest = [...group].sort((a, b) => overlap(b.passage.text) - overlap(a.passage.text) || b.score - a.score)[0];
    for (const entry of [strongest, group.at(-1)]) if (entry) { pinned.add(entry.index); selected.add(entry.index); }
  }
  for (const hit of hits) {
    selected.add(hit.index);
    for (const neighbor of [hit.index - 1, hit.index + 1]) if (windows[neighbor]?.document.conversationId === hit.passage.document.conversationId && Math.abs(windows[neighbor].evidence.messageIndex - hit.passage.evidence.messageIndex) <= 1) selected.add(neighbor);
  }
  // Prioritize hits, then supporting context, while retaining chronological order.
  const core = new Set(hits.map(hit => hit.index));
  if (/最终|最后|变化|改变|演变|为什么.*选|final|latest|evolv|changed/iu.test(question)) {
    // Prefer explicit later corrections within retrieved messages, never the
    // newest unrelated discussion or evidence outside the confirmed scope.
    const messages = new Set([...pinned, ...core].map(index => `${windows[index].document.conversationId}:${windows[index].evidence.messageId}`));
    for (const [index, item] of windows.entries()) if (messages.has(`${item.document.conversationId}:${item.evidence.messageId}`) && /改为|纠正|不再|最终|确认|撤回|correction|instead|confirmed|withdraw/iu.test(item.text)) pinned.add(index);
  }
  for (const index of pinned) for (const neighbor of [index - 1, index + 1]) if (windows[neighbor]?.document.conversationId === windows[index].document.conversationId && Math.abs(windows[neighbor].evidence.messageIndex - windows[index].evidence.messageIndex) <= 1) selected.add(neighbor);
  const priority = (index: number) => pinned.has(index) ? 2 : core.has(index) ? 1 : 0;
  const indices: number[] = [];
  for (const index of [...new Set([...pinned, ...selected])].sort((a, b) => priority(b) - priority(a) || a - b)) {
    if (indices.includes(index)) continue;
    // Reserve the original question along with its answer before filling the
    // final window slots; many pinned answers must not evict every question.
    const previous = index - 1;
    const questionIndex = windows[index].role === "assistant" && windows[previous]?.role === "user" && windows[previous].document.conversationId === windows[index].document.conversationId && windows[index].evidence.messageIndex - windows[previous].evidence.messageIndex === 1 ? previous : undefined;
    const pair = [...new Set([...(questionIndex === undefined ? [] : [questionIndex]), index])].filter(entry => !indices.includes(entry));
    if (indices.length + pair.length <= 12) indices.push(...pair);
  }
  return indices.sort((a, b) => a - b).map(index => windows[index]);
}
