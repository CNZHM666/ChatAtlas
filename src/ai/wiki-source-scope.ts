import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiKnowledgeUnit } from "../shared/wiki-knowledge";

const LEAD = /^(?:如果|假如|若(?!干)|仅当|只有|除非|仅限|只限|仅适用|只适用|if\b|only (?:if|for|in|on)\b|unless\b|provided that\b|limited to\b)/iu;
const LIMIT_SCOPE = /^(?:仅限(?:于)?|只限(?:于)?|仅适用(?:于)?|只适用(?:于)?|only (?:for|in|on)\s+|limited to\s+)([^：:，,。]{2,60})(?=[：:，,])/iu;
const CONTEXT = /^(?:例如|比如|举例|先(?:在|加入|启用|测试|选择)|观察|试验|监测|for example\b|observe\b|monitor\b|test first\b)/iu;
const AUDIENCE = /^(?:[^。！？:：\d]{2,55}(?:中|内)[，,：:]|(?:among|of|for) [^.!?:\d]{2,65}[,:])/iu;
const CONSEQUENCE = /^(?:则|才|才能|then\b)/iu;
const DIVIDER = /^(?:#{1,6}\s|(?:---|___)\s*$|[`~]{3,})/u;
const BOUND = String.raw`(?:不超过|不少于|不低于|不高于|大于等于|小于等于|至少|至多|超过|低于|高于|大于|小于|最多|最少|上限(?:为)?|下限(?:为)?|>=|<=|≥|≤|>|<|at least|at most|up to|more than|less than|no more than|no less than|over|under)`;
const SCALE = String.raw`(?:%|milliseconds?|seconds?|minutes?|hours?|days?|weeks?|mb|gb|kb|ms|px|毫秒|秒|分钟|小时|天|周|人|个|条|次|份|项|元)`;
const MEASURE = new RegExp(String.raw`(?:(${BOUND})\s*)?(\d+(?:\.\d+)?)\s*(${SCALE})(?![A-Za-z])(\s*\+)?`, "giu");
const MEASURE_ROW = new RegExp(String.raw`^(?:\|\s*)?(?:${BOUND}\s*)?\d`, "iu");
const BREAK = /[。！？；;\n]|,(?!\d)|，|(?:、|且|并且|以及|\band\b)(?=\s*(?:至少|至多|超过|不超过|at least|at most|up to|\d))/iu;
const WIDEN = /或|以及|所有|任意|任何|等功能|\b(?:or|all|any|including other)\b/iu;
const WINDOW = /^(?:观察|监测|observe|monitor)\s*([^。.!，,]{2,32})/iu;
const clean = (text: string) => text.trim().replace(/^(?:>\s*|[-*+]\s+|\d+\.\s+)/u, "").replace(/\*\*|__/gu, "").trim();
const normalize = (text: string) => text.normalize("NFKC").toLowerCase().replace(/[\s*_‘’“”"「」]/gu, "").replace(/(?<=\p{Script=Han})了(?=\p{Script=Han})/gu, "");
function boundOf(text: string): string {
  if (/^(?:不超过|不高于|小于等于|最多|上限|至多|<=|≤|at most|up to|no more than)/iu.test(text)) return "<=";
  if (/^(?:不少于|不低于|大于等于|至少|最少|下限|>=|≥|at least|no less than|\+)/iu.test(text)) return ">=";
  if (/^(?:小于|低于|<|less than|under)/iu.test(text)) return "<";
  return text ? ">" : "";
}

interface Measure { key: string; bound: string; target: string }
interface SourceScope { excerpt: string; limits: string[]; measures: Measure[] }

function measures(text: string): Measure[] {
  const value = text.normalize("NFKC").replace(/\*\*|__/gu, "");
  return value.split(BREAK).flatMap(part => [...part.matchAll(MEASURE)].flatMap(match => {
    const [, bound, number, scale, plus] = match, at = match.index!;
    if (scale !== "%" && !bound && !plus) return [];
    const suffix = part.slice(at + match[0].length).trim();
    const target = suffix || part.slice(0, at).trim();
    return [{ key: `${number}${scale.toLowerCase()}`, bound: boundOf((bound ?? plus ?? "").trim()), target }];
  }));
}

const parsed = new Map<string, SourceScope[]>();
function sourceScopes(quote: string): SourceScope[] {
  const cached = parsed.get(quote);
  if (cached) return cached;
  const scopes: SourceScope[] = [];
  const lines = quote.split("\n").map(line => ({ raw: line, text: clean(line) })).filter(line => line.text);
  let fence = "";
  for (const [index, { raw, text }] of lines.entries()) {
    const marker = raw.trim().match(/^[`~]{3,}/u)?.[0];
    if (marker) {
      if (!fence || marker[0] === fence[0] && marker.length >= fence.length) fence = fence ? "" : marker;
      continue;
    }
    if (fence || !LEAD.test(text) || DIVIDER.test(raw.trim())) continue;
    const rows = [text], measured = measures(text), limits = [text.match(LIMIT_SCOPE)?.[1] ?? ""].filter(Boolean);
    let start = index;
    while (start > Math.max(0, index - 2) && CONTEXT.test(lines[start - 1].text) && !DIVIDER.test(lines[start - 1].raw.trim())) start--;
    const context = lines.slice(start, index).map(line => line.text);
    limits.push(...context.flatMap(line => line.match(WINDOW)?.[1]?.trim() || []));
    for (const line of lines.slice(index + 1, index + 7)) {
      if (DIVIDER.test(line.raw.trim()) || LEAD.test(line.text)) break;
      const next = measures(line.text);
      if (next.length && MEASURE_ROW.test(line.text.normalize("NFKC"))) {
        rows.push(line.text); measured.push(...next);
      } else if (!measured.length && rows.length < 3 && AUDIENCE.test(line.text)) {
        rows.push(line.text);
        limits.push(line.text.replace(/[，,：:]$/u, ""));
      } else {
        if (measured.length && CONSEQUENCE.test(line.text)) rows.push(line.text);
        break;
      }
    }
    if (measured.length) {
      const excerpt = [...context, ...rows].reduce((joined, line, at, all) => {
        const previous = all[at - 1];
        const separator = !previous ? "" : MEASURE_ROW.test(previous) && MEASURE_ROW.test(line) ? "、" : " ";
        return joined + separator + line;
      }, "");
      scopes.push({ excerpt, limits, measures: measured });
    }
  }
  if (parsed.size >= 512) parsed.clear();
  parsed.set(quote, scopes);
  return scopes;
}

function sameTarget(first: string, second: string): boolean {
  const original = normalize(first), written = normalize(second);
  if (WIDEN.test(second) && !WIDEN.test(first)) return false;
  if (!original || written.includes(original)) return true;
  const terms = knowledgeTerms(first.replace(/了(?=\p{Script=Han})/gu, "")), own = knowledgeTerms(second);
  return terms.size >= 2 && [...terms].filter(term => own.has(term)).length / terms.size >= .6;
}

/** A uniquely bound rule from the cited quote. Equal amounts can belong to separate source rules. */
export function measuredSourceScope(text: string, quote: string) {
  if (!/\d/u.test(text) || !/\d/u.test(quote)) return;
  const wanted = measures(text);
  if (!wanted.length) return;
  const scopes = sourceScopes(quote).filter(scope => wanted.every(written => scope.measures.some(original => original.key === written.key)));
  if (!scopes.length) return;
  const normalizedText = normalize(text);
  const conflicts = (scope: SourceScope) => scope.limits.some(limit => !normalizedText.includes(normalize(limit))) || wanted.some(written =>
    !scope.measures.some(original => original.key === written.key && (!original.bound || original.bound === written.bound) && sameTarget(original.target, written.target)));
  const scope = scopes[0];
  const complete = scopes.length === 1 && scope.measures.every(original => wanted.some(written => written.key === original.key))
    && new Set(scope.measures.map(measure => measure.key)).size === scope.measures.length;
  return { excerpt: complete ? scope.excerpt : undefined, conflict: scopes.every(conflicts) };
}

export function sourceScopeConflict(text: string, units: readonly WikiKnowledgeUnit[]): boolean {
  if (!/\d/u.test(text)) return false;
  return text.split(/[；;]/u).some(piece => {
    const matching = units.flatMap(unit => measuredSourceScope(piece, unit.evidence.quote) ?? []);
    return matching.length > 0 && matching.every(scope => scope.conflict);
  });
}

export function sourceScopedUnit(unit: WikiKnowledgeUnit): WikiKnowledgeUnit {
  if (unit.evidence.role !== "assistant" || unit.evidence.pasted || unit.about || !["proposal", "unknown"].includes(unit.adoption.status)) return unit;
  if (/[；;]\s*\S/u.test(unit.statement)) return unit;
  const scope = measuredSourceScope(unit.statement, unit.evidence.quote);
  if (!scope?.conflict || !scope.excerpt || scope.excerpt.length > 300) return unit;
  return { ...unit, statement: scope.excerpt, details: unit.details.filter(detail => !measuredSourceScope(detail, unit.evidence.quote)?.conflict) };
}
