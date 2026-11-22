import { wikiCanApplyDecisionLocally } from "../shared/wiki-editorial-cleanup";
import { wikiDecisionQuestions, withDecision, withVersionAnswer, type WikiVersionQuestion } from "../ai/wiki-key-decisions";
import { effectiveWikiAnswers, wikiLocalAnswer, wikiQuestionAlreadyAnswered } from "../ai/wiki-question-parse";
import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { currentBaseline } from "../ai/wiki-knowledge-state";
import { pendingWritingQuestions, sameWikiDecision, withWritingAnswer } from "../ai/wiki-writing-questions";
import { evidenceVersion } from "../shared/evidence-identity";
import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { factTextKey } from "../shared/project-fact-state";
import { projectCurrentPlan } from "../shared/project-current-plan";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { availableWikiEvidence, currentWikiEvidence, wikiEvidenceKey } from "../shared/wiki-evidence-link";
import { DECIDING_KINDS, wikiBlockedUnitIds, wikiLedgerUnits, wikiStatementWithConditions, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import { wikiSections } from "../shared/wiki-navigation";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { wikiSaidInQuote } from "../shared/wiki-said-in-quote";
import { sourceQuoteText } from "../shared/source-quote-text";
import { exclusiveWikiVersions } from "../ai/wiki-version-conflict";
import { leftOutClause } from "../shared/wiki-left-out";

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
  options: Array<{ id: string; label: string; unitIds: string[]; decisionUnitIds?: string[]; decidedAt?: number; basis?: OverviewBasis[] }>;
  sources?: OverviewBasis[];
  kind: "writing" | "version" | "arbitration" | "suggestion";
  mergeable?: boolean;
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
  const blockedUnits = ledger && wikiBlockedUnitIds(ledger);
  const effective = resolved?.statuses;
  const belongs = (id: string) => {
    const unit = units.get(id);
    return Boolean(unit && !unit.about && !blockedUnits?.has(id));
  };
  const live = (id: string) => belongs(id) && effective?.get(id) !== "history";
  const unavailableMessages = new Set(session.evidence.map(messageKey).filter(key => !byMessage.has(key)));
  const basisFor = (ids: string[], includeLedgerSources = false) => {
    const basis = new Map<string, OverviewBasis>();
    for (const id of ids) {
      const unit = units.get(id);
      if (!unit || blockedUnits?.has(id)) continue;
      const key = wikiEvidenceKey({ ...unit.evidence, excerpt: unit.evidence.quote });
      const { conversationId, messageId, quote } = unit.evidence;
      const message = messageKey(unit.evidence);
      let ref = exact.get(key) ?? byMessage.get(message)?.find(item => wikiQuoteRange(item.excerpt, quote));
      if (!ref && includeLedgerSources && quote.trim() && !blockedUnits?.has(id) && !unavailableMessages.has(message)) {
        // Concise drafts can omit a proposal's citation while keeping the unit and its original quote.
        const signatures = session.sourceSignatures?.[conversationId];
        const savedRef: FocusEvidence = { id: `decision-source:${id}`, conversationId, messageId,
          title: unit.subject, excerpt: quote, sourceVersionId: session.sourceVersionIds?.[conversationId], sourceSignature: signatures?.[messageId] };
        if ((!signatures || signatures[messageId]) && availableWikiEvidence(session, savedRef)) ref = savedRef;
      }
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
      const page = (home && pagesById.get(session.wikiSectionAliases?.[home] ?? home))
        || pages.find(page => (home !== undefined && page.wikiOwnerId === home) || page.claims?.some(claim => claim.unitIds?.includes(id)));
      if (!page) continue;
      const chapter = resolved?.organization?.chapters.find(item => item.id === (page.wikiOwnerId ?? page.id));
      const topics = chapter?.subtopics.filter(topic => topic.subjectIds.some(subject => resolved?.organization?.subjects.find(item => item.id === subject)?.unitIds.includes(id)));
      const heading = topics?.length === 1 && page.body.includes(topics[0].title) ? topics[0].title : undefined;
      return { id: page.id, heading };
    }
  };
  const row = (id: string, text: string, ids: string[]): OverviewRow => ({ id, text, basis: basisFor(ids), chapter: chapterFor(ids) });
  const questionRow = (id: string, text: string, ids: string[]) => ({
    ...row(id, text, ids),
    sources: basisFor(ids, true).map(item => {
      const version = evidenceVersion(session, item.ref);
      return version && !item.ref.sourceVersionId ? { ...item, ref: { ...item.ref, sourceVersionId: version } } : item;
    }),
  });
  const optionWithBasis = (id: string, label: string, unitIds: string[], sourceIds = unitIds, fallbackDate?: number) => ({
    id, label, unitIds, basis: basisFor(sourceIds, true),
    decidedAt: Math.max(0, ...sourceIds.map(unitId => units.get(unitId)?.evidence.discussedAt ?? 0)) || fallbackDate,
  });
  const writingRow = (question: WikiWritingQuestion): OverviewQuestion => {
    const options = question.options.filter(option => option.actions.some(action => action.do !== "open"))
      .map(option => {
        const scopedIds = option.actions.filter(action => action.do === "confirm" || action.do === "both").flatMap(action => action.units);
        const unitIds = option.actions.flatMap(action => action.units);
        return { ...optionWithBasis(option.id, option.label, unitIds, scopedIds.length ? scopedIds : unitIds), decisionUnitIds: scopedIds };
      });
    const ids = [...new Set([...question.unitIds, ...options.flatMap(option => option.unitIds)])];
    return { ...questionRow(question.id, question.ask, ids), kind: "writing", options };
  };
  const versionRow = (question: WikiVersionQuestion): OverviewQuestion => {
    const members = question.options.flatMap(option=>option.unitIds.flatMap(id=>units.get(id)??[]));
    return {
      ...questionRow(question.id, question.question, question.options.flatMap(option => option.unitIds)), kind: "version",
      mergeable: question.kind!=="roadmap"&&members.length>=2&&members.every((unit,index)=>members.slice(index+1)
        .every(other=>!exclusiveWikiVersions(unit,other)&&!exclusiveWikiVersions(other,unit))),
      options: question.options.map(option => optionWithBasis(option.id, option.label, option.unitIds)),
    };
  };

  const arbitration = resolved?.conflicts.filter(conflict => !conflict.selected).map((conflict): OverviewQuestion => {
    const latestPerScope = new Map<string, typeof conflict.choices[number]>();
    for (const choice of conflict.choices) {
      if (!latestPerScope.has(choice.scope)) latestPerScope.set(choice.scope, choice);
    }
    const options = [...latestPerScope.values()].map(choice =>
      optionWithBasis(choice.receipt.questionId, choice.receipt.answer, choice.ids, choice.ids, choice.receipt.at));
    return { ...questionRow(conflict.id, conflict.question, conflict.choices.flatMap(choice => choice.ids)), kind: "arbitration", options };
  }) ?? [];
  const queue = wikiDecisionQuestions(ledger, zh);
  const answers = resolved ? effectiveWikiAnswers(resolved.ledger, effective) : [];
  const writing = pendingWritingQuestions(resolved?.ledger ?? ledger, effective).filter(question => question.options.some(option =>
    option.actions.some(action => action.do === "owner" || action.do !== "open" && action.units.some(live)))).map(writingRow);
  const candidates = [...arbitration, ...writing,
    ...(versions ?? queue.versions).filter(question => {
      if (question.answer || wikiQuestionAlreadyAnswered(question.question, answers)) return false;
      const options = question.options.filter(option => option.unitIds.length && option.unitIds.every(live));
      return options.length === question.options.length && options.length >= 2
        && (question.kind === "roadmap" || !options.some(option => option.unitIds.every(id => effective?.get(id) === "confirmed")));
    }).map(versionRow)]
    .filter(item=>item.kind==="arbitration"||!["custom","merge","choose"].includes(ledger?.decisionArbitrations?.[item.id]?.mode??""))
    .filter(item => item.options.length && item.options.every(option => option.basis?.length)
      && (item.sources?.length || item.basis.length))
    .sort((a, b) => (Number(b.kind === "arbitration") - Number(a.kind === "arbitration")) || questionPriority(b.text) - questionPriority(a.text));
  const questions: OverviewQuestion[] = [];
  const decisionOf = (item: OverviewQuestion) => ({ text: item.text, options: item.options.map(option => option.decisionUnitIds ?? option.unitIds) });
  for (const item of candidates) {
    if (!questions.some(prior => prior.id === item.id || sameWikiDecision(decisionOf(prior), decisionOf(item)))) questions.push(item);
  }
  const questionUnits = new Set(questions.flatMap(question => question.options.flatMap(option => option.unitIds)));
  const decisionKey = (unit: WikiKnowledgeUnit) => factTextKey(wikiStatementWithConditions(unit, zh));
  const confirmedKeys = new Set([...units.values()].filter(unit => live(unit.id) && effective?.get(unit.id) === "confirmed").map(decisionKey));
  const suggestionKeys = new Set<string>();
  for (const item of queue.candidates) {
    const unit = units.get(item.id);
    if (item.verdict || !unit || !live(unit.id) || unit.evidence.pasted
      || !["open", "proposal"].includes(effective?.get(unit.id) ?? "") || questionUnits.has(unit.id)) continue;
    const key = decisionKey(unit);
    if (!key || confirmedKeys.has(key) || suggestionKeys.has(key)) continue;
    // Broad clusters order suggestions. A verdict only reaches exact restatements with the same conditions.
    const ids = item.unitIds.filter(id => {
      const other = units.get(id);
      return other && live(id) && !other.evidence.pasted && !questionUnits.has(id)
        && ["open", "proposal"].includes(effective?.get(id) ?? "") && decisionKey(other) === key;
    });
    const statement = wikiStatementWithConditions(unit, zh);
    const question = questionRow(`suggestion:${unit.id}`, statement, ids);
    if (!question.sources.length) continue;
    suggestionKeys.add(key);
    for (const id of ids) questionUnits.add(id);
    questions.push({ ...question, kind: "suggestion", options: [optionWithBasis("adopt", statement, ids)] });
  }
  const versionChoices = new Map<string, { question: OverviewQuestion; option: string }>();
  for (const version of queue.versions) {
    const answer = version.answer ?? ledger?.decisionArbitrations?.[version.id]?.choice;
    const selected = version.options.find(option => option.id === answer);
    if (!selected || version.options.length < 2) continue;
    const question = versionRow(version);
    if (question.options.some(option => !option.basis?.length)) continue;
    for (const id of selected.unitIds) versionChoices.set(id, { question, option: selected.id });
  }
  const choiceFor = (id: string) => {
    if (!resolved) return;
    const answer = wikiLocalAnswer(resolved.ledger, id);
    const question = answer && resolved.ledger.writingQuestions?.find(item => item.id === answer.questionId);
    if (question && answer.optionId) {
      const row = writingRow(question);
      if (row.options.some(option => option.id !== answer.optionId)) return { question: row, option: answer.optionId, previous: answer.previousChoices };
    }
    const version = versionChoices.get(id);
    if (version) return { ...version, previous: undefined };
  };
  const planned = new Set(plan?.items.map(item => item.unit.id));
  const usedPlans = new Set(plan?.items.map(item => factTextKey(item.text)));
  const seen = new Set(usedPlans);
  const decisions = [...units.values()].filter(unit => live(unit.id) && effective?.get(unit.id) === "confirmed"
    && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind) && !planned.has(unit.id))
    .sort((a, b) => Number(PRIORITY.test(b.statement)) - Number(PRIORITY.test(a.statement)))
    .flatMap(unit => {
      const entry = { ...row(unit.id, wikiStatementWithConditions(unit, zh), [unit.id]), basis: basisFor([unit.id], true) };
      const key = factTextKey(entry.text);
      if (!entry.basis.length || seen.has(key)) return [];
      seen.add(key);
      return [{ ...entry, choice: choiceFor(unit.id) }];
    });
  for(const [id,entry] of Object.entries(ledger?.decisionArbitrations??{})){
    if(!entry.text||entry.mode!=="custom"&&entry.mode!=="merge"||resolved?.conflicts.some(item=>item.id===id&&!item.selected))continue;
    const key = factTextKey(entry.text);
    const ids = entry.unitIds?.filter(live) ?? [];
    const item = { ...row(id, entry.text, ids), basis: basisFor(ids, true) };
    if (!key || seen.has(key) || !item.basis.length) continue;
    seen.add(key);
    decisions.unshift({...item,choice:undefined});
  }

  const decisionsByText = new Map(decisions.map(item => [factTextKey(item.text), item]));
  const decisionsInPlan = new Set<string>();
  const draftTime = ledger?.draft?.generatedAt ?? 0;
  const recent = effective && ledger?.decisionsAt && ledger.decisionsAt > draftTime
    ? currentBaseline([...units.values()].filter(unit => live(unit.id) && !unit.evidence.pasted && effective.get(unit.id) === "confirmed"
      && (resolved?.ledger.decisions?.[unit.id]?.at ?? 0) > draftTime), effective)
    : [];
  const followup = [...recent, ...ledger?.draft?.baseline ?? []].flatMap(item => {
    const key = factTextKey(item.text);
    if (item.unitIds.some(id => !live(id) || planned.has(id) || ["open", "contested"].includes(effective?.get(id) ?? ""))
      || usedPlans.has(key)) return [];
    if (item.part === "done" && item.unitIds.every(id => units.get(id)?.kind === "report" || effective?.get(id) === "reported")) return [];
    const confirmedUnit = item.unitIds.every(id => effective?.get(id) === "confirmed") && item.unitIds.map(id => units.get(id)!).find(unit =>
      !unit.evidence.pasted && factTextKey(item.part === "notNow" ? leftOutClause(unit.statement) : unit.statement) === key);
    const confirmed = Boolean(confirmedUnit);
    if (!confirmed && item.unitIds.some(id => questionUnits.has(id))) return [];
    const entry = row(`baseline:${item.part}:${item.unitIds.join("|")}:${key}`, confirmedUnit ? wikiStatementWithConditions(confirmedUnit, zh) : item.text, item.unitIds);
    if (confirmed && !entry.basis.length) entry.basis = basisFor(item.unitIds, true);
    if (!entry.basis.length) return [];
    usedPlans.add(key);
    const stated = !confirmed && item.holder === "user" && item.unitIds.some(id => ["stated", "reported"].includes(effective?.get(id) ?? ""))
      && entry.basis.some(basis => basis.userAuthored);
    const terms = knowledgeTerms(item.text);
    const score = (text: string) => [...knowledgeTerms(text)].filter(term => terms.has(term)).length;
    const ranked = entry.basis.map(basis => ({ basis, quoteScore: score(sourceQuoteText(basis.quote)), textScore: score(basis.text) }));
    entry.basis = ranked.sort((a, b) => (stated ? Number(Boolean(b.basis.userAuthored)) - Number(Boolean(a.basis.userAuthored)) : 0)
      || b.quoteScore - a.quoteScore || b.textScore - a.textScore).map(item => item.basis);
    const decision = confirmed ? decisionsByText.get(factTextKey(entry.text)) : undefined;
    if (decision) decisionsInPlan.add(decision.id);
    return [{ ...entry, part: item.part, standing: confirmed ? "confirmed" as const : stated ? "stated" as const : "proposed" as const, choice: decision?.choice }];
  });
  const planChoices = Object.fromEntries((plan?.items ?? []).map(item => [item.unit.id, choiceFor(item.unit.id)]));
  const planChapters = Object.fromEntries((plan?.items ?? []).map(({ unit }) => {
    const answer = resolved && wikiLocalAnswer(resolved.ledger, unit.id);
    return [unit.id, chapterFor([unit.id, ...(answer?.unitIds ?? [])])];
  }));
  return { questions, decisions: decisions.filter(item => !decisionsInPlan.has(item.id)), plan, planChoices, planChapters, followup };
}

