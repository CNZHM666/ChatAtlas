import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { CRITICAL_PROBLEM, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiWritingQuestion } from "../shared/wiki-knowledge";
import { withWikiSections } from "../shared/wiki-sections";
import { measureAILocalStep } from "./pipeline-timing";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { reviseForAnswers, writeLedgerDraft } from "./wiki-knowledge-write";
import { ledgerDocument } from "./wiki-ledger-document";
import { pendingWritingQuestions, settledReviewUnits, wikiNamedProjects, withAnswersFrom, withAnswersRevisited, withWriterQuestions, withWritingQuestions } from "./wiki-writing-questions";

export interface FocusWikiDraftCallbacks {
  onKeyDecisions?: (ledger: WikiKnowledgeLedger) => Promise<WikiKnowledgeLedger>;
  onWriterQuestions?: (questions: WikiWritingQuestion[], ledger: WikiKnowledgeLedger) => void;
  settleWriterQuestions?: (ledger: WikiKnowledgeLedger) => Promise<WikiKnowledgeLedger>;
  onPartial?: (session: FocusSession) => void;
}

type DraftContext = Pick<Parameters<typeof writeLedgerDraft>[1], "ai" | "locale" | "signal" | "project" | "previous" | "progress">
  & FocusWikiDraftCallbacks & {
    runId: string;
    originals: ConversationMessage[];
    sources: Conversation[];
    preview: Pick<FocusSession, "goal" | "mode" | "scope" | "locale" | "sourceConversationIds" | "sourceVersionIds" | "sourceSignatures" | "sourceRoles" | "sourceMessageOrder" | "wikiProjectBoundary">;
    title: (ledger: WikiKnowledgeLedger) => string;
    placement?: { ready: Promise<WikiKnowledgeLedger>; stable: ReadonlySet<string>; pending: () => boolean };
  };

