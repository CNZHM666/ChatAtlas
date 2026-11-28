import { wikiVersionQuestions, type WikiVersionQuestion } from "../ai/wiki-key-decisions";
import { answerProjectQuestion, projectWritingOptions, wikiProjectQuestions, type WikiProjectQuestion } from "../ai/wiki-project-decisions";
import { reopenWikiDecision } from "../shared/wiki-decision-receipts";
import { wikiLocalAnswer } from "../ai/wiki-question-parse";
import { wikiUnitDecisionOrigin } from "../ai/wiki-knowledge-state";
import type { OverviewDecisionOverride } from "../shared/project-state";
import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { evidenceVersion } from "../shared/evidence-identity";
import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { factTextKey } from "../shared/project-fact-state";
import { projectCurrentPlan } from "../shared/project-current-plan";
import { wikiUnitChapterHomes } from "../shared/wiki-chapter-links";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { availableWikiEvidence, currentWikiEvidence, wikiEvidenceKey } from "../shared/wiki-evidence-link";
import { DECIDING_KINDS, wikiBlockedUnitIds, wikiStatementWithConditions, type WikiKnowledgeLedger, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import { wikiSections } from "../shared/wiki-navigation";
import { exclusiveWikiVersions } from "../ai/wiki-version-conflict";
import { currentDecisions, projectReviewedClaims } from "../shared/project-continuation";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import { evidencePresentation } from "../shared/evidence-presentation";
import { documentEvidenceReview } from "./document-review";

type Reading = ReturnType<typeof resolveWikiReading>;

export interface OverviewBasis {
  ref: FocusEvidence;
  quote: string;
  text: string;
}

interface OverviewRow {
  id: string;
  text: string;
  basis: OverviewBasis[];
  chapter?: { id: string; heading?: string };
}

export type OverviewDecision = OverviewRow & {
  chapterTitle?: string;
  origin?: "user_confirmed" | "user_message" | "review_confirmed" | "manual";
  decidedAt?: number;
  tier?: "core" | "detail";
  unitId?: string;
  choice?: { question: OverviewQuestion; option: string; previous?: Array<{ answer: string; at: number }> };
  receiptId?: string;
};

type OverviewQuestion = OverviewRow & {
  options: Array<{ id: string; label: string; unitIds: string[]; decisionUnitIds?: string[]; decidedAt?: number; basis?: OverviewBasis[] }>;
  sources?: OverviewBasis[];
  kind: "writing" | "version" | "arbitration";
  mergeable?: boolean;
  entry?: WikiProjectQuestion;
};

const MAX_CARD_SUMMARY = 65;
const CARD_PROSE_PREFIX = /^(?:本章(?:介绍|讲解|说明|讨论)|Below (?:is|are)|This chapter (?:explains|describes|covers))\b|^本章(?:介绍|讲解|说明|讨论)/iu;
const sentenceSegmenter = new Intl.Segmenter("zh", { granularity: "sentence" });

export function overviewChapterSummary(body: string) {
  for (const block of wikiDocumentBlocks(body)) {
    if (block.kind !== "paragraph" && block.kind !== "list") continue;
    const text = evidencePresentation(block.text)
      .replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, "")
      .replace(/\[(?:来源\s*\d+|Source\s+\d+|S-\d+-[a-z0-9]+|e\d+(?::\d+)?|\d+)\](?:\([^)\n]*\))?/giu, "")
      .replace(/!?\[([^\]\n]+)\]\([^)\n]+\)/gu, "$1").replace(/〔[^〕\n]+〕|<[^>\n]+>|\*\*|__|\x60/gu, "")
      .replace(/\s+/gu, " ").replace(/[ \t]+(?=[，。！？；：])/gu, "").trim();
    if (block.standaloneLabel || !text || /^(?:原文来源|来源待核对|Source check|Original source)\b|^(?:原文来源|来源待核对)/iu.test(text)) continue;
    const sentence = [...sentenceSegmenter.segment(text)].map(item => item.segment.trim())
      .find(item => item.length >= 8 && !CARD_PROSE_PREFIX.test(item));
    if (!sentence) continue;
    const chars = Array.from(sentence);
    if (chars.length <= MAX_CARD_SUMMARY) return sentence;
    const prefix = chars.slice(0, MAX_CARD_SUMMARY - 1).join("");
    const boundary = Math.max(prefix.lastIndexOf("，"), prefix.lastIndexOf("、"), prefix.lastIndexOf(","), prefix.lastIndexOf(" "));
    return (boundary >= 40 ? prefix.slice(0, boundary) : prefix) + "…";
  }
  return "";
}

