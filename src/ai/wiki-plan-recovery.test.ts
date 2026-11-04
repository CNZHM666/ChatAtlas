import { expect, it } from "vitest";
import { contextKnowledge } from "../test/context-fixture";
import { planWikiTopics, type WikiPlanReceipt } from "./wiki-topic-plan";
import { validateWikiPlan } from "./wiki-plan-contract";
import type { StructuredAIRequest } from "./provider";
import type { DirectoryPage } from "../shared/wiki-directory";

const sections = (count: number) => Array.from({ length: count }, (_, index) => ({ ...contextKnowledge().session.sections[0],
  id: `private-source-${index}`, title: `主题${index % 4}`, body: `机制和条件${index}`, kind: "finding" as const }));
const wireSections = sections(3).map((section, index) => ({ ...section, id: `m${index}` }));
const leaf = (sectionIds: string[], title = "具体机制") => ({ title, question: `${title}如何处理？`, sectionIds });
const parent = (subtopics: ReturnType<typeof leaf>[], extra = {}) => ({ title: "系统设计", group: "", question: "系统怎样运行？", subtopics, ...extra });

it("derives the parent inventory from complete leaf ownership and keeps source order", () => {
  const value = { pages: [parent([leaf(["m2", "m0"], "存储"), leaf(["m1"], "检索")])] }, before = structuredClone(value);
  const valid = validateWikiPlan(value, wireSections);
  expect(valid[0].sectionIds).toEqual(["m0", "m1", "m2"]);
  expect(valid[0].subtopics?.[0].sectionIds).toEqual(["m0", "m2"]); expect(value).toEqual(before);
});

it("deduplicates only repetitions within the same declared owner", () => {
  const valid = validateWikiPlan({ pages: [parent([leaf(["m0", "m0", "m1", "m2"])], { sectionIds: ["m0", "m1", "m2", "m0"] })] }, wireSections);
  expect(valid[0].sectionIds).toEqual(["m0", "m1", "m2"]);
  expect(valid[0].subtopics?.[0].sectionIds).toEqual(["m0", "m1", "m2"]);
});

it("retains shared support within a parent without copying its material inventory", () => {
  const result=validateWikiPlan({pages:[parent([leaf(["m0","m1"],"存储"),leaf(["m1","m2"],"检索")])]},wireSections);
  expect(result[0].sectionIds).toEqual(["m0","m1","m2"]);
  expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["m0","m1"],["m1","m2"]]);
});

it("rejects explicit parent/child disagreement and supplies the precise mismatch", () => {
  expect(() => validateWikiPlan({ pages: [parent([leaf(["m0", "m1", "m2"])], { sectionIds: ["m0", "m1"] })] }, wireSections))
    .toThrowError(expect.objectContaining({ code: "PROVIDER_SCHEMA_wiki_directory_subtopic_identity", wikiDirectoryDetails: { missingIds: [], duplicateIds: [], unknownIds: [], parentMismatchIds: ["m2"] } }));
});

it("repairs only missing slots against fixed application-generated destinations", async () => {
  const input = sections(3); let calls = 0; let receipt: WikiPlanReceipt | undefined;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt); calls++;
    if (calls === 1) return request.validate({ pages: [parent([leaf(["m0", "m2"])])] });
    expect(data.stage).toBe("ownership");expect(data.slots).toHaveLength(1);
    expect(data.slots[0]).toMatchObject({choices:["s0"],title:input[1].title});
    expect(data.sections).toBeUndefined();expect(data.targets[0].id).toBe("s0");
    return request.validate({owners:["s0"]});
  } };
  const result = await planWikiTopics(input, "zh-CN", ai, new AbortController().signal, value => { receipt = value; });
  expect(result[0].sectionIds).toEqual(input.map(section => section.id));
  expect(receipt).toMatchObject({ requests: 2, repairCount: 1, reconciled: true });
});

it("reports invalid repair destinations instead of rethrowing the original ownership error", async () => {
  let calls = 0; const input = sections(3);
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    calls++; const data = JSON.parse(request.prompt);
    if (data.stage === "ownership") {expect(data.slots).toHaveLength(1);return request.validate({owners:[["s0","s1"]]});}
    return request.validate({ pages: [parent([leaf(["m0", "m1"], "存储")]),parent([leaf(["m1","m2"],"检索")],{title:"消息检索"})] });
  } };
  await expect(planWikiTopics(input, "zh-CN", ai, new AbortController().signal)).rejects.toMatchObject({
    code: "PROVIDER_SCHEMA_wiki_directory_ownership_target", fieldPaths: ["owners"], message: expect.stringContaining("无效的主题目标"),
  });
  expect(calls).toBe(5);
});

