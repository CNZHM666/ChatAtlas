import type { AtlasCanvas, EvidenceRef } from "../shared/types";
import type { FocusEvidence, FocusSession } from "../shared/focus-session";
import { getDatabase } from "./db";
import { listCards } from "./cards";

/** Open locally saved reading; project navigation never triggers AI. */
export async function projectReader(project: AtlasCanvas): Promise<FocusSession> {
  const db = await getDatabase();
  const saved = (await db.getAllFromIndex("focusSessions", "by-updated")).reverse().filter(session => session.canvasId === project.id);
  const existing = saved.find(session => session.status !== "preview" && session.sections.length) ?? saved.find(session => session.sections.length) ?? saved[0];
  if (existing) return existing;
  const now = Date.now();
  const legacyCards = (await db.getAll("cards")).filter(card => card.canvasId === project.id);
  const hidden = new Set(legacyCards.filter(card => card.ghost || card.kind === "portal").map(card => card.id));
  const legacyById = new Map(legacyCards.map(card => [card.id, card]));
  const cards = (await listCards(project.id)).filter(card => !hidden.has(card.id) && !card.ghost && card.kind !== "portal").map(card => {
    const legacy = legacyById.get(card.id);
    return { ...card, evidenceRefs: card.evidenceRefs ?? legacy?.evidenceRefs, anchorIds: [...new Set([...card.anchorIds, ...(legacy?.anchorIds ?? [])])] };
  });
  const path = project.readingPathCardIds ?? [];
  cards.sort((a, b) => { const ai = path.indexOf(a.id), bi = path.indexOf(b.id); return (ai < 0 ? Infinity : ai) - (bi < 0 ? Infinity : bi) || a.createdAt - b.createdAt; });
  const sourceIds = [...new Set(project.sourceConversationIds ?? cards.flatMap(card => [...card.conversationIds, ...(card.evidenceRefs ?? []).map(ref => ref.conversationId)]))];
  const evidence = new Map<string, FocusEvidence>();
  const sections = await Promise.all(cards.map(async card => {
    const anchors = (await Promise.all(card.anchorIds.map(id => db.get("anchors", id)))).filter(anchor => Boolean(anchor));
    const refs: EvidenceRef[] = [...(card.evidenceRefs ?? []), ...anchors.map(anchor => ({ conversationId: anchor!.conversationId, messageId: anchor!.messageId, excerpt: anchor!.preview }))];
    const ids = refs.filter(ref => Boolean(ref.messageId ?? ref.questionId) && sourceIds.includes(ref.conversationId)).map(ref => {
      const messageId = (ref.messageId ?? ref.questionId)!;
      const id = `legacy:${encodeURIComponent(ref.conversationId)}:${encodeURIComponent(messageId)}`;
      evidence.set(id, { id, conversationId: ref.conversationId, messageId, title: card.title, excerpt: ref.excerpt ?? "" });
      return id;
    });
    return { id: card.id, title: card.title, body: [card.description, card.notes].filter(Boolean).join("\n\n"), transition: "", kind: "review" as const, evidenceIds: [...new Set(ids)], ...(card.origin === "user" ? { origin: "user" as const } : {}) };
  }));
  const session: FocusSession = { id: `project-reader:${project.id}`, canvasId: project.id, status: "ready", goal: project.intent ?? project.title ?? project.name, title: project.title ?? project.name, mode: "review", sourceConversationIds: sourceIds, evidence: [...evidence.values()], sections, activeSectionId: sections[0]?.id ?? "", completedSectionIds: [], notes: "", createdAt: now, updatedAt: now };
  // Don't overwrite an editor opened concurrently in another tab.
  const tx = db.transaction("focusSessions", "readwrite");
  const concurrent = await tx.store.get(session.id);
  if (!concurrent) await tx.store.put(session);
  await tx.done;
  return concurrent ?? session;
}