const CORE_CONSTRAINT = /禁止|不得|不做|不支持|不允许|绝不|隐私边界|安全边界|\b(?:must not|never|out of scope|privacy boundary)\b/iu;
const ARCHITECTURE = /架构|技术栈|事实源|数据模型|数据结构|存储方案|核心接口|\b(?:architecture|tech stack|source of truth|data model|storage)\b/iu;
const PRODUCT_SCOPE = /产品定位|范围|首版|目标用户|MVP|\b(?:scope|positioning|first release|target audience)\b/iu;
const decisionRank = (text: string) => CORE_CONSTRAINT.test(text) ? 0 : ARCHITECTURE.test(text) ? 1 : PRODUCT_SCOPE.test(text) ? 2 : 3;
const OPEN_OVERVIEW = "overview-review:";
export function projectOverviewWorkspace(session: FocusSession, zh: boolean, reading?: Reading, versions?: WikiVersionQuestion[]) {
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
      if (ref) basis.set(key, { ref, quote: unit.evidence.quote, text: unit.statement });
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
    const options = projectWritingOptions(question)
      .map(option => {
        const scopedIds = option.actions.filter(action => action.do === "confirm" || action.do === "both").flatMap(action => action.units);
        const unitIds = option.actions.flatMap(action => action.units);
        return { ...optionWithBasis(option.id, option.label, unitIds, scopedIds.length ? scopedIds : unitIds), decisionUnitIds: scopedIds };
      });
    const ids = [...new Set([...question.unitIds, ...options.flatMap(option => option.unitIds)])];
    return { ...questionRow(question.id, question.ask, ids), kind: "writing", options, entry: { kind: "writing", question } };
  };
  const versionRow = (question: WikiVersionQuestion): OverviewQuestion => {
    const members = question.options.flatMap(option=>option.unitIds.flatMap(id=>units.get(id)??[]));
    return {
      ...questionRow(question.id, question.question, question.options.flatMap(option => option.unitIds)), kind: "version", entry: { kind: "version", question },
      mergeable: question.kind!=="roadmap"&&members.length>=2&&members.every((unit,index)=>members.slice(index+1)
        .every(other=>!exclusiveWikiVersions(unit,other)&&!exclusiveWikiVersions(other,unit))),
      options: question.options.map(option => optionWithBasis(option.id, option.label, option.unitIds)),
    };
  };

  const questions = (ledger && resolved ? wikiProjectQuestions(ledger, zh, resolved, versions) : []).map((entry): OverviewQuestion => {
    if (entry.kind === "writing") return writingRow(entry.question);
    if (entry.kind === "version") return versionRow(entry.question);
    const conflict = entry.question;
    const latestPerScope = new Map<string, typeof conflict.choices[number]>();
    for (const choice of conflict.choices) if (!latestPerScope.has(choice.scope)) latestPerScope.set(choice.scope, choice);
    const options = [...latestPerScope.values()].map(choice =>
      optionWithBasis(choice.receipt.questionId, choice.receipt.answer, choice.ids, choice.ids, choice.receipt.at));
    return { ...questionRow(conflict.id, conflict.question, conflict.choices.flatMap(choice => choice.ids)), kind: "arbitration", options, entry };
  }).filter(item => item.options.length && item.options.every(option => option.basis?.length)
    && (item.sources?.length || item.basis.length));
  const versionChoices = new Map<string, { question: OverviewQuestion; option: string }>();
  for (const version of wikiVersionQuestions(ledger, zh)) {
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
  const reviewed = projectReviewedClaims(session);
  const seen = new Set<string>();
  const decisions: OverviewDecision[] = [...units.values()].filter(unit => !reviewed.shadows(unit.id, unit.statement) && live(unit.id)
    && effective?.get(unit.id) === "confirmed" && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind)
    && (wikiUnitDecisionOrigin(unit) || resolved?.ledger.decisions?.[unit.id]?.verdict === "confirmed"))
    .flatMap(unit => {
      const entry = { ...row(unit.id, wikiStatementWithConditions(unit, zh), [unit.id]), basis: basisFor([unit.id], true) };
      const key = factTextKey(entry.text);
      if (!entry.basis.length || seen.has(key)) return [];
      seen.add(key);
      const verdict = resolved?.ledger.decisions?.[unit.id];
      const origin = verdict?.verdict === "confirmed" ? "user_confirmed" : wikiUnitDecisionOrigin(unit);
      const approval = origin === "user_confirmed" && unit.adoption.approval;
      const approvalRef = approval && refs.find(ref => ref.conversationId === unit.evidence.conversationId
        && ref.messageId === approval.messageId && wikiQuoteRange(ref.excerpt, approval.quote));
      if (approval && approvalRef) entry.basis.push({ ref: approvalRef, quote: approval.quote, text: entry.text });
      const decidedAt = verdict?.at ?? (origin === "user_message" ? unit.evidence.discussedAt : approval
        ? [...units.values()].find(source => source.evidence.conversationId === unit.evidence.conversationId
          && source.evidence.messageId === approval.messageId && source.evidence.role === "user")?.evidence.discussedAt : undefined);
      return [{ ...entry, choice: choiceFor(unit.id), unitId: unit.id, origin, decidedAt }];
    });
  for (const [id, receipt] of Object.entries(resolved?.ledger.decisionArbitrations ?? {})) {
    if (!receipt.text || receipt.mode === "defer" || reviewed.overriddenReceipts.has(id) || reviewed.shadows(undefined, receipt.text)
      || receipt.unitIds?.some(unitId => reviewed.shadows(unitId, receipt.text!))
      || resolved?.conflicts.some(conflict => conflict.id === id && !conflict.selected)) continue;
    const key = factTextKey(receipt.text);
    const ids = receipt.unitIds?.filter(id => units.has(id)) ?? [];
    const item = { ...row(id, receipt.text, ids), basis: basisFor(ids, true) };
    if (!key) continue;
    const matching = decisions.findIndex(decision => factTextKey(decision.text) === key);
    if (matching >= 0) decisions[matching] = { ...decisions[matching], receiptId: id, origin: "user_confirmed", decidedAt: receipt.at };
    else {
      seen.add(key);
      decisions.unshift({ ...item, receiptId: id, unitId: ids.length === 1 ? ids[0] : undefined, origin: "user_confirmed", decidedAt: receipt.at });
    }
  }

  const planChoices = Object.fromEntries((plan?.items ?? []).map(item => [item.unit.id, choiceFor(item.unit.id)]));
  const planChapters = Object.fromEntries((plan?.items ?? []).map(({ unit }) => {
    const answer = resolved && wikiLocalAnswer(resolved.ledger, unit.id);
    return [unit.id, chapterFor([unit.id, ...(answer?.unitIds ?? [])])];
  }));
  for (const entry of reviewed.entries) {
    const key = factTextKey(entry.text);
    const chapter = entry.sectionId ? { id: entry.sectionId, heading: entry.heading } : undefined;
    const basis = entry.references.map(ref => ({ ref, quote: entry.quote && wikiQuoteRange(ref.excerpt, entry.quote) ? entry.quote : ref.excerpt, text: entry.text }));
    if (entry.holder === "open" && entry.overview && !questions.some(question => question.id === entry.overview?.receiptId)) {
      questions.push({ id: OPEN_OVERVIEW + entry.id, kind: "writing", text: entry.text, chapter, basis,
        options: [{ id: "confirm", label: zh ? "确认这项决定" : "Confirm this decision", unitIds: [] }] });
    }
    if (entry.holder !== "decided" || !key || seen.has(key)) continue;
    seen.add(key);
    decisions.unshift({ id: entry.id, text: entry.text, chapter, basis,
      origin: entry.overview ? "manual" : "review_confirmed", decidedAt: entry.overview?.at,
      unitId: entry.unitIds.length === 1 ? entry.unitIds[0] : undefined });
  }
  const savedRefs = new Map(session.evidence.map(ref => [ref.id,ref]));
  for (const page of pages) {
    const claims = (page.claims ?? []).filter(claim => !claim.markOnly && !claim.unitIds?.length && (claim.continuation || page.continuationLoose || page.continuation));
    const published = claims.flatMap((claim,index) => {
      if (reviewed.shadows(undefined, claim.text) || !wikiQuoteRange(page.body,claim.text)) return [];
      // Incremental answers are saved as user decisions by the side panel's write action.
      const confirmed = Boolean(claim.continuation && claim.userDecided && claim.holder === "decided");
      return confirmed || claim.holder === "open" ? [{ confirmed, text:claim.text, evidenceIds:claim.evidenceIds, index }] : [];
    });
    for (const item of published) {
      const key = factTextKey(item.text);
      if (!key) continue;
      const basis = item.evidenceIds.flatMap(id => {
        const ref = savedRefs.get(id);
        return ref ? [{ ref, quote:ref.excerpt, text:item.text }] : [];
      });
      const entry = { id:`continuation:${page.id}:${item.index}`, text:item.text, basis, chapter:{id:page.id} };
      if (item.confirmed && !seen.has(key)) {
        seen.add(key);
        decisions.push({ ...entry, origin: page.origin === "user" ? "manual" : "user_confirmed" });

      }
    }
  }
  const orderedDecisions = decisions.map((decision): OverviewDecision => ({ ...decision,
    chapterTitle: decision.chapter && pagesById.get(decision.chapter.id)?.title,
    tier: decisionRank(decision.text) < 3 ? "core" : "detail",
  })).sort((a, b) => decisionRank(a.text) - decisionRank(b.text) || (b.decidedAt ?? 0) - (a.decidedAt ?? 0));
  return { questions, decisions: orderedDecisions, plan, planChoices, planChapters, chapterCards: overviewChapterCards(session, zh, orderedDecisions, pages) };
}

