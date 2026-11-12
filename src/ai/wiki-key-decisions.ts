import { DECIDING_KINDS, aboutNameKey, wikiLedgerUnits, type WikiScopeAnswer, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus, type WikiUserDecision } from "../shared/wiki-knowledge";
import { roadmaps, wikiUnitStatuses } from "./wiki-knowledge-write";
import { exclusiveWikiVersions } from "./wiki-version-conflict";
import { wikiByDiscussion } from "../shared/wiki-sources";
import { differingPlans } from "../shared/wiki-differing-plans";
import { wikiDecidedTopics } from "../shared/wiki-decided-topics";

/** A key point the user can confirm as a decision or set aside: one point however often it was restated. */
export interface WikiDecisionCandidate {
  /** The most recent statement of the point, shown to the user. */
  id: string; statement: string; subject: string; chapter?: string;
  /** Every unit stating this point: a verdict applies to all of them. */
  unitIds: string[]; status: WikiUnitStatus; verdict?: WikiUserDecision["verdict"];
  /** How much the answer changes the document: how often the point came back, a decision, left open. */
  weight?: number;
}

const bigramsOf = (text: string) => { const chars = Array.from(text.normalize("NFKC").toLocaleLowerCase().replace(/[\s\p{P}\p{S}]/gu, "")); return new Set(chars.slice(1).map((char, index) => chars[index] + char)); };
const namesOf = (text: string) => new Set(text.normalize("NFKC").toLocaleLowerCase().match(/\d+(?:\.\d+)?|[a-z][a-z0-9-]*/gu) ?? []);

interface DecisionCluster { units: WikiKnowledgeUnit[]; status: WikiUnitStatus; subject: string; chapter?: string; weight: number }
/** The points and their restatements, worked out once per extraction and organization: a verdict changes neither, so
 * confirming a point only re-reads the verdicts (the clustering compared every pair and made each click slow). */
const clusterCache = new WeakMap<object, DecisionCluster[]>();
function decisionClusters(ledger: WikiKnowledgeLedger): DecisionCluster[] {
  const organization = ledger.organization!;
  const cached = clusterCache.get(organization);
  if (cached) return cached;
  const units = wikiLedgerUnits(ledger), plain = wikiUnitStatuses(units, organization);
  const chapterOf = new Map<string, string>(), subjectOf = new Map<string, string>();
  for (const subject of organization.subjects) for (const id of subject.unitIds) subjectOf.set(id, subject.name);
  const subjectById = new Map(organization.subjects.map(subject => [subject.id, subject]));
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const subjectId of topic.subjectIds) for (const id of subjectById.get(subjectId)?.unitIds ?? []) chapterOf.set(id, chapter.title);
  // Judged by what the conversation shows, before any verdict: a judged point stays listed so it can be undone.
  const open = units.filter(unit => !unit.about && DECIDING_KINDS.includes(unit.kind) && ["proposal", "relayed", "open"].includes(plain.get(unit.id)!)).sort((a, b) => wikiByDiscussion(b, a));
  const pairs = new Map(open.map(unit => [unit.id, bigramsOf(unit.statement)])), names = new Map(open.map(unit => [unit.id, namesOf(unit.statement)]));
  // One restates the other: most of its character pairs are there, and every number or Latin name too.
  const restates = (a: WikiKnowledgeUnit, b: WikiKnowledgeUnit) => {
    const own = pairs.get(a.id)!, theirs = pairs.get(b.id)!;
    if (own.size < 10 || theirs.size < 10 || own.size > theirs.size * 1.6) return false;
    let shared = 0; for (const pair of own) if (theirs.has(pair)) shared++;
    if (shared / own.size < .7) return false;
    const known = names.get(b.id)!; for (const name of names.get(a.id)!) if (!known.has(name)) return false;
    return true;
  };
  const groups: WikiKnowledgeUnit[][] = [];
  for (const unit of open) { const home = groups.find(group => group.some(member => restates(unit, member) || restates(member, unit))); if (home) home.push(unit); else groups.push([unit]); }
  const weight = (group: WikiKnowledgeUnit[]) => group.length + (group.some(unit => unit.kind === "decision") ? 2 : 0) + (group.some(unit => plain.get(unit.id) === "open") ? 1 : 0);
  const clusters = groups.sort((a, b) => weight(b) - weight(a)).map(group => ({ units: group, weight: weight(group), status: plain.get(group[0].id)!, subject: subjectOf.get(group[0].id) ?? group[0].subject, ...(chapterOf.get(group[0].id) ? { chapter: chapterOf.get(group[0].id) } : {}) }));
  clusterCache.set(organization, clusters);
  return clusters;
}

