import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { KnowledgeProposal, OrganizationRun } from "../shared/types";
import { getOrganizationRun, listOrganizationRuns, saveOrganizationRun } from "../storage/organization-runs";
import { estimateKnowledgeRequests, eventsFromKnowledgeProposal, knowledgeProgress, mergeTaskEvents, upsertProgressEvent } from "./organization-task";

describe("organization task events", () => {
  it("estimates first-run model work from the confirmed source scope", () => {
    const sources = Array.from({ length: 2 }, (_, index) => ({ id: `c${index}`, messageCount: 32 })) as Parameters<typeof estimateKnowledgeRequests>[0];
    expect(estimateKnowledgeRequests(sources)).toEqual({ core: 4, withOptionalChecks: 9 });
    expect(estimateKnowledgeRequests([])).toEqual({ core: 0, withOptionalChecks: 0 });
  });
  it("maps proposal discoveries to cited, structured minutes without generating text", () => {
    const ref = { conversationId: "conversation-a", messageId: "message-a" };
    const now = 100;
    const card = (id: string, type: "concept" | "bridge" | "insight" | "draft", title: string) => ({ id, type, title, body: `${title} body`, evidenceRefs: [ref], tags: [], origin: "ai" as const, userEdited: false, createdAt: now, updatedAt: now });
    const proposal: KnowledgeProposal = {
      id: "proposal-events", status: "preview", mode: "initial", createdAt: now, updatedAt: now,
      canvases: [{ id: "topic-a", title: "Control", type: "topic", origin: "ai", userEdited: false, createdAt: now, updatedAt: now }],
      cards: [card("concept-a", "concept", "Poles"), card("bridge-a", "bridge", "Eigenvalue connection"), card("insight-a", "insight", "Long-term theme"), card("draft-a", "draft", "Open question")],
      memberships: [{ id: "topic-a:concept-a", canvasId: "topic-a", cardId: "concept-a", x: 0, y: 0, userPositioned: false, createdAt: now, updatedAt: now }],
      relations: [], sources: [], analyzedConversationIds: [ref.conversationId], reviewConversationIds: [],
    };
    const events = eventsFromKnowledgeProposal(proposal, now);
    expect(events.map((event) => event.type)).toEqual(["topic_found", "concept_found", "bridge_created", "insight_created", "draft_suggested", "proposal_ready"]);
    expect(events.find((event) => event.type === "bridge_created")).toMatchObject({ sourceRefs: [ref], body: "Eigenvalue connection body" });
  });

  it("updates a stage once and calculates progress from completed work", () => {
    const events = upsertProgressEvent(upsertProgressEvent([], "conversation_profiles", 2, 5, 1), "conversation_profiles", 4, 5, 2);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ current: 4, total: 5 });
    expect(knowledgeProgress({ stage: "relations", completed: 14, total: 23 }).progress).toBe(79);
    expect(mergeTaskEvents(events, events)).toHaveLength(1);
  });

  it("persists a run and its event history", async () => {
    const run: OrganizationRun = { id: "organization-run-storage-test", title: "Control organization", targetType: "knowledge_space", targetIds: ["conversation-a"], startedAt: 1, updatedAt: 2, status: "waiting_review", stage: "proposal_ready", progress: 100, events: [{ type: "topic_found", title: "Control", sourceRefs: [{ conversationId: "conversation-a" }], timestamp: 2 }], proposalId: "proposal-a" };
    await saveOrganizationRun(run);
    expect(await getOrganizationRun(run.id)).toEqual(run);
    expect((await listOrganizationRuns()).some((item) => item.id === run.id)).toBe(true);
  });
});
