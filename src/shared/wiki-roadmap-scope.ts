import type { WikiKnowledgeUnit } from "./wiki-knowledge";

const LABEL = /\bv\d+(?:\.\d+)*(?:-[a-z][\w.-]*)?|\b(?:phase|stage|milestone)\s*(?:\d+(?:\.\d+)*|[a-z]\b)|\bm\d+(?:\.\d+)*|(?:\bgithub\s+)?\b(?:alpha|beta|mvp)\b|首版|第\s*[一二三四五六七八九十\d]+\s*(?:版|阶段)/giu;
const LEADING_LABEL = new RegExp(`^\\s*(?:(?:在|于|for\\s+|in\\s+)?(?:${LABEL.source})\\s*(?:版本|阶段|里程碑)?[ \\t:：、-]*)+`, "iu");
const PRIORITY = /\bP\d+\b|(?:最高|高|中|低)优先级/giu;
const PHASE_LIMIT = /(?:暂不|本(?:阶段|期|轮|版)(?:暂)?不|仅(?:在)?本阶段|\b(?:not in|out of scope for) (?:this|the current)\b|\bdefer(?:red)? until\b)/iu;
const PERMANENT_LIMIT = /永久(?:排除|禁止|不)|永(?:远|久)不|任何(?:版本|阶段).{0,12}(?:禁止|不)|\b(?:never (?:support|allow|include)|permanently out of scope)\b/iu;
const OUT_OF_SCOPE = /暂不(?:支持|做|开放|包含|纳入|实现)|(?:阶段|版本|首版|第一版)\s*(?:暂)?不(?:支持|做|开放|包含|纳入|实现)|\b(?:out of scope|will not (?:support|include))\b/iu;
const NEXT = /(?:下一|下个)(?:版本|阶段|里程碑)|\bnext (?:release|phase|milestone)\b/iu;
const LATER = /远期(?:规划|考虑|再做)|(?:后续(?:版本|阶段)再|未来再考虑)|\b(?:future releases?|long.term roadmap)\b/iu;
const NOW = /(?:本|当前)(?:轮|期|版(?:本)?|阶段)(?:纳入|包含|实现|增加|支持|交付)|\b(?:included in|ships? in) (?:this|the current) (?:release|phase)\b/iu;

export interface WikiRoadmapScope {
  rawLabels: string[];
  priorities: string[];
  bucket?: "now" | "next" | "later" | "out_of_scope";
  exclusionType?: "phase_only" | "permanent";
  exclusionLabels?: string[];
  schemeId?: string;
  replacement?: "superseded";
  reportedDelivery?: "user_reported";
}

const labelKey = (label: string) => label.normalize("NFKC").toLowerCase().replace(/\s+/gu, "").replace(/^milestone(?=\d)/u, "m");
const distinct = (values: string[]) => [...new Map(values.map(value => [labelKey(value), value])).values()];
export const wikiStageLabels = (text: string) => distinct(text.match(LABEL) ?? []);

/** Retain scope in the units, but recall the same capability across releases. */
export function wikiRoadmapTopicText(text: string) {
  return text.replace(LEADING_LABEL, "") || text;
}

function byKind(label: string) {
  if (/^v\d|^首版|^第.*版$|^mvp$/iu.test(label)) return "release";
  if (/^(?:m\d|milestone)/iu.test(label)) return "milestone";
  if (/^(?:phase|stage)|^第.*阶段$/iu.test(label)) return "phase";
  return "channel";
}

/** Compare like labels. A release and a milestone can scope the same point. */
export function distinctWikiStageScopes(first: string, second: string) {
  const left = wikiStageLabels(first), right = wikiStageLabels(second);
  return left.some(label => {
    const sameKind = right.filter(other => byKind(other) === byKind(label));
    const leftKind = left.filter(other => byKind(other) === byKind(label));
    return leftKind.length === 1 && sameKind.length === 1 && labelKey(label) !== labelKey(sameKind[0]);
  });
}

/** Derive metadata from attested labels. Older stored ledgers need no migration. */
export function wikiRoadmapScope(unit: WikiKnowledgeUnit, options: {
  schemeId?: string; superseded?: boolean;
} = {}): WikiRoadmapScope {
  const quote = unit.evidence.quote, raw = wikiStageLabels(quote);
  const syntheticDecision = unit.id.startsWith("answer:") && unit.adoption.status === "user_decision";
  const rawLabels = wikiStageLabels(unit.statement).flatMap(label => {
    const matching = raw.find(original => labelKey(original) === labelKey(label));
    return matching ? [matching] : syntheticDecision ? [label] : [];
  });
  const priorities = distinct(quote.match(PRIORITY) ?? []).filter(priority =>
    (unit.statement.match(PRIORITY) ?? []).some(label => labelKey(label) === labelKey(priority)));
  const supports = (pattern: RegExp) => pattern.test(unit.statement) && (syntheticDecision || pattern.test(quote));
  const permanent = supports(PERMANENT_LIMIT);
  const exclusions = unit.statement.split(/[，,；;。\n]/u).filter(clause => PHASE_LIMIT.test(clause) || OUT_OF_SCOPE.test(clause));
  const exclusionLabels = rawLabels.filter(label => exclusions.some(clause => wikiStageLabels(clause).some(stage => labelKey(stage) === labelKey(label))));
  const scoped = (supports(PHASE_LIMIT) || supports(OUT_OF_SCOPE)) && (exclusionLabels.length > 0
    || exclusions.some(clause => /本(?:阶段|期|轮|版)|\bthis (?:phase|release)\b/iu.test(clause)));
  const buckets = [supports(OUT_OF_SCOPE) || scoped || permanent ? "out_of_scope" : undefined,
    supports(NEXT) ? "next" : undefined, supports(LATER) ? "later" : undefined, supports(NOW) ? "now" : undefined] as const;
  const matched = buckets.filter(value => value !== undefined);
  return { rawLabels, priorities, bucket: matched.length === 1 ? matched[0] : undefined,
    exclusionType: permanent && !scoped ? "permanent" : scoped && !permanent ? "phase_only" : undefined,
    exclusionLabels: scoped && !permanent && exclusionLabels.length ? exclusionLabels : undefined,
    schemeId: options.schemeId, replacement: options.superseded ? "superseded" : undefined,
    reportedDelivery: unit.delivery === "user_reported" ? "user_reported" : undefined };
}