/** Points still open for the user's verdict: an assistant proposal, pasted material or an open choice about this
 * project's own design, plans or limits. Restatements of one point (the positioning said six ways) are one candidate,
 * ranked by how often the discussion came back to it. Points the user already judged stay listed with their verdict. */
export function wikiDecisionCandidates(ledger: WikiKnowledgeLedger | undefined, limit = 8): WikiDecisionCandidate[] {
  if (!ledger?.organization) return [];
  return decisionClusters(ledger).slice(0, limit).map(cluster => {
    const latest = cluster.units[0], verdict = cluster.units.map(unit => ledger.decisions?.[unit.id]?.verdict).find(Boolean);
    return { id: latest.id, statement: latest.statement, subject: cluster.subject, ...(cluster.chapter ? { chapter: cluster.chapter } : {}), unitIds: cluster.units.map(unit => unit.id), weight: cluster.weight, status: verdict === "confirmed" ? "confirmed" : verdict === "rejected" ? "history" : cluster.status, ...(verdict ? { verdict } : {}) };
  });
}

/** The ledger with the user's verdict on a point (all its units), or the verdict removed. */
export function withDecision(ledger: WikiKnowledgeLedger, unitIds: string[], verdict: WikiUserDecision["verdict"] | undefined, at = Date.now(), shown: readonly string[] = []): WikiKnowledgeLedger {
  const decisions = { ...ledger.decisions };
  const wholeUnits = verdict === "confirmed" && shown.length
    ? new Set(wikiLedgerUnits(ledger).filter(unit => shown.includes(unit.statement)).map(unit => unit.id))
    : undefined;
  for (const id of unitIds) {
    if (verdict) decisions[id] = { verdict, at, ...(wholeUnits?.has(id) ? { wholeUnit: true } : {}) };
    else delete decisions[id];
  }
  return { ...ledger, decisions, decisionsAt: at };
}

/** Verdicts given or withdrawn since the draft was written: the document does not show them yet. */
export function ledgerDecisionsPending(ledger: WikiKnowledgeLedger | undefined): boolean {
  return Boolean(ledger?.draft && ledger.decisionsAt && ledger.decisionsAt > ledger.draft.generatedAt);
}

/** A choice of which version holds now: between roadmaps of one scope, or two versions of one point. */
export interface WikiVersionOption { id: string; label: string; unitIds: string[]; /** For a topic: whether the version holds now or came before. */ tag?: "current" | "earlier" }
export interface WikiVersionQuestion {
  id: string; kind: "roadmap" | "versions" | "topic"; question: string; chapter?: string; options: WikiVersionOption[];
  /** How much the answer changes the document, for the order questions are asked in. */
  impact?: number;
  /** The two units of a versions question, "older>newer", which both may hold. */
  pair?: string;
  /** The answer the ledger holds: an option's id, "both" or "open". */
  answer?: string;
}
export type WikiVersionAnswer = string | "both" | "open" | undefined;

