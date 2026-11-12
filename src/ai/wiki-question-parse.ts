import { UNDECIDED } from "../shared/open-words";
import { wikiMeasure } from "../shared/wiki-section-status";
import { knowledgeTerms } from "../shared/knowledge-subject";
import type { WikiAnswerAction, WikiKnowledgeLedger, WikiKnowledgeUnit, WikiScopeAnswer, WikiWritingQuestion } from "../shared/wiki-knowledge";
import { wikiConfirmationCovers, wikiUnitConfirmationDetails } from "./wiki-confirmation-scope";

/** Questions a model asks the user about the material, read from its answer: ids it was sent, answers from the actions
 * the ledger keeps, at least two answers each, nothing asked twice. Never throws: no questions is a valid answer.
 * real: the ids the model saw → unit ids. prefix tells questions asked before writing from those asked while writing. */
const ACTIONS = new Set(["confirm", "reject", "open", "both", "owner"]), OWNER_ANSWERS = new Set<WikiScopeAnswer>(["exclude", "related", "reference", "project"]), MAX_OPTIONS = 4;
const ALIAS = /\bk\d+\b/u;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function readQuestions(value: unknown, real: Map<string, string>, organization: number, options: { prefix?: string; limit?: number; stage?: "writing" } = {}): WikiWritingQuestion[] {
  const raw = (value as { questions?: unknown })?.questions, limit = options.limit ?? 6;
  if (!Array.isArray(raw)) return [];
  const asked = new Set<string>(), questions: WikiWritingQuestion[] = [];
  for (const item of raw.slice(0, limit * 2)) {
    const question = item as { about?: unknown; ask?: unknown; unitIds?: unknown; options?: unknown };
    const about = text(question.about, 24), ask = text(question.ask, 120);
    const unitIds = (Array.isArray(question.unitIds) ? question.unitIds : []).flatMap(id => typeof id === "string" && real.has(id) ? [real.get(id)!] : []);
    // An id the model was sent (k78) means nothing to the user, and came back inside one answer they chose.
    if (!about || !ask || !unitIds.length || !Array.isArray(question.options) || ALIAS.test(`${about} ${ask}`)) continue;
    const key = [...new Set(unitIds)].sort().join("|");
    if (asked.has(key)) continue;
    const answers = question.options.slice(0, MAX_OPTIONS).flatMap((option, index) => {
      const label = text((option as { label?: unknown })?.label, 60);
      if (!label || ALIAS.test(label)) return [];
      const actions = (Array.isArray((option as { actions?: unknown }).actions) ? (option as { actions: unknown[] }).actions : []).flatMap((action): WikiAnswerAction[] => {
        const entry = action as { do?: unknown; units?: unknown; name?: unknown; answer?: unknown };
        const units = (Array.isArray(entry.units) ? entry.units : []).flatMap(id => typeof id === "string" && real.has(id) ? [real.get(id)!] : []);
        if (typeof entry.do !== "string" || !ACTIONS.has(entry.do) || !units.length) return [];
        if (entry.do === "both") return units.length === 2 ? [{ do: "both", units: [units[0], units[1]] }] : [];
        if (entry.do === "owner") { const name = text(entry.name, 40), answer = entry.answer as WikiScopeAnswer; return name && OWNER_ANSWERS.has(answer) ? [{ do: "owner", units, name, answer }] : []; }
        return [{ do: entry.do as "confirm" | "reject" | "open", units }];
      });
      return [{ id: `o${index + 1}`, label, actions }];
    });
    if (answers.length < 2) continue;
    asked.add(key);
    questions.push({ id: `ask:${organization}:${options.prefix ? `${options.prefix}:` : ""}${questions.length + 1}`, about, ask, unitIds: [...new Set(unitIds)], options: answers, organization, ...(options.stage ? { stage: options.stage } : {}) });
    if (questions.length >= limit) break;
  }
  return questions;
}

