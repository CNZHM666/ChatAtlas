import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { validateWikiPlan, wikiPlanFailureMessage } from "./wiki-plan-contract";
import { planWikiTopics } from "./wiki-topic-plan";
import { AIProviderValidationError } from "./provider-errors";
import type { StructuredAIRequest } from "./provider";

const sections = Array.from({ length: 6 }, (_, index) => ({ ...contextKnowledge().session.sections[0], id: `m${index}`, kind: "finding" as const }));
const topic = (index: number) => ({ key: `t${index}`, title: `具体机制${index}`, question: `机制${index}如何处理？` });
const fixture = () => ({ pages: Array.from({ length: 3 }, (_, index) => ({ title: `系统模块${index}`, group: "", question: `模块${index}如何实现？`, subtopics: [topic(index * 2), topic(index * 2 + 1)] })), assignments: Object.fromEntries(sections.map((section, index) => [section.id, `t${index}`])) });

it.each([undefined, null, "", " \n "])("uses the existing title as the scope label for an omitted description (%j)", question => {
  const value = fixture(), before = structuredClone(value);
  const candidate = { ...value, pages: value.pages.map(page => ({ ...page, question, subtopics: page.subtopics.map(topic => ({ ...topic, question })) })) };
  const candidateBefore = structuredClone(candidate);
  const result = validateWikiPlan(candidate, sections);
  expect(result.every(page => page.question === page.title && page.subtopics?.every(topic => topic.question === topic.title))).toBe(true);
  expect(result.flatMap(page => page.sectionIds).sort()).toEqual(sections.map(section => section.id));
  expect(value).toEqual(before);
  expect(candidate).toEqual(candidateBefore);
});

it("removes only unassigned generated placeholders after verifying every material has one valid owner", () => {
  const value = fixture(), before = structuredClone(value);
  const candidate = { ...value, pages: [
    { ...value.pages[0], title: "空模板", subtopics: [topic(8)] },
    ...value.pages.map(page => ({ ...page, subtopics: [...page.subtopics, topic(9 + Number(page.title.at(-1))) ] })),
  ] };
  const result = validateWikiPlan(candidate, sections);
  expect(result).toEqual(validateWikiPlan(value, sections));
  expect(value).toEqual(before);
  expect(() => validateWikiPlan(candidate, sections.map((section, index) => index === 0 ? { ...section, userEdited: true } : section))).toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_personal" }));
  const { m5: removed, ...incomplete } = candidate.assignments; void removed;
  expect(() => validateWikiPlan({ ...candidate, assignments: incomplete }, sections)).toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_coverage" }));
});

it("keeps exact original field locations after removing preceding empty chapters and subtopics", () => {
  const value = fixture();
  const candidate = { ...value, pages: [
    { ...value.pages[0], subtopics: [topic(8)] },
    { ...value.pages[1], subtopics: [topic(0)] },
    { ...value.pages[2], subtopics: [topic(9), { ...topic(1), question: { privateText: "PRIVATE MODEL CONTENT" } }] },
  ], assignments: { m0: "t0", m1: "t0", m2: "t0", m3: "t1", m4: "t1", m5: "t1" } };
  try { validateWikiPlan(candidate, sections); throw Error("must fail"); }
  catch (error) {
    expect(error).toBeInstanceOf(AIProviderValidationError);
    const failure = error as AIProviderValidationError;
    expect(failure).toMatchObject({ code: "PROVIDER_SCHEMA_wiki_directory_subtopic_boundary", fieldPaths: ["pages[2].subtopics[1].question"], wikiDirectoryIssues: [{ path: "pages[2].subtopics[1].question", reason: "required_text" }] });
    expect(wikiPlanFailureMessage(failure, "zh-CN")).toContain("第 3 章第 2 个子主题的范围说明缺失或格式无效");
    expect(JSON.stringify(failure.wikiDirectoryIssues)).not.toContain("PRIVATE MODEL CONTENT");
  }
});

it.each([
  ["title", "", "required_text", undefined],
  ["title", "字".repeat(101), "text_too_long", 100],
  ["question", [], "required_text", undefined],
  ["question", "说明".repeat(121), "text_too_long", 240],
] as const)("reports the exact subtopic %s requirement", (field, text, reason, maxLength) => {
  const value = fixture();
  const pages = value.pages.map((page, index) => index !== 2 ? page : { ...page, subtopics: [page.subtopics[0], { ...page.subtopics[1], [field]: text }] });
  expect(() => validateWikiPlan({ ...value, pages }, sections)).toThrowError(expect.objectContaining({
    code: "PROVIDER_SCHEMA_wiki_directory_subtopic_boundary", fieldPaths: [`pages[2].subtopics[1].${field}`],
    wikiDirectoryIssues: [{ path: `pages[2].subtopics[1].${field}`, reason, ...(maxLength ? { maxLength } : {}) }],
  }));
});

it("prunes empty placeholders but still reports missing or conflicting material ownership as the cause", () => {
  const value = { pages: [{ title: "系统模块", question: "系统模块", subtopics: [
    { title: "机制一", sectionIds: ["m0"] }, { title: "机制二", sectionIds: ["m0"] }, { title: "空占位", sectionIds: [] },
  ] }] };
  expect(() => validateWikiPlan(value, sections.slice(0, 2))).toThrowError(expect.objectContaining({
    code: "PROVIDER_SCHEMA_wiki_directory_coverage", wikiDirectoryDetails: expect.objectContaining({ missingIds: ["m1"], duplicateIds: [] }),
  }));
});

it("repairs metadata with exact field requirements and preserves all existing assignments", async () => {
  const value = fixture(), broken = structuredClone(value); broken.pages[2].subtopics[1].title = "字".repeat(101);
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt); calls++;
    if (calls === 1) return request.validate(broken);
    expect(data.correction.issues).toEqual([{ path: "pages[2].subtopics[1].title", reason: "text_too_long", maxLength: 100 }]);
    expect(data.correction.previousPlan.assignments).toEqual(value.assignments);
    expect(request.system).toContain("without changing valid material ownership");
    return request.validate(value);
  } };
  expect(await planWikiTopics(sections, "zh-CN", ai, new AbortController().signal)).toHaveLength(3);
  expect(calls).toBe(2);
});

it("retains specific failure reasons when one bounded metadata repair still fails", async () => {
  const value = fixture(); value.pages[2].subtopics[1].title = "字".repeat(101);
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => { calls++; return request.validate(value); } };
  await expect(planWikiTopics(sections, "zh-CN", ai, new AbortController().signal)).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_wiki_directory_subtopic_boundary", message: expect.stringContaining("第 3 章第 2 个子主题的标题超过 100 字符") });
  expect(calls).toBe(2);
});
