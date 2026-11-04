import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { validateWikiPlan } from "./wiki-plan-contract";
import { planWikiTopics } from "./wiki-topic-plan";
import type { StructuredAIRequest } from "./provider";

const sections = Array.from({ length: 6 }, (_, index) => ({ ...contextKnowledge().session.sections[0], id: `m${index}`, kind: "finding" as const }));
const topic = (key: string, title: string) => ({ key, title, question: `${title}如何工作？` });
const page = (subtopics: ReturnType<typeof topic>[], title = "材料管理") => ({ title, group: "", question: `${title}如何实现？`, subtopics });
const valid = () => ({ pages: [page([topic("t0", "同步"), topic("t1", "导入")]), page([topic("t2", "权限")], "访问控制")], assignments: { m5: "t1", m3: "t2", m1: "t0", m0: "t2", m4: "t1", m2: "t0" } });

it("derives both inventories from one material-to-subtopic map without changing source order or input", () => {
  const value = valid(), before = structuredClone(value);
  const result = validateWikiPlan(value, sections);
  expect(result[0].sectionIds).toEqual(["m1", "m2", "m4", "m5"]);
  expect(result[0].subtopics?.map(topic => topic.sectionIds)).toEqual([["m1", "m2"], ["m4", "m5"]]);
  expect(result[1].sectionIds).toEqual(["m0", "m3"]);
  expect(result.flatMap(page => page.subtopics!.flatMap(topic => topic.sectionIds)).sort()).toEqual(sections.map(section => section.id));
  expect(validateWikiPlan(result, sections)).toEqual(result);
  expect(value).toEqual(before);
});

it("rejects missing or foreign materials with precise safe correction details", () => {
  const value = valid();
  const { m5: _omitted, ...rest } = value.assignments;
  void _omitted;
  expect(() => validateWikiPlan({ ...value, assignments: rest }, sections)).toThrowError(expect.objectContaining({
    code: "PROVIDER_SCHEMA_wiki_directory_coverage", fieldPaths: ["assignments.m5"], wikiDirectoryDetails: { missingIds: ["m5"], duplicateIds: [], unknownIds: [], parentMismatchIds: [] },
  }));
  expect(() => validateWikiPlan({ ...value, assignments: { ...value.assignments, "PRIVATE SOURCE CONTENT": "t0", m999: "t1" } }, sections)).toThrowError(expect.objectContaining({
    code: "PROVIDER_SCHEMA_wiki_directory_assignment_identity", fieldPaths: ["assignments"], wikiDirectoryDetails: { missingIds: [], duplicateIds: [], unknownIds: ["invalid-0", "m999"], parentMismatchIds: [] },
  }));
});

it("does not accept multiple destinations, unknown destinations, or ambiguous topic keys", () => {
  for (const destination of [["t0", "t1"], "t999", null, { key: "t0" }]) {
    expect(() => validateWikiPlan({ ...valid(), assignments: { ...valid().assignments, m0: destination } }, sections)).toThrowError(expect.objectContaining({
      code: "PROVIDER_SCHEMA_wiki_directory_assignment_target", fieldPaths: ["assignments.m0"], wikiDirectoryDetails: expect.objectContaining({ invalidAssignmentIds: ["m0"] }),
    }));
  }
  const value = valid(); value.pages[1].subtopics[0].key = "t0";
  expect(() => validateWikiPlan(value, sections)).toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_duplicate_topic_key", fieldPaths: ["pages[1].subtopics[0].key"] }));
});

it("keeps redundant inventories consistent and prunes unused generated topics only after full coverage", () => {
  const value = valid();
  expect(() => validateWikiPlan({ ...value, pages: [{ ...value.pages[0], sectionIds: ["m0"] }, value.pages[1]] }, sections)).toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_assignment_conflict", fieldPaths: ["pages[0].sectionIds"] }));
  expect(validateWikiPlan({ ...value, pages: [{ ...value.pages[0], subtopics: [...value.pages[0].subtopics, topic("t3", "无依据主题")] }, value.pages[1]] }, sections)).toEqual(validateWikiPlan(value, sections));
  expect(() => validateWikiPlan({ ...value, assignments: [] }, sections)).toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_assignment_format" }));
});

it("repairs one missing and four duplicated legacy owners with one explicit destination per material", async () => {
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt); calls++;
    expect(request.system).toContain("assignments");
    if (calls === 1) return request.validate({ pages: [
      { title: "材料管理", group: "", question: "如何管理？", subtopics: [{ title: "同步", question: "如何同步？", sectionIds: ["m0", "m1", "m2", "m3", "m4"] }] },
      { title: "访问控制", group: "", question: "如何授权？", subtopics: [{ title: "权限", question: "如何限制？", sectionIds: ["m0", "m1", "m2", "m3"] }] },
    ] });
    expect(data.version).toBe(13);expect(data.stage).toBe("ownership");
    expect(data.slots).toHaveLength(5);expect(data.sections).toBeUndefined();
    expect(data.slots.map((slot:{choices:string[]})=>slot.choices)).toEqual(Array.from({length:5},()=>["s0","s1"]));
    return request.validate({owners:["s1","s0","s0","s1","s0"]});
  } };
  const input = sections.map(section => ({ ...section, id: `private:${section.id}` }));
  const result = await planWikiTopics(input, "zh-CN", ai, new AbortController().signal);
  expect(calls).toBe(2);
  expect(result.flatMap(page => page.sectionIds).sort()).toEqual(input.map(section => section.id));
});
