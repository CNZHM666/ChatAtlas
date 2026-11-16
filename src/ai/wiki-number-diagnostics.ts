import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { wikiUnitDetails, type WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { sourceBlockSupportsRows } from "../shared/wiki-source-code";

const VERSION = /\b[vV]\d+(?:\.\d+)*\b/gu;
// These labels make a claim about an identifier as a whole. Their digits
// cannot support a measurement or a differently named stage.
const IDENTIFIER = /\b(?:(?:[a-z][a-z0-9-]*?v|phase\s+|milestone\s+|stage\s+)\d+(?:\.\d+)*|[MP]\d+(?:\.\d+)*)\b/giu;
const identifierKey = (text: string) => text.toLowerCase().replace(/\s+/gu, "");
const ownerKey = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export function wikiNumberRowSources(row: string, candidates: Iterable<WikiKnowledgeUnit>, cited: WikiKnowledgeUnit[]) {
  const name = ownerKey(row.trim().replace(/^\|/u, "").split("|")[0]);
  if (name.length < 3) return cited;
  const labels = new Set([...row.matchAll(IDENTIFIER)].map(match => identifierKey(match[0])));
  if (!labels.size) return cited;
  const owner = (unit: WikiKnowledgeUnit) => ownerKey(unit.about?.name ?? "");
  const matching = [...candidates].filter(unit => owner(unit) === name && [...unit.statement.matchAll(IDENTIFIER)].some(match => labels.has(identifierKey(match[0]))));
  return [...new Set([...cited.filter(unit => !owner(unit) || owner(unit) === name), ...matching])];
}
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
  const identifiers = new Set<string>();
  const cleaned = text.replace(IDENTIFIER, label => { identifiers.add(identifierKey(label)); return " "; })
    .replace(VERSION, version => versions.has(version.toLowerCase()) ? " " : version);
  return { numbers: new Set(numbers(cleaned)), ranges: new Set(wikiNumberRanges(cleaned)), identifiers };
};

export function unsupportedWikiNumbers(text: string, known: string, versions: ReadonlySet<string>, labelSources = known) {
  const stated = valuesIn(text, versions), sourced = valuesIn(withDigits(known), versions);
  const sourcedLabels = labelSources === known ? sourced.identifiers : valuesIn(labelSources, versions).identifiers;
  return {
    numbers: [...stated.numbers].filter(value => !sourced.numbers.has(value)),
    ranges: [...stated.ranges].filter(value => !sourced.ranges.has(value)),
    identifiers: [...stated.identifiers].filter(value => !sourcedLabels.has(value)),
  };
}

const LIST_LEAD = /^\s*(?:[-*+]\s+|\d{1,2}(?:[.)]\s+|、\s*))/u;
const LIST_LABEL = /^(?:[-*+]\s+|\d{1,2}(?:[.)]\s+|、\s*))\*\*[^*\n]+\*\*\s*[：:]\s*/u;
const LIST_ITEM = /\n(?=[ \t]*(?:[-*+]\s+|\d{1,2}[.)]\s+))/u;
const SENTENCE = /(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*`%]\.)\s+(?!\d)/u;
const withoutMarks = (text: string) => text.replace(/\*\*|__|\[S-\d+-[\w-]+\]|〔[^〕\n]+〕|\[(?:Decided|Open|Earlier|AI suggestion)[^\]\n]*\]/gu, "");
const DRAFT_EXCERPT = /来源待核对的草稿原句「[^」]*」|Draft excerpt requiring source review “[^”]*”/gu;
const key = (text: string) => withoutMarks(text).replace(LIST_LEAD, "").normalize("NFKC").replace(/\s+/gu, "");
const parts = (text: string) => text.replace(DRAFT_EXCERPT, "").replace(/^\s*(?:\d+[.)]\s+|\d+、\s*)/gmu, "").replace(/\n+/gu, " ").split(SENTENCE).map(line => line.trim()).filter(Boolean);
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

const PROBLEM = /^"([\s\S]+?)…" (?:has numbers its units do not state: (.+)|states the range (\S+) that no cited unit states as a range(?:;.*)?|has identifiers its units do not state: (.+))$/u;
export const isWikiNumberProblem = (problem: string) => PROBLEM.test(problem);
export function wikiNumberProblemValues(problem: string) {
  const match = problem.match(PROBLEM);
  return match?.[2] ?? match?.[3] ?? match?.[4];
}
/** A former cell warning and its final row warning can name the same value. */
export function deduplicateWikiNumberProblems(problems: string[], spans: string[]) {
  const seen = new Set<string>();
  return problems.filter(problem => {
    const match = problem.match(PROBLEM);
    if (!match) return true;
    const anchor = key(match[1]), rows = spans.filter(span => /^\s*\|/u.test(span) && key(span).includes(anchor));
    if (rows.length !== 1) return true;
    const identity = JSON.stringify([key(rows[0]), match[2] ?? match[3] ?? match[4]]);
    if (seen.has(identity)) return false;
    seen.add(identity);
    return true;
  });
}
interface Binding { text: string; unitIds?: readonly string[] }

/** Recheck the named span and value against its own bound sources. */
export function recheckWikiNumberProblem(problem: string, spans: string[], claims: readonly Binding[], paragraphs: readonly Binding[], units: ReadonlyMap<string, WikiKnowledgeUnit>, versions: ReadonlySet<string>) {
  const match = problem.match(PROBLEM);
  if (!match) return problem;
  const [, head, figures, range, identifiers] = match, anchor = key(head.split("\n")[0]);
  const wanted = range ? [range] : (figures ?? identifiers).split(/,\s*/u);
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
      const kind = identifiers ? "identifiers" : range ? "ranges" : "numbers";
      const legacyLabels = kind === "numbers" ? [...values.identifiers].filter(label => label.match(/\d+(?:\.\d+)*/gu)?.includes(value)) : [];
      if (!values[kind].has(value) && !legacyLabels.length) continue;
      const claim = anchored ?? claims.find(claim => {
        const own = key(claim.text);
        return own && (normalized.includes(own) || own.includes(normalized)) && valuesIn(claim.text, versions)[kind].has(value);
      });
      const binding = claim ?? paragraphs.find(paragraph => key(paragraph.text).includes(normalized));
      const bound = (binding?.unitIds ?? []).flatMap(id => units.get(id) ?? []);
      const cited = (kind === "identifiers" || !values[kind].has(value) && legacyLabels.length) && /^\s*\|/u.test(span)
        ? wikiNumberRowSources(span, units.values(), bound) : bound;
      const known = valuesIn(withDigits(cited.map(unit => [unit.statement, ...wikiUnitDetails(unit), unit.evidence.section ?? "", unit.evidence.quote].join(" ")).join(" ")), versions);
      const hasValue = !values[kind].has(value) || known[kind].has(value);
      if (hasValue && legacyLabels.every(label => known.identifiers.has(label))
        || cited.some(unit => unit.evidence.code && sourceBlockSupportsRows(span, unit.evidence.code))) continue;
      remaining.add(value);
    }
  }
  if (!remaining.size) return undefined;
  return figures && remaining.size < wanted.length
    ? `"${head}…" has numbers its units do not state: ${wanted.filter(value => remaining.has(value)).join(", ")}`
    : problem;
}
