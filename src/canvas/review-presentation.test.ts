import { describe, expect, it } from "vitest";
import { chronologicalGroups, resumeContext, reviewLead } from "./review-presentation";
import type { FocusSession } from "../shared/focus-session";

describe("compact review presentation", () => {
  it("uses complete sentences and preserves version numbers and qualifications", () => {
    expect(reviewLead("## 范围\n\nV1.0 仅在条件 B 下适用。接着分析预算。")).toBe("V1.0 仅在条件 B 下适用。");
    expect(reviewLead("The budget is 1.5 dollars. Next we validate it.")).toBe("The budget is 1.5 dollars.");
    expect(reviewLead("- **先验证条件**，再执行。\n\n下文保留例子。")).toBe("先验证条件，再执行。");
  });
  it("groups only adjacent equal phases and keeps every chapter in order", () => {
    const chapters = Array.from({ length: 36 }, (_, index) => ({ id: `${index}`, title: `Discussion ${index}`, phase: index < 12 ? "Scope" : index < 24 ? "Experiments" : "Constraints" }));
    const groups = chronologicalGroups(chapters, false);
    expect(groups.map((group) => group.title)).toEqual(["Scope", "Experiments", "Constraints"]);
    expect(groups.flatMap((group) => group.items)).toEqual(chapters);
    expect(chronologicalGroups([{ id: "a", title: "A", phase: "Scope" }, { id: "b", title: "B", phase: "Experiment" }, { id: "c", title: "C", phase: "Scope" }], false)).toHaveLength(3);
  });
  it("bounds legacy presentation without deleting or reordering chapters", () => {
    const chapters = Array.from({ length: 60 }, (_, index) => ({ id: `${index}`, title: `Original ${index}` }));
    const groups = chronologicalGroups(chapters, true);
    expect(groups).toHaveLength(6);
    expect(groups.flatMap((group) => group.items)).toEqual(chapters);
  });
  it("restores the current chapter and its own question rather than another chapter's note", () => {
    const session = { sections: [{ id: "one", title: "First" }, { id: "two", title: "Correction" }], activeSectionId: "two", reviewNeeds: { one: "Other question", two: "Why did it change?" }, sectionNotes: { two: { text: "Only applies in B" } } } as unknown as FocusSession;
    expect(resumeContext(session)).toMatchObject({ section: { id: "two" }, question: "Why did it change?", note: "Only applies in B" });
  });
});
