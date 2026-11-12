import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiUserChooses } from "../shared/wiki-user-choice";
import { wikiSaidLater } from "../shared/wiki-sources";
import type { WikiKnowledgeLedger, WikiKnowledgeOrganization, WikiKnowledgeUnit } from "../shared/wiki-knowledge";

/** A sentence asking: ending on a question mark or particle, or opening on an asking phrase. */
const ASKED_END = /(?:[？?]|吗|呢|么|嘛)\s*$/u;
/** Asking whether, not how: "怎么跟codex说……既然是小白应该首屏就展示……" tells what should be, under a "how" opening. */
const ASKED_START = /^(?:是不是|是否|要不要|会不会|能不能|可不可以|有没有|你觉得|你认为|\b(?:should|could|would|is|are|do|does|can) (?:i|we|it|this|the)\b)/iu;
const STATES = /应该|应当|必须|我要|我决定|就用|一定要|\b(?:must|we will|i will)\b/iu;
/** A statement telling the asking itself ("探讨……的可行性"), not an answer. */
const TELLS_ASKING = /^(?:探讨|讨论|评估|询问|了解|研究|思考|考虑|咨询|确认)/u;
const READ_KINDS: Array<WikiKnowledgeUnit["kind"]> = ["plan", "decision", "fact", "constraint"];

/** The quote's sentence carrying the point: the one sharing most of the statement's terms. */
function carryingSentence(unit: WikiKnowledgeUnit): string | undefined {
  const own = knowledgeTerms(unit.statement);
  let best: string | undefined, most = 0;
  for (const sentence of unit.evidence.quote.split(/(?<=[。！？!?\n])/u).map(part => part.trim()).filter(Boolean)) {
    let shared = 0;
    for (const term of knowledgeTerms(sentence)) if (own.has(term)) shared++;
    if (shared > most) { most = shared; best = sentence; }
  }
  return best;
}

/** Whether a user's point is a question they asked, read as their plan or a fact: "你觉得把戒色和AI结合怎么样，真的有效吗"
 * stood as the bold conclusion 「探讨将戒色行为管理与人工智能技术结合的可行性及有效性」〔你〕, and "是不是……应该侧重点放到帮助青少年
 * 男性……的方向？" as the user's plan to turn to teenagers. Only when the sentence carrying the point asks, and the user did
 * not decide it in their own words. */
export function userAskedOnly(unit: WikiKnowledgeUnit): boolean {
  if (unit.evidence.role !== "user" || unit.evidence.pasted || unit.about || !READ_KINDS.includes(unit.kind)) return false;
  if (unit.adoption.status === "user_decision" && wikiUserChooses(unit.evidence.quote)) return false;
  // What a question takes as given is still said: "为什么我现在的……日活卡在40了……是不是……？" reports the 40 daily users.
  // Only a plan or decision asked about is the question, or a point telling the asking itself.
  if (!["plan", "decision"].includes(unit.kind) && !TELLS_ASKING.test(unit.statement.trim()) || unit.delivery === "user_reported") return false;
  const sentence = carryingSentence(unit)?.replace(/[。！!；;，,\s]+$/u, "");
  if (!sentence) return false;
  // A question ending on a mark tells a point only when it states nothing as it should be, or the point tells the asking.
  return ASKED_START.test(sentence) || ASKED_END.test(sentence) && (TELLS_ASKING.test(unit.statement.trim()) || !STATES.test(sentence));
}

/** The ledger with each question the user asked typed a question: what they asked stays, never as what they decided. */
export function withUserQuestionsAsked(ledger: WikiKnowledgeLedger, report: Record<string, number> = {}): WikiKnowledgeLedger {
  let asked = 0;
  const batches = ledger.batches.map(batch => {
    if (!batch.units.some(userAskedOnly)) return batch;
    return { ...batch, units: batch.units.map(unit => { if (!userAskedOnly(unit)) return unit; asked++; return { ...unit, kind: "question" as const, adoption: { status: "unknown" as const } }; }) };
  });
  if (!asked) return ledger;
  report.user_questions_read = asked;
  return { ...ledger, batches };
}

/** What a later point explicitly rules out: "目标用户定位为18-25岁成年男性，而非青少年". Not "而非单纯……": not merely X does
 * not rule X out. */
