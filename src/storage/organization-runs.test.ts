import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import type { OrganizationRun } from "../shared/types";
import { getOrganizationRun, saveOrganizationEvaluation, saveOrganizationRun } from "./organization-runs";

describe("organization run evaluations", () => {
  it("keeps a saved review when the running task later updates its status", async () => {
    const run: OrganizationRun = { id: crypto.randomUUID(), title: "Review", targetType: "conversation", targetIds: ["conversation"], startedAt: 1, updatedAt: 1, status: "waiting_review", stage: "proposal_ready", progress: 100, events: [] };
    await saveOrganizationRun(run);
    await saveOrganizationEvaluation(run.id, 5, "Good chapter boundaries");
    await saveOrganizationRun({ ...run, status: "completed", completedAt: 2, updatedAt: 2 });
    expect(await getOrganizationRun(run.id)).toMatchObject({ status: "completed", evaluation: { score: 5, note: "Good chapter boundaries" } });
    await saveOrganizationEvaluation(run.id, undefined, "");
    expect((await getOrganizationRun(run.id))?.evaluation).toBeUndefined();
  });
});