function affectedOverviewOptions(question: OverviewQuestion, selectedId: string | undefined, ledger: WikiKnowledgeLedger) {
  return question.kind === "version" && selectedId ? question.options.filter(option => option.id === selectedId
    || option.unitIds.every(id => ledger.decisions?.[id]?.verdict === "rejected")) : question.options;
}

export function saveOverviewChoice(session: FocusSession, question: OverviewQuestion, optionId: string, zh: boolean): FocusSession {
  const ledger = session.wikiKnowledge;
  if (!ledger) throw new Error("Decision unavailable");
  if (question.kind === "arbitration") {
    const conflict = resolveWikiReading(ledger).conflicts.find(item => item.id === question.id);
    if (!conflict?.choices.some(choice => choice.receipt.questionId === optionId)) throw new Error(zh ? "待核对内容已变化" : "The conflict has changed");
    const at = Date.now();
    const deferredOverviewQuestions = (session.projectMaintenance?.deferredOverviewQuestions ?? []).filter(id => id !== question.id);
    return { ...session, updatedAt: at, projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions },
      wikiKnowledge: { ...ledger, decisionsAt: at, decisionArbitrations: { ...ledger.decisionArbitrations, [conflict.id]: { choice: optionId, at } } } };
  }
  const asked = question.kind === "writing" ? resolveWikiReading(ledger).ledger.writingQuestions?.find(item => item.id === question.id) : undefined;
  const version = question.kind === "version" ? wikiDecisionQuestions(ledger, zh).versions.find(item => item.id === question.id) : undefined;
  const selected = question.options.find(option => option.id === optionId);
  const currentOption = (asked ?? version)?.options.find(option => option.id === optionId);
  const ids = currentOption && ("actions" in currentOption ? currentOption.actions.flatMap(action => action.units) : currentOption.unitIds);
  if (!selected || !ids || currentOption?.label !== selected.label
    || JSON.stringify([...ids].sort()) !== JSON.stringify([...selected.unitIds].sort())) throw new Error("Decision changed");
  const at = Date.now();
  let next = asked ? withWritingAnswer(ledger, asked, optionId, undefined, at) : withVersionAnswer(ledger, version!, optionId);
  const previous = ledger.decisionArbitrations?.[question.id];
  if (previous?.mode === "choose") {
    const affected = affectedOverviewOptions(question, optionId, next);
    const action = { ...previous, choice: optionId, at: next.decisionsAt ?? at, text: selected.label,
      optionTexts: affected.map(option => option.label), unitIds: affected.flatMap(option => option.unitIds),
      evidenceIds: selected.basis?.map(item => item.ref.id) ?? [] };
    next = { ...next, decisionArbitrations: { ...next.decisionArbitrations, [question.id]: {
      ...action, locallyApplied: wikiCanApplyDecisionLocally(session.sections, action),
    } } };
  }
  const existing = session.projectMaintenance?.deferredOverviewQuestions ?? [];
  const deferredOverviewQuestions = existing.filter(id => id !== question.id);
  return { ...session, wikiKnowledge: next, updatedAt: at,
    ...(deferredOverviewQuestions.length !== existing.length ? { projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions } } : {}) };
}