/** What a plan can count its steps by: milestones, versions, time or phases. */
const STEP_AXES: Array<[string, RegExp]> = [
  ["milestone", /\bM\d\b|里程碑|milestone/giu],
  ["version", /\bv\d|版本|第[一二三四五\d]+版|\bMVP\b/giu],
  ["time", /第\s*[一二三四五六七八九十\d]+\s*(?:周|天|日|个?月)|\d+\s*(?:周|天|个月)|\bweek|\bday\b|\bmonth/giu],
  ["phase", /阶段|\bphase|\bP\d\b/giu],
];
/** The axis most of a plan's steps are named on: a weekly plan that ends in "v0.1 Beta" still counts weeks. */
const stepAxis = (text: string) => STEP_AXES.map(([axis, pattern]) => [axis, text.match(pattern)?.length ?? 0] as const).filter(([, count]) => count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";

const ROADMAP_OPTIONS = 4, OPTION_LINE = 64;
/** How much an answer changes the document. A topic: its base, more when left open, one per chapter it is told in and
 * more when the user's own idea is among its versions. A roadmap decides a chapter; two versions of one point a line. */
const TOPIC_IMPACT = 3, OPEN_IMPACT = 3, OWN_IMPACT = 2, ROADMAP_IMPACT = 6, PAIR_IMPACT = 4;
const line = (text: string) => { const plain = text.replace(/\s+/gu, " ").trim().replace(/[。.]$/u, ""); return plain.length <= OPTION_LINE ? plain : `${plain.slice(0, OPTION_LINE - 1).trim()}…`; };
const versionCache = new WeakMap<object, Array<Omit<WikiVersionQuestion, "answer">>>();

/** Version choices put to the user beside the key decisions: first the scopes with more than one roadmap (newest
 * first, at most four), then two versions of a point the assistant or pasted material changed without the user. At
 * most three, worked out once per organization; the answer is read from the ledger's verdicts each time. */
export function wikiVersionQuestions(ledger: WikiKnowledgeLedger | undefined, zh: boolean): WikiVersionQuestion[] {
  const organization = ledger?.organization;
  if (!ledger || !organization) return [];
  let questions = versionCache.get(organization);
  if (!questions) {
    questions = [];
    const merged = new Set(organization.merged.flatMap(row => row.from));
    const units = wikiLedgerUnits(ledger).filter(unit => !merged.has(unit.id) && !unit.about), byId = new Map(units.map(unit => [unit.id, unit]));
    const subjects = new Map(organization.subjects.map(subject => [subject.id, subject]));
    const scopeOf = new Map(organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.name] as const)));
    const planned = new Set<string>();
    for (const chapter of organization.chapters) {
      const slots = chapter.subtopics.map(topic => ({ title: topic.title, units: topic.subjectIds.flatMap(id => subjects.get(id)?.unitIds ?? []).flatMap(id => byId.get(id) ? [byId.get(id)!] : []) }));
      const { planOf, planScopeOf, chapterUnits } = roadmaps(slots, scopeOf, zh ? "zh-CN" : "en");
      const byScope = new Map<string, string[]>();
      for (const label of new Set(planOf.values())) byScope.set(planScopeOf(label), [...byScope.get(planScopeOf(label)) ?? [], label]);
      for (const [scope, labels] of byScope) {
        if (labels.length < 2) continue;
        const own = (label: string) => chapterUnits.filter(unit => planOf.get(unit.id) === label);
        // Plans counted on different steps (versions beside weeks) or on none (a budget rule beside a priority order)
        // say different things side by side: asking which one holds asks a question with no answer.
        const axes = labels.map(label => stepAxis(own(label).map(unit => unit.statement).join(" ")));
        if (axes.some(axis => !axis || axis !== axes[0])) continue;
        const latest = (label: string) => Math.max(...own(label).map(unit => unit.evidence.messageIndex));
        const options = labels.sort((a, b) => latest(b) - latest(a)).slice(0, ROADMAP_OPTIONS).map(label => {
          const members = own(label), fullest = [...members].sort((a, b) => b.statement.length - a.statement.length)[0];
          members.forEach(unit => planned.add(unit.id));
          return { id: label, label: line(fullest.statement), unitIds: members.map(unit => unit.id) };
        });
        const whole = /项目整体路线|whole project roadmap/u.test(scope);
        questions.push({ id: `roadmap:${chapter.id}:${scope}`, kind: "roadmap", chapter: chapter.title, options,
          question: zh ? whole ? "开发路线现在按哪一套推进？" : `「${scope}」现在按哪一套推进？` : whole ? "Which roadmap does the project follow now?" : `Which plan does “${scope}” follow now?` });
      }
    }
    // Versions the assistant or pasted material changed without the user, newest first; a roadmap step is asked above.
    const chapterOf = new Map<string, string>();
    for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const id of topic.subjectIds) for (const unitId of subjects.get(id)?.unitIds ?? []) chapterOf.set(unitId, chapter.title);
    const asked = new Set<string>();
    // Things settled more than once (the version chains): each one left open, and each whose version now is only a
    // suggestion told in more than one chapter. 「首屏」 confirmed one way and proposed two other ways was never asked: its
    // versions sat under three subjects, and only relations within one subject were.
    for (const topic of organization.topics ?? []) {
      const members = [...topic.current, ...topic.earlier].flatMap(id => byId.get(id) ?? []);
      if (members.length < 2 || members.some(unit => planned.has(unit.id) || asked.has(unit.id))) continue;
      const chapters = [...new Set(members.flatMap(unit => chapterOf.get(unit.id) ?? []))];
      const suggestedOnly = topic.current.every(id => { const unit = byId.get(id); return !unit || unit.evidence.role !== "user" && unit.adoption.status !== "user_adopted" && ledger.decisions?.[id]?.verdict !== "confirmed"; });
      if (!topic.open && !(suggestedOnly && chapters.length >= 2)) continue;
      const own = members.some(unit => unit.evidence.role === "user" && !unit.evidence.pasted);
      const options = [...topic.current.map(id => ({ id, tag: "current" as const })), ...topic.earlier.slice(-2).map(id => ({ id, tag: "earlier" as const }))]
        .flatMap(({ id, tag }) => byId.get(id) ? [{ id, label: byId.get(id)!.statement, unitIds: [id], tag }] : []).slice(0, ROADMAP_OPTIONS);
      if (options.length < 2) continue;
      members.forEach(unit => asked.add(unit.id));
      questions.push({ id: `topic:${options.map(option => option.id).join("|")}`, kind: "topic", impact: TOPIC_IMPACT + (topic.open ? OPEN_IMPACT : 0) + chapters.length + (own ? OWN_IMPACT : 0), ...(chapters[0] ? { chapter: chapters.join("、") } : {}),
        question: zh ? `「${topic.name}」现在按哪一个？` : `Which holds now for “${topic.name}”?`, options });
    }
    const pairs = organization.relations.filter(relation => (relation.kind === "replaces" || relation.kind === "rejects") && relation.status === "unresolved")
      .flatMap(relation => { const older = byId.get(relation.older), newer = byId.get(relation.newer); return older && newer && exclusiveWikiVersions(older, newer) && !planned.has(older.id) && !planned.has(newer.id) && older.kind !== "question" && newer.kind !== "question" ? [{ older, newer }] : []; })
      .sort((a, b) => wikiByDiscussion(b.newer, a.newer));
    for (const { older, newer } of pairs) {
      if (asked.has(older.id) || asked.has(newer.id)) continue;
      asked.add(older.id); asked.add(newer.id);
      const subject = scopeOf.get(newer.id) ?? newer.subject;
      questions.push({ id: `versions:${older.id}>${newer.id}`, kind: "versions", pair: `${older.id}>${newer.id}`, ...(chapterOf.get(newer.id) ? { chapter: chapterOf.get(newer.id) } : {}),
        question: zh ? `「${subject}」先后有两种说法，现在用哪个？` : `“${subject}” was said two ways. Which holds now?`,
        options: [{ id: "older", label: older.statement, unitIds: [older.id] }, { id: "newer", label: newer.statement, unitIds: [newer.id] }] });
    }
    // Each 版本未定 note the document would show, asked first: 「首页中央按钮的用法」 (the user's + button opening the AI page
    // beside the AI's 守护 button) stood as unsettled in one chapter while another told 「采纳中间按钮跳转AI」 as the plan.
    const statuses = wikiUnitStatuses(units, organization, ledger.decisions);
    for (const note of differingPlans(units, id => statuses.get(id), zh, wikiDecidedTopics(organization.topics, ledger.decisions))) {
      const members = note.unitIds.flatMap(id => byId.get(id) ?? []);
      if (members.length < 2 || members.some(unit => asked.has(unit.id) || planned.has(unit.id))) continue;
      members.forEach(unit => asked.add(unit.id));
      const chapters = [...new Set(members.flatMap(unit => chapterOf.get(unit.id) ?? []))], own = members.some(unit => unit.evidence.role === "user" && !unit.evidence.pasted);
      const head = note.note.split(/[：:]/u)[0].trim();
      questions.push({ id: `topic:${members.map(unit => unit.id).join("|")}`, kind: "topic", impact: TOPIC_IMPACT + OPEN_IMPACT + chapters.length + (own ? OWN_IMPACT : 0), ...(chapters[0] ? { chapter: chapters.join("、") } : {}),
        question: zh ? `${/两种|说法|写法|改法|用法/u.test(head) ? head : `「${head}」`}，现在按哪一个？` : `Which holds now for “${head}”?`,
        options: members.slice(0, ROADMAP_OPTIONS).map(unit => ({ id: unit.id, label: unit.statement, unitIds: [unit.id] })) });
    }
    // By how much of the document each answer changes: a roadmap decides a chapter, two versions of one point a line.
    questions = [...questions.filter(item => item.kind === "topic"), ...questions.filter(item => item.kind === "roadmap").map(item => ({ ...item, impact: ROADMAP_IMPACT })), ...questions.filter(item => item.kind === "versions").map(item => ({ ...item, impact: PAIR_IMPACT }))]
      .sort((a, b) => (b.impact ?? 0) - (a.impact ?? 0));
    versionCache.set(organization, questions);
  }
  return questions.map(question => {
    const verdicts = question.options.map(option => option.unitIds.map(id => ledger.decisions?.[id]?.verdict));
    const all = (index: number, verdict: string) => verdicts[index].every(value => value === verdict);
    const answer = verdicts.every(values => values.every(value => value === "open")) ? "open"
      : question.pair && ledger.coexisting?.includes(question.pair) && question.options.every((_, index) => all(index, "confirmed")) ? "both"
        : question.options.find((_, index) => all(index, "confirmed") && question.options.every((__, other) => other === index || all(other, "rejected")))?.id;
    return answer ? { ...question, answer } : question;
  });
}

