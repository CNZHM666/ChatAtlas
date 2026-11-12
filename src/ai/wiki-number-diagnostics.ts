import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiUnitDetails, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { sourceBlockSupportsRows } from "../shared/wiki-source-code";

const VERSION = /\b[vV]\d+(?:\.\d+)*\b/gu;
const ORDINAL = /第\s*\d+|[（(]\d{1,2}[)）]|(?<![\d.])\d{1,2}(?=[、)）]|\.\s)/gu;
const RANGE = /(\d[\d,]*(?:\.\d+)?)\s*[-–—~～至到]\s*(\d[\d,]*(?:\.\d+)?)/gu;
const DIGIT: Record<string, string> = { 一: "1", 二: "2", 两: "2", 三: "3", 四: "4", 五: "5", 六: "6", 七: "7", 八: "8", 九: "9", 十: "10" };
export const withDigits = (text: string) => text.replace(/[一二两三四五六七八九十](?=\s*(?:天|周|个|条|次|倍|小时|分钟|秒|人|版|步|层|种|项|名|月|年))/gu, char => DIGIT[char]);
export const projectVersions = (units: Iterable<WikiKnowledgeUnit>, answers: string[] = []) => new Set(
  [...[...units].map(unit => [unit.statement, unit.evidence.quote].join(" ")), ...answers]
    .flatMap(text => text.match(VERSION) ?? []).map(version => version.toLowerCase()),
);
const thousands = (text: string) => text.replace(/(?<=\d),(?=\d{3}(?:,\d{3})*(?!\d))/gu, "");
const numbers = (text: string) => thousands(text).replace(ORDINAL, " ").match(/\d+(?:\.\d+)?/gu) ?? [];
export const wikiNumberRanges = (text: string) => [...text.matchAll(RANGE)].map(match => `${match[1].replace(/,/gu, "")}-${match[2].replace(/,/gu, "")}`);
const valuesIn = (text: string, versions: ReadonlySet<string>) => {
  const cleaned = text.replace(VERSION, version => versions.has(version.toLowerCase()) ? " " : version);
  return { numbers: new Set(numbers(cleaned)), ranges: new Set(wikiNumberRanges(cleaned)) };
};

export function unsupportedWikiNumbers(text: string, known: string, versions: ReadonlySet<string>) {
  const stated = valuesIn(text, versions), sourced = valuesIn(withDigits(known), versions);
  return {
    numbers: [...stated.numbers].filter(value => !sourced.numbers.has(value)),
    ranges: [...stated.ranges].filter(value => !sourced.ranges.has(value)),
  };
}

const LIST_LEAD = /^\s*(?:[-*+]\s+|\d{1,2}(?:[.)]\s+|、\s*))/u;
const LIST_LABEL = /^(?:[-*+]\s+|\d{1,2}(?:[.)]\s+|、\s*))\*\*[^*\n]+\*\*\s*[：:]\s*/u;
const LIST_ITEM = /\n(?=[ \t]*(?:[-*+]\s+|\d{1,2}[.)]\s+))/u;
const SENTENCE = /(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*`%]\.)\s+(?!\d)/u;
const withoutMarks = (text: string) => text.replace(/\*\*|__|\[S-\d+-[\w-]+\]|〔[^〕\n]+〕|\[(?:Decided|Open|Earlier|AI suggestion)[^\]\n]*\]/gu, "");
const DRAFT_EXCERPT = /来源待核对的草稿原句「[^」]*」|Draft excerpt requiring source review “[^”]*”/gu;
const key = (text: string) => withoutMarks(text).replace(LIST_LEAD, "").normalize("NFKC").replace(/\s+/gu, "");
const parts = (text: string) => text.replace(DRAFT_EXCERPT, "").replace(/\n+/gu, " ").split(SENTENCE).map(line => line.trim()).filter(Boolean);
export function wikiNumberSpans(body: string): string[] {
  if (!/\d/u.test(body)) return [];
  return wikiDocumentBlocks(body).flatMap(block => {
    if (block.kind === "table") return block.text.split("\n").slice(2);
    if (block.kind === "paragraph") return parts(block.text);
    if (block.kind === "list") return block.text.split(LIST_ITEM).flatMap(parts);
    if (block.kind === "blockquote") return parts(block.text.replace(/^>\s*/gmu, ""));
    return [];
  });
}

const PROBLEM = /^"([\s\S]+?)…" (?:has numbers its units do not state: (.+)|states the range (\S+) that no cited unit states as a range(?:;.*)?)$/u;
export const isWikiNumberProblem = (problem: string) => PROBLEM.test(problem);
export function wikiNumberProblemValues(problem: string) {
  const match = problem.match(PROBLEM);
  return match?.[2] ?? match?.[3];
}
interface Binding { text: string; unitIds?: readonly string[] }

/** Recheck the named span and value against its own bound sources. */
export function recheckWikiNumberProblem(problem: string, spans: string[], claims: readonly Binding[], paragraphs: readonly Binding[], units: ReadonlyMap<string, WikiKnowledgeUnit>, versions: ReadonlySet<string>) {
  const match = problem.match(PROBLEM);
  if (!match) return problem;
  const [, head, figures, range] = match, anchor = key(head.split("\n")[0]);
  const wanted = range ? [range] : figures.split(/,\s*/u);
  if (!anchor) return problem;
  const remaining = new Set<string>();
  for (const span of spans) {
    const normalized = key(span);
    const anchored = claims.find(claim => {
      const own = key(claim.text);
      return own.startsWith(anchor) && normalized.includes(own);
    });
    if (!anchored && !normalized.startsWith(anchor) && !key(span.replace(LIST_LABEL, "")).startsWith(anchor)) continue;
    const values = valuesIn(withoutMarks(anchored?.text ?? span), versions);
    for (const value of wanted) {
      const kind = value.includes("-") ? "ranges" : "numbers";
      if (!values[kind].has(value)) continue;
      const claim = anchored ?? claims.find(claim => {
        const own = key(claim.text);
        return own && (normalized.includes(own) || own.includes(normalized)) && valuesIn(claim.text, versions)[kind].has(value);
      });
      const binding = claim ?? paragraphs.find(paragraph => key(paragraph.text).includes(normalized));
      const cited = (binding?.unitIds ?? []).flatMap(id => units.get(id) ?? []);
      if (cited.some(unit => {
        const source = [unit.statement, ...wikiUnitDetails(unit), unit.evidence.quote].join(" ");
        return valuesIn(withDigits(source), versions)[kind].has(value) || unit.evidence.code && sourceBlockSupportsRows(span, unit.evidence.code);
      })) continue;
      remaining.add(value);
    }
  }
  if (!remaining.size) return undefined;
  return figures && remaining.size < wanted.length
    ? `"${head}…" has numbers its units do not state: ${wanted.filter(value => remaining.has(value)).join(", ")}`
    : problem;
}
