import { listDeletedProjects } from "./project-deletion";
import { DEFAULT_CANVAS_ID, OVERVIEW_CANVAS_ID } from "../shared/constants";
import type { AISettings, AtlasCanvas, CanvasCard, CanvasMembership, ConversationGraph, KnowledgeCard, KnowledgeProposal, KnowledgeRelation, SourceRelation } from "../shared/types";
import { getDatabase } from "./db";
import { ensureOverviewCanvas } from "./canvases";
import { effectiveAISettings } from "../ai/ai-mode";

const membershipId = (canvasId: string, cardId: string) => `${canvasId}:${cardId}`;
const sourceId = (cardId: string, sourceType: SourceRelation["sourceType"], value: string) => `${cardId}:${sourceType}:${value}`;

export async function ensureKnowledgeMigration(): Promise<void> {
  await ensureOverviewCanvas();
  const db = await getDatabase();
  const legacyCards = await db.getAll("cards");
  const existing = new Set((await db.getAllKeys("knowledgeCards")).map(String));
  if (!legacyCards.some((card) => !existing.has(card.id))) return;
  const tx = db.transaction(["knowledgeCards", "canvasMemberships", "sourceRelations"], "readwrite");
  for (const card of legacyCards) {
    if (existing.has(card.id)) continue;
    const canvasId = card.canvasId ?? DEFAULT_CANVAS_ID;
    const knowledgeCard: KnowledgeCard = {
      id: card.id,
      homeCanvasId: canvasId,
      type: card.kind === "note" || card.kind === "bridge" || card.kind === "insight" || card.kind === "draft" ? card.kind : card.kind === "topic" ? "topic" : "concept",
      title: card.title,
      body: card.description,
      notes: card.notes,
      tags: card.tags ?? [],
      origin: "user",
      userEdited: true,
      createdAt: card.createdAt,
      updatedAt: card.updatedAt,
    };
    await tx.objectStore("knowledgeCards").put(knowledgeCard);
    await tx.objectStore("canvasMemberships").put({
      id: membershipId(canvasId, card.id), canvasId, cardId: card.id, x: card.x, y: card.y,
      userPositioned: Boolean(card.layoutLocked), createdAt: card.createdAt, updatedAt: card.updatedAt,
    });
    for (const conversationId of card.conversationIds.filter((id) => !id.startsWith(`${card.id}-conversation-`))) {
      await tx.objectStore("sourceRelations").put({ id: sourceId(card.id, "conversation", conversationId), cardId: card.id, sourceType: "conversation", sourceId: conversationId, conversationId, createdAt: card.createdAt });
    }
  }
  await tx.done;
}

export async function getAISettings(): Promise<AISettings | undefined> {
  const saved = await (await getDatabase()).get("aiSettings", "ai-settings");
  return saved ? effectiveAISettings(saved) : undefined;
}

export async function saveAISettings(settings: Omit<AISettings, "id" | "updatedAt">): Promise<AISettings> {
  const db = await getDatabase();
  const tx = db.transaction("aiSettings", "readwrite");
  const previous = await tx.store.get("ai-settings");
  const connections = new Map<string, NonNullable<AISettings["connections"]>[number]>();
  for (const item of [...previous?.connections ?? [], ...settings.connections ?? [], previous, settings]) {
    if (!item?.baseUrl || !item.apiKey || !item.model) continue;
    const { provider, baseUrl, apiKey, model, economyModel, embeddingModel, embeddingVersion, streaming } = item;
    const key = JSON.stringify([provider, baseUrl.replace(/\/+$/u, ""), model]);
    connections.delete(key);
    connections.set(key, { provider, baseUrl, apiKey, model, economyModel, embeddingModel, embeddingVersion, streaming });
  }
  const value = effectiveAISettings({ ...settings, connections: [...connections.values()].slice(-12), id: "ai-settings", updatedAt: Date.now() });
  await tx.store.put(value);
  await tx.done;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-ai-settings-changed"));
  return value;
}

/** Same identity saveAISettings uses to deduplicate saved connections. */
export const aiConnectionKey = (connection: Pick<AISettings, "provider" | "baseUrl" | "model">) => JSON.stringify([connection.provider, connection.baseUrl.replace(/\/+$/u, ""), connection.model]);

/** Forget one saved connection and its key. The active connection cannot be removed here. */
export async function removeAIConnection(key: string): Promise<AISettings | undefined> {
  const db = await getDatabase();
  const tx = db.transaction("aiSettings", "readwrite");
  const previous = await tx.store.get("ai-settings");
  if (!previous || aiConnectionKey(previous) === key) { await tx.done; return previous ? effectiveAISettings(previous) : undefined; }
  const value = { ...previous, connections: (previous.connections ?? []).filter(item => aiConnectionKey(item) !== key), updatedAt: Date.now() };
  await tx.store.put(value);
  await tx.done;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("atlas-ai-settings-changed"));
  return effectiveAISettings(value);
}