it("does not accept original or foreign IDs that were never offered in this request", async () => {
  let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => { calls++; return request.validate({ pages: [parent([leaf(["private-source-0", "m999"])])] }); } };
  let receipt:WikiPlanReceipt|undefined;
  await expect(planWikiTopics(sections(2), "zh-CN", ai, new AbortController().signal,value=>{receipt=value;})).rejects.toMatchObject({
    wikiDirectoryDetails: { missingIds: ["m0", "m1"], unknownIds: [] },
  }); expect(calls).toBe(5); // Initial draft plus four bounded slot repairs; no guessed IDs.
  expect(receipt?.quarantinedReferences).toBe(2); // Foreign references are gone, real omissions still fail.
});

it("reconciles 489 catalogue entries without exposing long IDs or losing any child ownership", async () => {
  const input = sections(489), before = structuredClone(input); let calls = 0;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    calls++; const data = JSON.parse(request.prompt), groups = new Map<string, string[]>();
    expect(data.sections.length).toBeLessThanOrEqual(data.editorialGrouping?128:36); expect(request.prompt).not.toContain("private-source-");
    for (const item of data.sections) { expect(item.id).toMatch(/^m\d+$/u); groups.set(item.title, [...groups.get(item.title) ?? [], item.id]); }
    const assignments = Object.fromEntries([...groups].flatMap(([, ids], index) => ids.map(id => [id, `t${index}`])));
    return request.validate({ pages: [...groups].map(([title], index) => ({ title, group: "", question: `${title}怎样工作？`, subtopics: [{ key: `t${index}`, title: "具体机制", question: "如何处理？" }] })), assignments });
  } };
  const pages = await planWikiTopics(input, "zh-CN", ai, new AbortController().signal);
  expect(pages).toHaveLength(4); expect(calls).toBeLessThanOrEqual(24);
  expect(pages.flatMap(page => page.sectionIds).sort()).toEqual(input.map(section => section.id).sort());
  expect(pages.flatMap(page => page.subtopics!.flatMap(topic => topic.sectionIds)).sort()).toEqual(input.map(section => section.id).sort());
  expect(input).toEqual(before);
});

it("does not leak correction state into later successful catalogue batches", async () => {
  let calls = 0; let sawLaterBatch = false;
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt); calls++;
    if (calls === 1) return request.validate({ pages: [parent([leaf(["m0"])])] });
    if(data.stage==="ownership")return request.validate({owners:data.slots.map(()=>"s0")});
    if (calls > 2) { sawLaterBatch = true; expect(data.correction).toBeUndefined(); }
    const ids = data.sections.map((section: { id: string }) => section.id);
    return request.validate({ pages: [parent([leaf(ids)])] });
  } };
  const pages = await planWikiTopics(sections(50), "zh-CN", ai, new AbortController().signal);
  expect(pages[0].sectionIds).toHaveLength(50); expect(sawLaterBatch).toBe(true);
});

it("rechecks cached alias results and never mutates their IDs during original binding", async () => {
  const cached: DirectoryPage[] = [{ ...parent([leaf(["m0", "m1", "m2"])]), sectionIds: ["m0", "m1", "m2"] }];
  const before = structuredClone(cached), ai = { generateStructured: async <T,>() => cached as T };
  const result = await planWikiTopics(sections(3), "en", ai, new AbortController().signal);
  expect(result[0].sectionIds).toEqual(sections(3).map(section => section.id)); expect(cached).toEqual(before);
  let calls = 0;
  const corrupt = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    if (++calls === 1) return [{ ...cached[0], sectionIds: ["m999"], subtopics: [leaf(["m999"])] }] as T;
    const data=JSON.parse(request.prompt);
    expect(data.stage).toBe("ownership");
    return request.validate({owners:Object.fromEntries(data.slots.map((slot:{id:string})=>[slot.id,"s0"]))});
  } };
  expect((await planWikiTopics(sections(3), "en", corrupt, new AbortController().signal))[0].sectionIds).toHaveLength(3);
  expect(calls).toBe(2);
});

it("invalidates catalogue reuse when text outside the displayed lead changes", async () => {
  const input = sections(2), signatures: string[] = [];
  input[0].body = "背景".repeat(500);
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => {
    const data = JSON.parse(request.prompt); signatures.push(data.catalogueSignature);
    return request.validate({ pages: [parent([leaf(data.sections.map((section: { id: string }) => section.id))])] });
  } };
  await planWikiTopics(input, "zh-CN", ai, new AbortController().signal);
  input[0].body += "新的限制。";
  await planWikiTopics(input, "zh-CN", ai, new AbortController().signal);
  expect(signatures[0]).not.toBe(signatures[1]);
});

it("stops before repair if the user cancels during invalid directory validation", async () => {
  let calls = 0; const controller = new AbortController();
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>) => { calls++; controller.abort(); return request.validate({ pages: [] }); } };
  await expect(planWikiTopics(sections(2), "zh-CN", ai, controller.signal)).rejects.toThrow(); expect(calls).toBe(1);
});