// A numbered stage or a measured value an answer names: "Milestone 1", "M2", "v1", "8px", "300 ms".
const STAGED = /\b(milestone|phase|stage|version|sprint|round|m|v)\s*(\d+(?:\.\d+)*)\b/giu;
const MEASURED = /(\d+(?:\.\d+)?)\s*(px|ms|kb|mb|gb|rem|em|dp|pt|%)(?![A-Za-z])/giu;
const SAME_KIND: Record<string, string> = { m: "milestone", v: "version" };
function marks(text: string) {
  const found = new Map<string, Set<string>>();
  const add = (kind: string, value: string) => { const key = SAME_KIND[kind] ?? kind; found.set(key, (found.get(key) ?? new Set()).add(value)); };
  for (const match of text.matchAll(STAGED)) add(match[1].toLowerCase(), match[2]);
  for (const match of text.matchAll(MEASURED)) add(match[2].toLowerCase(), match[1]);
  return found;
}
/** An answer whose words name another stage or value of the same kind than the point it confirms: "Milestone 1 includes
 * CSV export" confirming "Milestone 2 includes CSV export". The user who chose it rejected their own decision. */
export function labelContradicts(label: string, statement: string): boolean {
  const held = marks(statement);
  return [...marks(label)].some(([kind, values]) => { const other = held.get(kind); return Boolean(other) && ![...values].some(value => other!.has(value)); });
}
const confirmedBy = (option: WikiWritingQuestion["options"][number]) => option.actions.flatMap(action => action.do === "confirm" || action.do === "both" ? action.units : []);

/** Link the effective verdict to the action that set it. An answer's unitIds
 * include other options, so they cannot establish confirmation by themselves. */
export function wikiLocalConfirmation(stored: WikiKnowledgeLedger, reading: WikiKnowledgeLedger, unitId: string): "choice" | "verdict" | undefined {
  const verdict = reading.decisions?.[unitId];
  if (verdict?.verdict !== "confirmed") return;
  const answer = (reading.userAnswers ?? []).find(answer => {
    if (answer.at !== verdict.at) return false;
    const option = reading.writingQuestions?.find(question => question.id === answer.questionId)?.options.find(option => option.id === answer.optionId);
    return option && (unitId === `answer:${answer.questionId}:${option.id}` || confirmedBy(option).includes(unitId));
  });
  if (answer) return "choice";
  if (stored.decisions?.[unitId]?.verdict === "confirmed" && stored.decisions[unitId].at === verdict.at) return "verdict";
}
/** A later answer on a broader question cannot turn an earlier selected
 * option's unconfirmed details into an inferred rejection. */
function selectedAnswerUnits(ledger: WikiKnowledgeLedger): Set<string> {
  const questions = new Map(ledger.writingQuestions?.map(question => [question.id, question]));
  return new Set((ledger.userAnswers ?? []).flatMap(answer => {
    const chosen = questions.get(answer.questionId)?.options.find(option => option.id === answer.optionId);
    return chosen ? confirmedBy(chosen) : [];
  }));
}
const ownerKey = (name: string) => name.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, "");

/** A question as it can be put to the user: an owner answer naming the project itself does nothing (the project is
 * not another project), an answer contradicting the point it confirms goes, and a question left with one answer is
 * not asked: both its points said the same. undefined: not a question. */
