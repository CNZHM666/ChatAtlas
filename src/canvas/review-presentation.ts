import type { FocusSession } from "../shared/focus-session";
import { evidencePresentation } from "./evidence-presentation";

/** A complete orientation, never CSS clipping; full text stays in the chapter. */
export function reviewLead(text: string, sentences = 1): string {
  const plain = evidencePresentation(text).replace(/^\s*#{1,6}\s+.*$/gmu, "").replace(/```[\s\S]*?```/gu, "").replace(/!\[[^\]]*\]\([^)]*\)/gu, "").replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+|\d+[.、]\s+)/gmu, "").replace(/[*_`]/gu, "").trim();
  const paragraph = plain.split(/\n\s*\n/u)[0]?.replace(/\s+/gu, " ") ?? "";
  return [...new Intl.Segmenter(undefined, { granularity: "sentence" }).segment(paragraph)].slice(0, sentences).map((item) => item.segment).join("").trim();
}

export function resumeContext(session: FocusSession) {
  const section = session.sections.find((item) => item.id === session.activeSectionId) ?? session.sections[0];
  return { section, question: session.reviewNeeds?.[section?.id], note: session.sectionNotes?.[section?.id]?.deletedAt ? undefined : session.sectionNotes?.[section?.id]?.text };
}

/** Explicit adjacent phases can merge. Legacy groups describe ranges, never guessed relationships. */
export function chronologicalGroups<T extends { id: string; title: string; phase?: string }>(items: T[], zh: boolean): Array<{ id: string; title: string; items: T[] }> {
  const groups: Array<{ id: string; title: string; items: T[] }> = [];
  const hasPhases = items.some((item) => item.phase?.trim());
  for (const item of items) {
    const previous = groups.at(-1);
    const title = item.phase?.trim() || item.title;
    if (hasPhases && previous?.title.normalize("NFKC") === title.normalize("NFKC")) previous.items.push(item);
    else groups.push({ id: item.id, title, items: [item] });
  }
  if (groups.length <= 8) return groups;
  const size = Math.ceil(groups.length / 6);
  return Array.from({ length: Math.ceil(groups.length / size) }, (_, index) => {
    const batch = groups.slice(index * size, (index + 1) * size);
    return { id: batch[0].id, title: zh ? `阶段 ${index + 1}` : `Stage ${index + 1}`, items: batch.flatMap((group) => group.items) };
  });
}
