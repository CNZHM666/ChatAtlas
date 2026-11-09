import type { WikiKnowledgeUnit } from "./wiki-knowledge";

/** Whether a point placed under the user's message says something of that message. Extraction put points of the AI's
 * replies under the user's next message: "Milestone 1 focuses exclusively on data reliability." under a friend's review
 * asking for multiple currencies, and "Privacy and currency constraints apply to all future … recommendations." under
 * "给我把上面的15句对话总结成一个最终MD". Both read as [You] and one became the current stage. Words are compared where both
 * are written in Latin letters; a Chinese message is read only when it asks for a summary or a document, which states
 * nothing of the project itself. */
const SUMMARY_REQUEST = /总结|汇总|整理成|写成|生成[^。]{0,12}(?:MD|文档|文件)|\bsummari[sz]e\b|\bwrite (?:it|this|them) up\b/iu;
const latinWords = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/gu) ?? []).filter(word => !QUOTE_STOP.has(word)));
const QUOTE_STOP = new Set("the and for are was were with from that this these those has have had its into not but can will should must all any our your their about than then also only".split(" "));
export function wikiSaidInQuote(unit: WikiKnowledgeUnit): boolean {
  const quote = unit.evidence.quote ?? "", statement = unit.statement;
  if (!quote.trim() || /\p{Script=Han}/u.test(statement)) return true;
  const own = latinWords(statement);
  if (own.size < 3) return true;
  if (/\p{Script=Han}/u.test(quote)) return !SUMMARY_REQUEST.test(quote) || [...own].some(word => quote.toLowerCase().includes(word));
  const theirs = latinWords(quote), stem = (word: string) => word.slice(0, 5);
  const stems = new Set([...theirs].map(stem));
  return [...own].some(word => theirs.has(word) || stems.has(stem(word)));
}
