import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiDraftChapter, WikiInvariantIssue, WikiKnowledgeUnit, WikiTopicChain, WikiUnitStatus } from "../shared/wiki-knowledge";

/** What the checks read: the units, their statuses and the version chains. */
export interface InvariantContext {
  unitOf: (id: string) => WikiKnowledgeUnit | undefined; statusOf: (id: string) => WikiUnitStatus | undefined; topics?: WikiTopicChain[];
  /** A point the user turned down when asked. */
  declined?: (id: string) => boolean;
  /** The points the directory places in a chapter, by chapter id. */
  placed?: (chapterId: string) => string[];
}

/** A part of a unit's statement this share of whose character pairs the chapter must hold to count as told. */
const PART_TOLD = .5;
/** A whole one-sentence point is told in the writer's own words: this share of its character pairs is enough. */
const WHOLE_TOLD = .35;
/** A sentence holding this share of a turned-down point's character pairs tells that point. */
const TELLS_DECLINED = .5;
/** Sentences of two chapters this alike tell one point twice. */
const REPEAT_LIKENESS = .8, REPEAT_CHARS = 24;
/** Statuses whose every part must be written: what the user decided or said. */
const WHOLE: WikiUnitStatus[] = ["confirmed", "reported", "stated"];
/** Words telling a point as turned down. */
const TURNED_DOWN = /否定|否决|拒绝|不采用|未采纳|没有采纳|不采纳|放弃|未被采用|未予采用|declined|rejected|turned down/iu;
const DECIDING = ["decision", "plan", "constraint"];
const ORDINAL = /第[一二三四五六七八九十\d]{1,2}(?:版|步|阶段|期|轮|周|部分)/u;
/** Words telling a sentence as about an earlier version, not as how it is now. */
const APART = /此前|早先|早期|最初|起初|原先|原来|原本|之前|曾(?:经)?|较早|旧版|后(?:来)?(?:改|调整|转)|此后|随后|已(?:被)?(?:替换|取代|放弃|弃用)|不再|earlier|previously|initially|originally|no longer|was replaced/iu;
/** The assistant credited with a point: what the user said told as a suggestion. */
const CREDITS_AI = /(?:AI|助手|ChatGPT|模型)\s*(?:的)?(?:建议|提议|推荐)|(?<![你我])曾建议|(?<![你我])(?:建议|提议)(?:将|把|采用|使用|改为)|\b(?:the (?:AI|assistant) (?:suggests|suggested|proposes|proposed))\b/iu;
/** The user credited with a point: a decision or proposal told as the user's. */
const CREDITS_USER = /(?<![让由给请供待需许将把为与和及或、（(])你(?:已|已经)?(?:提出|决定|确认|选择|要求|确定)(?!是否|与|和|、|[（(])|(?<![区分供让由给交请待需许将把为与和及或、（(误认])用户(?:已|已经)?(?:决定|确认|确定)(?!是否|与|和|、|[（(]|合并)|\b(?:you (?:decided|confirmed|chose)|the user (?:decided|confirmed|chose))\b/iu;

const pairs = (text: string) => knowledgeTerms(text);
const ownWords = (unit: WikiKnowledgeUnit) => unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about;

/** The parts a unit lists, each to be told: 「分三版迭代：第一版……；第二版……；第三版……」 has three. A statement of one
 * part has none to check apart from itself. */
export function unitParts(statement: string): string[] {
  const body = statement.replace(/[。.]\s*$/u, "");
  const intro = body.match(/^[^：:；;]{0,20}[：:](?=.*[；;])/u)?.[0] ?? "";
  let parts = body.slice(intro.length).split(/[；;]/u).map(part => part.trim()).filter(Boolean);
  if (parts.length < 2) {
    const labels = [...body.matchAll(new RegExp(ORDINAL.source, "gu"))];
    if (labels.length >= 2) parts = labels.map((label, index) => body.slice(label.index, labels[index + 1]?.index ?? body.length).replace(/[，,、]\s*$/u, "").trim());
  }
  return parts.length >= 2 ? parts.filter(part => pairs(part).size >= 3) : [];
}

/** Whether a text tells a part: its ordinal label, when it has one, and most of its character pairs. */
export function partTold(part: string, text: string, share = PART_TOLD): boolean {
  const label = part.match(ORDINAL)?.[0];
  if (label && !text.includes(label)) return false;
  const own = pairs(part.replace(ORDINAL, "")), theirs = pairs(text);
  if (!own.size) return true;
  let shared = 0; for (const pair of own) if (theirs.has(pair)) shared++;
  return shared / own.size >= share;
}

const sentencesOf = (text: string) => text.split("\n").filter(line => !/^\s*(?:\||```|>|#)/u.test(line)).join("\n").split(/(?<=[。！？!?\n])/u).map(sentence => sentence.replace(/\*\*/gu, "").trim()).filter(Boolean);

/** The checks one chapter can fail on its own, the ones a rewrite of it can fix. */
export function chapterInvariants(chapter: WikiDraftChapter, context: InvariantContext): WikiInvariantIssue[] {
  const issues: WikiInvariantIssue[] = [];
  const earlier = new Map<string, WikiTopicChain>(), current = new Set<string>();
  for (const topic of context.topics ?? []) { for (const id of topic.earlier) earlier.set(id, topic); for (const id of topic.current) current.add(id); }
  const cited = new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)]);
  // Every part of what the user decided or said, told: 「第二版增加……」 left out of 「第一版……，第三版……」.
  for (const id of cited) {
    const unit = context.unitOf(id);
    if (!unit || !WHOLE.includes(context.statusOf(id)!) || earlier.has(id)) continue;
    const parts = unitParts(unit.statement);
    for (const part of parts) if (!partTold(part, chapter.body)) issues.push({ kind: "coverage", chapterId: chapter.id, unitIds: [id], text: part });
    // A one-sentence decision of the user's, cited and yet not told: 「决定先深耕戒色单一垂直领域」 bound to a sentence
    // saying only the assistant's 「建议将戒色作为获客入口逐步扩展」.
    const decided = context.statusOf(id) === "confirmed" || ownWords(unit) && DECIDING.includes(unit.kind);
    if (!parts.length && decided && !partTold(unit.statement, chapter.body, WHOLE_TOLD)) issues.push({ kind: "coverage", chapterId: chapter.id, unitIds: [id], text: unit.statement.slice(0, 80) });
  }
  // What holds now of a thing settled more than once, placed in this chapter and told nowhere in it: the chapter tells
  // the change without its end.
  const placed = new Set(context.placed?.(chapter.id) ?? []);
  for (const topic of context.topics ?? []) for (const id of topic.current) {
    const unit = context.unitOf(id);
    if (!unit || !placed.has(id) || cited.has(id) || context.statusOf(id) === "history" || partTold(unit.statement, chapter.body, WHOLE_TOLD)) continue;
    issues.push({ kind: "coverage", chapterId: chapter.id, unitIds: [id], text: unit.statement.slice(0, 80) });
  }
  // A point the user turned down, told as how the project is or as adopted once: 「社群互动则通过系统自动分配匿名小组」,
  // 「此前采用系统自动分配同期小组」 after the user declined it.
  const declined = [...cited].map(id => context.unitOf(id)).filter((unit): unit is WikiKnowledgeUnit => Boolean(unit) && context.declined?.(unit!.id) === true && !ownWords(unit!));
  if (declined.length) for (const sentence of sentencesOf(chapter.body)) {
    if (TURNED_DOWN.test(sentence)) continue;
    const told = declined.filter(unit => partTold(unit.statement, sentence, TELLS_DECLINED));
    if (told.length) issues.push({ kind: "rejected_as_current", chapterId: chapter.id, unitIds: told.map(unit => unit.id), text: sentence.slice(0, 80) });
  }
  for (const paragraph of chapter.paragraphs) {
    const claims = paragraph.claims?.length ? paragraph.claims : [{ text: paragraph.text, unitIds: paragraph.unitIds }];
    for (const claim of claims) {
      const ids = claim.unitIds.filter(id => context.unitOf(id));
      if (!ids.length || /^\s*>/u.test(claim.text)) continue;
      // An earlier version told as how it is now: every unit of the sentence replaced, none current, no word saying so.
      if (ids.every(id => earlier.has(id) && !current.has(id)) && !APART.test(claim.text) && !APART.test(paragraph.text.slice(Math.max(0, paragraph.text.indexOf(claim.text) - 12), paragraph.text.indexOf(claim.text))))
        issues.push({ kind: "earlier_as_current", chapterId: chapter.id, unitIds: ids, text: claim.text.slice(0, 80) });
      const units = ids.map(id => context.unitOf(id)!);
      if (units.every(ownWords) && CREDITS_AI.test(claim.text) && !/你|用户/u.test(claim.text)) issues.push({ kind: "user_as_ai", chapterId: chapter.id, unitIds: ids, text: claim.text.slice(0, 80) });
      // A point the user never turned down told as turned down beside one they did: 「……的提议也被否定」.
      if (context.declined && TURNED_DOWN.test(claim.text) && units.some(unit => !context.declined!(unit.id) && unit.evidence.role !== "user")) issues.push({ kind: "declined_overstated", chapterId: chapter.id, unitIds: ids.filter(id => !context.declined!(id)), text: claim.text.slice(0, 80) });
      if (units.every(unit => unit.evidence.role === "assistant") && ids.every(id => ["proposal", "analysis"].includes(context.statusOf(id) ?? "")) && CREDITS_USER.test(claim.text)) issues.push({ kind: "ai_as_user", chapterId: chapter.id, unitIds: ids, text: claim.text.slice(0, 80) });
    }
  }
  return issues;
}

/** Every check over the whole draft: each chapter's own, a confirmed point written nowhere, one point told in two
 * chapters. Reported with the draft; the chapter checks also send a chapter back once (wiki-knowledge-write). */
export function draftInvariants(chapters: WikiDraftChapter[], context: InvariantContext, confirmed: string[] = []): WikiInvariantIssue[] {
  const written = chapters.filter(chapter => chapter.body.trim());
  const issues = written.flatMap(chapter => chapterInvariants(chapter, context));
  const cited = new Set(written.flatMap(chapter => [...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)]));
  for (const id of confirmed) if (!cited.has(id) && context.unitOf(id)) issues.push({ kind: "missing", chapterId: "", unitIds: [id], text: context.unitOf(id)!.statement.slice(0, 80) });
  const seen: Array<{ chapter: string; sentence: string; pairs: Set<string> }> = [];
  for (const chapter of written) for (const sentence of sentencesOf(chapter.body)) {
    if (sentence.length < REPEAT_CHARS) continue;
    const own = pairs(sentence);
    const again = seen.find(other => {
      if (other.chapter === chapter.id) return false;
      let shared = 0; for (const pair of own) if (other.pairs.has(pair)) shared++;
      return shared / Math.max(1, Math.min(own.size, other.pairs.size)) >= REPEAT_LIKENESS;
    });
    if (again) issues.push({ kind: "repeat", chapterId: chapter.id, unitIds: [], text: sentence.slice(0, 80) });
    else seen.push({ chapter: chapter.id, sentence, pairs: own });
  }
  return issues;
}

/** Counts by kind, as report keys: invariant_coverage, invariant_repeat… */
export function invariantCounts(issues: WikiInvariantIssue[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const issue of issues) counts[`invariant_${issue.kind}`] = (counts[`invariant_${issue.kind}`] ?? 0) + 1;
  return counts;
}

/** What a rewrite of the chapter is told to fix, one line per failed check, in the units' own words. */
export function invariantCorrection(issues: WikiInvariantIssue[], context: InvariantContext): string {
  const currentOf = (id: string) => (context.topics ?? []).find(topic => topic.earlier.includes(id))?.current.flatMap(other => context.unitOf(other)?.statement ?? []) ?? [];
  return issues.slice(0, 8).map(issue => {
    if (issue.kind === "coverage") return `the chapter leaves out "${issue.text}", a part of a point it cites that the user decided or said: write it`;
    if (issue.kind === "earlier_as_current") return `"${issue.text}" tells an earlier version as how it is now${currentOf(issue.unitIds[0]).length ? `; what holds now is "${currentOf(issue.unitIds[0])[0].slice(0, 60)}"` : ""}: tell it as earlier (此前……) or leave it out`;
    if (issue.kind === "user_as_ai") return `"${issue.text}" tells what the user said as a suggestion: tell it as the user's (你提出……)`;
    if (issue.kind === "rejected_as_current") return `"${issue.text}" tells a point the user turned down as how the project is or as adopted earlier: tell it as turned down (你否定了……) or leave it out`;
    if (issue.kind === "declined_overstated") return `"${issue.text}" tells as turned down a point the user never turned down: only points marked declined were turned down; tell the others as they were`;
    if (issue.kind === "ai_as_user") return `"${issue.text}" credits the user with what only the assistant proposed: tell it as a suggestion`;
    return `"${issue.text}" is told twice`;
  }).join("; ");
}
