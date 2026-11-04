import type { FocusSection } from "../shared/focus-session";
import type { RouteCardDraft } from "./components/FocusUnderstandingPath";

export function removePersonalRouteCard(sections: FocusSection[], id: string): FocusSection[] {
  if (sections.find(section => section.id === id)?.origin !== "user") throw new Error("Only personal cards can be deleted");
  return sections.filter(section => section.id !== id).map(section => ({ ...section, understandingLinks: section.understandingLinks?.filter(link => link.targetId !== id) }));
}

export function moveRouteCard(sections: FocusSection[], id: string, before?: string): FocusSection[] {
  const item = sections.find(section => section.id === id);
  if (!item) throw new Error("Route card no longer exists");
  if (id === before) return sections;
  const next = sections.filter(section => section.id !== id);
  const index = before === undefined ? next.length : next.findIndex(section => section.id === before);
  if (index < 0) throw new Error("Route position no longer exists");
  next.splice(index, 0, item);
  return next.map((section, position) => sections[sections.indexOf(section) + 1]?.id === next[position + 1]?.id ? section : { ...section, transition: "" });
}

export function saveRouteCard(sections: FocusSection[], draft: RouteCardDraft): FocusSection[] {
  if (!draft.title.trim()) throw new Error("Card title is required");
  const existing = sections.find(section => section.id === draft.id);
  const metadata = { phase: draft.phase === undefined ? existing?.phase : draft.phase.trim() || undefined, responsibility: draft.responsibility === undefined ? existing?.responsibility : draft.responsibility.trim() || undefined, understandingLinks: draft.links === undefined ? existing?.understandingLinks : draft.links.filter(link => link.targetId !== draft.id && sections.some(section => section.id === link.targetId)) };
  const textEdited = existing && (existing.title !== draft.title || existing.body !== draft.body || existing.transition !== draft.transition || existing.phase !== metadata.phase);
  const structureEdited = existing?.structureEdited || metadata.responsibility !== existing?.responsibility || JSON.stringify(metadata.understandingLinks ?? []) !== JSON.stringify(existing?.understandingLinks ?? []);
  if (existing) return sections.map(section => section.id === draft.id ? { ...section, ...metadata, title: draft.title, body: draft.body, transition: draft.transition, userEdited: existing.userEdited || Boolean(textEdited), structureEdited } : section);
  const card: FocusSection = { id: draft.id, title: draft.title, body: draft.body, transition: draft.transition, ...metadata, evidenceIds: [], kind: "review", origin: "user", userEdited: true };
  return moveRouteCard([...sections, card], card.id, draft.before).map(section => section.id === card.id ? card : section);
}
