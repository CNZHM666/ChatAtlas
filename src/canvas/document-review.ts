import type { FocusSession } from "../shared/focus-session";
import { projectKnowledgeReading, projectKnowledgeReadingContext } from "../shared/project-knowledge-view";
import { wikiBlocks, type WikiBlockIssue } from "../shared/wiki-explanations";
import { wikiChapterEvidencePoints } from "./wiki-evidence";
import { needsConfirmation } from "./workspace-evidence-context";
import { wikiChapterPage } from "./wiki-document";

type ChapterReviewCount = { sectionId: string; count: number };
const evidenceReviewCache = new WeakMap<FocusSession, Map<boolean, ChapterReviewCount[]>>();

export function documentEvidenceReview(session: FocusSession, zh: boolean): ChapterReviewCount[] {
  const cache = evidenceReviewCache.get(session) ?? new Map<boolean, ChapterReviewCount[]>();
  const existing = cache.get(zh);
  if (existing) return existing;
  if (!session.wikiKnowledge?.draft && !session.sections.some(section => section.claims?.some(claim => !claim.checked && !claim.markOnly))) return [];
  const { view, chapters } = projectKnowledgeReadingContext(session);
  const review = chapters.flatMap(section => {
    if (!section.claims?.some(claim => !claim.checked && !claim.markOnly)) return [];
    const reading = projectKnowledgeReading(section, session, view, chapters, true);
    const page = wikiChapterPage(reading, session.evidence);
    const count = wikiChapterEvidencePoints({ ...reading, body: page.body }, session.evidence, zh).filter(needsConfirmation).length;
    return count ? [{ sectionId: section.id, count }] : [];
  });
  cache.set(zh, review);
  evidenceReviewCache.set(session, cache);
  return review;
}

const LABELS: Record<WikiBlockIssue["code"], [string, string]> = {
  duplicate_explanation: ["和前文讲的是同一件事", "Says again what an earlier paragraph says"],
  duplicate_with_extra: ["和前文重复，只多了一点内容", "Repeats an earlier paragraph with a little more"],
  unsupported_status: ["把没有确认的建议写成了已决定", "Presents an unconfirmed suggestion as decided"],
  unbound_decision: ["写了决定，但没有标出处", "States a decision without a source"],
  retired_as_current: ["把被替换的旧方案写成了现行方案", "Presents a replaced plan as current"],
};
export const issueLabel = (issue: WikiBlockIssue, zh: boolean) => LABELS[issue.code][zh ? 0 : 1];

/** The paragraph text an issue points at, for finding it in the rendered chapter. */
export function issueBlockText(session: FocusSession, issue: WikiBlockIssue): string | undefined {
  const section = session.sections.find(item => item.id === issue.sectionId);
  return section ? wikiBlocks(section).find(block => block.id === issue.blockId)?.text : undefined;
}
