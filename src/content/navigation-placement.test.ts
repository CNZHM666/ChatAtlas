import { describe, expect, it } from "vitest";
import { calculateNavigationPlacement } from "./navigation-placement";

const base = { role: "user" as const, messageTop: 350, messageBottom: 410, textLength: 50, viewportTop: 0, viewportHeight: 800, headerBottom: 72 };

describe("exact-message reading placement", () => {
  it("places a short question near the top so its answer is visible", () => {
    expect(calculateNavigationPlacement(base)).toEqual({ placement: "question-top", scrollDelta: 198 });
  });

  it("positions a long question at its answer boundary", () => {
    expect(calculateNavigationPlacement({ ...base, messageBottom: 900, answerTop: 940, textLength: 1000 })).toEqual({ placement: "question-answer-boundary", scrollDelta: 724 });
  });

  it("keeps navigator jumps at the question top even for long prompts", () => {
    expect(calculateNavigationPlacement({ ...base, messageBottom: 900, answerTop: 940, textLength: 1000, preferQuestionTop: true })).toEqual({ placement: "question-top", scrollDelta: 198 });
  });

  it("keeps context above a cited assistant message and clears a tall sticky header", () => {
    expect(calculateNavigationPlacement({ ...base, role: "assistant", messageTop: 500, headerBottom: 200 })).toEqual({ placement: "message-context", scrollDelta: 284 });
  });

  it("uses question end when the next answer is not mounted yet", () => {
    expect(calculateNavigationPlacement({ ...base, messageBottom: 720, textLength: 600 })).toEqual({ placement: "question-answer-boundary", scrollDelta: 504 });
  });

  it("calculates against a nested conversation scroller below the sticky header", () => {
    expect(calculateNavigationPlacement({ ...base, viewportTop: 82, viewportHeight: 600, headerBottom: 112 })).toEqual({ placement: "question-top", scrollDelta: 154 });
  });
});
