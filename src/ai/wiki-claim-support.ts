import { valuesDifferSaid } from "../shared/wiki-values-differ";
import { wikiQuantityConflicts } from "../shared/wiki-quantities";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiUnitDetails, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { sourceScopeConflict } from "./wiki-source-scope";

const digits = (text: string) => text.replace(/^[ \t]*(?:[-*+]\s+)?\d{1,2}[.)、]\s*/gmu, "");
const HAN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const numbered = (text: string) => text.replace(/[一二两三四五六七八九十]{1,3}(?=\s*(?:个|条|人|项|次|周|天|层|版|种|名|秒|分钟|小时|月|年))/gu, value => {
  const at = value.indexOf("十");
  return String(at < 0 ? HAN_DIGITS[value] : (HAN_DIGITS[value.slice(0, at)] ?? 1) * 10 + (HAN_DIGITS[value.slice(at + 1)] ?? 0));
});
const numbers = (text: string) => numbered(digits(text)).match(/\d+(?:\.\d+)?/gu) ?? [];
const ranges = (text: string) => [...text.matchAll(/(\d+(?:\.\d+)?)\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)/gu)].map(match => `${match[1]}-${match[2]}`);
export const unitClaimText = (unit: WikiKnowledgeUnit) => [unit.statement, ...wikiUnitDetails(unit), ...(unit.evidence.section ? [unit.evidence.section] : [])].join(" ");

/** The original quote can contain many unrelated points. Only the extracted point and
 * its own details may justify its numbers or a decision label. This is a conservative
 * local guard, not a substitute for semantic source review. */
/** Terms without the punctuation around a word: "week." and "week," are one word. "Validation of the MVP involves
 * testing with 10–15 college students for one week." shared three terms with its unit, not four, and was reported as
 * having no source. */
