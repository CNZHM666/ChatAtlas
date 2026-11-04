import { describe, expect, it } from "vitest";
import type { CanvasCard, Conversation } from "../shared/types";
import type { ReviewMark } from "../storage/review-marks";
import { knowledgeMarkdown } from "./review-export";

describe("knowledge Markdown export", () => {
  it("preserves the original decision, later update and source", () => {
    const card = { id: "card", canvasId: "space", kind: "concept", title: "Stability", notes: "My understanding", tags: [], anchorIds: [], conversationIds: ["source"], x: 0, y: 0, createdAt: 1, updatedAt: 1 } satisfies CanvasCard;
    const source = { id: "source", platform: "chatgpt", title: "Control theory", url: "", messageCount: 1, updatedAt: Date.UTC(2026, 0, 1) } satisfies Conversation;
    const mark = { id: "mark", cardId: "card", canvasId: "space", conversationId: "source", messageId: "message", kind: "decision", originalText: "Choose method A", updateNote: "Use B for the new project", createdAt: 1, updatedAt: 2 } satisfies ReviewMark;
    const output = knowledgeMarkdown(card, [mark], [source]);
    expect(output).toContain("> Choose method A");
    expect(output).toContain("My later update: Use B for the new project");
    expect(output).toContain("Control theory · 2026-01-01 · chatgpt");
  });
});
