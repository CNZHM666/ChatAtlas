import { expect, it } from "vitest";
import { keepWikiDraft, usableWikiClaim, wikiDraftKept } from "./wiki-review";
import { projectSession } from "../test/project-fixture";

it("keeps editorial acceptance separate from facts and invalidates it when text or anchors change", () => {
  const section = { ...projectSession().sections[0], reviewIssue: "Needs original context", claims: [{ text: "AI suggestion", quote: "suggestion", evidenceIds: ["e1"], verification: "uncertain" as const }] };
  const kept = keepWikiDraft(section, 42);
  expect(wikiDraftKept(kept)).toBe(true);
  expect(kept.reviewIssue).toBe(section.reviewIssue); expect(kept.claims).toEqual(section.claims);
  expect(section.editorialReview).toBeUndefined();
  expect(wikiDraftKept({ ...kept, body: "Changed" })).toBe(false);
  expect(wikiDraftKept({ ...kept, evidenceIds: ["other"] })).toBe(false);
  expect(usableWikiClaim(kept, kept.claims![0])).toBe(false);
});