export function soundQuestion(question: WikiWritingQuestion, statementOf: (id: string) => string | undefined, project?: string, unitOf?: (id: string) => WikiKnowledgeUnit | undefined): WikiWritingQuestion | undefined {
  // Figures of the project said on different days ("日活只有25", "每天稳定在22人", "日活卡在40了") are its history, not two
  // versions to choose from: asked "当前日活是25人、30人还是40人？", the answer turned one figure into a decision 〔已定〕 and
  // rejected the others, which the chapters still told with their dates.
  if (unitOf && question.unitIds.length >= 2 && question.unitIds.every(id => { const unit = unitOf(id); return Boolean(unit && wikiMeasure(unit)); })) return undefined;
  const own = project ? ownerKey(project) : "";
  const options = question.options.flatMap(option => {
    if (confirmedBy(option).some(id => { const statement = statementOf(id); return statement !== undefined && labelContradicts(option.label, statement); })) return [];
    const actions = option.actions.filter(action => !(action.do === "owner" && own && ownerKey(action.name) === own));
    return [actions.length === option.actions.length ? option : { ...option, actions }];
  });
  if (options.length < 2) return undefined;
  return options.length === question.options.length && options.every((option, index) => option === question.options[index]) ? question : { ...question, options };
}

/** The ledger with only the answers its questions can give, for reading: an answer the question should not have
 * offered is not taken, and the decisions it made, unless changed since, are withdrawn. The stored ledger stays. */
export function withSoundAnswers(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.writingQuestions?.length) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  const project = ledger.organization?.projectName, sound = new Map<string, WikiWritingQuestion | undefined>();
  for (const question of ledger.writingQuestions) sound.set(question.id, soundQuestion(question, id => units.get(id)?.statement, project, id => units.get(id)));
  if ([...sound].every(([id, question]) => question === ledger.writingQuestions!.find(item => item.id === id))) return ledger;
  const decisions = { ...ledger.decisions };
  const userAnswers = (ledger.userAnswers ?? []).filter(answer => {
    const question = ledger.writingQuestions!.find(item => item.id === answer.questionId);
    if (!question || !answer.optionId) return true;
    const kept = sound.get(question.id);
    if (kept?.options.some(option => option.id === answer.optionId)) return true;
    for (const id of new Set(question.options.flatMap(option => option.actions.flatMap(action => action.do === "owner" ? [] : action.units)))) if (decisions[id]?.at === answer.at) delete decisions[id];
    return false;
  });
  const next: WikiKnowledgeLedger = { ...ledger, decisions, userAnswers, writingQuestions: ledger.writingQuestions.flatMap(question => sound.get(question.id) ?? []) };
  if (!Object.keys(decisions).length) delete next.decisions;
  if (!userAnswers.length) delete next.userAnswers;
  return next;
}

/** Kinds that decide something: what an answer confirms when it confirms a point of one of them. */
const DECIDING: string[] = ["decision", "constraint", "plan"];
/** A point saying a choice is not made yet ("The choice between monthly and pay-period budgets remains undecided."). */
const LEFT_OPEN = UNDECIDED;
/** Words of a statement, lowercased, without the ones every sentence has. */
const terms = (text: string) => new Set(text.toLowerCase().split(/[^a-z0-9㐀-鿿-]+/u).filter(word => word.length >= 4 && !["choice", "between", "remains", "still", "open", "undecided", "versus", "with", "that", "this", "from"].includes(word)));
/** The user's answers as decisions, for reading: an answer that confirms only an account of facts ("Monthly budgets are
 * simpler …; pay-period budgets match cash flow …" for "Implement monthly budgets only for v1.") confirmed what the
 * user did not choose. Their choice is the answer's own words: it becomes a decision of its own under the same subject,
 * the account stays the AI's, and the points the answer kept saying the choice is open are earlier, since it is made.
 * One run listed the user's answer among the open questions and marked the account decided. The stored ledger stays. */
