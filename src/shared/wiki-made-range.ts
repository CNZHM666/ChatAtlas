/** A count of users or activity as a range: 日活稳定在20-30人区间, DAU 20–30. */
const MEASURED_RANGE = /(?:日活|DAU|活跃|用户数?|人数)[^，,。；;]{0,12}?(\d+)\s*(?:-|–|—|~|～|至|到)\s*(\d+)\s*(?:人|个用户|名用户)?/iu;
/** A clause saying the figure is current, with no day: 截至当前, 目前. */
const UNDATED_NOW = /^(?:截至(?:当前|目前|现在)|目前|当前|现阶段)[，,]?\s*/u;

/** A range of the project's figures no source gives as a range: 「截至当前，日活稳定在20-30人区间」 joined the 22 and 32
 * daily users said weeks apart into one span, undated, beside a later 40. The clause goes; the sentence keeps the rest.
 * A source giving those two numbers as a range keeps it. */
export function withoutMadeRanges(text: string, sources: string[]): string {
  if (!MEASURED_RANGE.test(text)) return text;
  const given = sources.map(source => source.replace(/\s+/gu, ""));
  return text.split(/(?<=[。！？\n])/u).map(sentence => {
    if (!MEASURED_RANGE.test(sentence) || /^\s*\|/u.test(sentence)) return sentence;
    const clauses = sentence.split(/(?<=[，,；;])/u);
    const made = (clause: string) => {
      const range = clause.match(MEASURED_RANGE);
      if (!range) return false;
      const [low, high] = [range[1], range[2]];
      return !given.some(source => new RegExp(`(?<!\\d)${low}\\s*(?:-|–|—|~|～|至|到)\\s*${high}(?!\\d)`, "u").test(source));
    };
    if (!clauses.some(made)) return sentence;
    const kept: string[] = [];
    for (const [at, clause] of clauses.entries()) {
      if (made(clause)) {
        // "截至当前，" before it says when the made figure stood: it goes with it.
        if (kept.length && UNDATED_NOW.test(kept[kept.length - 1].trim()) && kept[kept.length - 1].replace(UNDATED_NOW, "").trim() === "") kept.pop();
        const end = clause.match(/[。！？；;]\s*$/u)?.[0];
        if (end && kept.length) kept[kept.length - 1] = kept[kept.length - 1].replace(/[，,]\s*$/u, end.trim());
        continue;
      }
      kept.push(at === 0 || kept.length ? clause : clause.replace(UNDATED_NOW, ""));
    }
    const rest = kept.join("");
    return rest.replace(/[，,]\s*$/u, "。").trim() ? rest : "";
  }).join("");
}
