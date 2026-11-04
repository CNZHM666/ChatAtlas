import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { planWikiTopics } from "./wiki-topic-plan";
import { AIProviderValidationError } from "./provider-errors";
import { wikiPlanCorrectionProblems } from "./wiki-plan-correction";
import type { StructuredAIRequest } from "./provider";

const sections = Array.from({ length: 2 }, (_, index) => ({ ...contextKnowledge().session.sections[0], id: `m${index}`, kind: "finding" as const }));
const plan = (title: string) => ({ pages: [{ title: "系统模块", group: "", question: "模块如何实现？", subtopics: [{ key: "t0", title, question: "哪些条件？" }] }], assignments: { m0: "t0", m1: "t0" } });

it("tells the model in plain words which field to fix, not only the error code", async () => {
  const prompts: Array<{ correction?: { problems?: string[] } }> = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    prompts.push(JSON.parse(request.prompt));
    return request.validate(prompts.length === 1 ? plan("字".repeat(101)) : plan("具体机制"));
  } };
  await planWikiTopics(sections, "zh-CN", ai, new AbortController().signal);
  expect(prompts[0].correction).toBeUndefined();
  expect(prompts[1].correction?.problems).toEqual(["pages[0].subtopics[0].title exceeds 100 characters. Shorten it."]);
});

it("separates a scope conflict from a foreign ID and names empty subtopics and missing materials", () => {
  const error = new AIProviderValidationError("wiki_directory_identity");
  error.wikiDirectoryDetails = { missingIds: ["m2"], duplicateIds: [], unknownIds: ["m1", "m99"], parentMismatchIds: [] };
  error.wikiDirectoryIssues = [{ path: "pages[1].subtopics[1].sectionIds", reason: "empty_source_list" }];
  const problems = wikiPlanCorrectionProblems(error, { scope: [{ id: "m1", kind: "other" }] }, ["m0", "m1", "m2"]);
  expect(problems).toEqual([
    expect.stringMatching(/^m1 is listed in scope as other AND assigned/u),
    expect.stringMatching(/^m99 is not one of this request's section IDs/u),
    "m2 has no destination. Assign it to exactly one subtopic.",
    "pages[1].subtopics[1] has no materials. Assign materials to it or remove it.",
  ]);
});
