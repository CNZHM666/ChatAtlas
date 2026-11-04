import { wikiQuantityConflicts } from "../shared/wiki-quantities";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiUnitDetails, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const digits = (text: string) => text.replace(/^[ \t]*(?:[-*+]\s+)?\d{1,2}[.)、]\s*/gmu, "");
const HAN_DIGITS: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const numbered = (text: string) => text.replace(/[一二两三四五六七八九十]{1,3}(?=\s*(?:个|条|人|项|次|周|天|层|版|种|名|秒|分钟|小时|月|年))/gu, value => {
  const at = value.indexOf("十");
  return String(at < 0 ? HAN_DIGITS[value] : (HAN_DIGITS[value.slice(0, at)] ?? 1) * 10 + (HAN_DIGITS[value.slice(at + 1)] ?? 0));
});
const numbers = (text: string) => numbered(digits(text)).match(/\d+(?:\.\d+)?/gu) ?? [];
const ranges = (text: string) => [...text.matchAll(/(\d+(?:\.\d+)?)\s*[-–—~～至到]\s*(\d+(?:\.\d+)?)/gu)].map(match => `${match[1]}-${match[2]}`);
export const unitClaimText = (unit: WikiKnowledgeUnit) => [unit.statement, ...wikiUnitDetails(unit)].join(" ");

/** The original quote can contain many unrelated points. Only the extracted point and
 * its own details may justify its numbers or a decision label. This is a conservative
 * local guard, not a substitute for semantic source review. */
export function claimSupported(text: string, units: WikiKnowledgeUnit[]): boolean {
  const terms = knowledgeTerms(text);
  const relevant = units.filter(unit => {
    const own = knowledgeTerms(unitClaimText(unit));
    let shared = 0; for (const term of terms) if (own.has(term)) shared++;
    return shared >= Math.min(2, terms.size) && shared / Math.max(1, Math.min(terms.size, own.size)) >= .4;
  });
  if (!text.trim() || !terms.size || !relevant.length) return false;
  const known = relevant.map(unitClaimText), knownNumbers = new Set(known.flatMap(numbers));
  return !wikiQuantityConflicts(text, known).length && numbers(text).every(number => knownNumbers.has(number))
    && ranges(text).every(range => known.some(source => ranges(source).includes(range)));
}

/** Repair a stale binding only when one point in this chapter clearly states the
 * sentence. Ambiguous or absent support is left for review, never borrowed from
 * the preceding sentence or an unrelated project. */
export function claimSourceUnits(text: string, listed: WikiKnowledgeUnit[], candidates: WikiKnowledgeUnit[]): WikiKnowledgeUnit[] {
  if (claimSupported(text, listed)) return listed;
  const terms = knowledgeTerms(text);
  const owner = (unit: WikiKnowledgeUnit) => unit.about ? `${unit.about.role}:${unit.about.name}` : "self";
  const owners = new Set(listed.map(owner));
  const matches = candidates.filter(unit => owners.has(owner(unit)) && claimSupported(text, [unit])).map(unit => {
    const own = knowledgeTerms(unitClaimText(unit));
    return { unit, cover: [...terms].filter(term => own.has(term)).length / Math.max(1, terms.size) };
  }).filter(item => item.cover >= .7).sort((a, b) => b.cover - a.cover);
  return matches.length && (matches.length === 1 || matches[0].cover > matches[1].cover + .15) ? [matches[0].unit] : listed;
}
