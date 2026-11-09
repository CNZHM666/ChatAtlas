import { currentBaseline, laterTakenUp } from "./wiki-knowledge-state";
import { assistantRequest, exactDetail, personalDirection, similarStatements, wikiLedgerUnits, wikiUnitDetails, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { englishText } from "../shared/wiki-sentences";

/** Characters of English that say what one character of Chinese does: the length budgets below were set on Chinese
 * runs, and counted as written they cut an English run's subtopics to a third (one run left 49 points out, among them
 * every dashboard, row and colour value, so no table was left to write). */
const ENGLISH_CHARS = 2.5;
const cost = (text: string, length = text.length) => englishText(text) ? Math.ceil(length / ENGLISH_CHARS) : length;

/** The curated Wiki view: which units a chapter explains. Local and deterministic;
 * the rest stay in the ledger and are counted beside each subtopic. */

const KIND_WEIGHT: Record<WikiKnowledgeUnit["kind"], number> = { decision: 3, constraint: 3, mechanism: 3, report: 2, question: 2, plan: 2, fact: 1.5, history: 1 };
const MUST: WikiUnitStatus[] = ["confirmed", "contested", "reported", "open"];
const PASTED_BONUS = 1.5;
/** Other messages repeating a point that make it always shown; kinds whose measure makes them always shown. */
const ECHOED_MUST = 2, RULE_KINDS: Array<WikiKnowledgeUnit["kind"]> = ["constraint", "decision"];
/** Exact identifiers a reader looks for: an error code, a hex address, a screen size, a colour value, a duration range.
 * The subtopic cap folded "#18181B" and "300-600ms" away in one run. */
// A function a reader calls by name (redactSecrets()) too: one run left the redaction rule out for want of it.
const IDENTIFIER = /\b[a-z]+[A-Z]\w*\(\)|\b[A-Z][A-Z0-9]*_[A-Z0-9_]{3,}\b|\b0x[0-9A-Fa-f]{2,}\b|\b\d{3,4}\s*[x×]\s*\d{3,4}\b|#[0-9A-Fa-f]{6}\b|\d+\s*[-–~～]\s*\d+\s*ms\b/u;
const MEASURE = /\d+(?:\.\d+)?\s*(?:[-–~～至到]\s*\d+(?:\.\d+)?\s*)?(?:px|ms|毫秒|秒|分钟|小时|%|MB|KB|GB|字|\b(?:s|min|h)\b)/iu;
/** Each further message an explanation group's members come from adds this much evidence, up to the cap, as a
 * folded or repeated mention does: repeated discussion is stronger evidence, never more room in the text. */
const GROUP_EVIDENCE = 1, GROUP_EVIDENCE_CAP = 2;
/** A safety rule: what can burn a part or hurt the person building it ("禁止 GPIO 直接驱动 Fan 等高电流负载",
 * "220V 交流电", "膨胀电池"). The subtopic cap folded all three GPIO rules of one run away, and the Wiki read as if
 * any wiring the canvas drew were safe. */
const SAFETY = /市电|高压|交流电|短路|过流|过压|反接|烧(?:毁|坏)|触电|起火|膨胀电池|危险储能|(?:不能|不得|禁止|严禁|不要|勿)[^。；;]{0,16}直接(?:由\s*)?(?:ESP32\s*)?(?:GPIO|引脚|IO)?[^。；;]{0,6}驱动|(?:GPIO|引脚)[^。；;]{0,8}直(?:接)?(?:驱动|连)|(?:不能|不得|禁止|严禁)[^。；;]{0,12}照图接线|\b(?:unsafe|short circuit|mains voltage|high voltage)\b/iu;

/** A target counted in things to build or test ("准备 20~30 个真实用户任务", "至少 12 种场景"): what done means, and
 * the subtopic cap left both such plans of one run in the ledger. */
const COUNTED_TARGET = /\d+\s*(?:[-–~～至到]\s*\d+\s*)?(?:个|种|条|项)(?:真实|典型|标准|固定|常用)?(?:用户)?(?:任务|场景|需求|项目|用例|Prompt|测试|元件|模块)/u;
/** A rule keeping the hardware and the person safe, always shown and always written. */
export const wikiSafetyRule = (unit: WikiKnowledgeUnit) => RULE_KINDS.includes(unit.kind) && SAFETY.test(unit.statement);

/** Points a subject may show beyond those it must: about 1.5 × √n, between 4 and 14. A subject
 * about another product or technology (a competitor, a reference) gets half, with no floor:
 * this project's own subjects keep the room. */
export function wikiSubjectQuota(units: number, about = false) {
  const own = units <= 4 ? units : Math.min(14, Math.max(4, Math.round(Math.sqrt(units) * 1.5)));
  return about ? Math.max(1, Math.round(own / 2)) : own;
}
/** A subject is about something else when most of its units are. */
export const aboutSubject = (units: WikiKnowledgeUnit[]) => units.filter(unit => unit.about).length * 2 > units.length;

/** Points a whole draft shows at most; an explanation group counts once. Must-show points always count. */
export const WIKI_UNIT_BUDGET = 520;
/** Characters of material a whole draft explains at most, about what 520 single points used to hold: a
 * group's core and every condition only one member states count, so a large group costs its real length. */
export const WIKI_LENGTH_BUDGET = 34000;
/** Characters of material one subtopic explains at most, beyond its must-show points: about 700 characters of prose. */
export const WIKI_SUBTOPIC_LENGTH = 1000;
/** A learning record's subtopic holds a lesson: three times a project's. */
const LEARNING_SUBTOPIC = 3;

/** Advice to the person, not knowledge of the project: what the developer should learn, a career direction. One run
 * put "开发者需掌握嵌入式、控制理论、ROS2……" under the technical architecture. It stays in the ledger. */
const PERSONAL = { test: personalDirection };
const messageOf = (unit: WikiKnowledgeUnit) => unit.evidence.messageId || unit.evidence.evidenceId;
/** Separate messages saying a point: repeated discussion, not two units read from one message. */
const mentionsOf = (units: WikiKnowledgeUnit[]) => new Set(units.map(messageOf)).size;

/** Statements made again in other messages: for each set of near-identical units from two or more messages,
 * its best-ranked unit (then the earliest) with how many other messages repeat it. Two units from one message
 * are one mention. Candidates share two or more distinctive terms; similarStatements decides. */
export function echoedStatements(units: WikiKnowledgeUnit[], rank: (unit: WikiKnowledgeUnit) => number, order: Map<string, number>) {
  const terms = units.map(unit => knowledgeTerms(unit.statement)), byTerm = new Map<string, number[]>();
  terms.forEach((own, index) => own.forEach(term => { const list = byTerm.get(term); if (list) list.push(index); else byTerm.set(term, [index]); }));
  // A term in a large share of the units says little about which two are the same point.
  const common = Math.max(20, units.length * .1), parent = units.map((_, index) => index);
  const root = (index: number): number => parent[index] === index ? index : (parent[index] = root(parent[index]));
  terms.forEach((own, index) => {
    const shared = new Map<number, number>();
    for (const term of own) { const list = byTerm.get(term)!; if (list.length > common) continue; for (const other of list) if (other > index) shared.set(other, (shared.get(other) ?? 0) + 1); }
    // The overlap similarStatements asks for, from the terms already read, before its full check.
    const overlaps = (other: number) => { const theirs = terms[other]; if (own.size < 4 || theirs.size < 4) return false; let both = 0; for (const term of own) if (theirs.has(term)) both++; return both / Math.min(own.size, theirs.size) >= .5; };
    for (const [other, count] of shared) if (count >= 2 && messageOf(units[other]) !== messageOf(units[index]) && overlaps(other) && similarStatements(units[index].statement, units[other].statement)) parent[root(other)] = root(index);
  });
  const sets = new Map<number, WikiKnowledgeUnit[]>();
  units.forEach((unit, index) => { const at = root(index), list = sets.get(at); if (list) list.push(unit); else sets.set(at, [unit]); });
  const echoes = new Map<string, number>();
  for (const members of sets.values()) {
    const mentions = mentionsOf(members);
    if (mentions < 2) continue;
    const best = [...members].sort((a, b) => rank(b) - rank(a) || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))[0];
    echoes.set(best.id, mentions - 1);
  }
  return echoes;
}

