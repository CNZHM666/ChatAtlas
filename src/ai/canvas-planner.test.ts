import { describe, expect, it } from "vitest";
import type { ConversationSemanticProfile } from "../shared/types";
import { planCanvases } from "./canvas-planner";

describe("local canvas title normalization", () => {
  it("preserves specific domains instead of expanding generic substrings", () => {
    const profile = { conversationId: "c", domains: ["学习方法", "产品设计", "控制"], concepts: [], evidenceRefs: [] } as unknown as ConversationSemanticProfile;
    expect(planCanvases([profile], [], 1).map((canvas) => canvas.title)).toEqual(["学习方法", "产品设计", "控制与自动化"]);
  });
});
