import type { TranscriptPassage } from "../search/transcript-index";
import { matchingTerms } from "../search/transcript-index";
import { intentTerms } from "./knowledge-source-retrieval";
import { focusStrategy, estimateTokens, taskPolicy } from "../shared/atlas/policy.js";

/** Rejoin overlapping intervals rather than paying for the same text twice. */
export function mergeFocusPassages(passages: TranscriptPassage[]): TranscriptPassage[] {
  const groups = new Map<string, TranscriptPassage[]>();
  for (const passage of passages) {
    const key = `${passage.document.conversationId}:${passage.evidence.messageId}`;
    groups.set(key, [...groups.get(key) ?? [], passage]);
  }
  const result: TranscriptPassage[] = [];
  for (const group of groups.values()) {
    group.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
    let current: TranscriptPassage | undefined;
    for (const item of group) {
      if (current && item.start !== undefined && current.end !== undefined && item.start <= current.end) {
        const text = current.text + item.text.slice(Math.max(0, current.end - item.start));
        current = { ...current, text, end: Math.max(current.end, item.end ?? item.start + item.text.length), after: item.after,
          document: { ...current.document, body: [current.before, `${current.role ?? "assistant"}: ${text}`, item.after].filter(Boolean).join("\n") } };
        result[result.length - 1] = current;
      } else { current = { ...item }; result.push(current); }
    }
  }
  return result;
}

/** Keep the relevant part of a sampled passage when many confirmed sources share a request. */
export function compactFocusText(body: string, terms: string[], limit: number): string {
  if (body.length <= limit) return body;
  const normalized = body.normalize("NFKC").toLocaleLowerCase();
  const match = terms.map((term) => normalized.indexOf(term.normalize("NFKC").toLocaleLowerCase())).find((index) => index >= 0);
  const start = match === undefined ? 0 : Math.max(0, Math.min(body.length - limit, match - Math.floor(limit / 3)));
  return `${start ? "…" : ""}${body.slice(start, start + limit)}${start + limit < body.length ? "…" : ""}`;
}

export function chooseFocusPassages(goal: string, passages: TranscriptPassage[], sourceIds: string[], mode = "review", hints: Map<string, string> = new Map(), modelId?: string): TranscriptPassage[] {
  const strategy = focusStrategy(goal, mode);
  const terms = intentTerms(goal);
  const scope = new Set(sourceIds);
  const ranked = passages.filter((passage) => scope.has(passage.document.conversationId)).map((passage, index) => ({ passage, index,
    score: matchingTerms(passage.text, terms).reduce((sum, term) => sum + term.length * 3, 0) + matchingTerms(`${passage.document.title} ${hints.get(`${passage.document.conversationId}:${passage.evidence.messageId}`) ?? ""}`, terms).reduce((sum, term) => sum + term.length, 0) }))
    .sort((a, b) => b.score - a.score || b.passage.evidence.messageIndex - a.passage.evidence.messageIndex || a.index - b.index);
  const rankedBySource = new Map<string, typeof ranked>();
  for (const item of ranked) {
    const id = item.passage.document.conversationId;
    const group = rankedBySource.get(id);
    if (group) group.push(item); else rankedBySource.set(id, [item]);
  }
  const selected = new Map<string, TranscriptPassage>();
  const protectedIds = new Set<string>();
  const limit = Math.min(32, Math.max(sourceIds.length, strategy === "answer" ? 6 : strategy === "work" ? 20 : 12));
  const add = (passage?: TranscriptPassage) => { if (passage) selected.set(passage.document.id, passage); };
  // Keep confirmed sources represented, including later corrections. Low-match
  // sources are explicitly marked as samples by the synthesis prompt.
  for (const id of sourceIds) {
    const candidates = rankedBySource.get(id) ?? [];
    add(candidates[0]?.passage);
    if (candidates[0]) protectedIds.add(candidates[0].passage.document.id);
    const correction = candidates.filter((item) => /更正|纠正|修正|之前.*(?:错|不对)|实际上|correction|actually|previous.*wrong/iu.test(item.passage.text)).sort((a, b) => b.passage.evidence.messageIndex - a.passage.evidence.messageIndex || (b.passage.start ?? 0) - (a.passage.start ?? 0))[0]?.passage;
    if (correction && selected.size < limit) { add(correction); protectedIds.add(correction.document.id); }
  }
  for (const id of sourceIds) {
    const candidates = rankedBySource.get(id) ?? [];
    if (strategy !== "answer" && selected.size < limit) {
      const chronological = candidates.map((item) => item.passage).sort((a, b) => a.evidence.messageIndex - b.evidence.messageIndex || (a.start ?? 0) - (b.start ?? 0));
      add(chronological[0]); if (selected.size < limit) add(chronological.at(-1));
    }
  }
  for (const { passage, score } of ranked) { if (selected.size >= limit) break; if (score > 0) add(passage); }
  // A broad goal without lexical matches needs a spread across the discussion,
  // not the first sixteen adjacent chunks.
  if (strategy !== "answer" && !ranked.some((item) => item.score > 0)) {
    const ordered = [...ranked].sort((a, b) => a.index - b.index);
    for (let i = 0; i < limit && selected.size < limit; i++) add(ordered[Math.round(i * (ordered.length - 1) / Math.max(1, limit - 1))]?.passage);
  }
  const picked = [...selected.values()].slice(0, 32);
  // Keep model instructions/schema headroom in the same shared token budget.
  const inputBudget = taskPolicy("focus_session", { intent: goal, mode }).maxInputTokens - 2200;
  let merged = mergeFocusPassages(picked);
  while (estimateTokens(JSON.stringify(merged.map((item) => item.document.body)), modelId) > inputBudget) {
    const counts = new Map<string, number>();
    for (const item of picked) counts.set(item.document.conversationId, (counts.get(item.document.conversationId) ?? 0) + 1);
    let removable = -1;
    for (let i = picked.length - 1; i >= 0; i--) if (!protectedIds.has(picked[i].document.id) && (counts.get(picked[i].document.conversationId) ?? 0) > 1) { removable = i; break; }
    if (removable < 0) break;
    picked.splice(removable, 1);
    merged = mergeFocusPassages(picked);
  }
  // A long mandatory sample from every source can still exceed the budget.
  // Compact the AI samples, not the locally stored transcript or Reader text.
  let maxBodyLength = Math.max(80, Math.min(1200, Math.ceil(inputBudget * 2 / Math.max(1, merged.length))));
  while (estimateTokens(JSON.stringify(merged.map((item) => item.document.body)), modelId) > inputBudget && maxBodyLength >= 80) {
    merged = merged.map((item) => ({ ...item, document: { ...item.document, body: compactFocusText(item.document.body, terms, maxBodyLength) } }));
    maxBodyLength = Math.floor(maxBodyLength * .75);
  }
  if (estimateTokens(JSON.stringify(merged.map((item) => item.document.body)), modelId) > inputBudget) throw new Error("本次来源内容超过可处理范围，请减少来源或缩小目标。原文已保留。");
  return merged;
}
