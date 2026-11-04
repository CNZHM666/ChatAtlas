import type { Conversation } from "../shared/types";
import type { FocusScopeCandidate } from "./focus-scope";
import { homeReviewText } from "./home-review-materials";
import { historySearchMatcher } from "../search/home-history";

/** Excerpts locate a conversation; they never define its generation scope.
 * Include its beginning, ending and topic matches. Hash every original message
 * so cached navigation cannot survive a correction outside the excerpts. */
export function homeConversationCandidates(queries: string[], sources: Conversation[], blocks: FocusScopeCandidate[]): FocusScopeCandidate[] {
  const matchers = queries.map(historySearchMatcher);
  const bySource = new Map<string, FocusScopeCandidate[]>();
  for (const block of blocks) {
    const group = bySource.get(block.conversationId) ?? [];
    group.push(block); bySource.set(block.conversationId, group);
  }
  return sources.flatMap(source => {
    const turns = bySource.get(source.id);
    if (!turns?.length) return [];
    const ranked = turns.map((turn, index) => ({ index, score: Math.max(0, ...matchers.map(match => match(turn.text))) }))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const indices = [...new Set([0, turns.length - 1, ...ranked.slice(0, 3).map(row => row.index)])].sort((a, b) => a - b);
    const text = indices.map(index => homeReviewText(turns[index], queries.join(" "), 240)).join("\n[…]\n");
    return [{ id: source.id, conversationId: source.id, sourceTitle: source.title, title: source.title,
      text, excerpt: text, characters: turns.reduce((sum, turn) => sum + turn.characters, 0),
      messageIds: turns.flatMap(turn => turn.messageIds), messageSignatures: Object.fromEntries(turns.flatMap(turn => Object.entries(turn.messageSignatures))),
      recommended: ranked.some(row => row.score > 0), background: false }];
  });
}
