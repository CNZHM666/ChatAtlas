import { wikiDecisionQuestions, withVersionAnswer, type WikiVersionQuestion } from "../ai/wiki-key-decisions";
import { wikiLocalAnswer } from "../ai/wiki-question-parse";
import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { pendingWritingQuestions, withWritingAnswer } from "../ai/wiki-writing-questions";
import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { factTextKey } from "../shared/project-fact-state";
import { projectCurrentPlan } from "../shared/project-current-plan";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { currentWikiEvidence, wikiEvidenceKey } from "../shared/wiki-evidence-link";
import { DECIDING_KINDS, wikiStatementWithConditions, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import { wikiSections } from "../shared/wiki-navigation";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiSaidInQuote } from "../shared/wiki-said-in-quote";
import { sourceQuoteText } from "../shared/source-quote-text";

type Reading = ReturnType<typeof resolveWikiReading>;
type VersionChoices = ReturnType<typeof wikiDecisionQuestions>["versions"];

export interface OverviewBasis {
  ref: FocusEvidence;
  quote: string;
  text: string;
  userAuthored?: boolean;
}

interface OverviewRow {
  id: string;
  text: string;
  basis: OverviewBasis[];
  chapter?: { id: string; heading?: string };
}

type OverviewQuestion = OverviewRow & {
  options: Array<{ id: string; label: string; unitIds: string[] }>;
  kind: "writing" | "version";
};

const PRIORITY = /版本|范围|路线图|交付顺序|里程碑|安全|隐私|验收|\b(?:release|scope|roadmap|delivery order|milestone|safety|privacy|acceptance)\b/iu;
const SAFETY = /安全|隐私|\b(?:safety|security|privacy)\b/iu;
const SCOPE_OR_ORDER = /首版|第一(?:版|期|阶段)|版本|范围|路线图|交付顺序|里程碑|\b(?:release|scope|roadmap|delivery order|milestone|MVP|phase\s+\d+)\b/iu;

function questionPriority(text: string) {
  if (SAFETY.test(text)) return 3;
  if (SCOPE_OR_ORDER.test(text)) return 2;
  return Number(PRIORITY.test(text));
}

