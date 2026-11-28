import { UNDECIDED } from "../shared/open-words";
import { wikiMeasure } from "../shared/wiki-section-status";
import { knowledgeOverlap, knowledgeScopesAgree, knowledgeTerms, knowledgeVersion } from "../shared/knowledge-subject";
import type { WikiAnswerAction, WikiKnowledgeLedger, WikiKnowledgeUnit, WikiScopeAnswer, WikiUnitStatus, WikiUserAnswer, WikiWritingQuestion } from "../shared/wiki-knowledge";
import { DECIDING_KINDS, wikiExternalResearch } from "../shared/wiki-knowledge";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiChoiceTrigger, wikiConfirmationCovers, wikiLayerDeferral, wikiReleaseChecklistStatement, wikiReleaseDeferral, wikiUnitConfirmationDetails } from "./wiki-confirmation-scope";
import { wikiWorkflowScopes } from "./wiki-workflow-scope";
import { distinctWikiStageScopes, wikiStageLabels } from "../shared/wiki-roadmap-scope";

/** Questions a model asks the user about the material, read from its answer: ids it was sent, answers from the actions
 * the ledger keeps, at least two answers each, nothing asked twice. Never throws: no questions is a valid answer.
 * real: the ids the model saw → unit ids. prefix tells questions asked before writing from those asked while writing. */
const ACTIONS = new Set(["confirm", "reject", "open", "both", "owner"]), OWNER_ANSWERS = new Set<WikiScopeAnswer>(["exclude", "related", "reference", "project"]), MAX_OPTIONS = 4;
const ALIAS = /\bk\d+\b/u;
const text = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
export function readQuestions(value: unknown, real: Map<string, string>, organization: number, options: { prefix?: string; limit?: number; stage?: "writing"; scoped?: true } = {}): WikiWritingQuestion[] {
  const raw = (value as { questions?: unknown })?.questions, limit = options.limit ?? 6;
  if (!Array.isArray(raw)) return [];
  const asked = new Set<string>(), questions: WikiWritingQuestion[] = [];
  for (const item of raw.slice(0, limit * 2)) {
    if (!item || typeof item !== "object") continue;
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
        const entry = (action ?? {}) as { do?: unknown; units?: unknown; name?: unknown; answer?: unknown };
        const units = (Array.isArray(entry.units) ? entry.units : []).flatMap(id => {
          const unit = typeof id === "string" ? real.get(id) : undefined;
          return unit && (!options.scoped || unitIds.includes(unit)) ? [unit] : [];
        });
        if (typeof entry.do !== "string" || !ACTIONS.has(entry.do) || !units.length) return [];
        if (entry.do === "both") return units.length === 2 ? [{ do: "both", units: [units[0], units[1]] }] : [];
        if (entry.do === "owner") { const name = text(entry.name, 40), answer = entry.answer as WikiScopeAnswer; return name && OWNER_ANSWERS.has(answer) ? [{ do: "owner", units, name, answer }] : []; }
        return [{ do: entry.do as "confirm" | "reject" | "open", units }];
      });
      return [{ id: `o${index + 1}`, label, actions }];
    });
    if (answers.length < 2) continue;
    asked.add(key);
    const identity = sourceMessageSignature(JSON.stringify([about, ask, key, answers]));
    questions.push({ id: `ask:${organization}:${options.prefix ? `${options.prefix}:` : ""}${identity}`, about, ask, unitIds: [...new Set(unitIds)], options: answers, organization,
      ...(options.stage ? { stage: options.stage } : {}), ...(options.scoped ? { scoped: true } : {}) });
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
const AFTER_PRIOR_RELEASE = /(?:^|[，,；;。]\s*)(?:在|待)\s*V\d+(?:\.\d+)*[^，,；;。\n]{0,24}?(?:以后|之后|后)(?=\s*\S)|\bafter\s+v\d+(?:\.\d+)*(?:\s+(?:passes validation|ships|is validated))?\b/iu;

function confirmsAfterPrerequisite(label: string, statement: string) {
  const prerequisite = statement.match(AFTER_PRIOR_RELEASE);
  if (!prerequisite || !wikiStageLabels(label).length || labelContradicts(label, statement.replace(prerequisite[0], ""))) return false;
  const capability = knowledgeTerms(label.replace(/包含|纳入|引入|\b(?:includes?|adds?)\b/giu, " "));
  const after = knowledgeTerms(statement.replace(prerequisite[0], ""));
  return capability.size > 0 && [...capability].every(term => after.has(term));
}
/** In a release comparison, an earlier design can be the model for an
 * alternative in the release being decided. The answer records that release
 * choice separately, with the older design kept as context. */
function carriesReleaseAlternative(question: string, label: string, statement: string) {
  const [asked, ...alternatives] = question.split(/还是|或者|\b(?:or|versus)\b/iu);
  const target = knowledgeVersion(label), earlier = knowledgeVersion(statement);
  if (!target || !earlier || target === earlier || knowledgeVersion(asked) !== target) return false;
  const held = marks(statement);
  if ([...marks(label)].some(([kind, values]) => kind !== "version" && held.has(kind)
    && ![...values].some(value => held.get(kind)!.has(value)))) return false;
  const describe = (text: string) => knowledgeTerms(text.replace(/\b(?:v|version\s*)\d+(?:\.\d+)*|仅|只|\bonly\b/giu, " "));
  const words = [...describe(label)], source = describe(statement);
  const suffix = label.match(/\p{Script=Han}(?=[\s。.!?！？]*$)/u)?.[0];
  return words.length > 0 && alternatives.some(alternative => {
    if (knowledgeVersion(alternative) !== earlier) return false;
    const offered = describe(alternative);
    const shared = words.filter(word => source.has(word) && offered.has(word)).length;
    return shared === words.length || Boolean(suffix && statement.includes(suffix)
      && alternative.includes(suffix) && shared >= Math.ceil(words.length / 2));
  });
}
const confirmedBy = (option: WikiWritingQuestion["options"][number]) => option.actions.flatMap(action => action.do === "confirm" || action.do === "both" ? action.units : []);

