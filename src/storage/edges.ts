import type { CanvasEdge, KnowledgeRelation, KnowledgeRelationType } from "../shared/types";
import { DEFAULT_CANVAS_ID } from "../shared/constants";
import { getDatabase } from "./db";
import { ensureKnowledgeMigration } from "./knowledge-graph";

const portalCardId = (value: string) => value.startsWith("portal:");

export async function listEdges(canvasId: string): Promise<CanvasEdge[]> {
  await ensureKnowledgeMigration();
  const db = await getDatabase();
  const memberships = await db.getAllFromIndex("canvasMemberships", "by-canvas", canvasId);
  const visible = new Set(memberships.map((item) => item.cardId));
  const relations = (await db.getAll("knowledgeRelations")).filter((relation) => relation.status === "accepted" && relation.evidenceRefs.length && (visible.has(relation.fromCardId) || visible.has(relation.toCardId)));
  const relationEdges = relations.map<CanvasEdge>((relation) => {
    const fromVisible = visible.has(relation.fromCardId);
    const toVisible = visible.has(relation.toCardId);
    return {
      id: relation.id, canvasId,
      source: fromVisible ? relation.fromCardId : `portal:${relation.id}:${relation.fromCardId}`,
      target: toVisible ? relation.toCardId : `portal:${relation.id}:${relation.toCardId}`,
      type: relation.origin === "user" ? "manual" : "suggested",
      relation: relation.type === "explains" ? "bridge" : "structural",
      knowledgeRelationType: relation.type, label: relation.label, evidenceRefs: relation.evidenceRefs,
      status: relation.status, createdAt: relation.createdAt,
    };
  });
  const relationIds = new Set(relationEdges.map((edge) => edge.id));
  const legacy = (await db.getAll("edges"))
    .filter((edge) => (edge.canvasId ?? DEFAULT_CANVAS_ID) === canvasId && !relationIds.has(edge.id))
    .map((edge) => ({ ...edge, canvasId, relation: edge.relation ?? "structural" as const }));
  return [...relationEdges, ...legacy];
}

function relationType(edge: CanvasEdge): KnowledgeRelationType {
  return edge.knowledgeRelationType ?? (edge.relation === "bridge" ? "explains" : "related_to");
}

export async function saveEdges(canvasId: string, edges: CanvasEdge[]): Promise<void> {
  await ensureKnowledgeMigration();
  const db = await getDatabase();
  const currentMemberships = await db.getAllFromIndex("canvasMemberships", "by-canvas", canvasId);
  const visible = new Set(currentMemberships.map((item) => item.cardId));
  const persisted = edges.filter((edge) => !portalCardId(edge.source) && !portalCardId(edge.target));
  const keep = new Set(edges.map((edge) => edge.id));
  const currentRelations = (await db.getAll("knowledgeRelations")).filter((relation) => relation.status === "accepted" && (visible.has(relation.fromCardId) || visible.has(relation.toCardId)));
  const tx = db.transaction(["edges", "knowledgeRelations"], "readwrite");
  const existingLegacy = (await tx.objectStore("edges").getAll()).filter((edge) => (edge.canvasId ?? DEFAULT_CANVAS_ID) === canvasId);
  for (const edge of existingLegacy.filter((edge) => !keep.has(edge.id))) await tx.objectStore("edges").delete(edge.id);
  for (const relation of currentRelations.filter((item) => !keep.has(item.id))) await tx.objectStore("knowledgeRelations").put({ ...relation, status: "rejected", userRejected: true, updatedAt: Date.now() });
  for (const edge of persisted) {
    await tx.objectStore("edges").put({ ...edge, canvasId });
    if (edge.relation === "attachment") continue;
    const existing = await tx.objectStore("knowledgeRelations").get(edge.id);
    if (existing?.userRejected) continue;
    const relation: KnowledgeRelation = {
      id: edge.id, fromCardId: edge.source, toCardId: edge.target, type: relationType(edge), label: edge.label,
      origin: edge.type === "manual" ? "user" : "ai", status: "accepted",
      evidenceRefs: edge.evidenceRefs ?? existing?.evidenceRefs ?? [{ conversationId: "user-created" }],
      userEdited: edge.type === "manual" || existing?.userEdited || Boolean(existing && existing.label !== edge.label), createdAt: existing?.createdAt ?? edge.createdAt, updatedAt: Date.now(),
    };
    await tx.objectStore("knowledgeRelations").put(relation);
  }
  await tx.done;
}