export function overviewChapterCards(session: FocusSession, zh: boolean, decisions?: readonly Pick<OverviewRow,"text"|"chapter">[],
  pages = wikiSections(session)): Record<string, { summary: string; decidedCount: number; pendingReviewCount: number }> {
  const reviewCounts = new Map(documentEvidenceReview(session, zh).map(item => [item.sectionId, item.count]));
  const reviewed = decisions ? undefined : projectReviewedClaims(session);
  return Object.fromEntries(pages.filter(page => !page.continuationLoose && !page.wikiOutline).map(page => {
    const texts = decisions
      ? decisions.filter(decision => decision.chapter?.id === page.id).map(decision => decision.text)
      : reviewed?.entries.filter(entry => entry.sectionId === page.id && entry.holder === "decided").map(entry => entry.text) ?? [];
    if (!decisions && !session.wikiKnowledge) texts.push(...currentDecisions(page)
      .filter(text => wikiQuoteRange(page.body, text) && !reviewed?.shadows(undefined, text)));
    return [page.id, { summary: overviewChapterSummary(page.body), decidedCount: new Set(texts.map(factTextKey)).size,
      pendingReviewCount: reviewCounts.get(page.id) ?? 0 }];
  }));
}

export type ProjectOverviewWorkspace = NonNullable<ReturnType<typeof projectOverviewWorkspace>>;