export async function saveKnowledgeProposal(proposal: KnowledgeProposal): Promise<void> {
  await (await getDatabase()).put("knowledgeProposals", proposal);
}

export async function getLatestKnowledgeProposal(): Promise<KnowledgeProposal | undefined> {
  const values = await (await getDatabase()).getAllFromIndex("knowledgeProposals", "by-updated");
  return values.reverse().find((proposal) => proposal.status === "preview");
}

export async function cancelKnowledgeProposal(id: string): Promise<void> {
  const db = await getDatabase();
  const proposal = await db.get("knowledgeProposals", id);
  if (proposal) await db.put("knowledgeProposals", { ...proposal, status: "cancelled", updatedAt: Date.now() });
}

export async function applyKnowledgeProposal(proposal: KnowledgeProposal, conversationGraphs: ConversationGraph[] = [], expectedGraphUpdatedAt: ReadonlyMap<string, number | undefined> = new Map()): Promise<void> {
  const db = await getDatabase();
  const tx = db.transaction(["canvases", "knowledgeCards", "canvasMemberships", "knowledgeRelations", "sourceRelations", "knowledgeProposals", "conversationGraphs"], "readwrite");
  const conversationGraphChanges: NonNullable<KnowledgeProposal["conversationGraphChanges"]> = [];
  const evidenceRefChanges: NonNullable<KnowledgeProposal["evidenceRefChanges"]> = [];
  const relationChanges: NonNullable<KnowledgeProposal["relationChanges"]> = [];
  const membershipChanges: NonNullable<KnowledgeProposal["membershipChanges"]> = [];
  const refKey = (ref: { conversationId: string; questionId?: string; messageId?: string }) => `${ref.conversationId}:${ref.questionId ?? ""}:${ref.messageId ?? ""}`;
  const previousGraphs = new Map<string, ConversationGraph | undefined>();
  for (const graph of conversationGraphs) {
    const before = await tx.objectStore("conversationGraphs").get(graph.conversationId);
    if (expectedGraphUpdatedAt.has(graph.conversationId) && before?.updatedAt !== expectedGraphUpdatedAt.get(graph.conversationId)) {
      void tx.done.catch(() => undefined);
      tx.abort();
      throw new Error("A conversation canvas changed during organization. Review it before applying.");
    }
    previousGraphs.set(graph.conversationId, before);
  }
  for (const canvas of proposal.canvases) {
    const current = await tx.objectStore("canvases").get(canvas.id);
    if (current?.userEdited || current?.origin === "user") continue;
    const value: AtlasCanvas = { ...canvas, name: canvas.title };
    await tx.objectStore("canvases").put(value);
  }
  for (const update of proposal.scopeUpdates ?? []) {
    const current = await tx.objectStore("canvases").get(update.canvasId);
    if (!current || current.updatedAt !== update.baselineUpdatedAt) {
      void tx.done.catch(() => undefined);
      tx.abort();
      throw new Error("The Knowledge Space changed during organization. Review its sources before applying.");
    }
    await tx.objectStore("canvases").put({ ...current, intent: update.intent, sourceConversationIds: update.sourceConversationIds, readingPathCardIds: current.readingPathUserEdited ? current.readingPathCardIds : update.readingPathCardIds, updatedAt: Date.now() });
  }
  for (const card of proposal.cards) {
    const current = await tx.objectStore("knowledgeCards").get(card.id);
    if (current?.userEdited || current?.origin === "user" || current?.origin === "user_modified") continue;
    await tx.objectStore("knowledgeCards").put({ ...current, ...card });
  }
  for (const membership of proposal.memberships) {
    const current = await tx.objectStore("canvasMemberships").get(membership.id);
    membershipChanges.push({ id: membership.id, before: current });
    if (current?.userPositioned) await tx.objectStore("canvasMemberships").put({ ...membership, x: current.x, y: current.y, userPositioned: true });
    else await tx.objectStore("canvasMemberships").put(membership);
  }
  for (const relation of proposal.relations) {
    const current = await tx.objectStore("knowledgeRelations").get(relation.id);
    if (current?.userRejected || current?.status === "rejected" || current?.userEdited) continue;
    if (relation.status !== "proposed_low_confidence" && !relation.proposedLowConfidence && relation.evidenceRefs.length) {
      relationChanges.push({ id: relation.id, before: current });
      await tx.objectStore("knowledgeRelations").put({ ...current, ...relation, status: "accepted" });
    }
  }
  for (const source of proposal.sources) await tx.objectStore("sourceRelations").put(source);
  for (const update of proposal.evidenceUpdates ?? []) {
    const current = await tx.objectStore("knowledgeCards").get(update.cardId);
    if (!current) continue;
    const existing = new Set((current.evidenceRefs ?? []).map(refKey));
    const added = update.refs.filter((ref) => !existing.has(refKey(ref)));
    if (!added.length) continue;
    evidenceRefChanges.push({ cardId: update.cardId, refs: added });
    await tx.objectStore("knowledgeCards").put({ ...current, evidenceRefs: [...(current.evidenceRefs ?? []), ...added], updatedAt: Date.now() });
  }
  for (const graph of conversationGraphs) {
    const before = previousGraphs.get(graph.conversationId);
    const appliedAt = Date.now();
    conversationGraphChanges.push({ conversationId: graph.conversationId, before, appliedAt });
    await tx.objectStore("conversationGraphs").put({ ...graph, updatedAt: appliedAt });
  }
  await tx.objectStore("knowledgeProposals").put({ ...proposal, status: "applied", conversationGraphChanges, evidenceRefChanges, relationChanges, membershipChanges, updatedAt: Date.now() });
  await tx.done;
}