/** One point to explain: an explanation group, or a unit in no group. */
interface Point { members: WikiKnowledgeUnit[]; home: string; text: string; length: number; must: boolean; value: number; order: number }
export interface WikiCuratedView {
  /** Every unit the draft shows, all members of each chosen group included. */
  selected: Set<string>;
  /** The subject each selected unit is written under: a group's members all sit at its home. */
  home: Map<string, string>;
  /** Groups explained at a home outside a subject holding some of their members: subject → group cores. */
  elsewhere: Map<string, Array<{ core: string; home: string }>>;
  report: Record<string, number>;
}

/** Selected units: every confirmed, reported or open unit and the user's own words, plus each subject's
 * best-ranked others within its quota. An explanation group is one point: chosen whole or not at all,
 * scored by its best member plus a little for each further one, written at its home subject. Another
 * project of the user's stays in the ledger and out of this project's Wiki. */
export function curateWikiUnits(ledger: WikiKnowledgeLedger, statuses: Map<string, WikiUnitStatus>, budget = WIKI_UNIT_BUDGET, lengthBudget = WIKI_LENGTH_BUDGET, subtopicLength = WIKI_SUBTOPIC_LENGTH): WikiCuratedView {
  const organization = ledger.organization, report: Record<string, number> = {};
  if (!organization) return { selected: new Set(), home: new Map(), elsewhere: new Map(), report };
  const units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  const subjectOf = new Map(organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.id] as const)));
  const order = new Map(organization.subjects.flatMap(subject => subject.unitIds).map((id, index) => [id, index]));
  // A learning record is the learner's own path: what to learn, the route, the projects to practise on and the career it
  // is for are its matter, not advice beside a project or another product's points. One run left out the whole first
  // week of Git, tagged as about GitHub, and every 学习路线 point.
  const learning = ledger.documentType === "learning";
  const shown = (unit: WikiKnowledgeUnit | undefined): unit is WikiKnowledgeUnit => Boolean(unit) && subjectOf.has(unit!.id) && !assistantRequest(unit!.statement) && (learning || unit!.about?.role !== "other_project" && !PERSONAL.test(unit!.statement));
  // Repetition and recency from P2: a point folded from several mentions, or the newer side of a narrowing.
  const repeated = new Map(organization.merged.map(row => [row.id, row.from.length]));
  const bonus = new Map<string, number>();
  for (const relation of organization.relations) {
    if (relation.kind === "supplements" || relation.kind === "coexists") { bonus.set(relation.older, (bonus.get(relation.older) ?? 0) + .5); bonus.set(relation.newer, (bonus.get(relation.newer) ?? 0) + .5); }
    if (relation.kind === "narrows") { bonus.set(relation.newer, (bonus.get(relation.newer) ?? 0) + 1); bonus.set(relation.older, (bonus.get(relation.older) ?? 0) - 1); }
  }
  // What pasted material reports ranks by its kind like any other point: it may describe another product.
  // Material the user pasted about this project (a review of its code, an export of its state) is the
  // best evidence of what exists; pasted notes about another product carry an about and get no bonus.
  // A point stated again in other messages, and folded by neither dedupe nor a group, is repeated discussion too:
  // the best-ranked copy counts the others like folded mentions; the copies themselves gain nothing.
  const echoes = echoedStatements([...units.values()].filter(unit => subjectOf.has(unit.id)), unit =>KIND_WEIGHT[unit.kind] + (repeated.get(unit.id) ?? 0), order);
  if (echoes.size) report.echoed_points = echoes.size;
  const score = (unit: WikiKnowledgeUnit) => KIND_WEIGHT[unit.kind] + Math.min(2, (repeated.get(unit.id) ?? 0) + (echoes.get(unit.id) ?? 0)) +(bonus.get(unit.id) ?? 0) + (wikiUnitDetails(unit).some(exactDetail) ? 1 : 0) + (unit.evidence.pasted && !unit.about ? PASTED_BONUS : 0);
  // Also always shown: a point said in three or more messages (one copy; "Service Worker 可能终止" was said in five and
  // shown in none), a rule or target giving a measure ("正文宽度控制在 720–850px"), and a point naming something exact
  // (an error code, an address, a resolution: each run kept a different few of "LOAD_REQUIRES_DRIVER", "0x3C", "1440x900").
  const baseline = new Set(currentBaseline([...units.values()].filter(unit => subjectOf.has(unit.id)), statuses, laterTakenUp([...units.values()])).flatMap(item => item.unitIds));
  // The first unit carrying each source table or code block: its statement ("Define dashboard top bar dimensions and
  // colors for light and dark modes") ranks low, and left out it took the whole property table with it.
  const carriers = new Set<string>(), blocks = new Set<string>();
  for (const unit of [...units.values()].filter(unit => subjectOf.has(unit.id) && unit.evidence.code).sort((a, b) => order.get(a.id)! - order.get(b.id)!)) {
    const key = `${unit.evidence.code!.language}\n${unit.evidence.code!.text}`;
    if (!blocks.has(key)) { blocks.add(key); carriers.add(unit.id); }
  }
  const must = (unit: WikiKnowledgeUnit) => carriers.has(unit.id) || baseline.has(unit.id) || MUST.includes(statuses.get(unit.id)!) || unit.evidence.role === "user" && !unit.evidence.pasted
    || (echoes.get(unit.id) ?? 0) >= ECHOED_MUST || RULE_KINDS.includes(unit.kind) && MEASURE.test(unit.statement) || wikiSafetyRule(unit) || [...RULE_KINDS, "plan"].includes(unit.kind) && COUNTED_TARGET.test(unit.statement) || IDENTIFIER.test(`${unit.statement} ${unit.details.join(" ")}`);
  const points: Point[] = [], grouped = new Set<string>(), elsewhere = new Map<string, Array<{ core: string; home: string }>>();
  for (const group of organization.groups ?? []) {
    const members = group.members.map(member => units.get(member.unitId)).filter(shown).filter(unit => !grouped.has(unit.id));
    if (members.length < 2) continue;
    // The group's home while a shown member still sits there; otherwise the anchor's subject, then the first member's.
    const at = new Set(members.map(unit => subjectOf.get(unit.id)!)), anchor = members.find(unit => unit.id === group.anchorUnitId) ?? members[0];
    const home = at.has(group.homeSubjectId) ? group.homeSubjectId : subjectOf.get(anchor.id)!;
    members.forEach(unit => grouped.add(unit.id));
    // The real length: the core once, then every condition only one member states; a member adding
    // without split-off conditions keeps its own support as what it adds.
    const roles = new Map(group.members.map(member => [member.unitId, member]));
    const length = group.core.length + members.reduce((sum, unit) => { const member = roles.get(unit.id)!; return sum + (member.role === "restates" ? 0 : member.adds.length ? member.adds.join("").length : member.support.length || unit.statement.length); }, 0);
    points.push({ members, home, text: group.core, length: cost(group.core, length), must: members.some(must), value: Math.max(...members.map(score)) + Math.min(GROUP_EVIDENCE_CAP, GROUP_EVIDENCE * (mentionsOf(members) - 1)), order: Math.min(...members.map(unit => order.get(unit.id)!)) });
    for (const subject of new Set(members.map(unit => subjectOf.get(unit.id)!))) if (subject !== home) elsewhere.set(subject, [...elsewhere.get(subject) ?? [], { core: group.core, home }]);
  }
  for (const subject of organization.subjects) for (const id of subject.unitIds) {
    const unit = units.get(id);
    if (shown(unit) && !grouped.has(id)) points.push({ members: [unit], home: subject.id, text: unit.statement, length: cost(unit.statement), must: must(unit), value: score(unit), order: order.get(id)! });
  }
  const bySubject = organization.subjects.map(subject => {
    const own = points.filter(point => point.home === subject.id), members = own.flatMap(point => point.members);
    // Read to review: every point of a lesson is shown, not the best few.
    return { own, quota: learning ? own.length : wikiSubjectQuota(own.length, aboutSubject(members)) };
  });
  const picked = new Set<Point>(points.filter(point => point.must));
  // The whole draft stays within the point budget: quotas shrink in proportion, each subject keeping at least one point.
  const room = Math.max(0, budget - picked.size), wanted = bySubject.reduce((sum, { own, quota }) => sum + Math.min(quota, own.filter(point => !point.must).length), 0);
  const scale = wanted > room ? room / wanted : 1;
  for (const { own, quota: full } of bySubject) {
    // Ties keep discussion order, so a rerun selects the same points.
    // The quota goes to distinct points: a near-repeat of a point already picked is skipped.
    const chosen = own.filter(point => point.must), quota = scale < 1 && full ? Math.max(1, Math.round(full * scale)) : full;
    let taken = 0;
    for (const point of own.filter(point => !point.must).sort((a, b) => b.value - a.value || a.order - b.order)) {
      if (taken >= quota) break;
      if (chosen.some(other => similarStatements(point.text, other.text))) continue;
      chosen.push(point); picked.add(point); taken++;
    }
  }
  // The length budget: the lowest-valued optional points leave first, whole; a group's conditions are never cut.
  let length = [...picked].reduce((sum, point) => sum + point.length, 0);
  for (const point of [...picked].filter(point => !point.must).sort((a, b) => a.value - b.value || b.order - a.order)) {
    if (length <= lengthBudget) break;
    picked.delete(point); length -= point.length; report.length_dropped = (report.length_dropped ?? 0) + 1;
  }
  // A subtopic reads in one sitting: past SUBTOPIC_LENGTH characters of material, its lowest-valued optional points
  // stay in the ledger, counted beside it. One run's UI 规范 subtopic held 46 points, 2800 characters.
  const subtopicOf = new Map((organization.chapters ?? []).flatMap((chapter, at) => chapter.subtopics.flatMap((topic, index) => topic.subjectIds.map(id => [id, `${at}:${index}`] as const))));
  const bySubtopic = new Map<string, Point[]>();
  for (const point of picked) { const key = subtopicOf.get(point.home) ?? point.home; bySubtopic.set(key, [...bySubtopic.get(key) ?? [], point]); }
  for (const own of bySubtopic.values()) {
    let size = own.reduce((sum, point) => sum + point.length, 0);
    for (const point of own.filter(point => !point.must).sort((a, b) => a.value - b.value || b.order - a.order)) {
      if (size <= (learning ? subtopicLength * LEARNING_SUBTOPIC : subtopicLength)) break;
      picked.delete(point); size -= point.length; length -= point.length; report.subtopic_dropped = (report.subtopic_dropped ?? 0) + 1;
    }
  }
  const selected = new Set<string>(), home = new Map<string, string>();
  for (const point of picked) for (const unit of point.members) { selected.add(unit.id); home.set(unit.id, point.home); }
  Object.assign(report, { points: picked.size, group_points: [...picked].filter(point => point.members.length > 1).length, length });
  return { selected, home, elsewhere, report };
}

/** The selected unit IDs alone. */
export function selectWikiUnits(ledger: WikiKnowledgeLedger, statuses: Map<string, WikiUnitStatus>, budget = WIKI_UNIT_BUDGET): Set<string> {
  return curateWikiUnits(ledger, statuses, budget).selected;
}
