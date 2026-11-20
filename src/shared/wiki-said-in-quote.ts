import type { WikiKnowledgeUnit } from "./wiki-knowledge";
import { sourceQuoteText } from "./source-quote-text";

/** Whether a point placed under the user's message says something of that message. Extraction put points of the AI's
 * replies under the user's next message: "Milestone 1 focuses exclusively on data reliability." under a friend's review
 * asking for multiple currencies, and "Privacy and currency constraints apply to all future … recommendations." under
 * "给我把上面的15句对话总结成一个最终MD". Both read as [You] and one became the current stage. Words are compared where both
 * are written in Latin letters; a Chinese message is read only when it asks for a summary or a document, which states
 * nothing of the project itself. */
const SUMMARY_REQUEST = /总结|汇总|整理成|写成|生成[^。]{0,12}(?:MD|文档|文件)|\bsummari[sz]e\b|\bwrite (?:it|this|them) up\b/iu;
const latinWords = (text: string) => new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{2,}/gu) ?? []).filter(word => !QUOTE_STOP.has(word)));
const QUOTE_STOP = new Set("the and for are was were with from that this these those has have had its into not but can will should must all any our your their about than then also only".split(" "));
const FEEDBACK_ONLY = /^(?:(?:现在|現在|这个|這個|这样|這樣|这版|這版|效果)?\s*(?:怎[么麽麼][样樣]|怎[么麽麼]看|如何|好[吗嗎])|what do you think|how (?:is it|does it look)(?: now)?)$/iu;
export function wikiQuoteAsksOnlyForFeedback(quote: string): boolean {
  if (!/怎[么麽麼]|如何|好[吗嗎]|what do you think|how (?:is it|does it look)|!\[/iu.test(quote)) return false;
  const words = sourceQuoteText(quote).normalize("NFKC").trim().replace(/[。.!?！？]+$/u, "").trim();
  return words ? FEEDBACK_ONLY.test(words) : /!\[/u.test(quote);
}

export function wikiSaidInQuote(unit: WikiKnowledgeUnit): boolean {
  const quote = unit.evidence.quote ?? "", statement = unit.statement;
  if (wikiQuoteAsksOnlyForFeedback(quote) && !wikiQuoteAsksOnlyForFeedback(statement)) return false;
  if (!quote.trim() || /\p{Script=Han}/u.test(statement)) return true;
  const own = latinWords(statement);
  if (own.size < 3) return true;
  if (/\p{Script=Han}/u.test(quote)) return !SUMMARY_REQUEST.test(quote) || [...own].some(word => quote.toLowerCase().includes(word));
  const theirs = latinWords(quote), stem = (word: string) => word.slice(0, 5);
  const stems = new Set([...theirs].map(stem));
  return [...own].some(word => theirs.has(word) || stems.has(stem(word)));
}