/** The ledger with a version answer: the chosen option confirmed and the others set aside; both confirmed and kept side
 * by side; all marked open; or, with no answer, every verdict of the question withdrawn. */
export function withVersionAnswer(ledger: WikiKnowledgeLedger, question: WikiVersionQuestion, answer: WikiVersionAnswer): WikiKnowledgeLedger {
  // An older UI/cache can still hold a compound, compatible pair. Choosing one
  // confirms that point without silently rejecting the independent point in the other.
  const chosenOption = question.options.find(option => option.id === answer);
  if (chosenOption && question.kind === "versions") {
    const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
    const pair = question.options.map(option => units.get(option.unitIds[0]));
    if (pair.length === 2 && pair[0] && pair[1] && !exclusiveWikiVersions(pair[0], pair[1])) return withDecision(ledger, chosenOption.unitIds, "confirmed", undefined, [chosenOption.label]);
  }
  const ids = question.options.flatMap(option => option.unitIds);
  let next = withDecision(ledger, ids, undefined);
  next = { ...next, coexisting: (next.coexisting ?? []).filter(pair => pair !== question.pair) };
  if (!next.coexisting?.length) delete next.coexisting;
  if (answer === "open") return withDecision(next, ids, "open");
  if (answer === "both") return { ...withDecision(next, ids, "confirmed", undefined, question.options.map(option => option.label)), ...(question.pair ? { coexisting: [...next.coexisting ?? [], question.pair] } : {}) };
  const chosen = question.options.find(option => option.id === answer);
  if (!chosen) return next;
  next = withDecision(next, chosen.unitIds, "confirmed", undefined, [chosen.label]);
  return withDecision(next, ids.filter(id => !chosen.unitIds.includes(id)), "rejected");
}

