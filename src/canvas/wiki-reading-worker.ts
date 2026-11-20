import type { FocusSession } from "../shared/focus-session";
import { projectKnowledgeReading, projectKnowledgeReadingContext } from "../shared/project-knowledge-view";
import { projectWikiPage, type ProjectWikiPages, type WikiPageTarget } from "./project-wiki-pages";

export type WikiReadingProjection = {
  context: ReturnType<typeof projectKnowledgeReadingContext>;
  chapter: ReturnType<typeof projectKnowledgeReading> | undefined;
};
export type WikiReadingRequest = { session: FocusSession } & ({ target: "chapter" } | { target: WikiPageTarget; zh: boolean });

const worker = globalThis as unknown as {
  postMessage(result: WikiReadingProjection | Partial<ProjectWikiPages>): void;
  onmessage: ((event: MessageEvent<WikiReadingRequest>) => void) | null;
};

worker.onmessage = ({ data: request }) => {
  const { session, target } = request;
  if (target !== "chapter") {
    worker.postMessage(projectWikiPage(session, request.zh, target));
    return;
  }
  const context = projectKnowledgeReadingContext(session);
  const chapter = context.chapters.find(chapter => chapter.id === session.activeSectionId);
  worker.postMessage({ context, chapter: chapter && projectKnowledgeReading(chapter, session, context.view, context.chapters, true) });
};