const bareTerms = (text: string) => new Set([...knowledgeTerms(text)].map(term => term.replace(/[.,;:!?)"'’”]+$/u, "").replace(/^[("'‘“]+/u, "")).filter(Boolean));
/** Whether a value of the text is a unit's: a stretch of the text giving it shares a word with a unit giving it. */
function lentBy(value: string, ofRange: boolean, text: string, units: WikiKnowledgeUnit[]): boolean {
  const segments = text.split(/[，,；;、。！？!?()（）]/u).filter(segment => segment.trim());
  return segments.some(segment => (ofRange ? ranges(segment) : numbers(segment)).includes(value)
    && units.some(unit => { const own = unitClaimText(unit), mine = bareTerms(own); return (ofRange ? ranges(own) : numbers(own)).includes(value) && [...bareTerms(segment)].some(term => mine.has(term)); }));
}
/** A day or span a figure is dated by, in brackets: （6月14日—7月7日）, (Jun 14–Jul 7). */
const SAID_ON = /[（(]\s*\d{1,2}月\d{1,2}日(?:\s*[—–-]\s*\d{1,2}月\d{1,2}日)?\s*[）)]|[（(](?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2}(?:\s*[–-]\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{1,2})?[）)]/gu;
export function claimSupported(said: string, units: WikiKnowledgeUnit[]): boolean {
  // The day a figure was said, added after it from its conversation ("每天稳定在22人（6月14日—7月7日）"): no unit states that
  // day in its words, and its numbers read as unsourced. The user's report lost 〔你〕 for it.
  const text = said.replace(SAID_ON, "");
  if (sourceScopeConflict(text, units)) return false;
  if (valuesDifferSaid(text, units.map(unit => [unitClaimText(unit), unit.evidence.quote].join(" ")))) return true;
  const terms = bareTerms(text);
  // A palette row ("Dark / #0F0F10 / #111112 / #151516 / #27272A") says its colours, which no word list holds: two of
  // them in the unit are the unit stating it.
  const colours = new Set((text.match(/#[0-9a-f]{6}\b/giu) ?? []).map(colour => colour.toLowerCase()));
  const relevant = units.filter(unit => {
    const own = bareTerms(unitClaimText(unit));
    let shared = 0; for (const term of terms) if (own.has(term)) shared++;
    const sameColours = (unitClaimText(unit).match(/#[0-9a-f]{6}\b/giu) ?? []).filter(colour => colours.has(colour.toLowerCase())).length;
    // A table cell of one colour ("#111112") has no words: the unit giving that colour states it.
    return terms.size && shared >= Math.min(2, terms.size) && shared / Math.max(1, Math.min(terms.size, own.size)) >= .4 || colours.size && sameColours >= Math.min(2, colours.size);
  });
  if (!text.trim() || !terms.size && !colours.size) return false;
  // A sentence of values in its own words ("Earlier proposals suggested larger radii (16px cards, 24px dialogs) …
  // replaced by the current 8px standard."): no unit shares enough of its words, yet each of its values is a cited
  // unit's, beside a word of that unit. It is supported by those values.
  if (!relevant.length) {
    const values = numbers(text);
    return values.length >= 2 && !wikiQuantityConflicts(text, units.map(unitClaimText)).length && values.every(number => lentBy(number, false, text, units)) && ranges(text).every(range => lentBy(range, true, text, units));
  }
  const known = relevant.map(unitClaimText), knownNumbers = new Set(known.flatMap(numbers));
  // A sentence joining several cited units ("全局圆角 6px~8px；但输入框 20~26px、组件卡片圆角 10~12px 另有取值"): a value
  // one of them gives is that unit's, when the stretch saying it shares a term with it, though the unit shares too
  // little with the whole sentence to count as stating it. One run reported such a line as having no source.
  const lent = (value: string, ofRange: boolean) => lentBy(value, ofRange, text, units);
  return !wikiQuantityConflicts(text, known).length && numbers(text).every(number => knownNumbers.has(number) || lent(number, false))
    && ranges(text).every(range => known.some(source => ranges(source).includes(range)) || lent(range, true));
}

/** A table row: supported whole, or cell by cell where every cell giving a value is: a row joining two points
 * ("日活用户数 | 约30人（近期降至22人） | 其中15人为连续使用核心用户，占比约68%") shares too little with either read whole,
 * and was reported as having no source. */
export function rowSupported(cells: string[], units: WikiKnowledgeUnit[]): boolean {
  const valued = cells.filter(cell => /\d/u.test(cell));
  return claimSupported(cells.join("，"), units) || valued.length > 0 && valued.every(cell => claimSupported(cell, units));
}

/** Repair a stale binding only when one point in this chapter clearly states the
 * sentence. Ambiguous or absent support is left for review, never borrowed from
 * the preceding sentence or an unrelated project. */
export function claimSourceUnits(text: string, listed: WikiKnowledgeUnit[], candidates: WikiKnowledgeUnit[]): WikiKnowledgeUnit[] {
  if (claimSupported(text, listed)) return listed;
  const terms = knowledgeTerms(text);
  // A bare label (a table's "日活 (DAU)" cell) says no point of its own: re-bound, it took the mark of whichever later
  // point named the same metric, and the earlier row's value read as that conversation's.
  if (listed.length && !/\d/u.test(text) && terms.size <= 2) return listed;
  const owner = (unit: WikiKnowledgeUnit) => unit.about ? `${unit.about.role}:${unit.about.name}` : "self";
  const owners = new Set(listed.map(owner));
  const matches = candidates.filter(unit => owners.has(owner(unit)) && claimSupported(text, [unit])).map(unit => {
    const own = knowledgeTerms(unitClaimText(unit));
    return { unit, cover: [...terms].filter(term => own.has(term)).length / Math.max(1, terms.size) };
  }).filter(item => item.cover >= .7).sort((a, b) => b.cover - a.cover);
  return matches.length && (matches.length === 1 || matches[0].cover > matches[1].cover + .15) ? [matches[0].unit] : listed;
}
