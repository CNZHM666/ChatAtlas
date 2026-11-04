import type { FocusScopeCandidate } from "./focus-scope";
import { discussionBlocks } from "../shared/discussion-context";
import { historySearchMatcher } from "../search/home-history";

/** Navigation excerpts, not an assertion that the entire turn was analyzed.
 * Keep complete paragraphs/code blocks; full selected turns are read later. */
export function homeReviewText(item: FocusScopeCandidate, goal: string, limit = 1600): string {
  if (item.text.length <= limit) return item.text;
  const blocks = discussionBlocks(item.text), score = historySearchMatcher(goal);
  const ranked = blocks.map((block, index) => ({ block, index, rank: score(block.text) + (index === 0 ? 1 : 0) }))
    .sort((a, b) => b.rank - a.rank || a.index - b.index);
  const chosen: typeof ranked = []; let length = 0;
  for (const entry of ranked) {
    const cost = entry.block.text.length + (chosen.length ? 7 : 0);
    if (cost + length <= limit) { chosen.push(entry); length += cost; }
  }
  // Oversized indivisible examples remain in originals, not a broken code fence.
  return chosen.sort((a, b) => a.index - b.index).map(entry => entry.block.text).join("\n[…]\n") || item.title.slice(0, 300);
}