export function withAnsweredChoices(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.writingQuestions?.length) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  const decisions = { ...ledger.decisions }, added = new Map<string, WikiKnowledgeUnit>();
  for (const answer of [...ledger.userAnswers].sort((a, b) => b.at - a.at)) {
    const question: WikiWritingQuestion | undefined = (ledger.writingQuestions ?? []).find(item => item.id === answer.questionId);
    const option: WikiWritingQuestion["options"][number] | undefined = question?.options.find(item => item.id === answer.optionId);
    if (!question || !option) continue;
    const confirmed = option.actions.flatMap(action => action.do === "confirm" ? action.units : []).flatMap(id => {
      const unit = units.get(id), verdict = decisions[id];
      return unit && (!verdict || verdict.verdict === "confirmed") ? [unit] : [];
    });
    const scoped = confirmed.some(unit => !decisions[unit.id] && answerLeavesDetailsOpen(unit, question, answer.answer));
    if (!confirmed.length || confirmed.some(unit => DECIDING.includes(unit.kind) && (!scoped || decisions[unit.id]?.verdict === "confirmed"))) continue;
    if (added.has(confirmed[0].id)) continue;
    for (const unit of confirmed) if (decisions[unit.id]?.verdict === "confirmed" && decisions[unit.id]?.at === answer.at) delete decisions[unit.id];
    const leftOpen = option.actions.flatMap(action => action.do === "open" ? action.units : []).flatMap(unitId => units.get(unitId) ?? []).filter(unit => LEFT_OPEN.test(unit.statement));
    for (const unit of leftOpen) if (decisions[unit.id]?.at === answer.at) decisions[unit.id] = { ...decisions[unit.id], verdict: "rejected" };
    // Other points saying the same choice is open ("… monthly versus pay-period budgeting is still open."), not asked
    // about: the choice is made for them too.
    const openTerms = leftOpen.map(unit => terms(unit.statement));
    for (const unit of units.values()) {
      if (decisions[unit.id] || !LEFT_OPEN.test(unit.statement)) continue;
      const own = terms(unit.statement);
      if (openTerms.some(other => [...own].filter(term => other.has(term)).length >= 3)) decisions[unit.id] = { verdict: "rejected", at: answer.at };
    }
    // The quote stays the anchor's own words, from the message it was said in: one run gave the answer "ask → answer"
    // as its quote, found in no message, and checking the claims against the originals dropped it, its 〔已定〕 and its
    // row among the key decisions. The decision itself is the user's, kept in decisions below.
    const anchor = confirmed[0], label = option.label.trim(), answerId = `answer:${question.id}:${option.id}`;
    // A short label ("380px") says nothing read alone: one run wrote 「380px.〔已定〕」 as its own paragraph and key
    // decision. It goes after what the question is about: 「Popup 宽度：380px。」.
    // A Chinese label is short by its length alone: 「使用“完成专注 X 轮”」 has spaces around its X, read as three words.
    const words = /\p{Script=Han}/u.test(label) ? false : /\s\S+\s\S+/u.test(label);
    const about = question.about?.trim(), bare = !words && label.length <= 16 && about && !label.includes(about);
    const said = bare ? `${about}${/\p{Script=Han}/u.test(about!) ? "：" : ": "}${label}` : label, han = /\p{Script=Han}/u.test(said);
    const statement = /[.!?。！？]$/u.test(said) ? said : `${said}${han ? "。" : "."}`;
    added.set(anchor.id, { ...anchor, id: answerId, statement, kind: "decision", details: [], conditions: undefined, adoption: { status: "user_decision" }, delivery: "unknown", about: undefined, relation: undefined,
      evidence: { ...anchor.evidence, evidenceId: `${anchor.evidence.evidenceId}:${answerId}`, pasted: false, code: undefined } });
    decisions[answerId] = { verdict: "confirmed", at: answer.at };
  }
  if (!added.size) return ledger;
  const clean = (unit: WikiKnowledgeUnit) => { const copy = { ...unit, evidence: { ...unit.evidence } }; delete copy.about; delete copy.relation; delete copy.evidence.code; return copy; };
  const batches = ledger.batches.map(batch => batch.units.some(unit => added.has(unit.id)) ? { ...batch, units: batch.units.flatMap(unit => added.has(unit.id) ? [unit, clean(added.get(unit.id)!)] : [unit]) } : batch);
  const organization = ledger.organization && { ...ledger.organization, subjects: ledger.organization.subjects.map(subject => subject.unitIds.some(id => added.has(id)) ? { ...subject, unitIds: subject.unitIds.flatMap(id => added.has(id) ? [id, added.get(id)!.id] : [id]) } : subject) };
  return { ...ledger, batches, decisions, ...(organization ? { organization } : {}) };
}