/** Another project the discussion keeps naming: where it belongs decides whether its points are written into this
 * project's chapters, a chapter of their own, the references, or not at all. Extraction marks it other_project but
 * cannot tell the user's second project from a part of this one; the user can, in one click. */
export interface WikiScopeQuestion { id: string; key: string; name: string; count: number; question: string; detail: string; unitIds: string[]; answer?: WikiScopeAnswer }
/** One point written in several chapters: told once, it is not repeated across the document. */
/** point: the point itself, in full; statements: up to two of the ways the discussion said it, so the user can judge. */
export interface WikiSameQuestion { id: string; groupId: string; question: string; detail: string; point: string; statements: string[]; chapters: string[]; home: string; answer?: "same" | "different" }

/** Units naming another project before it is asked about; fewer are passing mentions. */
const SCOPE_MIN_UNITS = 3, SCOPE_QUESTIONS = 2, SAME_QUESTIONS = 2, POINT_LENGTH = 140, SAME_LIKENESS = .45;
export function wikiScopeQuestions(ledger: WikiKnowledgeLedger | undefined, zh: boolean): WikiScopeQuestion[] {
  const organization = ledger?.organization;
  if (!ledger || !organization) return [];
  const merged = new Set(organization.merged.flatMap(row => row.from)), byKey = new Map<string, { name: string; units: WikiKnowledgeUnit[] }>();
  for (const unit of wikiLedgerUnits(ledger)) {
    if (unit.about?.role !== "other_project" || merged.has(unit.id)) continue;
    const key = aboutNameKey(unit.about.name), entry = byKey.get(key) ?? { name: unit.about.name, units: [] };
    entry.units.push(unit); byKey.set(key, entry);
  }
  return [...byKey].filter(([, entry]) => entry.units.length >= SCOPE_MIN_UNITS).sort((a, b) => b[1].units.length - a[1].units.length).slice(0, SCOPE_QUESTIONS).map(([key, { name, units }]) => {
    const sample = [...units].sort((a, b) => b.statement.length - a.statement.length)[0];
    return { id: `scope:${key}`, key, name, count: units.length, unitIds: units.map(unit => unit.id), detail: line(sample.statement),
      question: zh ? `「${name}」在讨论里出现了 ${units.length} 次，它是？` : `“${name}” comes up ${units.length} times. What is it?`, ...(ledger.scopeAnswers?.[key] ? { answer: ledger.scopeAnswers[key] } : {}) };
  });
}
export function withScopeAnswer(ledger: WikiKnowledgeLedger, question: WikiScopeQuestion, answer: WikiScopeAnswer | undefined): WikiKnowledgeLedger {
  const scopeAnswers = { ...ledger.scopeAnswers }, next: WikiKnowledgeLedger = { ...ledger, decisionsAt: Date.now() };
  if (answer) scopeAnswers[question.key] = answer; else delete scopeAnswers[question.key];
  if (Object.keys(scopeAnswers).length) next.scopeAnswers = scopeAnswers; else delete next.scopeAnswers;
  return next;
}