export async function undoKnowledgeProposal(id: string): Promise<void> {
  const db = await getDatabase();
  const proposal = await db.get("knowledgeProposals", id);
  if (!proposal || proposal.status !== "applied") return;
  const tx = db.transaction(["canvases", "knowledgeCards", "canvasMemberships", "knowledgeRelations", "sourceRelations", "knowledgeProposals", "conversationGraphs"], "readwrite");
  const proposalMembershipIds = new Set(proposal.memberships.map((membership) => membership.id));
  const refKey = (ref: { conversationId: string; questionId?: string; messageId?: string }) => `${ref.conversationId}:${ref.questionId ?? ""}:${ref.messageId ?? ""}`;
  for (const change of proposal.evidenceRefChanges ?? []) {
    const current = await tx.objectStore("knowledgeCards").get(change.cardId);
    if (!current) continue;
    const added = new Set(change.refs.map(refKey));
    await tx.objectStore("knowledgeCards").put({ ...current, evidenceRefs: current.evidenceRefs?.filter((ref) => !added.has(refKey(ref))), updatedAt: Date.now() });
  }
  for (const change of proposal.relationChanges ?? proposal.relations.map((relation) => ({ id: relation.id, before: undefined }))) {
    const current = await tx.objectStore("knowledgeRelations").get(change.id);
    if (!current || current.userEdited || current.userRejected) continue;
    if (change.before) await tx.objectStore("knowledgeRelations").put(change.before);
    else await tx.objectStore("knowledgeRelations").delete(change.id);
  }
  for (const source of proposal.sources) await tx.objectStore("sourceRelations").delete(source.id);
  for (const change of proposal.membershipChanges ?? proposal.memberships.map((membership) => ({ id: membership.id, before: undefined }))) {
    const current = await tx.objectStore("canvasMemberships").get(change.id);
    if (!current || current.userPositioned) continue;
    if (change.before) await tx.objectStore("canvasMemberships").put(change.before);
    else await tx.objectStore("canvasMemberships").delete(change.id);
  }
  for (const card of proposal.cards) {
    const current = await tx.objectStore("knowledgeCards").get(card.id);
    const memberships = await tx.objectStore("canvasMemberships").index("by-card").getAll(card.id);
    const hasMembershipOutsideBatch = memberships.some((membership) => !proposalMembershipIds.has(membership.id));
    if (current && !current.userEdited && current.origin === "ai" && !hasMembershipOutsideBatch) await tx.objectStore("knowledgeCards").delete(card.id);
  }
  for (const canvas of proposal.canvases) {
    const current = await tx.objectStore("canvases").get(canvas.id);
    const memberships = await tx.objectStore("canvasMemberships").index("by-canvas").getAll(canvas.id);
    if (current && !current.userEdited && !memberships.length) await tx.objectStore("canvases").delete(canvas.id);
  }
  for (const update of proposal.scopeUpdates ?? []) {
    const current = await tx.objectStore("canvases").get(update.canvasId);
    if (current && !current.userEdited && current.intent === update.intent && JSON.stringify(current.sourceConversationIds) === JSON.stringify(update.sourceConversationIds)) {
      await tx.objectStore("canvases").put({
        ...current,
        intent: update.before?.intent,
        sourceConversationIds: update.before?.sourceConversationIds,
        readingPathCardIds: current.readingPathUserEdited ? current.readingPathCardIds : update.before?.readingPathCardIds,
        updatedAt: Date.now(),
      });
    }
  }
  for (const change of proposal.conversationGraphChanges ?? []) {
    const current = await tx.objectStore("conversationGraphs").get(change.conversationId);
    if (!current || current.updatedAt !== change.appliedAt || current.userEdited) continue;
    if (change.before) await tx.objectStore("conversationGraphs").put(change.before);
    else await tx.objectStore("conversationGraphs").delete(change.conversationId);
  }
  await tx.objectStore("knowledgeProposals").put({ ...proposal, status: "cancelled", updatedAt: Date.now() });
  await tx.done;
}

