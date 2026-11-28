import { planWikiTopics, previousWikiDirectory } from "../ai/wiki-topic-plan";
import type { AtlasAI } from "../ai/atlas-ai";
import type { FocusSection, FocusSession } from "../shared/focus-session";
import { continuationTextKey, replaceableContinuation } from "../shared/project-continuation";
import { applyWikiDirectory, type DirectoryPage } from "../shared/wiki-directory";
import { remapWikiSectionReferences } from "../shared/wiki-topic-merge";
import type { ProjectChange } from "./project-increment";
import { changeDirectoryId, minimumChapterNotes } from "./project-update-state";

export async function planProjectDirectory(project: FocusSession, changes: ProjectChange[], locale: "zh-CN" | "en", ai: AtlasAI, signal: AbortSignal, conversationCount: number, onStart?: () => void): Promise<DirectoryPage[]> {
  const pending = changes.flatMap((item, index) => item.target || item.appendTo || item.kind === "open_question" ? [] : [{
    id: changeDirectoryId(index), title: item.title, body: item.text, transition: "", evidenceIds: [], kind: item.kind,
  }]);
  if (!pending.length) return [];
  const mentioned = new Set(changes.flatMap(item => item.target ? [item.target] : []));
  const existing = project.sections.filter(section => section.continuationLoose && section.kind !== "open_question" &&
    replaceableContinuation(section) && !project.wikiSuggestions?.[section.id] && !mentioned.has(section.id)).slice(-24);
  const catalogue: FocusSection[] = [
    ...existing.map(section => ({ ...section, continuation: undefined, continuationLoose: undefined })),
    ...pending,
  ];
  if (catalogue.length < minimumChapterNotes) return [];
  onStart?.();
  const chapters = project.sections.filter(section => !section.continuationLoose);
  const planned = await planWikiTopics(catalogue, locale, ai, signal, undefined, {
    conversations: conversationCount, documentNames: [project.title],
    previousDirectory: previousWikiDirectory({ ...project, sections: chapters }),
  });
  const allowed = new Set(catalogue.map(section => section.id));
  const fresh = new Set(pending.map(section => section.id));
  const titles = new Set(chapters.flatMap(section => [section.title, section.wikiDisplayTitle ?? section.title]).map(continuationTextKey));
  return planned.flatMap(page => {
    const sectionIds = [...new Set(page.sectionIds)].filter(id => allowed.has(id));
    const title = continuationTextKey(page.title);
    if (sectionIds.length < minimumChapterNotes || !sectionIds.some(id => fresh.has(id)) || titles.has(title)) return [];
    sectionIds.forEach(id => allowed.delete(id));
    titles.add(title);
    return [{ ...page, sectionIds, subtopics: undefined, ownerId: undefined }];
  });
}

export function applyProjectDirectory(project: FocusSession, directory: readonly DirectoryPage[], selectedIds: ReadonlyMap<string, string>) {
  if (!directory.length) return project;
  const aliases = new Map<string, string>();
  const moved = new Set<string>();
  const appended: FocusSection[] = [];
  for (const page of directory) {
    if (!page.sectionIds.some(id => selectedIds.has(id))) continue;
    const ids = new Set(page.sectionIds.map(id => selectedIds.get(id) ?? id));
    const originals = project.sections.filter(section => ids.has(section.id) && section.continuationLoose && replaceableContinuation(section) && !moved.has(section.id));
    if (originals.length < minimumChapterNotes) continue;
    const sectionIds = originals.map(section => section.id);
    const [section] = applyWikiDirectory(originals, [{ ...page, sectionIds }]);
    appended.push({ ...section, continuation: true, continuationLoose: undefined, body: originals.map(item => item.body.trim()).filter(Boolean).join("\n\n") });
    for (const original of originals) {
      moved.add(original.id);
      if (original.id !== section.id) aliases.set(original.id, section.id);
    }
  }
  if (!appended.length) return project;
  const next = [...project.sections.filter(section => !moved.has(section.id)), ...appended];
  const updated = aliases.size ? remapWikiSectionReferences(project, next, aliases) : { ...project, sections: next };
  const order = project.wikiOrder ?? project.sections.map(section => section.id);
  return { ...updated, updatedAt: project.updatedAt, wikiOrder: [...order.filter(id => !moved.has(id)), ...appended.map(section => section.id)],
    continuationUpdate: updated.continuationUpdate && { ...updated.continuationUpdate,
    sectionIds: [...new Set(updated.continuationUpdate.sectionIds?.map(id => aliases.get(id) ?? id))] }, wikiOverview: undefined };
}
