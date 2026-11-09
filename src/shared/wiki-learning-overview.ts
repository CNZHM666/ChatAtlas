import type { LearningRole } from "./wiki-document-type";
import { knowledgeTerms } from "./knowledge-subject";
import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiKnowledgeUnit } from "./wiki-knowledge";

/** Where a point stands: learned, the next step, planned for later, or left out for now. */
export type LearningStatus = "learned" | "next" | "todo" | "skip";
export interface LearningItem {
  text: string; unitId: string;
  /** For learned: told by the user, or judged by the AI after the user's exercises. */
  by: "user" | "ai";
  /** Progress only: the knowledge points the item names, each named once across the whole map. */
  points?: string[]; status?: LearningStatus;
  /** Where it was said, so each status can be checked against its message. */
  conversationId?: string; messageIndex?: number;
}
export interface LearningOverview {
  goal: LearningItem[]; learned: LearningItem[]; todo: LearningItem[]; skip: LearningItem[]; mistakes: LearningItem[]; checks: LearningItem[];
  /** How the learner studies (a daily rhythm, keeping notes) and with what (a course, a video): no knowledge point, so
   * never "learned" or "to learn". */
  methods: LearningItem[];
  /** Every progress item in one list, learned first, then the next step, the plan and what is left for now. */
  map: LearningItem[];
  /** The latest learned point as said, and the latest next step: "where am I, what comes next". */
  now?: LearningItem; next?: LearningItem;
  /** When the latest source conversation ended: the progress is as of then, not as of reading. */
  asOf?: number;
}

const LIMIT = { goal: 4, mistakes: 8, checks: 6, methods: 10 } as const;
/** A way of studying told as progress: "学会用 Notion 记录学习" stood in the map as a point learned. */
const METHOD_SAID = /学习方法|死记|背诵|记事本|学习记录|记录学习|笔记|节奏|每天\s*\d|复习(?:方式|方法|节奏)|任务驱动|番茄|\b(?:study method|routine|take notes)\b/iu;
/** Told again: most of both points' words shared. Measured on the shorter one, "区分 = 与 ==" went as a repeat of
 * "区分 > 与 >=". */
const SAME = .6;
/** A step named for the next lesson or day: "明天先复习，随后开始 NumPy". */
const NEXT = /明天|下一步|下一课|下次|接下来|随后开始|\bnext\b|tomorrow/iu;
/** A record of what was learned that day, written out as a note ("今天学会：- def …"): the AI's model of a learning
 * diary read as "需掌握 def…" and stood as still to learn beside "已掌握 def". */
const LEARNED_RECORD = /(?:今天|今日)(?:学会|学到|掌握)|\b(?:today i learned|learned today)\b/iu;
/** The verb a listed set of points follows, per status; the first that yields a list wins. */
const LIST_VERBS: Record<LearningStatus, RegExp[]> = {
  learned: [/(?:掌握|学会|学完|涵盖|包括)了?/gu],
  todo: [/(?:学习|补充|掌握|学会|学)/gu],
  next: [],
  skip: [/(?:跳过|不(?:需要|用)?学(?:习)?|不碰)/gu, /(?:学习|学)/gu],
};
const SPLIT = /\s*(?:、|，|,|以及|及|和)\s*/u;

/** The knowledge points a progress statement lists, as said: "已掌握变量、list、for 和 def，足以…" → 变量, list, for, def.
 * A statement that lists none is one point, itself. */
export function learningPoints(statement: string, status: LearningStatus): string[] {
  for (const verb of LIST_VERBS[status]) {
    for (const match of statement.matchAll(verb)) {
      const rest = statement.slice(match.index! + match[0].length).split(/[，。；;：:！!？?\n]/u)[0];
      const items = rest.split(SPLIT).map(item => item.trim().replace(/^(?:了|的)/u, "").replace(/等$/u, "").trim()).filter(item => item.length > 0 && item.length <= 24);
      if (items.length >= 2) return items;
    }
  }
  return [statement.trim()];
}

const norm = (text: string) => text.toLowerCase().replace(/\s+|\(\)|（）/gu, "");
const ASCII = /[a-z0-9_]/u;
/** One point names the other: the same words, or one inside the other as a whole word ("def" in "def定义函数", never
 * "in" in "print"). */
function names(short: string, long: string): boolean {
  if (short === long) return true;
  if (!short || short.length > long.length) return false;
  if (!/[a-z]/u.test(short) && short.length < 2) return false;
  for (let at = long.indexOf(short); at >= 0; at = long.indexOf(short, at + 1)) {
    const before = long[at - 1], after = long[at + short.length];
    if (/^[a-z0-9_]/u.test(short) && before && ASCII.test(before)) continue;
    if (/[a-z0-9_]$/u.test(short) && after && ASCII.test(after)) continue;
    return true;
  }
  return false;
}
/** Whether a text names a knowledge point: "for循环" names "for", "if/elif/else 结构" names "if/elif/else". */
export const namesPoint = (point: string, text: string) => names(norm(point), norm(text));
const covers = (known: string[], point: string) => { const p = norm(point); return known.some(other => { const o = norm(other); return names(o, p) || names(p, o); }); };

/** Where a learner stands, from a learning document's roles: what it is for, what is learned, next, planned and left
 * for now, the mistakes made and the self-tests the conversation gave. Progress is one map of knowledge points, each
 * point under its latest standing: a point once learned no longer stands as still to learn, and a point planned twice
 * stands where it was planned last. Empty for a project. */
