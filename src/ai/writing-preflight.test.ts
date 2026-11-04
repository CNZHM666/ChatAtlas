import { expect, it } from "vitest";
import { WikiPreflightError, writingPreflightIssue } from "./writing-preflight";

const topic = (ownerId: string, evidenceIds: string[] = []) => ({ ownerId, subtopics: [{ evidenceIds }] });

it("accepts a request every passage and subtopic of which belongs to its roster", () => {
  expect(writingPreflightIssue({ passages: [{ id: "a", wikiOwnerId: "o1" }, { id: "b", wikiOwnerId: "o2" }], wikiTopics: [topic("o1", ["a"]), topic("o2", ["b"])] })).toBeUndefined();
});

it("names the first reason a writing request cannot succeed", () => {
  expect(writingPreflightIssue({ passages: [], wikiTopics: [topic("o1")] })).toBe("empty_batch");
  // The original stuck batch: materials without a chapter, so no roster to cite.
  expect(writingPreflightIssue({ passages: [{ id: "a" }], wikiTopics: [] })).toBe("empty_roster");
  expect(writingPreflightIssue({ passages: [{ id: "a", wikiOwnerId: "gone" }], wikiTopics: [topic("o1")] })).toBe("unknown_owner");
  expect(writingPreflightIssue({ passages: [{ id: "a", wikiOwnerId: "o1" }], wikiTopics: [topic("o1"), topic("o2")] })).toBe("topic_without_material");
  expect(writingPreflightIssue({ passages: [{ id: "a", wikiOwnerId: "o1" }], wikiTopics: [topic("o1", ["missing"])] })).toBe("unknown_subtopic_evidence");
});

it("reports a stable code and a localized message", () => {
  const error = new WikiPreflightError("empty_roster", true);
  expect(error.code).toBe("WIKI_PREFLIGHT_EMPTY_ROSTER");
  expect(error.message).toContain("没有发送请求");
});
