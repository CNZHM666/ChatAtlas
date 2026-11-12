import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import type { AIUsageEvent, OrganizationRun } from "../shared/types";
import { getDatabase } from "../storage/db";
import { projectAnalysisCsv } from "./project-analysis-csv";

it("exports the saved run and its source-matched history without synthesizing other projects' runs", async () => {
  const db = await getDatabase();
  const run = (id: string, targetIds: string[], startedAt: number): OrganizationRun => ({
    id, title: id, targetType: "conversation", targetIds, startedAt, updatedAt: startedAt, status: "completed", stage: "proposal_ready", progress: 100, events: [],
    pipelineSpans: [{ id: `${id}-wiki`, feature: "wiki", phase: "wiki:generation", startedAt, durationMs: 10, status: "completed" }],
  });
  const usage = (id: string, runId?: string): AIUsageEvent => ({
    id, runId, createdAt: 100, taskType: "other", providerId: "openai", modelId: "test", conversationIds: [],
    inputTokens: 10, outputTokens: 5, tokenSource: "provider", status: "completed", attempt: 1,
  });
  await Promise.all([
    db.put("organizationRuns", run("current", ["one", "two"], 200)),
    db.put("organizationRuns", run("previous", ["two", "one"], 100)),
    db.put("organizationRuns", run("another-project", ["three"], 300)),
    db.put("aiUsageEvents", usage("own-request", "current")),
    db.put("aiUsageEvents", usage("another-request", "another-project")),
    db.put("aiUsageEvents", usage("orphan-request", "unrelated-missing-run")),
    db.put("aiUsageEvents", usage("unassigned-request")),
  ]);
  const csv = await projectAnalysisCsv({ runId: "current", sourceConversationIds: ["one", "two"] });
  expect(csv?.trim().split("\r\n").slice(1).map(row => row.split(",")[0])).toEqual(['"current"', '"previous"']);
  expect(csv).toContain("own-request");
  expect(csv).not.toMatch(/another-project|another-request|orphan-request|unassigned-request|unrelated-missing-run/u);
});