export type ProjectOverviewWorkspace = NonNullable<ReturnType<typeof projectOverviewWorkspace>>;

/** Apply one inline decision without a new model request. The reading
 * projection uses the same scoped receipt for local updates and export. */
export function applyWikiDecisionCard(session: FocusSession, question: OverviewQuestion, action: {
  mode: "choose" | "defer" | "reject" | "custom" | "merge"; choice?: string; text?: string;
}, zh: boolean): FocusSession {
  const active = projectOverviewWorkspace(session, zh)?.questions.find(item=>item.id===question.id);
  if (!active || !session.wikiKnowledge) throw new Error("Decision changed");
  const at = Date.now(), selected = active.options.find(option=>option.id===action.choice);
  const paused = new Set(session.projectMaintenance?.deferredOverviewQuestions);
  if (action.mode === "defer") {
    paused.add(active.id);
    return { ...session, updatedAt: at, projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions: [...paused] } };
  }
  paused.delete(active.id);
  if (active.kind === "suggestion") {
    if (action.mode !== "reject" && (action.mode !== "choose" || !selected)) throw new Error("Decision option changed");
    const ids = new Set(active.options[0].unitIds);
    const statements = wikiLedgerUnits(session.wikiKnowledge).filter(unit => ids.has(unit.id)).map(unit => unit.statement);
    const ledger = withDecision(session.wikiKnowledge, [...ids], action.mode === "reject" ? "rejected" : "confirmed", at, statements);
    return { ...session, updatedAt: at, wikiKnowledge: ledger, projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions: [...paused] } };
  }
  if (action.mode === "reject") throw new Error("Decision option changed");
  let next = session;
  if (action.mode === "choose") {
    if (!selected) throw new Error("Decision option changed");
    next = saveOverviewChoice(session, active, selected.id, zh);
  }
  if (action.mode==="merge"&&!active.mergeable) throw new Error("Alternatives cannot be merged");
  const text=action.mode==="choose"?selected?.label:action.text?.trim();
  if(!text||text.length>500||/[\r\n]|^\s*(?:#|>|[-*+]\s|\d+\.\s|~{3}|\x60{3})/u.test(text))throw new Error("Invalid decision text");
  const ledger=next.wikiKnowledge!;
  const affected = affectedOverviewOptions(active, selected?.id, ledger);
  const entry={choice:selected?.id??action.mode,at:Math.max(at,ledger.decisionsAt??at),mode:action.mode,
    chapterId:active.chapter?.id,heading:active.chapter?.heading,text,question:active.text,
    optionTexts:affected.map(option=>option.label),unitIds:affected.flatMap(option=>option.unitIds),
    evidenceIds:(selected?.basis??active.basis).map(item=>item.ref.id)};
  return {...next,updatedAt:entry.at,projectMaintenance:{...next.projectMaintenance,deferredOverviewQuestions:[...paused]},
    wikiKnowledge:{...ledger,decisionsAt:entry.at,decisionArbitrations:{...ledger.decisionArbitrations,[active.id]:{...entry,
      locallyApplied:wikiCanApplyDecisionLocally(session.sections,entry)}}}};
}
