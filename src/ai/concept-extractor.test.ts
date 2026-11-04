import { describe, expect, it } from "vitest";
import type { ConversationSemanticProfile, QuestionSnapshot } from "../shared/types";
import { extractConcepts } from "./concept-extractor";

describe("concept evidence", () => {
  it("anchors a concept to matching questions instead of a generic conversation sample", () => {
    const profile: ConversationSemanticProfile = { conversationId: "c", summary: "Control systems", domains: ["Control"], topics: [], concepts: ["系统极点"], intent: "learn", evidenceRefs: [{ conversationId: "c", questionId: "q1" }], analyzedVersion: "v1", updatedAt: 1 };
    const snapshots: QuestionSnapshot[] = [
      { questionId: "q1", conversationId: "c", displayTitle: "Introduction", summary: "Overview", concepts: ["系统框图"], sourceHash: "1", analysisVersion: 1, updatedAt: 1 },
      { questionId: "q2", conversationId: "c", displayTitle: "Poles", summary: "Poles", concepts: ["极点"], sourceHash: "2", analysisVersion: 1, updatedAt: 1 },
    ];
    expect(extractConcepts([profile], 1, snapshots)[0].evidenceRefs).toEqual([{ conversationId: "c", questionId: "q2", messageId: "q2" }]);
  });
});