export function saveOverviewChoice(session: FocusSession, question: OverviewQuestion, optionId: string, zh: boolean): FocusSession {
  const ledger = session.wikiKnowledge;
  if (question.id.startsWith(OPEN_OVERVIEW)) return applyWikiDecisionCard(session, question, { mode: "choose", choice: optionId }, zh);
  if (!ledger) throw new Error("Decision unavailable");
  const saved = ledger.decisionArbitrations?.[question.id];
  const base = saved ? { ...session, wikiKnowledge: reopenWikiDecision(ledger, question.id) } : session;
  const candidate = projectOverviewWorkspace(base, zh)?.questions.find(item => item.id === question.id);
  if (candidate) return applyWikiDecisionCard(base, question, { mode: "choose", choice: optionId }, zh);
  // Older saved answers can still be edited after their options leave the active queue.
  const reading = resolveWikiReading(ledger);
  const asked = reading.ledger.writingQuestions?.find(item => item.id === question.id);
  const version = wikiVersionQuestions(ledger, zh).find(item => item.id === question.id);
  const entry: WikiProjectQuestion | undefined = asked ? { kind: "writing", question: asked }
    : version ? { kind: "version", question: version } : undefined;
  const original = question.options.find(option => option.id === optionId);
  const updated = (asked ? writingOption(asked, optionId) : version?.options.find(option => option.id === optionId));
  if (!entry || !original || !updated || original.label !== updated.label
    || JSON.stringify(original.unitIds) !== JSON.stringify(updated.unitIds)) throw new Error("Decision changed");
  const next = answerProjectQuestion(base.wikiKnowledge!, entry, { choice: optionId,
    location: { chapterId: question.chapter?.id, heading: question.chapter?.heading } });
  if (next === base.wikiKnowledge) throw new Error("Decision changed");
  return { ...base, wikiKnowledge: next, updatedAt: next.decisionsAt! };
}

