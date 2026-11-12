/** A sentence saying the discussion gave one item different values: 同步间隔在讨论中有 5 分钟和 10 分钟两种说法，尚未统一. */
export const VALUES_DIFFER = /两种说法|几种说法|不同说法|说法不一|尚未统一|未统一|另一处为|另有[^。；;]{0,8}说法|\b(?:differ(?:s|ent)? (?:between|across)|two values|not yet settled)\b/iu;
const figures = (text: string) => text.replace(/[０-９]/gu, digit => String.fromCharCode(digit.charCodeAt(0) - 0xfee0)).match(/\d+(?:\.\d+)?/gu) ?? [];
/** Such a sentence stands on its sources when each of its values is one a source gives, and at least two sources give
 * one: the check read 「30 秒和 60 秒两种说法」 as contradicting the 30-second review it cites, and failed it. */
export function valuesDifferSaid(text: string, sources: string[]): boolean {
  if (!VALUES_DIFFER.test(text) || sources.length < 2) return false;
  const values = [...new Set(figures(text))], given = sources.map(source => new Set(figures(source)));
  return values.length >= 2 && values.every(value => given.some(set => set.has(value))) && given.filter(set => values.some(value => set.has(value))).length >= 2;
}
