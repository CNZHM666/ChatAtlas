import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { CanvasCard, OrganizationPlan } from "../shared/types";
import { listCards, saveCards } from "./cards";
import { getOrganizationPlan, saveOrganizationPlan } from "./organization-plans";

describe("organization plan persistence", () => {
  it("stores a plan without replacing existing canvas records", async () => {
    const card: CanvasCard = { id: "migration-card", canvasId: "migration-canvas", kind: "topic", title: "Existing", x: 1, y: 2, tags: [], anchorIds: [], conversationIds: [], createdAt: 1, updatedAt: 1 };
    const plan: OrganizationPlan = { id: "migration-canvas", canvasId: "migration-canvas", status: "preview", suggestions: [], reviewItems: [], conversationStates: {}, analyzedConversationIds: [], createdAt: 2, updatedAt: 2 };
    await saveCards(card.canvasId, [card]);
    await saveOrganizationPlan(plan);

    expect(await getOrganizationPlan(plan.canvasId)).toEqual(plan);
    expect((await listCards(card.canvasId))[0]).toMatchObject({ id: card.id, title: "Existing" });
  });
});
