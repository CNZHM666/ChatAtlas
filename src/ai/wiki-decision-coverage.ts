import { claimSupported } from "./wiki-claim-support";
import { wikiUnitHome } from "./wiki-unit-routing";
import { assistantRequest, personalDirection, statesCore, type WikiDraftChapter, type WikiKnowledgeOrganization, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";

/** The user's own direction (personalDirection) is not the project's, confirmed or not: restored, it was listed among the
 * project's decisions beside 第一版禁止 STM32. */
/** A citation alone does not cover a decision. It must have a sentence of its
 * own that can carry its own adoption and source, apart from proposed details. */
export function ensureWikiDecisions(chapters: WikiDraftChapter[], organization: WikiKnowledgeOrganization, units: WikiKnowledgeUnit[], statuses: Map<string, WikiUnitStatus>): number {
  const live = new Set(organization.subjects.flatMap(subject => subject.unitIds));
  let restored = 0;
  for (const unit of units) {
    if (!live.has(unit.id) || unit.about || statuses.get(unit.id) !== "confirmed" || assistantRequest(unit.statement) || personalDirection(unit.statement)) continue;
    const covered = chapters.flatMap(chapter => chapter.paragraphs).flatMap(paragraph => paragraph.claims ?? []).find(claim => claim.unitIds.includes(unit.id)
      && claimSupported(claim.text, [unit]) && statesCore(unit.statement, claim.text) && claim.unitIds.every(id => statuses.get(id) === "confirmed"));
    if (covered) { if (covered.markOnly) { delete covered.markOnly; restored++; } continue; }
    const home = wikiUnitHome(organization, unit), chapter = chapters.find(chapter => chapter.id === home?.id);
    if (!chapter?.paragraphs.length) continue; // A failed chapter remains a failed chapter.
    const topic = home!.subtopics.find(topic => topic.subjectIds.some(id => organization.subjects.find(subject => subject.id === id)?.unitIds.includes(unit.id)))?.title ?? chapter.paragraphs[0].subtopic;
    const text = unit.statement.trim(), paragraph = { subtopic: topic, text, unitIds: [unit.id], claims: [{ text, unitIds: [unit.id] }] };
    const last = chapter.paragraphs.map(paragraph => paragraph.subtopic).lastIndexOf(topic);
    chapter.paragraphs.splice(last < 0 ? chapter.paragraphs.length : last + 1, 0, paragraph);
    const heading = `### ${topic}`, at = chapter.body.indexOf(heading), next = at < 0 ? -1 : chapter.body.indexOf("\n### ", at + heading.length);
    if (at < 0) chapter.body += `\n\n${heading}\n\n${text}`;
    else if (next < 0) chapter.body += `\n\n${text}`;
    else chapter.body = `${chapter.body.slice(0, next).trimEnd()}\n\n${text}\n${chapter.body.slice(next)}`;
    restored++;
  }
  return restored;
}

/** A legacy merge must not hide the only explicit adoption behind an unconfirmed
 * canonical wording. Re-expose that point without deleting either source. */
export function preserveMergedWikiDecisions(organization: WikiKnowledgeOrganization, statuses: Map<string, WikiUnitStatus>, report: Record<string, number>): WikiKnowledgeOrganization {
  const restore = new Map(organization.merged.flatMap(row => row.from.filter(id => statuses.get(id) === "confirmed" && statuses.get(row.id) !== "confirmed").map(id => [id, row.id] as const)));
  if (!restore.size) return organization;
  const subjects = organization.subjects.map(subject => ({ ...subject, unitIds: [...subject.unitIds, ...[...restore].filter(([, into]) => subject.unitIds.includes(into)).map(([id]) => id)] }));
  report.confirmed_merge_restored = restore.size;
  return { ...organization, subjects, merged: organization.merged.map(row => ({ ...row, from: row.from.filter(id => !restore.has(id)) })) };
}
