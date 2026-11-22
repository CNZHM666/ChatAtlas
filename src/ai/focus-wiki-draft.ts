import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { CRITICAL_PROBLEM, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiWritingMode } from "../shared/wiki-knowledge";
import { withWikiSections } from "../shared/wiki-sections";
import { measureAILocalStep } from "./pipeline-timing";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { writeLedgerDraft } from "./wiki-knowledge-write";
import { cleanWikiDraftDisplay, wikiInternalDraftLabel } from "./wiki-editorial-review";
import { ledgerDocument } from "./wiki-ledger-document";
import { prewritingWikiQuestions, wikiNamedProjects, withAnswersFrom, withAnswersRevisited, withWriterQuestions, withWritingQuestions } from "./wiki-writing-questions";

export interface FocusWikiDraftCallbacks {
  onKeyDecisions?: (ledger: WikiKnowledgeLedger) => Promise<WikiKnowledgeLedger>;
  onWritingMode?: (current: WikiWritingMode) => Promise<WikiWritingMode>;
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
  const { ai, signal, locale, runId, originals, project, progress, previous, placement, onKeyDecisions, onPartial } = context;
  const chooseMode = planned.documentType !== "learning" ? context.onWritingMode : undefined;
  const report: Record<string, number> = {};
  const asked = onKeyDecisions
    ? await measureAILocalStep(runId, "wiki", "wiki:decision-questions", () => withWritingQuestions(planned, { ai, signal, locale, runId, report }), () => report)
    : planned;
  const questions = onKeyDecisions ? prewritingWikiQuestions(asked) : [];
  const scopeGate = asked.documentType === "learning" || wikiNamedProjects(asked).length > 0
    || questions.some(question => question.options.some(option => option.actions.some(action => action.do === "owner")));
  const decision = onKeyDecisions ? measureAILocalStep(runId, "wiki", "wiki:decision-review", () => onKeyDecisions(asked)) : undefined;
  const pendingDecisions = decision && !chooseMode && !scopeGate && questions.length
    ? { units: new Set(questions.flatMap(question => [...question.unitIds, ...question.options.flatMap(option => option.actions.flatMap(action => action.units))])),
        ready: decision.then(answered => withWikiSections(withAnswersRevisited(answered), originals)) }
    : undefined;
  pendingDecisions?.ready.catch(() => undefined);
  let organized = withAnswersRevisited(decision && !pendingDecisions ? await decision : asked);
  signal.throwIfAborted();
  if (chooseMode) {
    const mode = await measureAILocalStep(runId, "wiki", "wiki:writing-mode", () => chooseMode(organized.writingMode ?? "concise"));
    organized = { ...organized, writingMode: mode };
  }
  signal.throwIfAborted();
  const title = context.title(organized), zh = locale === "zh-CN", titles = Object.fromEntries(context.sources.map(source => [source.id, source.title]));
  const onChapters = onPartial ? (chapters: WikiDraftChapter[], basis: WikiKnowledgeLedger) => {
    const outline = (basis.organization?.chapters ?? []).map((chapter): FocusSection => {
      const topics = chapter.subtopics.map(topic => topic.title).filter(title => !wikiInternalDraftLabel(title));
      const question = cleanWikiDraftDisplay(chapter.question);
      return { id: chapter.id, title: wikiInternalDraftLabel(chapter.title) ? topics[0] ?? (zh ? "章节草稿" : "Chapter draft") : chapter.title,
        kind: "finding", transition: "", evidenceIds: [], wikiOutline: true, wikiQuestion: question,
        body: [question, topics.length ? (zh ? "本章包括：" : "Covers: ") + topics.join(" · ") : ""].filter(Boolean).join("\n\n") };
    });
    const document = chapters.length
      ? ledgerDocument({ ...basis, draft: { version: 1, writingMode: basis.writingMode, generatedAt: Date.now(), status: "partial", chapters, report: {} } }, titles)
      : { sections: [], evidence: [] };
    const unfinishedChecks = new Set(chapters.filter(chapter => chapter.problems.some(problem => CRITICAL_PROBLEM.test(problem))).map(chapter => chapter.id));
    const byId = new Map(document.sections.map(section => [section.id, unfinishedChecks.has(section.id) ? { ...section, reviewIssue: "draft" as const } : section]));
    const sections = outline.map(item => byId.get(item.id) ?? item);
    if (!sections.length || signal.aborted) return;
    const now = Date.now();
    onPartial({ ...context.preview, id: `partial:${runId}`, runId, status: "preview", title, evidence: document.evidence,
      sections, activeSectionId: sections[0].id, completedSectionIds: [], notes: "", createdAt: now, updatedAt: now, wikiKnowledge: basis });
  } : undefined;
  if (onChapters) onChapters([], resolveWikiReading(organized).ledger);

  const pendingPlacement = placement && { stable: placement.pending() || pendingDecisions ? placement.stable : new Set<string>(),
    ready: Promise.all([placement.ready, pendingDecisions?.ready ?? organized]).then(([placed, reviewed]) => {
      const answered = withAnswersFrom({ ...placed, writingMode: reviewed.writingMode, writingQuestions: reviewed.writingQuestions, writingQuestionRun: reviewed.writingQuestionRun }, reviewed);
      return withWikiSections(answered, originals);
    }) };
  const draft = await writeLedgerDraft(withWikiSections(organized, originals), {
    ai, locale, signal, runId, project, progress, onChapters, previous, pendingDecisions, pendingPlacement,
  });
  if (placement) await placement.ready;
  const { ledger } = withWriterQuestions(draft);
  return { ledger, title: context.title(ledger) };
}
