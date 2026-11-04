const synonymGroups = [
  ["费用", "成本", "价格", "预算", "花费", "cost", "pricing"],
  ["卡顿", "掉帧", "流畅", "性能", "速度", "响应", "performance", "latency"],
  ["隐私", "数据安全", "密钥", "privacy", "security"],
  ["失败", "报错", "错误", "重试", "error", "retry"],
  ["部署", "上线", "发布", "deploy", "release"],
  ["学习", "理解", "复习", "learn", "review"],
  ["类似产品", "相关产品", "同类产品", "竞品", "对标", "参考产品", "竞品对标", "flux", "circuit mind", "fritzing"],
];
export const normalizeSearch = (text: string) => text.normalize("NFKC").toLocaleLowerCase();
const conversational = /有没有|是否有|可不可以|能不能|可以|能否|请问|请帮我|帮我|给我|供我|一下|之前|以前|相关的|类似的|有哪些|有什么|是什么|为什么|(?:时)?(?:怎么|如何|怎样)|找到|找回|这个|那个|这些|那些|里面|进行|的|了|吗|呢|啊|吧/gu;
export function queryTerms(query: string): string[] {
  const words = normalizeSearch(query).replace(conversational, " ").match(/[a-z0-9+#._-]+|[\p{Script=Han}]+/gu) ?? [];
  return [...new Set(words.flatMap((word) => /^[\p{Script=Han}]+$/u.test(word) && word.length > 2 ? Array.from({ length: word.length - 1 }, (_, index) => word.slice(index, index + 2)) : [word]))];
}
/** Independent alternatives cannot dilute a precise question with earlier wording. */
export function searchQueriesMatcher(queries: string[], related = true, alreadyNormalized = false): (text: string) => number {
  const matchers = queries.filter(query => query.trim()).map(query => searchMatcher(query, related, alreadyNormalized));
  return text => Math.max(0, ...matchers.map(match => match(text)));
}
export function followUpQueries(question: string, previousQuestion = "", extra: string[] = []): string[] {
  const contextual = /^(?:那|它|这个|这样|还有|继续|具体呢|为什么呢|what about|and |it\b|that\b|why\??$)/iu.test(question.trim());
  return [...new Set([question, ...(contextual && previousQuestion ? [previousQuestion] : []), ...extra].filter(query => query.trim()))];
}
export function expandedQuery(query: string): string {
  const normalized = normalizeSearch(query);
  return [query, ...synonymGroups.filter((group) => group.some((word) => normalized.includes(word))).flat()].join(" ");
}
export function searchMatcher(query: string, related = false, alreadyNormalized = false): (text: string) => number {
  const needle = normalizeSearch(query.trim());
  if (!needle) return () => 0;
  const original = queryTerms(query);
  const alternatives = related ? queryTerms(expandedQuery(query)).filter((term) => !original.includes(term)) : [];
  return (text) => {
  const haystack = alreadyNormalized ? text : normalizeSearch(text);
  if (haystack.includes(needle)) return 60;
  const matched = original.filter((term) => haystack.includes(term)).length;
  const literal = original.length && matched / original.length >= .4 ? matched / original.length * 35 : 0;
  return literal + Math.min(18, alternatives.filter((term) => haystack.includes(term)).length * 3);
  };
}
export function searchScore(query: string, text: string, related = false): number { return searchMatcher(query, related)(text); }
export function searchExcerpt(query: string, text: string): string {
  const plain = text.replace(/\s+/gu, " ").trim();
  const terms = queryTerms(query);
  const haystack = normalizeSearch(plain);
  const index = Math.max(0, ...terms.map((term) => haystack.indexOf(term)).filter((position) => position >= 0).sort((a, b) => b - a).slice(-1));
  const start = Math.max(0, index - 50);
  return `${start ? "…" : ""}${plain.slice(start, start + 210)}${plain.length > start + 210 ? "…" : ""}`;
}
