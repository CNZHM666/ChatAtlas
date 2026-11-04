import { describe, expect, it } from "vitest";
import type { AtlasCanvas, CanvasCard, OrganizationRun } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { normalizeOrganizationTarget, pendingOrganization, spaceSourceIds } from "./task-scope";

describe("AI entry point boundaries", () => {
  const space = { id: "own" } as AtlasCanvas;
  const cards = [{ canvasId: "own", conversationIds: ["a"], evidenceRefs: [{ conversationId: "b" }] }, { canvasId: "other", conversationIds: ["private-other"] }] as CanvasCard[];
  const sessions = [{ canvasId: "own", sourceConversationIds: ["c"] }, { canvasId: "other", sourceConversationIds: ["private-other"] }] as FocusSession[];
  it("recovers legacy sources only from the current space", () => {
    expect(spaceSourceIds(space, cards, sessions)).toEqual(["a", "b", "c"]);
    expect(spaceSourceIds(undefined, cards, sessions)).toEqual([]);
    expect(spaceSourceIds({ ...space, sourceConversationIds: [] }, cards, sessions)).toEqual([]);
    expect(spaceSourceIds({ ...space, sourceConversationIds: ["a"] }, cards, sessions)).toEqual(["a"]);
  });
  it("cannot turn a conversation action into a multi-source or space action", () => {
    expect(() => normalizeOrganizationTarget({ targetType: "conversation", targetIds: ["a", "b"] })).toThrow();
    expect(() => normalizeOrganizationTarget({ targetType: "conversation", targetIds: ["a"], scopeCanvasId: "own" })).toThrow();
    expect(normalizeOrganizationTarget({ targetType: "conversation", targetIds: ["a", "a"] }).targetIds).toEqual(["a"]);
  });
  it("resumes repeated clicks but allows a different intent, scope or model", () => {
    const target = { targetType: "knowledge_space" as const, targetIds: ["a", "b"], scopeCanvasId: "own", intent: "Review" };
    const run = { ...target, id: "pending", status: "waiting_review" } as OrganizationRun;
    expect(pendingOrganization([run], { ...target, targetIds: ["b", "a"] })?.id).toBe("pending");
    for (const different of [{ intent: "Other" }, { scopeCanvasId: "other" }, { modelId: "other" }, { targetIds: ["a"] }]) expect(pendingOrganization([run], { ...target, ...different })).toBeUndefined();
    expect(pendingOrganization([{ ...run, status: "completed" }], target)).toBeUndefined();
  });
});
