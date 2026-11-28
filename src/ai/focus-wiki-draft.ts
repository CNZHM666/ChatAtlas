import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import { CRITICAL_PROBLEM, wikiExternalResearch, wikiLedgerUnits, wikiResearchUse, type WikiDraftChapter, type WikiKnowledgeLedger, type WikiWritingEvent, type WikiWritingMode } from "../shared/wiki-knowledge";
import { withWikiSections } from "../shared/wiki-sections";
import { measureAILocalStep, recordAISkippedStep } from "./pipeline-timing";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { writeLedgerDraft } from "./wiki-knowledge-write";
import { cleanWikiDraftDisplay, wikiInternalDraftLabel } from "./wiki-editorial-review";
import { ledgerDocument } from "./wiki-ledger-document";
import { wikiNamedProjects, withAnswersRevisited, withWriterQuestions, withWritingQuestions } from "./wiki-writing-questions";
import { wikiPrewritingProjectQuestions } from "./wiki-project-decisions";

export interface FocusWikiDraftCallbacks {
  onKeyDecisions?: (ledger: WikiKnowledgeLedger) => Promise<WikiKnowledgeLedger>;
  onWritingMode?: (current: WikiWritingMode) => Promise<WikiWritingMode>;
  onPartial?: (session: FocusSession) => void;
  onWritingEvent?: (event: WikiWritingEvent) => void;
}

type DraftContext = Pick<Parameters<typeof writeLedgerDraft>[1], "ai" | "locale" | "signal" | "project" | "previous" | "progress">
  & FocusWikiDraftCallbacks & {
    runId: string;
    originals: ConversationMessage[];
    sources: Conversation[];
    preview: Pick<FocusSession, "goal" | "mode" | "scope" | "locale" | "sourceConversationIds" | "sourceVersionIds" | "sourceSignatures" | "sourceRoles" | "sourceMessageOrder" | "wikiProjectBoundary">;
    title: (ledger: WikiKnowledgeLedger) => string;
  };

/** Generation and updates share the decision prompts, live directory and chapter previews. */
export async function writeFocusWikiDraft(planned: WikiKnowledgeLedger, context: DraftContext) {
  const { ai, signal, locale, runId, originals, project, progress, previous, onKeyDecisions, onPartial } = context;
  const chooseMode = planned.documentType !== "learning" ? context.onWritingMode : undefined;
  const report: Record<string, number> = {};
  const projectUnits = wikiLedgerUnits(planned).filter(unit => !wikiExternalResearch(unit));
  const projectIds = new Set(projectUnits.filter(unit => !unit.about).map(unit => unit.id));
  const competingProjectPlans = planned.organization?.relations.some(relation => relation.status === "unresolved"
    && projectIds.has(relation.older) && projectIds.has(relation.newer))
    || planned.organization?.topics?.some(topic => topic.open && topic.current.filter(id => projectIds.has(id)).length > 1);
  const unconflictedResearch = planned.selectionIntent === "research"
    && planned.documentType !== "learning" && planned.writingMode !== "audit"
    && !planned.userAnswers?.length && !Object.keys(planned.decisions ?? {}).length
    && projectUnits.every(unit => !unit.relation && unit.kind !== "question" && unit.kind !== "history"
      && unit.about?.role !== "other_project" && !["user_adopted", "user_decision", "rejected"].includes(unit.adoption.status)
      && (unit.evidence.role === "user" ? unit.kind !== "constraint" : Boolean(wikiResearchUse(unit)) || unit.kind === "fact"));
  const structuredResearch = planned.status === "complete" && planned.organization
    && (planned.organization.report.source_structure_used || unconflictedResearch)
    && !competingProjectPlans && !wikiPrewritingProjectQuestions(planned, locale === "zh-CN").length;
  const asked = onKeyDecisions && !structuredResearch
    ? await measureAILocalStep(runId, "wiki", "wiki:decision-questions", () => withWritingQuestions(planned, { ai, signal, locale, runId, report }), () => report)
    : planned;
  if (onKeyDecisions && structuredResearch) {
    await recordAISkippedStep(runId, "wiki", "wiki:decision-questions", "Structured research has no unresolved project decisions");
  }
  const questions = onKeyDecisions ? wikiPrewritingProjectQuestions(asked, locale === "zh-CN") : [];
  const names = onKeyDecisions ? wikiNamedProjects(asked) : [];
  const scopeGate = asked.documentType === "learning" || names.some(project => !structuredResearch || project.role === "other_project" || project.excluded)
    || questions.some(item => item.kind === "writing" && item.question.options.some(option => option.actions.some(action => action.do === "owner")));
  const decision = onKeyDecisions && (!structuredResearch || questions.length || scopeGate)
    ? measureAILocalStep(runId, "wiki", "wiki:decision-review", () => onKeyDecisions(asked)) : undefined;
  if (onKeyDecisions && !decision) {
    await recordAISkippedStep(runId, "wiki", "wiki:decision-review", "No project questions or scope choices");
  }
  let organized = withAnswersRevisited(decision ? await decision : asked);
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

  const draft = await writeLedgerDraft(withWikiSections(organized, originals), {
    ai, locale, signal, runId, project, progress, onChapters, onWritingEvent: context.onWritingEvent, previous,
  });
  const { ledger } = withWriterQuestions(draft);
  return { ledger, title: context.title(ledger) };
}