const RULES_OUT = /(?:而非|而不是|不再面向|不面向|不针对|不再针对)\s*([^，。；、,;：:（(“”"]{2,10})/gu;
const MERELY = /^(?:单纯|仅仅|仅|只|纯|普通|一味|盲目|无限|统一|一般)/u;

/** A later point ruling out what an earlier one proposed ("……帮助青少年男性找回自信" before "……18-25岁成年男性，而非青少年")
 * replaces it, when they share a term besides the ruled-out words: the two stood side by side, unmarked. A relation the
 * organization holds between them already stands. */
export function explicitExclusions(organization: WikiKnowledgeOrganization, units: Map<string, WikiKnowledgeUnit>, report: Record<string, number> = {}): WikiKnowledgeOrganization {
  const related = new Set(organization.relations.flatMap(relation => [`${relation.older}\n${relation.newer}`, `${relation.newer}\n${relation.older}`]));
  const shown = new Set(organization.subjects.flatMap(subject => subject.unitIds));
  const live = [...units.values()].filter(unit => shown.has(unit.id) && !unit.about);
  const added: WikiKnowledgeOrganization["relations"] = [];
  for (const newer of live) {
    const ruled = [...newer.statement.matchAll(RULES_OUT)].map(match => match[1].replace(/的$/u, "").trim()).filter(phrase => phrase.length >= 2 && !MERELY.test(phrase));
    if (!ruled.length) continue;
    const own = knowledgeTerms(newer.statement);
    for (const older of live) {
      if (older === newer || related.has(`${older.id}\n${newer.id}`) || older.evidence.messageId === newer.evidence.messageId || !wikiSaidLater(newer, older)) continue;
      const phrase = ruled.find(item => older.statement.includes(item) && !new RegExp(`(?:而非|而不是|不|非|没有)\\s*${item.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "u").test(older.statement));
      if (!phrase) continue;
      const excluded = knowledgeTerms(phrase);
      let shared = 0;
      for (const term of knowledgeTerms(older.statement)) if (own.has(term) && !excluded.has(term)) shared++;
      if (!shared) continue;
      added.push({ older: older.id, newer: newer.id, kind: "replaces", status: "resolved" });
      related.add(`${older.id}\n${newer.id}`); related.add(`${newer.id}\n${older.id}`);
    }
  }
  if (!added.length) return organization;
  report.exclusions_replacing = added.length;
  return { ...organization, relations: [...organization.relations, ...added] };
}

/** The points of one answered question that shared a subject stay together when routing moves one of them: asked
 * "首页最终采用左侧布局还是100% AI Agent驾驶舱？", the three answers sat under one subject; routing took the rejected
 * 左侧布局 to 界面与交互设计 › 首页架构与布局, where it opened the chapter's homepage section as its conclusion, and left the
 * chosen 混合模式 among the algorithms. The others follow the one moved, the user's choice beside what it replaced.
 * With the units given, they go where they read best together: to the chapter the one moved went to, or back with the
 * others when their own chapter's points share more of their words. One run routed 「采用“半Agent”架构……」 to 干预机制
 * and the homepage points answered with it followed, 首页设计为“AI Agent指挥台……” told under 紧急求助. */
export function answeredTogether(before: WikiKnowledgeOrganization, after: WikiKnowledgeOrganization, answers: WikiKnowledgeLedger["userAnswers"], report: Record<string, number> = {}, decisions: WikiKnowledgeLedger["decisions"] = {}, units?: Map<string, WikiKnowledgeUnit>): WikiKnowledgeOrganization {
  if (!answers?.length) return after;
  const subjectIn = (organization: WikiKnowledgeOrganization, id: string) => organization.subjects.find(subject => subject.unitIds.includes(id))?.id;
  const chapterOf = new Map(after.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, chapter.id] as const))));
  // The words of a chapter's points in the routed layout, the answered set's own left out.
  const chapterTerms = (chapter: string | undefined, except: Set<string>) => new Set(after.subjects.filter(subject => chapterOf.get(subject.id) === chapter).flatMap(subject => subject.unitIds).filter(id => !except.has(id)).flatMap(id => [...knowledgeTerms(units?.get(id)?.statement ?? "")]));
  const fit = (ids: string[], chapter: string | undefined) => { const theirs = chapterTerms(chapter, new Set(ids)); let shared = 0; for (const id of ids) for (const term of knowledgeTerms(units?.get(id)?.statement ?? "")) if (theirs.has(term)) shared++; return shared; };
  const moves = new Map<string, string>();
  for (const answer of answers) {
    // With them, what the answer set aside of their subject without asking (another way of doing what it decided).
    const homes = new Set(answer.unitIds.flatMap(id => subjectIn(before, id) ?? []));
    const setAside = before.subjects.filter(subject => homes.has(subject.id)).flatMap(subject => subject.unitIds).filter(id => !answer.unitIds.includes(id) && decisions?.[id]?.at === answer.at);
    const ids = [...answer.unitIds, ...setAside].filter(id => subjectIn(before, id) && subjectIn(after, id));
    for (const id of ids) {
      const from = subjectIn(before, id)!, to = subjectIn(after, id)!;
      if (from === to || moves.has(id)) continue;
      // Each point that sat with the moved one and is still where it was.
      const stayed = ids.filter(other => other !== id && !moves.has(other) && subjectIn(before, other) === from && subjectIn(after, other) === from);
      if (!stayed.length) continue;
      // Back with the others when they read better where they are than where the one moved went.
      const together = [id, ...stayed];
      if (units && chapterOf.get(from) !== chapterOf.get(to) && fit(together, chapterOf.get(from)) > fit(together, chapterOf.get(to))) { moves.set(id, from); report.answered_kept_home = (report.answered_kept_home ?? 0) + 1; continue; }
      for (const other of stayed) moves.set(other, to);
    }
  }
  if (!moves.size) return after;
  const followed = [...moves].filter(([id, to]) => to !== subjectIn(before, id)).length;
  if (followed) report.answered_moved_together = followed;
  return { ...after, subjects: after.subjects.map(subject => {
    const kept = subject.unitIds.filter(id => !moves.has(id) || moves.get(id) === subject.id);
    const added = [...moves].filter(([id, to]) => to === subject.id && !subject.unitIds.includes(id)).map(([id]) => id);
    return kept.length === subject.unitIds.length && !added.length ? subject : { ...subject, unitIds: [...kept, ...added] };
  }) };
}
