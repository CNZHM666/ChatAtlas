import { messageFullTextSearch, type MessageSearchOptions } from "./message-fulltext";
import { memoryQueryVariants } from "./memory-query";

type Hit = Awaited<ReturnType<typeof messageFullTextSearch.search>>["hits"][number];
/** How many hits before a long question is retried with most, not all, of its words, and how long a question must be:
 * a short keyword query stays exact, so words far apart in an unrelated message never count as a match. */
const FEW = 5, LONG_QUESTION = 10;

/** The one ranking both history searches use (the workbench's and the sidebar's), so a query finds the same messages
 * in the same order in either place: each wording of the query is searched, a message found by several ranks higher,
 * and a long natural question with few hits is searched again needing two thirds of its words (quoted text stays exact).
 * total is how many messages matched before the limit. */
export async function rankedMessages(query: string, options: MessageSearchOptions & { limit: number }): Promise<{ hits: Array<Hit & { score: number }>; total: number }> {
  const search = { requireBodyMatch: true, proximity: 120, ...options };
  const variants = memoryQueryVariants(query), ranked = new Map<string, { hit: Hit; score: number }>();
  for (const [index, variant] of variants.entries()) {
    options.signal?.throwIfAborted();
    const found = await messageFullTextSearch.search(variant, search);
    for (const [position, hit] of found.hits.entries()) { const previous = ranked.get(hit.messageId); ranked.set(hit.messageId, { hit: previous?.hit ?? hit, score: (previous?.score ?? 0) + (index ? .7 : 1) / (60 + position) }); }
  }
  if (!/["“]/u.test(query) && ranked.size < FEW && query.replace(/\s+/gu, "").length >= LONG_QUESTION) {
    for (const variant of [...variants].sort((a, b) => a.length - b.length).slice(0, 2)) {
      options.signal?.throwIfAborted();
      const extra = await messageFullTextSearch.search(variant, { ...search, minimumTermCoverage: 2 / 3 });
      for (const [position, hit] of extra.hits.entries()) if (!ranked.has(hit.messageId)) ranked.set(hit.messageId, { hit, score: .35 / (60 + position) });
    }
  }
  const hits = [...ranked.values()].sort((a, b) => b.score - a.score).slice(0, options.limit).map(row => ({ ...row.hit, score: row.score }));
  return { hits, total: ranked.size };
}
