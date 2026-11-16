import { expect, it } from "vitest";
import { withoutUnrelatedScopeNotes } from "./wiki-scope-identity";
it("removes only generated notes that paired unrelated compound names", () => {
  const unrelated = '> 范围有分歧：「仅预留 Concept Preview 接口/Feature Flag/UI Slot」写为不开发，「架构」中又建议「结构操作经过 Plan → Preview → Confirm → Apply」。需要你确认。';
  const genuine = '> 范围有分歧：「Concept Preview 接口」写为不开发，下文又写「第一版开发 Concept Preview 接口」。需要你确认。';
  expect(withoutUnrelatedScopeNotes(unrelated)).toBe("");
  expect(withoutUnrelatedScopeNotes(genuine)).toBe(genuine);
});