export function projectOverviewWorkspace(session: FocusSession, zh: boolean, reading?: Reading, versions?: VersionChoices) {
  if (session.mode !== "work" || session.wikiKnowledge?.documentType === "learning") return;
  const plan = projectCurrentPlan(session, reading);
  const ledger = session.wikiKnowledge;
  const resolved = reading ?? (ledger && resolveWikiReading(ledger));
  const units = new Map(resolved?.units.map(unit => [unit.id, unit]));
  const refs = currentWikiEvidence(session);
  const exact = new Map(refs.map(ref => [wikiEvidenceKey(ref), ref]));
  const byMessage = new Map<string, FocusEvidence[]>();
  const messageKey = (ref: Pick<FocusEvidence, "conversationId" | "messageId">) => JSON.stringify([ref.conversationId, ref.messageId]);
  for (const ref of refs) {
    const key = messageKey(ref);
    const group = byMessage.get(key) ?? [];
    group.push(ref);
    byMessage.set(key, group);
  }
  const basisFor = (ids: string[]) => {
    const basis = new Map<string, OverviewBasis>();
    for (const id of ids) {
      const unit = units.get(id);
      if (!unit) continue;
      const key = wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote });
      const ref = exact.get(key) ?? byMessage.get(messageKey(unit.evidence))?.find(item => wikiQuoteRange(item.excerpt, unit.evidence.quote));
      if (ref) basis.set(key, { ref, quote: unit.evidence.quote, text: unit.statement, userAuthored: unit.evidence.role === "user" && !unit.evidence.pasted && wikiSaidInQuote(unit) });
    }
    return [...basis.values()];
  };
  const pages = wikiSections(session);
  const pagesById = new Map(pages.map(page => [page.id, page]));
  const homes = wikiUnitChapterHomes(resolved?.organization);
  const chapterFor = (ids: string[]) => {
    for (const id of ids) {
      const home = homes.get(id);
      const page = (home && pagesById.get(home)) || pages.find(page => page.claims?.some(claim => claim.unitIds?.includes(id)));
      if (!page) continue;
      const chapter = resolved?.organization?.chapters.find(item => item.id === page.id);
      const topics = chapter?.subtopics.filter(topic => topic.subjectIds.some(subject => resolved?.organization?.subjects.find(item => item.id === subject)?.unitIds.includes(id)));
      const heading = topics?.length === 1 && page.body.includes(topics[0].title) ? topics[0].title : undefined;
      return { id: page.id, heading };
    }
  };
  const row = (id: string, text: string, ids: string[]): OverviewRow => ({ id, text, basis: basisFor(ids), chapter: chapterFor(ids) });
  const writingRow = (question: WikiWritingQuestion): OverviewQuestion => {
    const options = question.options.filter(option => option.actions.some(action => action.do !== "open"))
      .map(option => ({ id: option.id, label: option.label, unitIds: option.actions.flatMap(action => action.units) }));
    const ids = [...new Set([...question.unitIds, ...options.flatMap(option => option.unitIds)])];
    return { ...row(question.id, question.ask, ids), kind: "writing", options };
  };
  const versionRow = (question: WikiVersionQuestion): OverviewQuestion => ({
    ...row(question.id, question.question, question.options.flatMap(option => option.unitIds)), kind: "version",
    options: question.options.map(option => ({ id: option.id, label: option.label, unitIds: option.unitIds })),
  });

  const questions = [...pendingWritingQuestions(ledger).map(writingRow),
    ...(versions ?? wikiDecisionQuestions(ledger, zh).versions).filter(question => !question.answer).map(versionRow)]
    .filter(item => item.options.length && item.basis.length)
    .sort((a, b) => questionPriority(b.text) - questionPriority(a.text));
  const choiceFor = (id: string) => {
    if (!resolved) return;
    const answer = wikiLocalAnswer(resolved.ledger, id);
    const question = answer && resolved.ledger.writingQuestions?.find(item => item.id === answer.questionId);
    if (question && answer.optionId) return { question: writingRow(question), option: answer.optionId, previous: answer.previousChoices };
  };
  const seen = new Set<string>(), planned = new Set(plan?.items.map(item => item.unit.id));
  const decisions = [...units.values()].filter(unit => resolved?.statuses.get(unit.id) === "confirmed"
    && !unit.about && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind) && !planned.has(unit.id))
    .sort((a, b) => Number(PRIORITY.test(b.statement)) - Number(PRIORITY.test(a.statement)))
    .flatMap(unit => {
      const entry = row(unit.id, wikiStatementWithConditions(unit, zh), [unit.id]);
      const key = factTextKey(entry.text);
      if (!entry.basis.length || seen.has(key)) return [];
      seen.add(key);
      return [{ ...entry, choice: choiceFor(unit.id) }];
    });

  const usedPlans = new Set(plan?.items.map(item => factTextKey(item.text)));
  const decisionsByText = new Map(decisions.map(item => [factTextKey(item.text), item]));
  const decisionsInPlan = new Set<string>();
  const followup = (ledger?.draft?.baseline ?? []).flatMap((item, index) => {
    const key = factTextKey(item.text);
    if (item.unitIds.some(id => planned.has(id) || ["history", "contested"].includes(resolved?.statuses.get(id) ?? ""))
      || usedPlans.has(key)) return [];
    const entry = row(`baseline:${index}`, item.text, item.unitIds);
    if (!entry.basis.length) return [];
    usedPlans.add(key);
    const confirmed = item.unitIds.length > 0 && item.unitIds.every(id => resolved?.statuses.get(id) === "confirmed");
    const stated = !confirmed && item.holder === "user" && entry.basis.some(basis => basis.userAuthored);
    const terms = knowledgeTerms(item.text);
    const score = (text: string) => [...knowledgeTerms(text)].filter(term => terms.has(term)).length;
    const ranked = entry.basis.map(basis => ({ basis, quoteScore: score(sourceQuoteText(basis.quote)), textScore: score(basis.text) }));
    entry.basis = ranked.sort((a, b) => (stated ? Number(Boolean(b.basis.userAuthored)) - Number(Boolean(a.basis.userAuthored)) : 0)
      || b.quoteScore - a.quoteScore || b.textScore - a.textScore).map(item => item.basis);
    const duplicate = confirmed ? decisionsByText.get(key) : undefined;
    const decision = duplicate && item.unitIds.includes(duplicate.id) ? duplicate : undefined;
    if (decision) decisionsInPlan.add(decision.id);
    return [{ ...entry, part: item.part, standing: confirmed ? "confirmed" as const : stated ? "stated" as const : "proposed" as const, choice: decision?.choice }];
  });
  const planChoices = Object.fromEntries((plan?.items ?? []).map(item => [item.unit.id, choiceFor(item.unit.id)]));
  return { questions, decisions: decisions.filter(item => !decisionsInPlan.has(item.id)), plan, planChoices, followup, decisionsAt: ledger?.decisionsAt };
}

export function saveOverviewChoice(session: FocusSession, question: OverviewQuestion, optionId: string, zh: boolean): FocusSession {
  const ledger = session.wikiKnowledge;
  if (!ledger) throw new Error("Decision unavailable");
  const asked = question.kind === "writing" ? resolveWikiReading(ledger).ledger.writingQuestions?.find(item => item.id === question.id) : undefined;
  const version = question.kind === "version" ? wikiDecisionQuestions(ledger, zh).versions.find(item => item.id === question.id) : undefined;
  const selected = question.options.find(option => option.id === optionId);
  const currentOption = (asked ?? version)?.options.find(option => option.id === optionId);
  const ids = currentOption && ("actions" in currentOption ? currentOption.actions.flatMap(action => action.units) : currentOption.unitIds);
  if (!selected || !ids || currentOption?.label !== selected.label
    || JSON.stringify([...ids].sort()) !== JSON.stringify([...selected.unitIds].sort())) throw new Error("Decision changed");
  const next = asked ? withWritingAnswer(ledger, asked, optionId) : withVersionAnswer(ledger, version!, optionId);
  const existing = session.projectMaintenance?.deferredOverviewQuestions ?? [];
  const deferredOverviewQuestions = existing.filter(id => id !== question.id);
  return { ...session, wikiKnowledge: next, updatedAt: Date.now(),
    ...(deferredOverviewQuestions.length !== existing.length ? { projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions } } : {}) };
}

export type ProjectOverviewWorkspace = NonNullable<ReturnType<typeof projectOverviewWorkspace>>;
