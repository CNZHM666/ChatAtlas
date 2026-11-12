import type { WikiKnowledgeLedger, WikiTopicChain } from "./wiki-knowledge";

/** The version chains read against the user's latest answers. A chain is found once, when the knowledge is organized;
 * the answers may come after it (首屏100%为AI Agent驾驶舱 confirmed beside 327, though the chain had it earlier):
 * - a point the user turned down is no version of anything: it leaves the chain, neither current nor earlier;
 * - a point the user confirmed holds now, wherever the chain had it;
 * - once a confirmed point holds, the unconfirmed ones beside it came before it, and nothing stays open;
 * - a chain left with no current point, or a single point, is no chain. */
export function wikiDecidedTopics(topics: WikiTopicChain[] | undefined, decisions: WikiKnowledgeLedger["decisions"]): WikiTopicChain[] {
  if (!topics?.length) return [];
  const verdict = (id: string) => decisions?.[id]?.verdict;
  return topics.flatMap(topic => {
    const kept = (ids: string[]) => ids.filter(id => verdict(id) !== "rejected");
    let current = kept(topic.current), earlier = kept(topic.earlier), open = topic.open;
    const confirmed = [...current, ...earlier].filter(id => verdict(id) === "confirmed");
    if (confirmed.length) {
      earlier = [...current, ...earlier].filter(id => !confirmed.includes(id));
      current = confirmed;
      open = false;
    }
    if (!current.length || current.length + earlier.length < 2) return [];
    return [{ ...topic, current, earlier, open: open && current.length > 1 }];
  });
}
