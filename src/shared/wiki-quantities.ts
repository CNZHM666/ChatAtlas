/** Counts retain both their value and their object. A benchmark with 20 tasks
 * cannot become a study with 20 people just because the digits still match. */
interface Count { value: string; object: string; label: string }
const AMOUNT = String.raw`\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?`;
const noun = (text: string): { object: string; label: string } | undefined => {
  const types: Array<[string, RegExp]> = [
    ["task", /(?:真实|目标|标准|用户|测试|基准|项目|需求|场景|独立|个)?(?:用户)?任务|真实(?:用户)?需求|\b(?:(?:user|real|benchmark|test)\s+)?(?:tasks?|requirements?)\b/iu],
    ["event", /(?:项目|用户|测试)?事件|\bevents?\b/iu],
    ["case", /(?:测试|验收|基准)?(?:用例|场景)|\b(?:test\s+)?cases?\b/iu],
    ["component", /(?:基础|本地|常用|确认参数的)?(?:元件|组件|模块)|\b(?:components?|modules?)\b/iu],
    ["person", /(?:真实|目标|非硬件专业|大学生|用户|名|个)*用户|大学生|参与者|受试者|志愿者|\b(?:users?|people|participants?|students?)\b/iu],
    ["file", /(?:项目|配置)?文件|\bfiles?\b/iu],
    ["project", /(?:标准|示例|测试)?项目|\bprojects?\b/iu],
  ];
  const match = types.flatMap(([object, pattern]) => { const found = text.match(pattern); return found ? [{ object, label: found[0].replace(/^(?:个|名|条|项)/u, ""), at: found.index ?? 0 }] : []; }).sort((a, b) => a.at - b.at)[0];
  return match && { object: match.object, label: match.label };
};
const valueOf = (text: string) => text.replace(/\s+/gu, "").replace(/[–—~～至到]/gu, "-");
function counts(text: string): Count[] {
  const out: Count[] = [];
  for (const line of text.split("\n")) {
    if (/^\s*\|/u.test(line)) {
      const cells = line.split("|").slice(1, -1).map(cell => cell.trim());
      const object = noun(cells[0] ?? ""), amount = cells[1]?.match(new RegExp(`^(?:至少|约|≥|>\\s*)?(${AMOUNT})\\s*(?:个|名|条|项|种)?$`, "u"));
      if (object && amount) out.push({ value: valueOf(amount[1]), ...object });
      // Table rows are checked as rows; a later cell must not change the first cell's object.
      if (object && amount) continue;
    }
    for (const match of line.matchAll(new RegExp(`(${AMOUNT})\\s*(?:个|名|条|项|种|份)?\\s*([^。，,；;：:|\\n]{1,24})`, "gu"))) {
      const after = match[2].replace(/^[~～\-\d\s]+/u, ""), object = noun(after);
      if (object && after.indexOf(object.label) <= 8) out.push({ value: valueOf(match[1]), ...object });
    }
  }
  return out;
}
export function wikiQuantityConflicts(text: string, sources: string[]): Count[] {
  const known = sources.flatMap(counts);
  return counts(text).filter(count => {
    const sameValue = known.filter(source => source.value === count.value);
    return sameValue.length > 0 && !sameValue.some(source => source.object === count.object);
  });
}

/** Repair only an unambiguous table label. Prose verbs and ambiguous objects must
 * be rewritten/reviewed, not guessed. All original source text remains untouched. */
export function repairWikiQuantityRows(text: string, sources: string[]): string {
  const known = sources.flatMap(counts);
  return text.split("\n").map(line => {
    if (!/^\s*\|/u.test(line)) return line;
    const bad = wikiQuantityConflicts(line, sources)[0];
    if (!bad) return line;
    const matches = known.filter(count => count.value === bad.value), objects = new Set(matches.map(count => count.object));
    if (objects.size !== 1) return line;
    const cells = line.split("|"); cells[1] = ` ${matches[0].label} `;
    return cells.join("|");
  }).join("\n");
}