export function learningOverview(ledger: WikiKnowledgeLedger | undefined): LearningOverview | undefined {
  if (ledger?.documentType !== "learning" || !ledger.learningRoles) return undefined;
  const roles = ledger.learningRoles, folded = new Set((ledger.organization?.merged ?? []).flatMap(item => item.from.filter(id => id !== item.id)));
  const rejected = new Set(Object.entries(ledger.decisions ?? {}).filter(([, decision]) => decision.verdict === "rejected").map(([id]) => id));
  // A point tagged as about another project is still the learner's: GitHub's first week, python-control's code.
  const units = wikiLedgerUnits(ledger).filter(unit => !folded.has(unit.id) && !rejected.has(unit.id))
    .sort((a, b) => (a.evidence.conversationSpan?.start ?? 0) - (b.evidence.conversationSpan?.start ?? 0) || a.evidence.messageIndex - b.evidence.messageIndex);
  const item = (unit: WikiKnowledgeUnit, extra: Partial<LearningItem> = {}): LearningItem => ({ text: unit.statement.trim(), unitId: unit.id, by: byOf(unit), conversationId: unit.evidence.conversationId, messageIndex: unit.evidence.messageIndex, ...extra });
  // How to study and what with: one list, the overview's; the chapters no longer keep one each.
  const isMethod = (unit: WikiKnowledgeUnit) => roles[unit.id] === "method" || roles[unit.id] === "resource" || (roles[unit.id] === "learned" || roles[unit.id] === "todo") && METHOD_SAID.test(unit.statement);
  const list = (role: LearningRole | ((unit: WikiKnowledgeUnit) => boolean), limit: number) => {
    const kept: Array<{ item: LearningItem; terms: Set<string> }> = [];
    for (const unit of units.filter(other => typeof role === "function" ? role(other) : roles[other.id] === role)) {
      const terms = knowledgeTerms(unit.statement);
      if (kept.some(other => { let shared = 0; for (const term of terms) if (other.terms.has(term)) shared++; return shared / Math.max(1, terms.size, other.terms.size) >= SAME; })) continue;
      kept.push({ item: item(unit), terms });
    }
    return kept.map(entry => entry.item).slice(0, limit);
  };

  const recorded = (unit: WikiKnowledgeUnit) => LEARNED_RECORD.test(unit.evidence.code?.text ?? "") || LEARNED_RECORD.test(unit.evidence.quote);
  const learnedUnits = units.filter(unit => !isMethod(unit) && (roles[unit.id] === "learned" || roles[unit.id] === "todo" && recorded(unit)));
  const todoUnits = units.filter(unit => !isMethod(unit) && roles[unit.id] === "todo" && !recorded(unit));
  const nextUnit = [...todoUnits].reverse().find(unit => NEXT.test(unit.statement));

  // Learned first, in the order said: each later statement keeps only the points not already learned.
  const learned: LearningItem[] = [], known: string[] = [];
  for (const unit of learnedUnits) {
    const points = learningPoints(unit.statement, "learned").filter(point => !covers(known, point));
    if (!points.length) continue;
    known.push(...points);
    learned.push(item(unit, { points, status: "learned", text: listed(unit.statement, points, "learned") }));
  }
  // Left for now, unless learned since.
  const skip: LearningItem[] = [], skipped: string[] = [];
  for (const unit of units.filter(other => roles[other.id] === "skip")) {
    const points = learningPoints(unit.statement, "skip").filter(point => !covers(known, point) && !covers(skipped, point));
    if (!points.length) continue;
    skipped.push(...points);
    skip.push(item(unit, { points, status: "skip", text: listed(unit.statement, points, "skip") }));
  }
  // Still to learn: what is not learned yet, each point where it was planned last.
  const planned = todoUnits.filter(unit => unit !== nextUnit).map(unit => ({ unit, points: learningPoints(unit.statement, "todo").filter(point => !covers(known, point)) }));
  const todo: LearningItem[] = [];
  planned.forEach((entry, index) => {
    const later = planned.slice(index + 1).flatMap(other => other.points);
    const points = entry.points.filter(point => !covers(later, point));
    if (points.length) todo.push(item(entry.unit, { points, status: "todo", text: listed(entry.unit.statement, points, "todo") }));
  });
  const next = nextUnit ? item(nextUnit, { points: [nextUnit.statement.trim()], status: "next" }) : undefined;
  const lastLearned = learnedUnits.at(-1);
  const asOf = Math.max(0, ...units.map(unit => unit.evidence.conversationSpan?.end ?? 0)) || undefined;
  return {
    goal: list("goal", LIMIT.goal), learned, todo: next ? [next, ...todo] : todo, skip,
    mistakes: list("mistake", LIMIT.mistakes), checks: list("check", LIMIT.checks), methods: list(isMethod, LIMIT.methods),
    map: [...learned, ...next ? [next] : [], ...todo, ...skip],
    ...(lastLearned ? { now: item(lastLearned, { status: "learned" }) } : {}), ...(next ? { next } : {}), ...(asOf ? { asOf } : {}),
  };
}
/** The statement as said when it kept all its points; otherwise only the points still standing. */
const listed = (statement: string, points: string[], status: LearningStatus) => {
  const all = learningPoints(statement, status);
  return all.length === points.length ? statement.trim() : points.join("、");
};
const byOf = (unit: WikiKnowledgeUnit): "user" | "ai" => unit.evidence.role === "user" && !unit.evidence.pasted ? "user" : "ai";