export async function listAllKnowledgeCards(): Promise<KnowledgeCard[]> {
  await ensureKnowledgeMigration();
  return (await getDatabase()).getAll("knowledgeCards");
}

export async function listAllMemberships(): Promise<CanvasMembership[]> {
  await ensureKnowledgeMigration();
  return (await getDatabase()).getAll("canvasMemberships");
}

export async function listAllKnowledgeRelations(): Promise<KnowledgeRelation[]> {
  return (await getDatabase()).getAll("knowledgeRelations");
}

export async function listAllSourceRelations(): Promise<SourceRelation[]> {
  return (await getDatabase()).getAll("sourceRelations");
}

export async function listSearchableKnowledgeCards(): Promise<CanvasCard[]> {
  const deleted = new Set((await listDeletedProjects()).map(project => project.id));
  const [cards, memberships, sources] = await Promise.all([listAllKnowledgeCards(), listAllMemberships(), listAllSourceRelations()]);
  const membershipByCard = new Map<string, typeof memberships[number]>();
  for (const membership of memberships) if (!deleted.has(membership.canvasId) && !membershipByCard.has(membership.cardId)) membershipByCard.set(membership.cardId, membership);
  const sourcesByCard = new Map<string, string[]>();
  for (const source of sources) if (source.sourceType === "conversation") {
    const ids = sourcesByCard.get(source.cardId) ?? [];
    ids.push(source.conversationId); sourcesByCard.set(source.cardId, ids);
  }
  const deletedMemberships = new Set(memberships.filter(item => deleted.has(item.canvasId)).map(item => item.cardId));
  return cards.filter(card => membershipByCard.has(card.id) || (card.homeCanvasId ? !deleted.has(card.homeCanvasId) : !deletedMemberships.has(card.id))).map((card) => {
    const membership = membershipByCard.get(card.id);
    return {
      id: card.id, canvasId: membership?.canvasId ?? card.homeCanvasId ?? OVERVIEW_CANVAS_ID, kind: card.type,
      title: card.title, description: card.body, notes: card.notes, tags: card.tags, anchorIds: [], evidenceRefs: card.evidenceRefs,
      conversationIds: sourcesByCard.get(card.id) ?? [],
      x: membership?.x ?? 0, y: membership?.y ?? 0, createdAt: card.createdAt, updatedAt: card.updatedAt,
      origin: card.origin, userEdited: card.userEdited, homeCanvasId: card.homeCanvasId,
    };
  });
}

export interface OverviewDomain {
  canvasId: string;
  cardCount: number;
  sourceCount: number;
}

export interface OverviewLink { fromCanvasId: string; toCanvasId: string; strength: number }

export async function getKnowledgeOverview(): Promise<{ domains: OverviewDomain[]; links: OverviewLink[] }> {
  const [allMemberships, relations, sources, deletedProjects] = await Promise.all([listAllMemberships(), listAllKnowledgeRelations(), listAllSourceRelations(), listDeletedProjects()]);
  const deleted = new Set(deletedProjects.map(project => project.id));
  const memberships = allMemberships.filter(item => !deleted.has(item.canvasId));
  const cardCanvases = new Map<string, string[]>();
  for (const membership of memberships) cardCanvases.set(membership.cardId, [...cardCanvases.get(membership.cardId) ?? [], membership.canvasId]);
  const domains = [...new Set(memberships.map((item) => item.canvasId))].filter((id) => id !== OVERVIEW_CANVAS_ID).map((canvasId) => {
    const cardIds = new Set(memberships.filter((item) => item.canvasId === canvasId).map((item) => item.cardId));
    return { canvasId, cardCount: cardIds.size, sourceCount: new Set(sources.filter((source) => cardIds.has(source.cardId)).map((source) => source.conversationId)).size };
  });
  const strengths = new Map<string, number>();
  for (const relation of relations.filter((item) => item.status === "accepted")) {
    for (const from of cardCanvases.get(relation.fromCardId) ?? []) for (const to of cardCanvases.get(relation.toCardId) ?? []) {
      if (from === to) continue;
      const key = [from, to].sort().join("|");
      strengths.set(key, (strengths.get(key) ?? 0) + 1);
    }
  }
  const links = [...strengths].map(([key, strength]) => { const [fromCanvasId, toCanvasId] = key.split("|"); return { fromCanvasId, toCanvasId, strength }; }).sort((a, b) => b.strength - a.strength).slice(0, 12);
  return { domains, links };
}
