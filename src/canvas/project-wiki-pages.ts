import { wikiDraftOutOfPlace } from "../ai/wiki-draft-fit";
import { ledgerDecisionsPending, wikiDecisionQuestions } from "../ai/wiki-key-decisions";
import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import type { FocusSession } from "../shared/focus-session";
import { projectOverviewContent, projectOverviewReadingText } from "../shared/project-overview";
import { projectTimeline } from "../shared/project-timeline";
import type { WikiUnitStatus } from "../shared/wiki-knowledge";
import { documentEvidenceReview } from "./document-review";
import { approximatePoints } from "./wiki-evidence";

type Reading = ReturnType<typeof resolveWikiReading>;

export function projectOverviewPage(session: FocusSession, zh: boolean, preview = false, reading?: Reading) {
  const overview = projectOverviewContent(session, reading);
  const readingText = projectOverviewReadingText(session, overview);
  const references = session.evidence.filter(ref => overview.evidenceIds.includes(ref.id));
  const personal = session.briefUserEdited || session.projectMaintenance?.overview !== undefined;
  const points = personal || preview ? [] : approximatePoints("overview", references, readingText, zh, 12);
  return { overview, readingText, references, points: points.length || personal || preview
    ? points : approximatePoints("overview", session.evidence, readingText, zh, 12) };
}

export function projectLedgerPage(session: FocusSession, zh: boolean, reading?: Reading) {
  const ledger = session.wikiKnowledge;
  if (!ledger?.organization) return;
  const resolved = reading ?? resolveWikiReading(ledger);
  const { organization, statuses } = resolved;
  if (!organization) return;
  const merged = new Set(organization.merged.flatMap(row => row.from));
  const byId = new Map(resolved.units.filter(unit => !merged.has(unit.id)).map(unit => [unit.id, unit]));
  const subjects = new Map(organization.subjects.map(subject => [subject.id, subject]));
  const chapters = organization.chapters.map(chapter => ({
    id: chapter.id,
    title: chapter.title,
    rows: chapter.subtopics.flatMap(topic => topic.subjectIds).flatMap(id => {
      const subject = subjects.get(id);
      return subject?.unitIds.flatMap(id => {
        const unit = byId.get(id);
        return unit ? [{ subject: subject.name, unit, search: `${unit.statement} ${unit.subject}`.toLocaleLowerCase() }] : [];
      }) ?? [];
    }),
  }));
  const unitIds = new Set(organization.subjects.flatMap(subject => subject.unitIds).filter(id => byId.has(id)));
  const counts = new Map<WikiUnitStatus, number>();
  for (const id of unitIds) {
    const status = statuses.get(id);
    if (status) counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  return { chapters, statuses, total: unitIds.size, counts,
    misplaced: wikiDraftOutOfPlace(ledger, resolved), pending: ledgerDecisionsPending(ledger),
    questions: wikiDecisionQuestions(ledger, zh) };
}

export function projectWikiPages(session: FocusSession, zh: boolean) {
  const reading = session.wikiKnowledge && resolveWikiReading(session.wikiKnowledge);
  return {
    overview: projectOverviewPage(session, zh, false, reading),
    review: documentEvidenceReview(session, zh),
    ledger: projectLedgerPage(session, zh, reading),
    milestones: projectTimeline(session, reading),
  };
}
export type ProjectWikiPages = ReturnType<typeof projectWikiPages>;