const answerKey = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s。.!?！？]+/gu, "");
const restoredQuestion = (question: WikiWritingQuestion) => question.options.length === 1 && !question.options[0].actions.length;

/** Older writer questions used a positional ID. A regenerated question at
 * that position can describe a different choice and reuse the same option ID. */
function switchedQuestion(question: WikiWritingQuestion, answer: WikiUserAnswer) {
  const selected = question.options.find(option => option.id === answer.optionId);
  return Boolean(answer.optionId && answer.question.trim() && answer.unitIds.length && question.id.startsWith("ask:") && selected
    && (!question.unitIds.some(id => answer.unitIds.includes(id))
      || answerKey(question.ask) !== answerKey(answer.question) && answerKey(selected.label) !== answerKey(answer.answer)));
}

export function withOriginalAnswerQuestions(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  const answers = new Map(ledger.userAnswers?.map(answer => [answer.questionId, answer]));
  const decisions = { ...ledger.decisions };
  let changed = false;
  const writingQuestions = ledger.writingQuestions?.map(question => {
    const answer = answers.get(question.id);
    if (!answer || !switchedQuestion(question, answer)) return question;
    changed = true;
    for (const id of question.unitIds) {
      if (!answer.unitIds.includes(id) && decisions[id]?.at === answer.at && !decisions[id]?.wholeUnit) delete decisions[id];
    }
    return { ...question, ask: answer.question, unitIds: answer.unitIds, options: [{ id: answer.optionId!, label: answer.answer, actions: [] }] };
  });
  return changed ? { ...ledger, writingQuestions, ...(ledger.decisions ? { decisions } : {}) } : ledger;
}

/** Link the effective verdict to the action that set it. An answer's unitIds
 * include other options, so they cannot establish confirmation by themselves. */
export function wikiLocalConfirmation(stored: WikiKnowledgeLedger, reading: WikiKnowledgeLedger, unitId: string): "choice" | "verdict" | undefined {
  const verdict = reading.decisions?.[unitId];
  if (verdict?.verdict !== "confirmed") return;
  if (wikiLocalAnswer(reading, unitId)) return "choice";
  if (stored.decisions?.[unitId]?.verdict === "confirmed" && stored.decisions[unitId].at === verdict.at) return "verdict";
}

export function wikiLocalAnswer(reading: WikiKnowledgeLedger, unitId: string) {
  const verdict = reading.decisions?.[unitId];
  if (verdict?.verdict !== "confirmed") return;
  return reading.userAnswers?.find(answer => {
    if (answer.at !== verdict.at) return false;
    const question = reading.writingQuestions?.find(question => question.id === answer.questionId);
    // An incremental extract in an older build could retain the answer and
    // its exact verdict while dropping the question definition.
    if (!question && answer.optionId && answer.question.trim() && answer.answer.trim()) {
      return unitId === `answer:${answer.questionId}:${answer.optionId}` || answer.unitIds.length === 1 && answer.unitIds[0] === unitId;
    }
    const option = question?.options.find(option => option.id === answer.optionId);
    return question && option && !switchedQuestion(question, answer)
      && (unitId === `answer:${answer.questionId}:${option.id}` || confirmedBy(option).includes(unitId));
  });
}

/** Both a scoped synthetic decision and a verdict on an existing unit can
 * settle a question. A later replacement of that verdict reopens the check. */
export function wikiConfirmedQuestionTexts(ledger: WikiKnowledgeLedger, statuses: ReadonlyMap<string, WikiUnitStatus>): string[] {
  return effectiveWikiAnswers(ledger, statuses).map(answer => `${answer.question} ${answer.answer}`);
}

export function effectiveWikiAnswers(ledger: WikiKnowledgeLedger, statuses?: ReadonlyMap<string, WikiUnitStatus>) {
  return (ledger.userAnswers ?? []).filter(answer => [`answer:${answer.questionId}:${answer.optionId}`, ...answer.unitIds]
    .some(id => (!statuses || statuses.get(id) === "confirmed") && wikiLocalAnswer(ledger, id) === answer));
}

/** Rewriting a question can give it new unit IDs. Match the same two
 * alternatives without carrying a choice to a different scope or condition. */
