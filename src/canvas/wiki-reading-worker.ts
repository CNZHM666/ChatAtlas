import type { FocusSession } from "../shared/focus-session";
import { projectKnowledgeReading, projectKnowledgeReadingContext } from "../shared/project-knowledge-view";
import { projectTimeline, type ProjectMilestone } from "../shared/project-timeline";
import { projectWikiPages, type ProjectWikiPages } from "./project-wiki-pages";

export type WikiReadingProjection = {
  context: ReturnType<typeof projectKnowledgeReadingContext>;
  chapter: ReturnType<typeof projectKnowledgeReading> | undefined;
};
export type WikiReadingRequest = { session: FocusSession } & ({ target: "chapter" | "timeline" } | { target: "pages"; zh: boolean });

const worker = globalThis as unknown as {
  postMessage(result: WikiReadingProjection | ProjectMilestone[] | ProjectWikiPages): void;
  onmessage: ((event: MessageEvent<WikiReadingRequest>) => void) | null;
};

worker.onmessage = ({ data: request }) => {
  const { session, target } = request;
  if (target === "pages") {
    worker.postMessage(projectWikiPages(session, request.zh));
    return;
  }
  if (target === "timeline") {
    worker.postMessage(projectTimeline(session));
    return;
  }
  const context = projectKnowledgeReadingContext(session);
  const chapter = context.chapters.find(chapter => chapter.id === session.activeSectionId);
  worker.postMessage({ context, chapter: chapter && projectKnowledgeReading(chapter, session, context.view, context.chapters, true) });
};