/** Explanation groups whose members the directory spread over two or more chapters, most spread first. */
export function wikiSameQuestions(ledger: WikiKnowledgeLedger | undefined, zh: boolean): WikiSameQuestion[] {
  const organization = ledger?.organization;
  if (!ledger || !organization?.groups?.length) return [];
  const subjectChapter = new Map<string, string>();
  for (const chapter of organization.chapters) for (const topic of chapter.subtopics) for (const id of topic.subjectIds) subjectChapter.set(id, chapter.title);
  const unitChapter = new Map(organization.subjects.flatMap(subject => subject.unitIds.flatMap(id => subjectChapter.has(subject.id) ? [[id, subjectChapter.get(subject.id)!] as const] : [])));
  const settled = new Set(ledger.separateGroups ?? []), statementOf = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit.statement.trim()]));
  return organization.groups.flatMap(group => {
    const chapters = [...new Set(group.members.flatMap(member => unitChapter.get(member.unitId) ?? []))], home = subjectChapter.get(group.homeSubjectId);
    if (chapters.length < 2 || !home || settled.has(group.id) && !ledger.sameGroups?.includes(group.id)) return [];
    // The point must read like what the members say: a summary none of them resembles ("当前方案与旧方案明确区分" over
    // eleven different distinctions, two of them alike) asks the user to judge a sentence the discussion never said.
    const core = bigramsOf(group.core), said = group.members.flatMap(member => statementOf.get(member.unitId) ?? []).filter(text => text !== group.core.trim());
    const resembles = (text: string) => { const own = bigramsOf(text); let shared = 0; for (const pair of core) if (own.has(pair)) shared++; return core.size > 0 && shared / Math.min(core.size, own.size || 1) >= SAME_LIKENESS; };
    if (said.length && said.filter(resembles).length * 2 < said.length) return [];
    // Only a point told again elsewhere is asked: members away from the home that only add their own conditions are
    // written where they are anyway, and asking "是同一件事吗" of them had no right answer.
    if (!group.members.some(member => member.role === "restates" && unitChapter.get(member.unitId) !== home)) return [];
    return [{ group, chapters, home }];
  }).sort((a, b) => b.chapters.length - a.chapters.length || b.group.members.length - a.group.members.length).slice(0, SAME_QUESTIONS).map(({ group, chapters, home }) => ({
    id: `same:${group.id}`, groupId: group.id, chapters, home, detail: line(group.core), point: group.core.trim().slice(0, POINT_LENGTH),
    // One wording from the chapter that keeps it and one from a chapter that would only mention it, side by side.
    statements: (() => { const wordings = group.members.flatMap(member => { const text = statementOf.get(member.unitId); return text && text !== group.core.trim() ? [{ text, chapter: unitChapter.get(member.unitId) }] : []; });
      const kept = wordings.find(item => item.chapter === home), away = wordings.find(item => item.chapter !== home);
      return [...new Set([kept, away].flatMap(item => item ? [item.text] : wordings.slice(0, 2).map(other => other.text)))].slice(0, 2).map(line); })(),
    // The point is named in the question itself: "这一点" alone left the user guessing what was asked.
    question: zh ? `「${line(group.core)}」在${chapters.length > 2 ? `「${chapters[0]}」等 ${chapters.length} 章` : `「${chapters.join("」「")}」`}都写了，说的是同一件事吗？` : `“${line(group.core)}” is written in ${chapters.join(", ")}. Is it one point?`,
    ...(ledger.sameGroups?.includes(group.id) ? { answer: "same" as const } : ledger.separateGroups?.includes(group.id) ? { answer: "different" as const } : {}),
  }));
}
export function withSameAnswer(ledger: WikiKnowledgeLedger, question: WikiSameQuestion, answer: "same" | "different" | undefined): WikiKnowledgeLedger {
  const sameGroups = (ledger.sameGroups ?? []).filter(id => id !== question.groupId), separateGroups = (ledger.separateGroups ?? []).filter(id => id !== question.groupId);
  if (answer === "same") sameGroups.push(question.groupId); else if (answer === "different") separateGroups.push(question.groupId);
  const next: WikiKnowledgeLedger = { ...ledger, sameGroups, separateGroups, decisionsAt: Date.now() };
  if (!sameGroups.length) delete next.sameGroups;
  if (!separateGroups.length) delete next.separateGroups;
  return next;
}