function writingOption(question: WikiWritingQuestion, optionId: string) {
  const option = projectWritingOptions(question).find(item => item.id === optionId);
  return option && { label: option.label, unitIds: option.actions.flatMap(action => action.units) };
}

export function applyWikiDecisionCard(session: FocusSession, question: OverviewQuestion, action: {
  mode: "choose" | "defer" | "custom" | "merge"; choice?: string; text?: string;
}, zh: boolean): FocusSession {
  const active = projectOverviewWorkspace(session, zh)?.questions.find(item => item.id === question.id);
  if (!active) throw new Error("Decision changed");
  if (active.id.startsWith(OPEN_OVERVIEW) && action.mode !== "defer") {
    const id = active.id.slice(OPEN_OVERVIEW.length);
    const saved = session.projectMaintenance?.overviewDecisions?.[id];
    if (!saved || saved.status !== "open" || action.mode === "merge" || action.mode === "choose" && action.choice !== "confirm") throw new Error("Decision changed");
    return saveOverviewDecision(session, id, { ...saved, status: "decided",
      text: action.mode === "custom" ? overviewDecisionText(action.text ?? "") : saved.text });
  }
  const paused = new Set(session.projectMaintenance?.deferredOverviewQuestions);
  if (action.mode === "defer") {
    paused.add(active.id);
    return { ...session, updatedAt: Date.now(), projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions: [...paused] } };
  }
  if (!active.entry || !session.wikiKnowledge) throw new Error("Decision changed");
  const selected = active.options.find(option => option.id === action.choice);
  const prior = question.options.find(option => option.id === action.choice);
  if (action.mode === "choose" && (!selected || !prior || selected.label !== prior.label
    || JSON.stringify(selected.unitIds) !== JSON.stringify(prior.unitIds))) throw new Error("Decision changed");
  if (action.mode === "merge" && !active.mergeable) throw new Error("Alternatives cannot be merged");
  paused.delete(active.id);
  const ledger = answerProjectQuestion(session.wikiKnowledge, active.entry, { choice: action.choice, text: action.text, merge: action.mode === "merge",
    location: { chapterId: active.chapter?.id, heading: active.chapter?.heading,
      evidenceIds: (selected?.basis ?? active.sources ?? active.basis).map(item => item.ref.id) } });
  if (ledger === session.wikiKnowledge) throw new Error("Invalid decision");
  const overrides = session.projectMaintenance?.overviewDecisions;
  return { ...session, updatedAt: ledger.decisionsAt!, wikiKnowledge: ledger,
    projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions: [...paused],
      overviewDecisions: overrides && Object.fromEntries(Object.entries(overrides)
        .filter(([, item]) => item.status !== "open" || item.receiptId !== active.id)),
    } };
}