export function wikiQuestionAlreadyAnswered(text: string, answers: readonly WikiUserAnswer[]) {
  const normalized = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s*_`“”‘’「」'".。!?？！，,:：]+/gu, "");
  const scopeTerms = (value: string) => [...new Set(value.toLowerCase().match(/\bv\d+(?:\.\d+)*|\b(?:phase|milestone|stage)\s+[a-z\d.]+|第[一二三四五六七八九十\d]+(?:版|阶段)|本(?:轮|期|阶段)|首版|首发|默认|仅(?:限|在|当|对)|除非|(?:发布|上线)(?:前|后)|\b(?:only|unless|by default|before release|after release)\b/gu) ?? [])].map(normalized).sort().join("|");
  const alternatives = (value: string) => value.split(/还是|或者|\s+(?:or|vs\.?|versus)\s+/iu);
  return answers.some(answer => {
    if (!knowledgeScopesAgree(text, answer.question) || distinctWikiStageScopes(text, answer.question) || scopeTerms(text) !== scopeTerms(answer.question)) return false;
    if (normalized(text) === normalized(answer.question)) return true;
    const [first, second, extra] = alternatives(text), [priorFirst, priorSecond, priorExtra] = alternatives(answer.question);
    if (!second || !priorSecond || extra || priorExtra) return false;
    const choice = normalized(answer.answer).replace(/^(?:选用|采用|选择|use|choose|adopt)/u, "");
    if (choice.length < 6 || !normalized(first).endsWith(choice) || !normalized(priorFirst).endsWith(choice)) return false;
    const subject = (value: string) => normalized(value).slice(0, -choice.length).replace(/(?:最终|具体|是|为|选用|采用|选择|如何|should|use|choose|adopt)+$/u, "");
    const before = subject(priorFirst), after = subject(first);
    const shared = knowledgeOverlap(before, after).length;
    const exactTerms = /[a-z].*[/_-].*[a-z]/u.test(choice);
    if (!shared && (!exactTerms || new Set([...after].filter(ch => /\p{Script=Han}/u.test(ch) && before.includes(ch))).size < 2)) return false;
    // The other option must still be the same, even if the question's subject
    // was paraphrased. Short generic choices need an exact question match.
    const alternate = normalized(second), priorAlternate = normalized(priorSecond);
    return alternate.length >= 8 && alternate === priorAlternate;
  });
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

/** Ownership may be clarified, but outside work cannot be accepted or rejected as project policy. */
export function wikiQuestionUsesExternalAlternative(question: WikiWritingQuestion, unitOf: (id: string) => WikiKnowledgeUnit | undefined): boolean {
  const external = (id: string) => {
    const unit = unitOf(id);
    return Boolean(unit && (unit.about || wikiExternalResearch(unit)));
  };
  const actions = question.options.flatMap(option => option.actions);
  return actions.some(action => action.do !== "owner" && action.units.some(external))
    || question.unitIds.some(external) && !actions.some(action => action.do === "owner");
}

/** An explicit verdict can cover a whole proposition only when the choice
 * covers every independent clause and the material is project policy. */
export function wikiChoiceCoversUnit(unit: WikiKnowledgeUnit, question: WikiWritingQuestion, label: string, verdict: "confirm" | "reject" | "open" | "both") {
  if (unit.about || wikiExternalResearch(unit) || !DECIDING_KINDS.includes(unit.kind)) return false;
  const parts = unit.statement.split(/[；;。！？\n]+|[，,]\s*(?=还需|同时|另需|另外|并且|also\b|additionally\b)/iu)
    .map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) {
    if (parts.some(part => knowledgeOverlap(part, label).length < 2)) return false;
  }
  return verdict === "reject" ? !answerLeavesRejectionOpen(unit, label) : !answerLeavesDetailsOpen(unit, question, label);
}

/** Remove contradictory choices and ownership actions that name the project itself. */
export function soundQuestion(question: WikiWritingQuestion, statementOf: (id: string) => string | undefined, project?: string, unitOf?: (id: string) => WikiKnowledgeUnit | undefined, selectedId?: string): WikiWritingQuestion | undefined {
  if (unitOf && !selectedId && wikiQuestionUsesExternalAlternative(question, unitOf)) return undefined;
  // Figures of the project said on different days ("日活只有25", "每天稳定在22人", "日活卡在40了") are its history, not two
  // versions to choose from: asked "当前日活是25人、30人还是40人？", the answer turned one figure into a decision 〔已定〕 and
  // rejected the others, which the chapters still told with their dates.
  if (unitOf && question.unitIds.length >= 2 && question.unitIds.every(id => { const unit = unitOf(id); return Boolean(unit && wikiMeasure(unit)); })) return undefined;
  const own = project ? ownerKey(project) : "";
  const options = question.options.flatMap(option => {
    if (confirmedBy(option).some(id => {
      const statement = statementOf(id);
      return statement !== undefined && labelContradicts(option.label, statement)
        && !confirmsAfterPrerequisite(option.label, statement) && !carriesReleaseAlternative(question.ask, option.label, statement);
    })) return [];
    const actions = option.actions.filter(action => !(action.do === "owner" && own && ownerKey(action.name) === own));
    return [actions.length === option.actions.length ? option : { ...option, actions }];
  });
  if (options.length < 2 && !options.some(option => option.id === selectedId)) return undefined;
  return options.length === question.options.length && options.every((option, index) => option === question.options[index]) ? question : { ...question, options };
}

/** The ledger with only the answers its questions can give, for reading: an answer the question should not have
 * offered is not taken, and the decisions it made, unless changed since, are withdrawn. The stored ledger stays. */
export function withSoundAnswers(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  ledger = withOriginalAnswerQuestions(ledger);
  if (!ledger.writingQuestions?.length) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  const project = ledger.organization?.projectName, sound = new Map<string, WikiWritingQuestion | undefined>();
  const answers = new Map(ledger.userAnswers?.map(answer => [answer.questionId, answer]));
  for (const question of ledger.writingQuestions) {
    const answer = answers.get(question.id);
    if (answer?.scope?.targets.some(target => {
      const unit = units.get(target.unitId);
      return !unit || unit.evidence.conversationId !== target.conversationId || unit.evidence.messageId !== target.messageId
        || unit.statement !== target.claim || sourceMessageSignature(unit.evidence.quote) !== target.quote;
    })) {
      sound.set(question.id, undefined);
      continue;
    }
    sound.set(question.id, restoredQuestion(question) && answer
      ? question : soundQuestion(question, id => units.get(id)?.statement, project, id => units.get(id), answer?.optionId));
  }
  if ([...sound].every(([id, question]) => question === ledger.writingQuestions!.find(item => item.id === id))) return ledger;
  const decisions = { ...ledger.decisions };
  const inactivePairs = new Set<string>();
  const userAnswers = (ledger.userAnswers ?? []).filter(answer => {
    const question = ledger.writingQuestions!.find(item => item.id === answer.questionId);
    if (!question || !answer.optionId && !answer.scope) return true;
    const kept = sound.get(question.id);
    if (kept && (!answer.optionId || kept.options.some(option => option.id === answer.optionId))) return true;
    if (answer.scope) for (const action of question.options.find(option => option.id === answer.optionId)?.actions ?? []) {
      if (action.do === "both" && action.units.every(id => decisions[id]?.at === answer.at && !decisions[id]?.wholeUnit)) {
        inactivePairs.add(`${action.units[0]}>${action.units[1]}`);
      }
    }
    for (const id of new Set(question.options.flatMap(option => option.actions.flatMap(action => action.do === "owner" ? [] : action.units)))) {
      if (decisions[id]?.at === answer.at && !decisions[id]?.wholeUnit) delete decisions[id];
    }
    return false;
  });
  const next: WikiKnowledgeLedger = { ...ledger, decisions, userAnswers, writingQuestions: ledger.writingQuestions.flatMap(question => sound.get(question.id) ?? []) };
  if (inactivePairs.size && next.coexisting) next.coexisting = next.coexisting.filter(pair => !inactivePairs.has(pair));
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

const INTEGRATION_OPTIONS = /^(本阶段|下一阶段|本期|本轮)?\s*是否(?:要)?(?:集成|接入)\s*([^，,。；;？?]{2,50}?)或(?:者)?\s*([^，,。；;？?]{2,50})[？?]$/u;
export function wikiScopedIntegration(ask: string, answer: string) {
  const alternatives = ask.match(INTEGRATION_OPTIONS);
  const purpose = answer.match(/^(?:集成|接入)[，,]\s*(用于[^。；;！？!?]{2,45})[。.]?$/u)?.[1];
  if (!alternatives || !purpose) return;
  const [, stage = "", first, second] = alternatives;
  return `${stage}确认集成，${purpose}。具体采用「${first.trim()}」或「${second.trim()}」待明确`;
}

/** A claim citing the original purpose-only choice cannot name the winning
 * alternative, even when a separate, later receipt resolves that choice. */
export function wikiRepairIntegrationChoice(text: string, ask: string, answer: string) {
  const scoped = wikiScopedIntegration(ask, answer);
  const options = ask.match(INTEGRATION_OPTIONS)?.slice(2);
  if (!scoped || !options || !/^(?:具体采用|确定采用|明确采用|本阶段确认集成)/u.test(text)) return;
  const compact = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s/gu, "");
  const named = options.filter(option => {
    const name = option.trim().replace(/^(?:生成|采用|接入)/u, "");
    const brand = name.match(/^[\w-]{3,}/u)?.[0];
    return compact(text).includes(compact(name)) || Boolean(brand && compact(text).includes(compact(brand)));
  });
  const purpose = compact(answer.split(/[，,]/u).at(-1) ?? "");
  return named.length === 1 || named.length === 2 && compact(text).includes(purpose) && /待明确|尚未决定|待确定/u.test(text)
    ? scoped + "。" : undefined;
}

function integrationFollowup(ask: string, question: WikiWritingQuestion, label: string) {
  const options = ask.match(INTEGRATION_OPTIONS)?.slice(2);
  const followup = question.ask.match(/(?:具体是|具体)(?:采用|使用|选择)\s*(.+?)\s*还是\s*(.+?)[？?]$/u);
  if (!options || !followup || !question.about || !/^(?:采用|使用|选择)/u.test(label)) return;
  const optionKey = (value: string) => answerKey(value.replace(/^(?:采用|使用|选择)\s*/u, "")
    .replace(/[「」“”]/gu, "").replace(/[，,]\s*$/u,"").replace(/在线(?=仿真)/u,"").replace(/本地运行$/u,""));
  const [left,right] = options.map(optionKey), choice = optionKey(label);
  if (left === right || ![left,right].includes(choice) || ![optionKey(followup[1]),optionKey(followup[2])].every((key,index) => key === [left,right][index])) return;
  return question.about + "：" + label.replace(/[。.]$/u, "") + "。";
}
/** The user's answers as decisions, for reading: an answer that confirms only an account of facts ("Monthly budgets are
 * simpler …; pay-period budgets match cash flow …" for "Implement monthly budgets only for v1.") confirmed what the
 * user did not choose. Their choice is the answer's own words: it becomes a decision of its own under the same subject,
 * the account stays the AI's, and the points the answer kept saying the choice is open are earlier, since it is made.
 * One run listed the user's answer among the open questions and marked the account decided. The stored ledger stays. */
export function withAnsweredChoices(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.writingQuestions?.length) return ledger;
  const all = ledger.batches.flatMap(batch => batch.units);
  const units = new Map(all.map(unit => [unit.id, unit] as const));
  const answerUnits = all.filter(unit => unit.id.startsWith("answer:"));
  const repeated = answerUnits.length !== new Set(answerUnits.map(unit => unit.id)).size;
  const decisions = { ...ledger.decisions }, added = new Map<string, WikiKnowledgeUnit>();
  const workflow = wikiWorkflowScopes(ledger,units).narrowed;
  for (const answer of [...ledger.userAnswers].sort((a, b) => b.at - a.at)) {
    const question: WikiWritingQuestion | undefined = (ledger.writingQuestions ?? []).find(item => item.id === answer.questionId);
    const option: WikiWritingQuestion["options"][number] | undefined = question?.options.find(item => item.id === answer.optionId);
    if (!question || !option) continue;
    const answerId: string = `answer:${question.id}:${option.id}`;
    // A derived ledger can enter this pass again when drawing the preview.
    if (units.has(answerId) && decisions[answerId]?.verdict === "confirmed" && decisions[answerId].at === answer.at) continue;
    const scopedWorkflow=workflow.get(question.id);
    if(scopedWorkflow&&!added.has(scopedWorkflow.anchor.id)){
      const {anchor,statement,feedbackIds}=scopedWorkflow,id=answerId;
      for(const related of [anchor.id,...feedbackIds])if(decisions[related]?.at===answer.at&&decisions[related]?.verdict==="confirmed")delete decisions[related];
      added.set(anchor.id,{...anchor,id,statement,kind:"decision",details:[],conditions:undefined,adoption:{status:"user_decision"},delivery:"unknown",about:undefined,relation:undefined,evidence:{...anchor.evidence,evidenceId:`${anchor.evidence.evidenceId}:${id}`,pasted:false,code:undefined}});
      decisions[id]={verdict:"confirmed",at:answer.at};
      continue;
    }
    if (restoredQuestion(question)) {
      if (UNDECIDED.test(answer.answer)) continue;
      const choice = knowledgeTerms(answer.answer);
      const version = knowledgeVersion(answer.answer);
      const anchors = answer.unitIds.flatMap(id => units.get(id) ?? []).filter(unit => !unit.about && (unit.kind !== "question" || wikiChoiceQuestionText(unit.statement,answer.question)));
      const overlap = (unit: WikiKnowledgeUnit) => [...knowledgeTerms(unit.statement)].filter(term => choice.has(term)).length
        + (version && version === knowledgeVersion(unit.statement) ? 1 : 0);
      const anchor = anchors.sort((a, b) => overlap(b) - overlap(a))[0];
      if (anchor && !added.has(anchor.id) && overlap(anchor) >= 2) {
        const id = answerId;
        const label = answer.answer.trim();
        const proposition = /^必须/u.test(label) && !/还是|或者|或(?:者)?应/u.test(answer.question)
          ? answer.question.match(/^是否(.{2,110}必须[^？?]{2,})[？?]$/u)?.[1] : undefined;
        const timing = /阶段|phase\b/iu.test(label) && /时机|何时|什么时候|阶段.*还是|\bwhen\b/iu.test(answer.question);
        const context = question.about?.trim() || anchor.subject;
        const said = proposition ?? (timing && context && !label.includes(context) ? `${context}${/\p{Script=Han}/u.test(context)?"：":": "}${label}` : label);
        const statement = /[.!?。！？]$/u.test(said) ? said : `${said}${/\p{Script=Han}/u.test(said) ? "。" : "."}`;
        added.set(anchor.id, { ...anchor, id, statement, kind: "decision", details: [], conditions: undefined, adoption: { status: "user_decision" }, delivery: "unknown", about: undefined, relation: undefined,
          evidence: { ...anchor.evidence, evidenceId: `${anchor.evidence.evidenceId}:${id}`, pasted: false, code: undefined } });
        decisions[id] = { verdict: "confirmed", at: answer.at };
      }
      continue;
    }
    const confirmed = option.actions.flatMap(action => action.do === "confirm" ? action.units : []).flatMap(id => {
      const unit = units.get(id), verdict = decisions[id];
      return unit && (!verdict || verdict.verdict === "confirmed") ? [unit] : [];
    });
    // Some options express a positive alternative by rejecting the only recorded
    // proposal. Keep that answer as its own scoped decision, never as adoption of
    // the rejected source's other clauses.
    if(!confirmed.length&&option.actions.length&&option.actions.every(action=>action.do==="reject")&&/^(?:支持|包含|采用|使用|开启|允许|完整|(?:support|include|use|enable|allow)\b)/iu.test(option.label)&&question.about?.trim()){
      const anchor=option.actions.flatMap(action=>action.units).flatMap(id=>units.get(id)??[])[0];
      if(anchor&&!added.has(anchor.id)){
        const id=answerId,statement=`${question.about}${/\p{Script=Han}/u.test(question.about)?"：":": "}${answer.answer}${/\p{Script=Han}/u.test(answer.answer)?"。":"."}`;
        added.set(anchor.id,{...anchor,id,statement,kind:"decision",details:[],conditions:undefined,adoption:{status:"user_decision"},delivery:"unknown",about:undefined,relation:undefined,evidence:{...anchor.evidence,evidenceId:`${anchor.evidence.evidenceId}:${id}`,pasted:false,code:undefined}});
        decisions[id]={verdict:"confirmed",at:answer.at};
      }
      continue;
    }
    const scoped = confirmed.some(unit => !decisions[unit.id] && (answer.scope
      ? !wikiChoiceCoversUnit(unit, question, answer.answer, "confirm") : answerLeavesDetailsOpen(unit, question, answer.answer)));
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
    const anchor = confirmed[0], label = (answer.answer || option.label).trim();
    // A short label ("380px") says nothing read alone: one run wrote 「380px.〔已定〕」 as its own paragraph and key
    // decision. It goes after what the question is about: 「Popup 宽度：380px。」.
    // A Chinese label is short by its length alone: 「使用“完成专注 X 轮”」 has spaces around its X, read as three words.
    const words = /\p{Script=Han}/u.test(label) ? false : /\s\S+\s\S+/u.test(label);
    const about = question.about?.trim(), bare = about && !label.includes(about)
      && (!words && label.length <= 16 || answerTargetsAnotherClaim(anchor, question, label));
    const defer = wikiReleaseDeferral(question.ask, label);
    const said = wikiReleaseChecklistStatement(answer.question, label, anchor) ?? wikiScopedIntegration(question.ask, label) ?? wikiLayerDeferral(question.ask, label) ?? (defer ? /\p{Script=Han}/u.test(question.ask) ? `${defer.stage} 暂缓${/^[A-Za-z]/u.test(defer.feature) ? " " : ""}${defer.feature}` : `${defer.stage} defers ${defer.feature}`
      : bare && !wikiStageLabels(label).length ? `${about}${/\p{Script=Han}/u.test(about!) ? "：" : ": "}${label}` : label);
    const han = /\p{Script=Han}/u.test(said);
    const statement = /[.!?。！？]$/u.test(said) ? said : `${said}${han ? "。" : "."}`;
    added.set(anchor.id, { ...anchor, id: answerId, statement, kind: "decision", details: [], conditions: undefined, adoption: { status: "user_decision" }, delivery: "unknown", about: undefined, relation: undefined,
      evidence: { ...anchor.evidence, evidenceId: `${anchor.evidence.evidenceId}:${answerId}`, pasted: false, code: undefined } });
    decisions[answerId] = { verdict: "confirmed", at: answer.at };
  }
  // Later questions may reference a choice that only exists after the first
  // answer has been projected. Keep a separate receipt for the later choice.
  const followups = new Map<string, WikiKnowledgeUnit>();
  const anchors = new Map([...units, ...[...added.values()].map(unit => [unit.id,unit] as const)]);
  for (const answer of [...ledger.userAnswers].sort((a,b)=>b.at-a.at)) {
    const question: WikiWritingQuestion | undefined = ledger.writingQuestions.find(item => item.id === answer.questionId);
    const option: WikiWritingQuestion["options"][number] | undefined = question?.options.find(item => item.id === answer.optionId);
    const [anchorId] = answer.unitIds;
    if (!question || !option || answerKey(option.label)!==answerKey(answer.answer) || switchedQuestion(question,answer) || answer.unitIds.length !== 1) continue;
    const confirms = option.actions.some(action => action.do === "confirm" && action.units.includes(anchorId));
    const onlyOpensAnchor = question.options.length === 2 && question.options.every(item=>item.actions.length===1
      &&item.actions[0].do==="open"&&item.actions[0].units.length===1&&item.actions[0].units[0]===anchorId);
    if (!confirms&&!onlyOpensAnchor) continue;
    const origin = ledger.userAnswers.find(item => `answer:${item.questionId}:${item.optionId}` === anchorId);
    const anchor = anchors.get(anchorId);
    if (!origin || !anchor || origin.at >= answer.at || !wikiScopedIntegration(origin.question,origin.answer)) continue;
    const statement = integrationFollowup(origin.question,question,answer.answer);
    const id = `answer:${question.id}:${option.id}`;
    const verdict=decisions[anchorId];
    if (!statement || units.has(id) || followups.has(anchorId) || verdict?.wholeUnit
      || verdict?.verdict!=="confirmed"&&!(onlyOpensAnchor&&verdict?.verdict==="open"&&verdict.at===answer.at)) continue;
    decisions[anchorId] = {verdict:"confirmed",at:origin.at};
    decisions[id] = {verdict:"confirmed",at:answer.at};
    followups.set(anchorId,{...anchor,id,subject:question.about,statement,evidence:{...anchor.evidence,evidenceId:`${anchor.evidence.evidenceId}:${id}`}});
  }
  if (!added.size && !repeated && !followups.size) return ledger;
  const clean = (unit: WikiKnowledgeUnit) => { const copy = { ...unit, evidence: { ...unit.evidence } }; delete copy.about; delete copy.relation; delete copy.evidence.code; return copy; };
  const refreshed = new Map([...added.values()].map(unit => [unit.id, clean(unit)]));
  const emitted = new Set<string>();
  const batches = ledger.batches.map(batch => {
    const base = batch.units.flatMap(unit => {
      if (unit.id.startsWith("answer:")) {
        if (emitted.has(unit.id)) return [];
        emitted.add(unit.id);
        return [refreshed.get(unit.id) ?? units.get(unit.id)!];
      }
      const choice = added.get(unit.id);
      if (!choice || units.has(choice.id) || emitted.has(choice.id)) return [unit];
      emitted.add(choice.id);
      return [unit, refreshed.get(choice.id)!];
    });
    const members = base.flatMap(unit => followups.has(unit.id) ? [unit,followups.get(unit.id)!] : [unit]);
    return members.length === batch.units.length && members.every((unit, index) => unit === batch.units[index]) ? batch : { ...batch, units: members };
  });
  const organization = ledger.organization && { ...ledger.organization, subjects: ledger.organization.subjects.map(subject => {
    const unitIds = [...new Set(subject.unitIds.flatMap(id => added.has(id) ? [id, added.get(id)!.id] : [id])
      .flatMap(id=>followups.has(id)?[id,followups.get(id)!.id]:[id]))];
    return unitIds.length === subject.unitIds.length && unitIds.every((id, index) => id === subject.unitIds[index]) ? subject : { ...subject, unitIds };
  }) };
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
function answerTargetsAnotherClaim(unit: WikiKnowledgeUnit, question: WikiWritingQuestion, answer: string) {
  // Concrete alternatives may point to the same paragraph simply because
  // it mentions the topic. The chosen option still only settles its own scope.
  const targets = (option: WikiWritingQuestion["options"][number]) => option.actions.some(action => action.do==="confirm"&&action.units.includes(unit.id));
  if (question.options.filter(targets).length < 2) return false;
  const chosen = knowledgeTerms(answer);
  if (chosen.size < 3) return false;
  const statement = knowledgeTerms(unit.statement);
  const shared = [...chosen].filter(term => statement.has(term)).length;
  return shared < 2 || shared / chosen.size < .4;
}

export function wikiChoiceQuestionText(statement:string, ask:string) {
  const stem = (text:string)=>answerKey(text.replace(/^(?:需(?:要)?|尚需|待)(?:决定|确认|选择)[：:，,\s]*/u,""));
  return Boolean(stem(statement)&&stem(statement)===stem(ask))
    && /[？?]\s*$|还是|或者|是否|\b(?:whether|versus)\b/iu.test(ask);
}

/** A choice naming examples of a classification covers that classification. */
function differentClassification(statement: string, question: string) {
  const examples = /(?:分为|划分为|归为)([^。？?\n]{4,90}?)等(?:[二三四五六七八九十\d]+类|分类)/u.exec(question)?.[1]
    ?? /(?:categories|classification)\s+(?:such as|including)\s+([^?.]{5,100})/iu.exec(question)?.[1];
  if (!examples || !/分类|分为|(?:[二三四五六七八九十\d]+)(?:种|类)|\bcategories\b/iu.test(statement)) return false;
  const named = examples.split(/、|，|,|以及|\band\b/iu).map(item => item.trim()).filter(item => item.length >= 3);
  const key = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s*_"“”「」]/gu, "");
  return named.length >= 2 && !named.every(item => key(statement).includes(key(item)));
}

export function answerLeavesDetailsOpen(unit: WikiKnowledgeUnit, question: WikiWritingQuestion, answer: string) {
  if (distinctWikiStageScopes(answer, unit.statement)) return true;
  if (wikiChoiceQuestionText(unit.statement,question.ask)) return true;
  if (differentClassification(unit.statement, question.ask)) return true;
  if (wikiScopedIntegration(question.ask, answer)) return true;
  if (wikiReleaseChecklistStatement(question.ask, answer, unit)) return true;
  // A timing answer only covers that timing, even when a compound plan has
  // no numeric conditions for the general scope check to catch.
  const timing = /何时|什么时候|时机|哪个阶段|阶段[^。！？\n]{0,30}还是|\b(?:when|what stage)\b/iu.test(question.ask)
    && /阶段|之后|之前|发布后|\b(?:phase|stage|alpha|beta|after|before)\b/iu.test(answer)
    && /[，,；;]|[。.]\s*\S/u.test(unit.statement);
  if (timing) return true;
  if (answerTargetsAnotherClaim(unit, question, answer)) return true;
  // A selected setting can be one clause of a larger specification. The
  // rest of the specification does not inherit the choice's confirmation.
  const clauses = unit.statement.split(/[；;。！？\n]+|[，,]\s*(?=(?:同时|另外|此外|并且|(?:V\d+(?:\.\d+)*)\s)|(?:and also|additionally)\b)/iu).filter(clause => clause.trim());
  const selected = knowledgeTerms(answer);
  const asked = knowledgeTerms(`${question.about} ${question.ask} ${answer}`);
  if (clauses.length > 1 && clauses.some(clause => [...knowledgeTerms(clause)].some(term => selected.has(term)))
    && clauses.some(clause => {
      const terms = [...knowledgeTerms(clause)];
      return terms.length >= 2 && terms.every(term => !asked.has(term));
    })) return true;
  const trigger = wikiChoiceTrigger(`${question.about} ${question.ask}`, answer);
  if (trigger && !unit.statement.replace(/\s+/gu, "").toLowerCase().includes(trigger.replace(/\s+/gu, "").toLowerCase())) return true;
  if (/(?:还是|或者|\b(?:or|versus)\b)/iu.test(question.ask)) {
    const clauses = unit.statement.matchAll(/[，,；;]\s*(?:仅通过|同时|并且|还需|另需|另行|(?:and also|additionally)\b)([^，,；;。.!?\n]+)/giu);
    if ([...clauses].some(([, clause]) => [...knowledgeTerms(clause)].filter(term => !asked.has(term)).length >= 3)) return true;
  }
  const details = wikiUnitConfirmationDetails(unit);
  if (!details.length) return false;
  const yes = /^(?:是|确认|同意|可以|采用|yes|confirm|approved?|agree)[。.!！]?$/iu.test(answer.trim()) && !/还是|或者|\b(?:or|versus|vs\.?)\b/iu.test(question.ask);
  return !wikiConfirmationCovers(`${question.about} ${answer}${yes ? ` ${question.ask}` : ""}`, details);
}

/** Remove confirmation the answer assigned to an entire compound point when
 * its specific numbers were never offered. withAnsweredChoices then records
 * the user's actual choice if no narrower deciding unit represents it. */
export function answerLeavesRejectionOpen(unit: WikiKnowledgeUnit, answer: string) {
  return distinctWikiStageScopes(answer, unit.statement);
}

export function withAnswerScope(ledger: WikiKnowledgeLedger): WikiKnowledgeLedger {
  if (!ledger.userAnswers?.length || !ledger.decisions) return ledger;
  const units = new Map(ledger.batches.flatMap(batch => batch.units.map(unit => [unit.id, unit] as const)));
  let decisions: WikiKnowledgeLedger["decisions"] | undefined;
  const reviewed = new Set<string>();
  for (const answer of [...ledger.userAnswers].sort((a, b) => b.at - a.at)) {
    const question = ledger.writingQuestions?.find(item => item.id === answer.questionId), chosen = question?.options.find(option => option.id === answer.optionId);
    if (!question || !chosen) continue;
    for (const { id, verdict: kind } of chosen.actions.flatMap(action => action.do === "confirm" || action.do === "reject"
      ? action.units.map(id => ({ id, verdict: action.do === "confirm" ? "confirmed" : "rejected" })) : [])) {
      if (reviewed.has(id)) continue;
      reviewed.add(id);
      const unit = units.get(id), verdict = ledger.decisions[id];
      if (!unit || verdict?.verdict !== kind || verdict.wholeUnit && verdict.at >= answer.at
        || (kind === "confirmed" ? !answerLeavesDetailsOpen(unit, question, answer.answer)
          : verdict.at !== answer.at || !answerLeavesRejectionOpen(unit, answer.answer))) continue;
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
const proposedFigures = (text: string) => [...new Set([...text.normalize("NFKC").matchAll(/\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?/gu)]
  .map(match => match[0].replace(/\s/gu, "").replace(/[–—~～至到]/gu, "-")))].sort().join(",");
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
    const exclusiveTiming = /立即|本期|现在|\b(?:now|immediately)\b/iu.test(question.ask) &&
      /还是仅|或仅|\bor only\b/iu.test(question.ask) &&
      /后期|后续|\blater\b/iu.test(answer.answer) && /可选|\boptional\b/iu.test(answer.answer);
    if (exclusiveTiming && confirmed.length) for (const option of question.options) {
      if (option === chosen || !/核心|立即|本期|\b(?:core|required|immediately)\b/iu.test(option.label)) continue;
      for (const id of confirmedBy(option)) {
        const unit=units.get(id);
        if (!unit || selected.has(id) || ledger.decisions[id] || decisions?.[id] || unit.evidence.role !== "assistant" ||
          ["user_decision","user_adopted","rejected"].includes(unit.adoption.status)) continue;
        (decisions ??= { ...ledger.decisions })[id] = { verdict:"rejected",at:answer.at };
      }
    }
    if (!confirmed.length || !rejected.length) continue;
    const asked = knowledgeTerms(`${question.about} ${question.ask}`), shared = (a: WikiKnowledgeUnit, b: WikiKnowledgeUnit) => { const theirs = knowledgeTerms(b.statement); return [...knowledgeTerms(a.statement)].filter(term => theirs.has(term)).length; };
    for (const old of rejected) for (const id of subjectOf.get(old.id)?.unitIds ?? []) {
      const unit = units.get(id);
      if (!unit || selected.has(id) || question.unitIds.includes(id) || ledger.decisions[id] || decisions?.[id] || unit.evidence.role !== "assistant" || !ALTERNATIVE_KINDS.includes(unit.kind) || ["user_decision", "user_adopted"].includes(unit.adoption.status)) continue;
      if (![...knowledgeTerms(unit.statement)].some(term => asked.has(term))) continue;
      if (proposedFigures(unit.statement) !== proposedFigures(old.statement) || !knowledgeScopesAgree(unit.statement, old.statement)) continue;
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
    const refusedScopes = refused.map(unit => ({statement: unit.statement, words: knowledgeTerms(unit.statement), figures: proposedFigures(unit.statement)}));
    for (const unit of units.values()) {
      // The chosen option may have confirmed only the core of this point.
      // Removing an overbroad confirmation does not turn its details down.
      if (selected.has(unit.id) || ledger.decisions[unit.id] || decisions?.[unit.id] || unit.evidence.role === "user" || !(asked.has(unit.id) || places.has(subjectOf.get(unit.id) ?? ""))) continue;
      const own = knowledgeTerms(unit.statement);
      const figures = proposedFigures(unit.statement);
      if (refusedScopes.some(other => figures === other.figures && knowledgeScopesAgree(unit.statement, other.statement)
        && [...own].filter(term => other.words.has(term)).length >= RESTATES_TURNED_DOWN)) {
        (decisions ??= { ...ledger.decisions })[unit.id] = { verdict: "rejected", at: answer.at };
      }
    }
  }
  return decisions ? { ...ledger, decisions } : ledger;
}
