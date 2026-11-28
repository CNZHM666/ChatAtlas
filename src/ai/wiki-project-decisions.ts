import { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiVersionQuestions, withVersionAnswer, type WikiVersionQuestion } from "./wiki-key-decisions";
import { effectiveWikiAnswers, wikiQuestionAlreadyAnswered } from "./wiki-question-parse";
import { pendingWritingQuestions, sameWikiDecision, wikiWritingDecisionIdentity, wikiWritingQuestionPriority, withWritingAnswer } from "./wiki-writing-questions";
import { aboutNameKey, wikiBlockedUnitIds, wikiExternalResearch, wikiLedgerUnits, type WikiKnowledgeLedger, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import type { WikiDecisionConflict } from "./wiki-decision-arbitration";
import { wikiDecisionScope, type WikiDecisionReceipt } from "../shared/wiki-decision-receipts";

export type WikiProjectQuestion =
  | { kind: "writing"; question: WikiWritingQuestion }
  | { kind: "version"; question: WikiVersionQuestion }
  | { kind: "arbitration"; question: WikiDecisionConflict };

/** The same scoped decisions feed the first draft and the overview. The view owns its display limit. */
export function wikiProjectQuestions(ledger: WikiKnowledgeLedger, zh: boolean, reading = resolveWikiReading(ledger), versionCandidates?: WikiVersionQuestion[]): WikiProjectQuestion[] {
  const blocked = wikiBlockedUnitIds(ledger);
  const units = new Map(reading.units.flatMap(unit => blocked.has(unit.id) || wikiExternalResearch(unit)
    || unit.about && ledger.scopeAnswers?.[aboutNameKey(unit.about.name)] === "exclude" ? [] : [[unit.id, unit] as const]));
  const live = (id: string) => units.has(id) && reading.statuses.get(id) !== "history";
  const answered = effectiveWikiAnswers(reading.ledger, reading.statuses);
  const done = (id: string) => ["choose", "merge", "custom"].includes(reading.ledger.decisionArbitrations?.[id]?.mode ?? "");
  const writing = pendingWritingQuestions(reading.ledger, reading.statuses).flatMap(question => {
    if (done(question.id) || wikiWritingQuestionPriority(question) < 2) return [];
    const unitIds = question.unitIds.filter(id => units.has(id));
    if (!unitIds.length) return [];
    const options = question.options.filter(option => option.actions.every(action => action.units.every(id => units.has(id))));
    if (!options.some(option => option.actions.some(action => action.do !== "open" && action.units.some(live)))) return [];
    if (unitIds.length !== question.unitIds.length && options.filter(projectWritingOption).length < 2) return [];
    return [{ ...question, unitIds, options }];
  });
  const versions = (versionCandidates ?? wikiVersionQuestions(reading.ledger, zh)).filter(question => (versionCandidates || question.kind === "roadmap")
    && !question.answer && !done(question.id) && !wikiQuestionAlreadyAnswered(question.question, answered)
    && question.options.length >= 2 && question.options.every(option => option.unitIds.length && option.unitIds.every(live)));
  const conflicts = reading.conflicts.filter(conflict => !conflict.selected
    && conflict.choices.every(choice => choice.ids.length && choice.ids.every(live)));

  const ranked = [
    ...conflicts.map(question => ({ entry: { kind: "arbitration", question } as const, priority: 5,
      identity: { text: question.question, options: question.choices.map(choice => choice.ids) } })),
    ...writing.map(question => ({ entry: { kind: "writing", question } as const, priority: wikiWritingQuestionPriority(question),
      identity: wikiWritingDecisionIdentity(question) })),
    ...versions.map(question => ({ entry: { kind: "version", question } as const, priority: 2,
      identity: { text: question.question, options: question.options.map(option => option.unitIds) } })),
  ].sort((a, b) => b.priority - a.priority);
  const identities: Array<(typeof ranked)[number]["identity"]> = [];
  const settled = Object.values(reading.ledger.decisionArbitrations ?? {}).flatMap(receipt =>
    receipt.deferredToDraft && receipt.question && receipt.alternatives ? [{ text: receipt.question, options: receipt.alternatives }] : []);
  return ranked.flatMap(({ entry, identity }) => {
    if (identities.some(prior => sameWikiDecision(prior, identity))) return [];
    if (entry.kind !== "arbitration" && settled.some(prior => sameWikiDecision(prior, identity))) return [];
    identities.push(identity);
    return [entry];
  });
}

export const WIKI_PREWRITING_DECISIONS = 3;
export const wikiPrewritingProjectQuestions = (ledger: WikiKnowledgeLedger, zh: boolean) =>
  wikiProjectQuestions(ledger, zh).filter(item => item.kind !== "writing" || item.question.stage !== "writing").slice(0, WIKI_PREWRITING_DECISIONS);

const projectWritingOption = (option: WikiWritingQuestion["options"][number]) => option.actions.some(action => action.do !== "open");
export const projectWritingOptions = (question: WikiWritingQuestion) => question.options.filter(projectWritingOption);

export function projectQuestionDetails(entry: WikiProjectQuestion) {
  if (entry.kind === "writing") return { title: entry.question.about, ask: entry.question.ask, ids: entry.question.unitIds, options: projectWritingOptions(entry.question) };
  if (entry.kind === "version") return { title: entry.question.chapter, ask: entry.question.question, ids: entry.question.options.flatMap(option => option.unitIds), options: entry.question.options };
  const choices = [...new Map([...entry.question.choices].reverse().map(choice => [choice.scope, choice])).values()];
  return { title: undefined, ask: entry.question.question, ids: choices.flatMap(choice => choice.receipt.unitIds),
    options: choices.map(choice => ({ id: choice.receipt.questionId, label: choice.receipt.answer })) };
}

export function answerProjectQuestion(ledger: WikiKnowledgeLedger, entry: WikiProjectQuestion, action: {
  choice?: string; text?: string; merge?: boolean; location?: Pick<WikiDecisionReceipt, "chapterId" | "heading" | "evidenceIds">;
}) {
  const { choice, location } = action;
  const words = action.text?.trim();
  const details = projectQuestionDetails(entry), units = new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit]));
  const ids = [...new Set(details.ids)].filter(id => units.has(id));
  if (!ids.length) return ledger;
  if (action.text !== undefined && (!words || words.length > 500 || /[\r\n]|^\s*(?:#|>|[-*+]\s|\d+\.\s|~{3}|\x60{3})/u.test(words))) return ledger;
  const selected = details.options.find(option => option.id === choice);
  if (!selected && !words) return ledger;
  const questionId = entry.question.id;
  const update = !selected ? ledger : entry.kind === "writing" ? withWritingAnswer(ledger, entry.question, choice)
    : entry.kind === "version" ? withVersionAnswer(ledger, entry.question, choice) : ledger;
  if (selected && entry.kind !== "arbitration" && update === ledger) return ledger;
  const at = Math.max(Date.now(), ledger.decisionsAt ?? 0, ledger.draft?.generatedAt ?? 0) + 1;
  const changed = [...new Set([...Object.keys(ledger.decisions ?? {}), ...Object.keys(update.decisions ?? {})])]
    .filter(id => ledger.decisions?.[id] !== update.decisions?.[id]);
  const normalized = { ...update.decisions };
  for (const id of changed) if (normalized[id]) normalized[id] = { ...normalized[id], at };
  const scope = wikiDecisionScope(ledger, ids, details.title ?? details.ask);
  const addedPairs = update.coexisting?.filter(pair => !ledger.coexisting?.includes(pair));
  const receipt: WikiDecisionReceipt = {
    at, choice: selected?.id ?? (action.merge ? "merge" : "custom"), mode: selected ? "choose" : action.merge ? "merge" : "custom",
    text: selected?.label ?? words, question: details.ask, unitIds: ids, optionTexts: details.options.map(option => option.label),
    ...location, deferredToDraft: true, scope,
    alternatives: entry.kind === "writing" ? wikiWritingDecisionIdentity(entry.question).options
      : entry.kind === "version" ? entry.question.options.map(option => option.unitIds) : entry.question.choices.map(option => option.ids),
    ...(changed.length ? { previousVerdicts: Object.fromEntries(changed.map(id => [id, ledger.decisions?.[id] ?? null])) } : {}),
    ...(addedPairs?.length ? { addedPairs } : {}),
  };
  return { ...update, decisions: normalized, decisionsAt: at,
    userAnswers: update.userAnswers?.map(answer => answer.questionId === questionId ? { ...answer, at } : answer),
    decisionArbitrations: { ...update.decisionArbitrations, [questionId]: receipt } };
}
