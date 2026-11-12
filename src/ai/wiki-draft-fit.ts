import type { WikiKnowledgeLedger } from "../shared/wiki-knowledge";
import { curateWikiUnits } from "./wiki-knowledge-select";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { ledgerDecisionsPending } from "./wiki-key-decisions";

/** A paragraph the writer did not place by its points' home: a source block shown beside the claim it backs, and
 * earlier versions told with what holds now, may sit in another chapter than their points. */
const PLACED_ELSEWHERE = /^\s*\*(?:讨论中的原文(?:表格|代码)|(?:Table|Code) from the discussion) · /u;
const EARLIER = /^(?:早先版本|Earlier versions)$/u;

/** Chapters of the draft written for another layout than the organization's now:
 * - a prose paragraph each of whose points the writer would now file under another chapter (「首页设计为“AI Agent指挥
 *   台……”」 under 干预机制 → 紧急求助 while both its points sit in 界面设计 → 首页布局), none of them a version of a thing
 *   settled more than once;
 * - a chapter the organization no longer has, or one it has and the draft lacks.
 * The writer files each point at its home (its subject, or its explanation group's) in the layout as it reads it, so a draft written for this
 * layout has none; one kept while the layout changed reads its points in the wrong place until those chapters are
 * written again. Returns the titles of the chapters to write again, in the organization's order. */
export function wikiDraftOutOfPlace(stored: WikiKnowledgeLedger | undefined): string[] {
  const draft = stored?.draft;
  if (!stored?.organization || !draft?.chapters.length) return [];
  // The layout as the writer reads it: points a broad subject carried into the wrong chapter are filed by their kind.
  const { ledger, statuses } = resolveWikiReading(stored), organization = ledger.organization!, view = curateWikiUnits(ledger, statuses);
  const chapterOfSubject = new Map(organization.chapters.flatMap(chapter => chapter.subtopics.flatMap(topic => topic.subjectIds.map(id => [id, chapter.id] as const))));
  const subjectOf = new Map(organization.subjects.flatMap(subject => subject.unitIds.map(id => [id, subject.id] as const)));
  const chapterOf = (id: string) => chapterOfSubject.get(view.home.get(id) ?? subjectOf.get(id) ?? "");
  const versions = new Set((organization.topics ?? []).flatMap(topic => [...topic.current, ...topic.earlier]));
  const drafted = new Set(draft.chapters.map(chapter => chapter.id)), planned = new Set(organization.chapters.map(chapter => chapter.id));
  const out = new Set(organization.chapters.filter(chapter => !drafted.has(chapter.id)).map(chapter => chapter.id));
  for (const chapter of draft.chapters) {
    if (!planned.has(chapter.id)) { out.add(chapter.id); continue; }
    if (chapter.paragraphs.some(paragraph => {
      if (EARLIER.test(paragraph.subtopic) || PLACED_ELSEWHERE.test(paragraph.text) || paragraph.unitIds.some(id => versions.has(id))) return false;
      const placed = paragraph.unitIds.flatMap(id => chapterOf(id) ?? []);
      return placed.length > 0 && !placed.includes(chapter.id);
    })) out.add(chapter.id);
  }
  const titles = new Map([...draft.chapters, ...organization.chapters].map(chapter => [chapter.id, chapter.title]));
  return [...new Set([...organization.chapters, ...draft.chapters].map(chapter => chapter.id).filter(id => out.has(id)))].map(id => titles.get(id) ?? id);
}

/** The document is behind its ledger: verdicts given since it was written, or chapters written for another layout. */
export function ledgerRewriteNeeded(ledger: WikiKnowledgeLedger | undefined): boolean {
  return ledgerDecisionsPending(ledger) || wikiDraftOutOfPlace(ledger).length > 0;
}
