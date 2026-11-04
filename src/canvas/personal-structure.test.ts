import { expect, it } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import { carryReviewNotes } from "./review-notes";

const base: FocusSession = { id: "old", title: "项目", goal: "回顾", mode: "work", locale: "zh-CN", sourceConversationIds: ["source"], evidence: [], sections: ["生成", "校验"].map((title, index) => ({ id: `old-${index}`, title, body: "旧正文", evidenceIds: [], transition: "", kind: "finding" })), activeSectionId: "old-0", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };

it("remaps authored structure by unique chapters while allowing new generated text", () => {
  const previous = { ...base, sections: [{ ...base.sections[0], structureEdited: true, responsibility: "我的职责", understandingLinks: [{ targetId: "old-1", kind: "flow" as const }] }, { ...base.sections[1], understandingLinks: [{ targetId: "old-0", kind: "feedback" as const }] }] };
  const next = { ...base, id: "next", sections: base.sections.map((section, index) => ({ ...section, id: `new-${index}`, body: "新正文" })) };
  const copied = carryReviewNotes(previous, next);
  expect(copied.sections?.[0]).toMatchObject({ id: "new-0", body: "新正文", responsibility: "我的职责", understandingLinks: [{ targetId: "new-1", kind: "flow" }] });
  expect(copied.sections?.[1].understandingLinks).toEqual([{ targetId: "new-0", kind: "feedback" }]);
  expect(copied.detachedNotes).toEqual([]);
  expect(next.sections[0]).not.toHaveProperty("responsibility");
});

it("recovers ambiguous or removed personal relationships as notes with readable names", () => {
  const previous = { ...base, sections: [{ ...base.sections[0], responsibility: "我的职责", understandingLinks: [{ targetId: "old-1", kind: "feedback" as const }] }, base.sections[1]] };
  const next = { ...base, sections: [{ ...base.sections[0], id: "new-0" }] };
  const copied = carryReviewNotes(previous, next);
  expect(copied.sections?.[0].understandingLinks).toEqual([]);
  expect(copied.sections?.[0].responsibility).toBe("我的职责");
  expect(copied.detachedNotes?.[0].text).toContain("生成 → 反馈至 → 校验");
  expect(copied.detachedNotes?.[0].text).not.toContain("old-1");
  const ambiguous = carryReviewNotes(previous, { ...base, sections: [{ ...base.sections[0], id: "new-0" }, { ...base.sections[0], id: "new-1" }] });
  expect(ambiguous.sections).toBeUndefined();
  expect(ambiguous.detachedNotes?.[0].text).toContain("我的说明: 我的职责");
});