/** Generation and updates share the decision prompts, live directory and chapter previews. */
export async function writeFocusWikiDraft(planned: WikiKnowledgeLedger, context: DraftContext) {
  const { ai, signal, locale, runId, originals, project, progress, previous, placement, onKeyDecisions, onPartial, onWriterQuestions, settleWriterQuestions } = context;
  const asked = onKeyDecisions ? await withWritingQuestions(planned, { ai, signal, locale, runId }) : planned;
  const questions = pendingWritingQuestions(asked);
  const scopeGate = asked.documentType === "learning" || wikiNamedProjects(asked).length > 0
    || questions.some(question => question.options.some(option => option.actions.some(action => action.do === "owner")));
  const decision = onKeyDecisions ? measureAILocalStep(runId, "wiki", "wiki:decision-review", () => onKeyDecisions(asked)) : undefined;
  const pendingDecisions = decision && !placement && !scopeGate && questions.length
    ? { units: new Set(questions.flatMap(question => [...question.unitIds, ...question.options.flatMap(option => option.actions.flatMap(action => action.units))])),
        ready: decision.then(answered => withWikiSections(withAnswersRevisited(answered), originals)) }
    : undefined;
  pendingDecisions?.ready.catch(() => undefined);
  const organized = withAnswersRevisited(decision && !pendingDecisions ? await decision : asked);
  signal.throwIfAborted();
  const title = context.title(organized), zh = locale === "zh-CN", titles = Object.fromEntries(context.sources.map(source => [source.id, source.title]));
  const onChapters = onPartial ? (chapters: WikiDraftChapter[], basis: WikiKnowledgeLedger) => {
    const outline = (basis.organization?.chapters ?? []).map((chapter): FocusSection => ({
      id: chapter.id, title: chapter.title, kind: "finding", transition: "", evidenceIds: [], wikiOutline: true, wikiQuestion: chapter.question,
      body: [chapter.question, chapter.subtopics.length ? `${zh ? "本章包括：" : "Covers: "}${chapter.subtopics.map(topic => topic.title).join(" · ")}` : ""].filter(Boolean).join("\n\n"),
    }));
    const document = chapters.length
      ? ledgerDocument({ ...basis, draft: { version: 1, generatedAt: Date.now(), status: "partial", chapters, report: {} } }, titles)
      : { sections: [], evidence: [] };
    const unfinishedChecks = new Set(chapters.filter(chapter => chapter.problems.some(problem => CRITICAL_PROBLEM.test(problem))).map(chapter => chapter.id));
    const byId = new Map(document.sections.map(section => [section.id, unfinishedChecks.has(section.id) ? { ...section, reviewIssue: "draft" } : section]));
    const sections = outline.map(item => byId.get(item.id) ?? item);
    if (!sections.length || signal.aborted) return;
    const now = Date.now();
    onPartial({ ...context.preview, id: `partial:${runId}`, runId, status: "preview", title, evidence: document.evidence,
      sections, activeSectionId: sections[0].id, completedSectionIds: [], notes: "", createdAt: now, updatedAt: now, wikiKnowledge: basis });
  } : undefined;
  if (onChapters) onChapters([], resolveWikiReading(organized).ledger);

  const shown = new Set((organized.writingQuestions ?? []).map(question => [...question.unitIds].sort().join("|")));
  let questionLedger = organized;
  const queuedQuestions: WikiWritingQuestion[] = [], offeredQuestions: WikiWritingQuestion[] = [];
  let canAskWriterQuestions = !pendingDecisions;
  const onQuestions = onWriterQuestions ? (questions: WikiWritingQuestion[]) => {
    if (!canAskWriterQuestions) { queuedQuestions.push(...questions); return; }
    const settled = new Set([...(questionLedger.userAnswers ?? []).flatMap(answer => answer.unitIds), ...Object.keys(questionLedger.decisions ?? {}), ...settledReviewUnits(questionLedger)]);
    const fresh = questions.filter(question => {
      const key = [...question.unitIds].sort().join("|");
      if (shown.has(key) || question.unitIds.some(id => settled.has(id))) return false;
      shown.add(key);
      return true;
    });
    if (fresh.length && !signal.aborted) {
      offeredQuestions.push(...fresh);
      onWriterQuestions(fresh, questionLedger);
    }
  } : undefined;
  const writingDecisions = pendingDecisions && { ...pendingDecisions, ready: pendingDecisions.ready.then(answered => {
    questionLedger = answered;
    canAskWriterQuestions = true;
    onQuestions?.(queuedQuestions.splice(0));
    return answered;
  }) };
  writingDecisions?.ready.catch(() => undefined);
  const pendingPlacement = placement && { stable: placement.pending() ? placement.stable : new Set<string>(), ready: placement.ready.then(placed => {
    const answered = withAnswersFrom({ ...placed, writingQuestions: organized.writingQuestions }, organized);
    questionLedger = answered;
    return withWikiSections(answered, originals);
  }) };
  let ledger = await writeLedgerDraft(withWikiSections(organized, originals), {
    ai, locale, signal, runId, project, progress, onChapters, previous, pendingDecisions: writingDecisions, pendingPlacement, onQuestions,
  });
  if (placement) await placement.ready;
  if (settleWriterQuestions) {
    const raised = withWriterQuestions(ledger);
    if (raised.added.length || offeredQuestions.length) {
      const answered = await measureAILocalStep(runId, "wiki", "wiki:writer-review", () => settleWriterQuestions(raised.ledger));
      signal.throwIfAborted();
      ledger = await reviseForAnswers(answered, [...offeredQuestions, ...raised.added], { ai, locale, signal, runId });
      if (ledger.draft && ledger.decisionsAt && ledger.decisionsAt > ledger.draft.generatedAt) ledger = { ...ledger, draft: { ...ledger.draft, generatedAt: ledger.decisionsAt } };
    }
  }
  return { ledger, title };
}
