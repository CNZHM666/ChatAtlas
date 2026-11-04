import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CanvasCard, KnowledgeProposal, KnowledgeRelation } from "../shared/types";
import { applyKnowledgeProposal, undoKnowledgeProposal } from "./knowledge-graph";
import { createCanvas } from "./canvases";
import { listCards, saveCards } from "./cards";
import { listEdges, saveEdges } from "./edges";
import { getDatabase } from "./db";

const card = (id: string, canvasId: string, title = id): CanvasCard => ({
  id, canvasId, kind: "concept", title, x: 10, y: 20, tags: [], anchorIds: [], conversationIds: [],
  createdAt: 1, updatedAt: 1,
});

describe("shared knowledge graph storage", () => {
  it("applies a confirmed source scope and reading path with the proposal", async () => {
    const canvas = await createCanvas("Scoped review");
    const proposal: KnowledgeProposal = { id: "scoped-review-proposal", status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], scopeUpdates: [{ canvasId: canvas.id, intent: "控制理论", sourceConversationIds: ["control-source"], readingPathCardIds: ["poles", "stability"], baselineUpdatedAt: canvas.updatedAt, before: {} }], analyzedConversationIds: [], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    await applyKnowledgeProposal(proposal);
    expect(await (await getDatabase()).get("canvases", canvas.id)).toMatchObject({ intent: "控制理论", sourceConversationIds: ["control-source"], readingPathCardIds: ["poles", "stability"] });
    await undoKnowledgeProposal(proposal.id);
    expect((await (await getDatabase()).get("canvases", canvas.id))?.sourceConversationIds).toBeUndefined();
  });
  it("exposes saved evidence to the reading canvas", async () => {
    const canvas = await createCanvas("Reader evidence");
    const sourceCard = card("reader-evidence-card", canvas.id, "系统极点");
    await saveCards(canvas.id, [sourceCard]);
    const db = await getDatabase();
    const saved = await db.get("knowledgeCards", sourceCard.id);
    await db.put("knowledgeCards", { ...saved!, evidenceRefs: [{ conversationId: "control-chat", messageId: "question-poles" }] });
    expect((await listCards(canvas.id))[0].evidenceRefs).toEqual([{ conversationId: "control-chat", messageId: "question-poles" }]);
  });

  it("adds evidence to an existing user concept without replacing its notes, then undoes only the new evidence", async () => {
    const db = await getDatabase();
    const canvas = await createCanvas("User knowledge");
    const sourceCard = card("user-concept-evidence", canvas.id, "系统极点");
    await saveCards(canvas.id, [{ ...sourceCard, notes: "我的理解" }]);
    const before = (await db.get("knowledgeCards", sourceCard.id))!;
    await db.put("knowledgeCards", { ...before, origin: "user", userEdited: true, evidenceRefs: [{ conversationId: "older", messageId: "old-q" }] });
    const proposal: KnowledgeProposal = { id: "append-user-evidence", status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], evidenceUpdates: [{ cardId: sourceCard.id, refs: [{ conversationId: "newer", questionId: "new-q", messageId: "new-q" }] }], analyzedConversationIds: [], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    await applyKnowledgeProposal(proposal);
    expect(await db.get("knowledgeCards", sourceCard.id)).toMatchObject({ origin: "user", userEdited: true, notes: "我的理解", evidenceRefs: [{ conversationId: "older", messageId: "old-q" }, { conversationId: "newer", questionId: "new-q", messageId: "new-q" }] });
    await undoKnowledgeProposal(proposal.id);
    expect((await db.get("knowledgeCards", sourceCard.id))?.evidenceRefs).toEqual([{ conversationId: "older", messageId: "old-q" }]);
  });

  it("applies a knowledge preview and its conversation structure together", async () => {
    const proposal: KnowledgeProposal = { id: "paired-preview", status: "preview", mode: "initial", canvases: [], cards: [], memberships: [], relations: [], sources: [], analyzedConversationIds: ["paired-source"], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    const graph = { conversationId: "paired-source", nodes: [], edges: [], updatedAt: 1 };
    await applyKnowledgeProposal(proposal, [graph]);
    const db = await getDatabase();
    expect((await db.get("knowledgeProposals", proposal.id))?.status).toBe("applied");
    expect(await db.get("conversationGraphs", graph.conversationId)).toMatchObject({ conversationId: graph.conversationId });
    await undoKnowledgeProposal(proposal.id);
    expect(await db.get("conversationGraphs", graph.conversationId)).toBeUndefined();
  });

  it("keeps conversation edits made after the knowledge proposal was applied", async () => {
    const proposal: KnowledgeProposal = { id: "paired-edited-preview", status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], analyzedConversationIds: ["paired-edited-source"], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    const db = await getDatabase();
    await db.put("conversationGraphs", { conversationId: "paired-edited-source", nodes: [], edges: [], updatedAt: 1 });
    await applyKnowledgeProposal(proposal, [{ conversationId: "paired-edited-source", nodes: [], edges: [], chapters: [], updatedAt: 2 }]);
    const applied = await db.get("conversationGraphs", "paired-edited-source");
    await db.put("conversationGraphs", { ...applied!, userEdited: true, updatedAt: applied!.updatedAt + 1 });
    await undoKnowledgeProposal(proposal.id);
    expect(await db.get("conversationGraphs", "paired-edited-source")).toMatchObject({ userEdited: true });
  });

  it("applies an explicitly reviewed replacement of a manually edited canvas", async () => {
    const db = await getDatabase();
    const conversationId = "manual-review-source";
    const proposal: KnowledgeProposal = { id: "manual-review-proposal", status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], analyzedConversationIds: [conversationId], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    await db.put("conversationGraphs", { conversationId, nodes: [], edges: [], chapters: [], userEdited: true, updatedAt: 7 });
    await applyKnowledgeProposal(proposal, [{ conversationId, nodes: [], edges: [], chapters: [], updatedAt: 8 }], new Map([[conversationId, 7]]));
    expect((await db.get("conversationGraphs", conversationId))?.userEdited).toBeUndefined();
    expect((await db.get("knowledgeProposals", proposal.id))?.status).toBe("applied");
  });

  it("rejects a changed canvas before applying any knowledge changes", async () => {
    const db = await getDatabase();
    const conversationId = "stale-review-source";
    const proposal: KnowledgeProposal = { id: "stale-review-proposal", status: "preview", mode: "incremental", canvases: [], cards: [], memberships: [], relations: [], sources: [], analyzedConversationIds: [conversationId], reviewConversationIds: [], createdAt: 1, updatedAt: 1 };
    await db.put("conversationGraphs", { conversationId, nodes: [], edges: [], chapters: [], userEdited: true, updatedAt: 9 });
    await expect(applyKnowledgeProposal(proposal, [{ conversationId, nodes: [], edges: [], chapters: [], updatedAt: 10 }], new Map([[conversationId, 7]]))).rejects.toThrow("changed during organization");
    expect(await db.get("conversationGraphs", conversationId)).toMatchObject({ updatedAt: 9, userEdited: true });
    expect(await db.get("knowledgeProposals", proposal.id)).toBeUndefined();
  });

  it("keeps one card identity across multiple canvas memberships", async () => {
    const math = await createCanvas("数学");
    const control = await createCanvas("控制与自动化");
    await saveCards(math.id, [card("shared-eigenvalue", math.id, "矩阵特征值")]);
    await saveCards(control.id, [{ ...card("shared-eigenvalue", control.id, "矩阵特征值"), x: 420, y: 160 }]);

    const mathCard = (await listCards(math.id)).find((item) => item.id === "shared-eigenvalue");
    const controlCard = (await listCards(control.id)).find((item) => item.id === "shared-eigenvalue");
    expect(mathCard?.title).toBe("矩阵特征值");
    expect(controlCard).toMatchObject({ id: mathCard?.id, x: 420, y: 160 });
    expect(await (await getDatabase()).count("knowledgeCards")).toBeGreaterThan(0);
  });

  it("renders a cross-canvas relation as a portal and remembers an explicit rejection", async () => {
    const programming = await createCanvas("编程与开源");
    const control = await createCanvas("控制与自动化");
    await saveCards(programming.id, [card("portal-roots", programming.id, "np.roots")]);
    await saveCards(control.id, [card("portal-poles", control.id, "系统极点")]);
    const relation: KnowledgeRelation = {
      id: "portal-relation", fromCardId: "portal-roots", toCardId: "portal-poles", type: "used_for",
      label: "用于求解系统特征方程", origin: "ai", status: "accepted",
      evidenceRefs: [{ conversationId: "conversation-a" }, { conversationId: "conversation-b" }],
      createdAt: 2, updatedAt: 2,
    };
    await (await getDatabase()).put("knowledgeRelations", relation);

    expect((await listCards(programming.id)).find((item) => item.kind === "portal")).toMatchObject({
      title: "系统极点", portalCanvasId: control.id, portalTargetCardId: "portal-poles",
    });
    const visibleEdges = await listEdges(programming.id);
    await saveEdges(programming.id, visibleEdges);
    expect((await (await getDatabase()).get("knowledgeRelations", relation.id))?.status).toBe("accepted");
    await saveEdges(programming.id, []);
    expect(await (await getDatabase()).get("knowledgeRelations", relation.id)).toMatchObject({ status: "rejected", userRejected: true });
  });

  it("promotes AI content to user_modified after an edit", async () => {
    const canvas = await createCanvas("Ownership");
    const original = card("owned-ai-card", canvas.id, "系统极点");
    await saveCards(canvas.id, [{ ...original, origin: "ai" }]);
    await saveCards(canvas.id, [{ ...original, title: "我理解的系统极点", origin: "ai", updatedAt: 3 }]);
    expect(await (await getDatabase()).get("knowledgeCards", original.id)).toMatchObject({ origin: "user_modified", userEdited: true });
  });

  it("does not overwrite a manual card when an AI proposal reuses its identity", async () => {
    const db = await getDatabase();
    const manual = { id: "owner-card", type: "concept" as const, title: "My own idea", body: "Keep this content", tags: [], origin: "user" as const, userEdited: false, createdAt: 1, updatedAt: 1 };
    await db.put("knowledgeCards", manual);
    const proposal: KnowledgeProposal = { id: "owner-proposal", status: "preview", mode: "incremental", canvases: [], cards: [{ ...manual, title: "AI rewrite", body: "Replacement", origin: "ai" }], memberships: [], relations: [], sources: [], analyzedConversationIds: [], reviewConversationIds: [], createdAt: 2, updatedAt: 2 };
    await applyKnowledgeProposal(proposal);
    expect(await db.get("knowledgeCards", manual.id)).toMatchObject({ title: "My own idea", body: "Keep this content", origin: "user" });
  });
});