function overviewDecisionText(text: string) {
  const words = text.trim();
  if (!words || words.length > 500 || /[\r\n]|^\s*(?:#|>|[-*+]\s|\d+\.\s|~{3}|\x60{3})/u.test(words)) throw new Error("Invalid decision text");
  return words;
}

function saveOverviewDecision(session: FocusSession, id: string, entry: Omit<OverviewDecisionOverride, "at">): FocusSession {
  const at = Math.max(Date.now(), session.updatedAt + 1);
  return { ...session, updatedAt: at, projectMaintenance: { ...session.projectMaintenance,
    overviewDecisions: { ...session.projectMaintenance?.overviewDecisions, [id]: { ...entry, at } },
    deferredOverviewQuestions: session.projectMaintenance?.deferredOverviewQuestions?.filter(key => key !== OPEN_OVERVIEW + id),
  } };
}

export function updateOverviewDecision(session: FocusSession, decisionId: string,
  action: { kind: "edit"; text: string } | { kind: "downgrade_ai" } | { kind: "reopen" }, zh: boolean): FocusSession {
  const decision = projectOverviewWorkspace(session, zh)?.decisions.find(row => row.id === decisionId || row.receiptId === decisionId);
  if (!decision) throw new Error("Decision changed");
  const prior = session.projectMaintenance?.overviewDecisions?.[decision.id];
  const receiptId = decision.receiptId ?? prior?.receiptId;
  const receipt = receiptId ? session.wikiKnowledge?.decisionArbitrations?.[receiptId] : undefined;
  const text = action.kind === "edit" ? overviewDecisionText(action.text) : decision.text;
  const base = receipt && receiptId && action.kind === "reopen" ? editOverviewDecision(session, receiptId, receipt.at) : session;
  return saveOverviewDecision(base, decision.id, {
    text, originalText: prior?.originalText ?? decision.text,
    status: action.kind === "edit" ? "decided" : action.kind === "reopen" ? "open" : "ai",
    sectionId: decision.chapter?.id, heading: decision.chapter?.heading, receiptId,
    unitIds: prior?.unitIds ?? receipt?.unitIds ?? projectReviewedClaims(session).entries.find(item => item.id === decision.id)?.unitIds
      ?? (decision.unitId ? [decision.unitId] : undefined),
    evidenceIds: prior?.evidenceIds ?? decision.basis.map(item => item.ref.id),
  });
}

export function addOverviewDecision(session: FocusSession, text: string, zh: boolean): FocusSession {
  if (session.mode !== "work" || session.wikiKnowledge?.documentType === "learning") {
    throw new Error(zh ? "此文档不支持记录项目决定。" : "Decision unavailable");
  }
  return saveOverviewDecision(session, `manual-decision:${crypto.randomUUID()}`, { text: overviewDecisionText(text), status: "decided" });
}

export function editOverviewDecision(session: FocusSession, id: string, expectedAt: number, text?: string): FocusSession {
  const ledger = session.wikiKnowledge, receipt = ledger?.decisionArbitrations?.[id];
  if (!ledger || !receipt || receipt.at !== expectedAt) throw new Error("Decision changed");
  const reopened = reopenWikiDecision(ledger, id);
  const words = text?.trim();
  if (text !== undefined && (!words || words.length > 500 || /[\r\n]|^\s*(?:#|>|[-*+]\s|\d+\.\s|~{3}|\x60{3})/u.test(words))) throw new Error("Invalid decision text");
  const at = Math.max(Date.now(), ledger.decisionsAt ?? 0, ledger.draft?.generatedAt ?? 0) + 1;
  const next: WikiKnowledgeLedger = words ? { ...reopened, decisionsAt: at, decisionArbitrations: {
    ...reopened.decisionArbitrations, [id]: { ...receipt, choice: "custom", mode: "custom", text: words, at,
      locallyApplied: undefined, deferredToDraft: true, previousVerdicts: undefined, addedPairs: undefined },
  } } : reopened;
  const deferredOverviewQuestions = (session.projectMaintenance?.deferredOverviewQuestions ?? []).filter(key => key !== id);
  return { ...session, wikiKnowledge: next, updatedAt: at,
    projectMaintenance: { ...session.projectMaintenance, deferredOverviewQuestions } };
}