/** An answer turning down what was asked: "否，保持原样或待定", "No, keep it as is". */
const DECLINES = /^(?:否|不(?:要|用|改|变|需要)?(?=[，,、\s]|$)|不改|保持原|维持原|no\b|keep (?:it |the current )?(?:as is|unchanged))/iu;
/** A suggestion to change something ("助手建议将首页统计文案从……改为……，待用户确认"). */
const PROPOSES_CHANGE = /建议|改为|换成|替换为|待(?:用户)?确认|\b(?:suggest|propos|switch to|change to)/iu;
/** The suggestions an answer turned down, for reading: "首页文案确认为「完成专注 X 轮」吗？" answered "否，保持原样或待定"
 * left the suggestion open, as the option said, and the export listed it among the open questions with "但用户回答保持
 * 原样或待定". The user said no to the change: a suggestion the answer left open, which another answer would have
 * confirmed, is turned down. A point the user decided by hand is left as they set it. The stored ledger stays. */
export function withDeclinedProposals(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  for (const answer of ledger.userAnswers) {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId), chosen = question?.options.find(option => option.id === answer.optionId);
    if (!question || !chosen || !DECLINES.test(chosen.label.trim()) || chosen.actions.some(action => action.do !== "open")) continue;
    const offered = new Set(question.options.flatMap(option => option === chosen ? [] : confirmedBy(option)));
    for (const id of chosen.actions.flatMap(action => action.units)) {
      const unit = units.get(id), decision = ledger.decisions[id];
      if (!unit || !offered.has(id) || unit.evidence.role !== "assistant" || !PROPOSES_CHANGE.test(unit.statement) || decision?.verdict !== "open" || decision.at !== answer.at) continue;
      (decisions ??= { ...ledger.decisions })[id] = { verdict: "rejected", at: answer.at };
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** A point saying a choice is still to make. */
const STILL_OPEN = UNDECIDED;
/** Two-character runs of Han text and Latin words: enough to tell two Chinese sentences talk of the same choice. */
// The words of asking and of leaving open are no content: "是否加入……尚未确定" gave six pairs every open question shares, and
// answering the long break settled the custom durations, the task name, the sound and the desktop window with it.
const ASKING = new RegExp(String.raw`${UNDECIDED.source}|是否|还是|要不要|能否|尚未|确定|决定|允许|加入|提供|支持|第一版|仅`, "giu");
const pairsOf = (text: string) => new Set([...text.toLowerCase().replace(ASKING, " ").matchAll(/\p{Script=Han}+|[a-z0-9]+/gu)].flatMap(([run]) => /\p{Script=Han}/u.test(run) ? [...run].slice(0, -1).map((char, at) => char + run[at + 1]) : run.length >= 2 ? [run] : []));
const SAME_CHOICE = 4;
/** An option the user chose that decides the choice settles what it set aside as open, for reading. Asked "V0.1版本是否包含
 * 每4轮后的15分钟长休息？", the chosen "包含长休息" confirmed the long break and set "是否加入……长休息尚未确定" and "……每4轮后的长
 * 休息尚待决定" open: after the answer they read 〔未定〕 and stood among the open questions. A point it set open that says a
 * choice is still to make is settled (an earlier state); any other ("宽度必须写成 CSS 变量……") keeps no verdict from it. An
 * option deciding nothing ("暂不决定") leaves its open points open. The stored ledger stays. */
export function withSettledByAnswer(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  for (const answer of ledger.userAnswers) {
    const chosen = ledger.writingQuestions?.find(item => item.id === answer.questionId)?.options.find(option => option.id === answer.optionId);
    if (!chosen?.actions.some(action => action.do === "confirm" && action.units.length)) continue;
    for (const id of chosen.actions.flatMap(action => action.do === "open" ? action.units : [])) {
      const unit = units.get(id), verdict = ledger.decisions[id];
      if (!unit || verdict?.verdict !== "open" || verdict.at !== answer.at) continue;
      decisions ??= { ...ledger.decisions };
      if (STILL_OPEN.test(unit.statement)) decisions[id] = { verdict: "rejected", at: verdict.at };
      else delete decisions[id];
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** The user's answers settle the points elsewhere saying the same choice is not made, for reading: "存储方案和弹窗宽度的最终
 * 选择暂不决定，两个备选方案均保留" (the user's, asked about by no question) still read as current after both were
 * answered. A point counts when it says the choice is open and shares at least four word pairs with a point the
 * answer set aside as open ("弹窗宽度保留……两案并存，未最终指定前不做选择"). A point the user decided by hand is left
 * as they set it. The stored ledger stays. */
export function withAnsweredOpenPoints(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = ledger.batches.flatMap(batch => batch.units), asked = new Set((ledger.writingQuestions ?? []).flatMap(question => question.unitIds));
  const settled = units.filter(unit => ledger.decisions?.[unit.id]?.verdict === "rejected" && STILL_OPEN.test(unit.statement) && asked.has(unit.id));
  if (!settled.length) return ledger;
  const seen = settled.map(unit => ({ pairs: pairsOf(unit.statement), at: ledger.decisions![unit.id].at }));
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  for (const unit of units) {
    if (asked.has(unit.id) || ledger.decisions[unit.id] || !STILL_OPEN.test(unit.statement)) continue;
    const own = pairsOf(unit.statement), match = seen.find(other => [...own].filter(pair => other.pairs.has(pair)).length >= SAME_CHOICE);
    if (match) (decisions ??= { ...ledger.decisions })[unit.id] = { verdict: "rejected", at: match.at };
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** Version names ("V0.1") are not values. Compare clauses separately so a
 * 25/5 choice does not approve the same plan's separate 15-minute break. */
export function answerLeavesDetailsOpen(unit: WikiKnowledgeUnit, question: WikiWritingQuestion, answer: string) {
  const details = wikiUnitConfirmationDetails(unit);
  if (!details.length) return false;
  const yes = /^(?:是|确认|同意|可以|采用|yes|confirm|approved?|agree)[。.!！]?$/iu.test(answer.trim()) && !/还是|或者|\b(?:or|versus|vs\.?)\b/iu.test(question.ask);
  return !wikiConfirmationCovers(`${question.about} ${answer}${yes ? ` ${question.ask}` : ""}`, details);
}

/** Remove confirmation the answer assigned to an entire compound point when
 * its specific numbers were never offered. withAnsweredChoices then records
 * the user's actual choice if no narrower deciding unit represents it. */
export function withAnswerScope(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  const reviewed = new Set<string>();
  for (const answer of [...ledger.userAnswers].sort((a, b) => b.at - a.at)) {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId), chosen = question?.options.find(option => option.id === answer.optionId);
    if (!question || !chosen) continue;
    for (const id of chosen.actions.flatMap(action => action.do === "confirm" ? action.units : [])) {
      if (reviewed.has(id)) continue;
      reviewed.add(id);
      const unit = units.get(id), verdict = ledger.decisions[id];
      if (!unit || verdict?.verdict !== "confirmed" || verdict.wholeUnit && verdict.at >= answer.at
        || !answerLeavesDetailsOpen(unit, question, answer.answer)) continue;
      decisions ??= { ...ledger.decisions };
      delete decisions[id];
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** A named offer in a point the answer turned down: "一次性“30天AI守护计划”付费模式". */
const NAMED_OFFER = /[“「"]([^”」"\n]{4,16})[”」"]/gu;
const offerKey = (text: string) => text.normalize("NFKC").replace(/\s+/gu, "").replace(/ai/giu, "").toLowerCase();
/** The suggestions built on what an answer turned down set aside with it, for reading: asked "初期采用一次性买断制还是订阅制？",
 * the user chose 基础免费+高级AI服务订阅 over the one-off “30天AI守护计划”, and its prices (¥19.9 的 30 天守护计划), its
 * paywall flow ("→ 付费解锁30天AI守护计划") and its comparison table still stood as current suggestions. A point of the
 * assistant naming the offer the rejected point names, which neither the chosen answer nor what it confirms names, is
 * an earlier option too. A point the user decided, or their own words, is left as it is. The stored ledger stays. */
export function withSetAsideOffers(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = ledger.batches.flatMap(batch => batch.units), byId = new Map(units.map(unit => [unit.id, unit] as const));
  const selected = selectedAnswerUnits(ledger);
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  for (const answer of ledger.userAnswers) {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId), chosen = question?.options.find(option => option.id === answer.optionId);
    if (!question || !chosen) continue;
    const kept = offerKey(`${chosen.label} ${confirmedBy(chosen).map(id => byId.get(id)?.statement ?? "").join(" ")}`);
    const rejected = chosen.actions.flatMap(action => action.do === "reject" ? action.units : []).filter(id => ledger.decisions?.[id]?.verdict === "rejected" && ledger.decisions[id].at === answer.at);
    const offers = [...new Set(rejected.flatMap(id => [...(byId.get(id)?.statement ?? "").matchAll(NAMED_OFFER)].map(match => offerKey(match[1]))))].filter(key => key.length >= 4 && !kept.includes(key));
    if (!offers.length) continue;
    for (const unit of units) {
      if (selected.has(unit.id) || ledger.decisions[unit.id] || decisions?.[unit.id] || unit.evidence.role !== "assistant" || unit.adoption.status === "user_decision" || unit.adoption.status === "user_adopted") continue;
      if (offers.some(key => offerKey(unit.statement).includes(key))) (decisions ??= { ...ledger.decisions })[unit.id] = { verdict: "rejected", at: answer.at };
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** Another way of doing what an answer decided, from the subject the answer's points sat in, set aside with the option
 * the answer turned down, for reading: asked "首页……保留左侧布局……，还是……100% AI Agent驾驶舱？", the user kept the left
 * layout, and "首页采用‘AI Agent指挥台+原数据与成长功能’的混合模式", which the question left out, still opened the
 * technical chapter, unmarked. A suggestion (decision or plan, the assistant's, undecided) of the same subject as a
 * point the answer rejected, naming what the question asks about, and nearer the rejected point than any it confirmed.
 * The stored ledger stays. */
const ALTERNATIVE_KINDS: Array<WikiKnowledgeUnit["kind"]> = ["decision", "plan"];
export function withSetAsideAlternatives(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions || !ledger.organization) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  const subjectOf = new Map(ledger.organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject] as const)));
  const selected = selectedAnswerUnits(ledger);
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  for (const answer of ledger.userAnswers) {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId), chosen = question?.options.find(option => option.id === answer.optionId);
    if (!question || !chosen) continue;
    const confirmed = confirmedBy(chosen).flatMap(id => units.get(id) ?? []);
    const rejected = chosen.actions.flatMap(action => action.do === "reject" ? action.units : []).filter(id => ledger.decisions?.[id]?.verdict === "rejected" && ledger.decisions[id].at === answer.at).flatMap(id => units.get(id) ?? []);
    if (!confirmed.length || !rejected.length) continue;
    const asked = knowledgeTerms(`${question.about} ${question.ask}`), shared = (a: WikiKnowledgeUnit, b: WikiKnowledgeUnit) => { const theirs = knowledgeTerms(b.statement); return [...knowledgeTerms(a.statement)].filter(term => theirs.has(term)).length; };
    for (const old of rejected) for (const id of subjectOf.get(old.id)?.unitIds ?? []) {
      const unit = units.get(id);
      if (!unit || selected.has(id) || question.unitIds.includes(id) || ledger.decisions[id] || decisions?.[id] || unit.evidence.role !== "assistant" || !ALTERNATIVE_KINDS.includes(unit.kind) || ["user_decision", "user_adopted"].includes(unit.adoption.status)) continue;
      if (![...knowledgeTerms(unit.statement)].some(term => asked.has(term))) continue;
      const near = shared(unit, old);
      if (near >= 2 && confirmed.every(other => shared(unit, other) < near)) (decisions ??= { ...ledger.decisions })[id] = { verdict: "rejected", at: answer.at };
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}

/** Content words two statements of one choice share, past which a point restates the one an answer turned down. */
const RESTATES_TURNED_DOWN = 4;
/** Points restating what an answer turned down, for reading: 「互助小组是系统自动分配且禁止手动创建，还是允许用户主动寻找战友？」
 * answered 「保留手动寻找或创建入口」 turned down the two points the option named, while 「群组入口应从“寻找组织”改为展示自动
 * 分配后的真实小组进度」, asked about in the same question, and 「用户开始计划后自动分配至守护小组」, under the same subject, still
 * read as the plan. A point with no verdict of its own, asked about with a turned-down point or under its subject, sharing
 * several of its words, is turned down with it. The stored ledger stays. */
export function withTurnedDownRestatements(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.decisions) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  const subjectOf = new Map((ledger.organization?.subjects ?? []).flatMap(subject => subject.unitIds.map(id => [id, subject.id] as const)));
  const selected = selectedAnswerUnits(ledger);
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  // Each answer's refused points, and, for decisions whose answer is not kept (a regenerated ledger carries the decisions,
  // not the questions), the points refused at one time: 「用户开始计划后自动分配至守护小组」 read as today's plan beside the
  // refused 「由系统自动分配匿名小组，不再提供手动创建入口」 once the questions were gone.
  const answered = new Set(ledger.userAnswers?.map(answer => answer.at) ?? []);
  const unanswered = [...new Set(Object.values(ledger.decisions).filter(decision => decision.verdict === "rejected" && !answered.has(decision.at)).map(decision => decision.at))]
    .map(at => ({ at, unitIds: Object.entries(ledger.decisions!).filter(([, decision]) => decision.verdict === "rejected" && decision.at === at).map(([id]) => id), asked: false }));
  const turns = [...(ledger.userAnswers ?? []).map(answer => {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId);
    return { at: answer.at, unitIds: answer.unitIds ?? question?.options.flatMap(option => option.actions.flatMap(action => action.units)) ?? [], asked: Boolean(answer.unitIds) };
  }), ...unanswered];
  for (const turn of turns) {
    const refused = turn.unitIds.flatMap(id => ledger.decisions?.[id]?.verdict === "rejected" && ledger.decisions[id].at === turn.at && units.get(id) ? [units.get(id)!] : []);
    if (!refused.length) continue;
    const answer = { at: turn.at };
    const asked = new Set(turn.asked ? turn.unitIds : []), places = new Set(refused.flatMap(unit => subjectOf.get(unit.id) ?? []));
    const words = refused.map(unit => knowledgeTerms(unit.statement));
    for (const unit of units.values()) {
      // The chosen option may have confirmed only the core of this point.
      // Removing an overbroad confirmation does not turn its details down.
      if (selected.has(unit.id) || ledger.decisions[unit.id] || decisions?.[unit.id] || unit.evidence.role === "user" || !(asked.has(unit.id) || places.has(subjectOf.get(unit.id) ?? ""))) continue;
      const own = knowledgeTerms(unit.statement);
      if (words.some(other => [...own].filter(term => other.has(term)).length >= RESTATES_TURNED_DOWN)) (decisions ??= { ...ledger.decisions })[unit.id] = { verdict: "rejected", at: answer.at };
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}
