import type { FocusSection, FocusSession } from "../shared/focus-session";
import type { ProjectReadingCache } from "../shared/project-reading-cache";
import { projectKnowledgeReading, projectKnowledgeReadingContext } from "../shared/project-knowledge-view";
import { wikiHistoryEntries } from "../shared/wiki-history";
import { wikiChapterPage } from "./wiki-document";
import { wikiApproximatePoints, wikiChapterEvidencePoints, wikiHistoryPoints } from "./wiki-evidence";

/** Precomputes a chapter's reading projection, page model, history and evidence points into the shared cache. */
export function warmWikiChapterCache(cache: ProjectReadingCache, session: FocusSession, section: FocusSection, zh: boolean) {
  if (cache.has(session, `chapter-points:${section.id}:${zh}`)) return;
  const reading = cache.get(session, `chapter:${section.id}`, () => {
    if (section.userEdited || section.origin) return section;
    const context = cache.get(session, "chapter-context", () => projectKnowledgeReadingContext(session));
    return projectKnowledgeReading(context.chapters.find(chapter => chapter.id === section.id) ?? section, session, context.view, context.chapters, true);
  });
  const page = cache.get(session, `chapter-page:${section.id}`, () => wikiChapterPage(reading, session.evidence));
  const generated = !section.userEdited && !section.origin;
  if (!generated) return;
  const history = cache.get(session, `chapter-history:${section.id}`, () => wikiHistoryEntries(session, section));
  const historyPoints = wikiHistoryPoints(section, history, session.evidence, zh);
  cache.get(session, `chapter-points:${section.id}:${zh}`, () => {
    const claims = wikiChapterEvidencePoints({ ...reading, body: page.body }, session.evidence, zh);
    const prose = claims.length ? claims : wikiApproximatePoints(reading, session.evidence, reading.body, zh);
    return [...prose, ...historyPoints.points];
  });
}