/** Questions are asked only where the answer changes what is written: where a project's points go, whether a point
 * spread over chapters is told once, which version of a thing holds, and whether a point the discussion kept returning
 * to (or left open) is the user's decision. A suggestion mentioned once changes one label and is not asked: it stays
 * marked as a suggestion, to change later in the ledger.
 * No count drops a question: every one whose answer changes the document is asked before writing, in order of how much
 * it changes. shown: how many stand open at once, a few more for a longer document; the rest wait folded below them.
 * A fixed six, two of them decisions, left 「首屏」, 「复盘时长」 and 「付费时机」 to the ledger after writing. */
const SHOWN_BASE = 4, SHOWN_PER_CHAPTER = .5, SHOWN_MOST = 10, ASKED_MOST = 24, LEDGER_CANDIDATES = 8;
export function wikiDecisionQuestions(ledger: WikiKnowledgeLedger | undefined, zh: boolean, versions = true): { scope: WikiScopeQuestion[]; same: WikiSameQuestion[]; versions: WikiVersionQuestion[]; candidates: WikiDecisionCandidate[]; shown: number } {
  const scope = versions ? wikiScopeQuestions(ledger, zh) : [], same = versions ? wikiSameQuestions(ledger, zh) : [];
  const questions = versions ? wikiVersionQuestions(ledger, zh).filter(question => question.answer || !question.options.some(option => option.unitIds.some(id => (ledger?.writingQuestions ?? []).some(asked => asked.unitIds.includes(id))))).slice(0, ASKED_MOST) : [];
  // Points the user was asked about before or while writing (answered or skipped) are not asked again here.
  const before = new Set([...(ledger?.writingQuestions ?? []).flatMap(question => question.unitIds), ...(ledger?.userAnswers ?? []).flatMap(answer => answer.unitIds)]);
  const asked = new Set([...before, ...questions.flatMap(question => question.options.flatMap(option => option.unitIds))]);
  const candidates = wikiDecisionCandidates(ledger, versions ? ASKED_MOST : LEDGER_CANDIDATES).filter(item => !item.unitIds.some(id => asked.has(id)) && (item.verdict || item.unitIds.length > 1 || item.status === "open"));
  const chapters = ledger?.organization?.chapters.length ?? 0;
  const shown = versions ? Math.min(SHOWN_MOST, Math.round(SHOWN_BASE + chapters * SHOWN_PER_CHAPTER)) : LEDGER_CANDIDATES;
  return { scope, same, versions: questions, candidates: candidates.slice(0, Math.max(0, (versions ? ASKED_MOST : LEDGER_CANDIDATES) - questions.length)), shown };
}
