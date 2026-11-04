import { expect, it, vi } from "vitest";
import type { FocusSession } from "../shared/focus-session";
import type { AtlasAIProvider, StructuredAIRequest } from "./provider";
import { applyWikiDirectory, organizeWikiDirectory, validateWikiDirectory } from "./wiki-directory";

const sections: FocusSession["sections"] = [
  { id: "a", title: "技术架构", body: "共同说明。\n\n第一版仅保存本地。", kind: "finding", evidenceIds: ["e1"], transition: "" },
  { id: "b", title: "核心架构", body: "共同说明。\n\n第二版仅在用户确认后同步。", kind: "finding", evidenceIds: ["e2"], transition: "" },
  { id: "c", title: "开发路径", body: "先验证，再上线。", kind: "finding", evidenceIds: ["e3"], transition: "" },
];
const pages = [{ title: "技术架构", group: "技术架构", question: "模块如何协作？", sectionIds: ["a", "b"] }, { title: "开发计划", group: "开发计划", question: "下一步做什么？", sectionIds: ["c"] }];
it("validates real main-chapter/subtopic coverage and merges beneath the planned headings",()=>{
 const outline=[{...pages[0],title:"系统架构",subtopics:[{title:"本地存储",question:"如何存储？",sectionIds:["a"]},{title:"同步边界",question:"何时同步？",sectionIds:["b"]}]},pages[1]] as const;
 const valid=validateWikiDirectory({pages:outline},sections),result=applyWikiDirectory(sections,valid);
 expect(result).toHaveLength(2);expect(result[0].wikiSubtopics?.map(topic=>topic.title)).toEqual(["本地存储","同步边界"]);expect(result[0].body).toContain("## 本地存储");expect(result[0].body).toContain("## 同步边界");expect(result[0].body).toContain("第二版仅在用户确认后同步");expect(result[0].evidenceIds).toEqual(["e1","e2"]);
 expect(()=>validateWikiDirectory({pages:[{...outline[0],subtopics:[outline[0].subtopics[0]]},pages[1]]},sections)).toThrow("cover the chapter");
 expect(()=>validateWikiDirectory({pages:[{...outline[0],subtopics:[outline[0].subtopics[0],{...outline[0].subtopics[1],sectionIds:["a"]}]},pages[1]]},sections)).toThrow("subtopic source");
});
it("retains distinct scope questions even when the parent and child names match",()=>{
 const result=validateWikiDirectory({pages:[{title:"索引",group:"系统",question:"如何维护索引？",sectionIds:["a"],subtopics:[{title:"索引维护",question:"如何更新？",sectionIds:["a"]}]},{title:"索引",group:"系统",question:"如何维护索引？",sectionIds:["b"],subtopics:[{title:"索引维护",question:"失败如何处理？",sectionIds:["b"]}]},pages[1]]},sections);
 expect(result).toHaveLength(2);expect(result[0].subtopics).toHaveLength(2);expect(result[0].subtopics?.map(topic=>topic.sectionIds)).toEqual([["a"],["b"]]);expect(result[0].subtopics?.map(topic=>topic.question)).toEqual(["如何更新？","失败如何处理？"]);
});
const session: FocusSession = { id: "s", title: "项目", goal: "项目整理", mode: "work", sections, sourceConversationIds: ["source"], evidence: [], activeSectionId: "b", completedSectionIds: ["a"], notes: "我的笔记", createdAt: 1, updatedAt: 1 };
function provider(result: unknown): AtlasAIProvider { return { testConnection: vi.fn(), generateStructured: async <T,>(request: StructuredAIRequest<T>) => request.validate(result) }; }
it("normalizes harmless directory wrappers and missing optional categories, with specific coverage failures",()=>{
 const result=validateWikiDirectory(pages.map(page=>({...page,group:undefined})),sections);expect(result[0].group).toBe("");
 expect(validateWikiDirectory({pages:pages.map(page=>({...page,title:page.group+"："+page.title}))},sections)[0].title).toBe(pages[0].title);
 try{validateWikiDirectory({pages:[pages[0]]},sections);throw Error("must reject");}catch(error){expect(error).toMatchObject({code:"PROVIDER_SCHEMA_wiki_directory_coverage",fieldPaths:["pages.sectionIds"]});}
});
it("normalizes generated English category aliases after directory analysis", async () => {
  const next = await organizeWikiDirectory({ ...session, locale: "zh-CN" }, provider({ pages: pages.map((page, index) => ({ ...page, group: index ? "Implementation Planning" : "Technical Architecture" })) }), new AbortController().signal);
  expect(next.sections.map(section => section.wikiGroup)).toEqual(["技术架构", "实施计划"]);
});
it("merges the same central topic without losing version conditions, evidence or distinct development work", () => {
  const next = applyWikiDirectory(sections, validateWikiDirectory({ pages }, sections));
  expect(next).toHaveLength(2);
  expect(next[0].body.match(/共同说明/gu)).toHaveLength(1);
  expect(next[0].body).toContain("第一版仅保存本地"); expect(next[0].body).toContain("第二版仅在用户确认后同步");
  expect(next[0].evidenceIds).toEqual(["e1", "e2"]); expect(next[1].body).toBe(sections[2].body);
  expect(sections).toHaveLength(3);
});
it("does not infer synonymous subjects from a repeated generic question", () => {
  const plan = validateWikiDirectory({ pages: [
    { ...pages[0], sectionIds: ["a"] }, { ...pages[0], title: "核心结构", question: "模块如何协作", sectionIds: ["b"] }, pages[1],
  ] }, sections);
  const result = applyWikiDirectory(sections, plan);
  expect(result).toHaveLength(3);
  expect(result[0].body).toContain("第一版仅保存本地"); expect(result[1].body).toContain("第二版仅在用户确认后同步");
  expect(result[0].evidenceIds).toEqual(["e1"]);expect(result[1].evidenceIds).toEqual(["e2"]);
});
it("rejects lost or reused chapters and protects user-edited pages and proposal status", () => {
  expect(() => validateWikiDirectory({ pages: [pages[0]] }, sections)).toThrow("retain every");
  expect(() => validateWikiDirectory({ pages: [pages[0], { ...pages[1], sectionIds: ["b", "c"] }] }, sections)).toThrow("duplicated");
  expect(() => validateWikiDirectory({ pages }, sections.map(section => section.id === "a" ? { ...section, userEdited: true } : section))).toThrow("Personal");
  expect(() => validateWikiDirectory({ pages }, sections.map(section => section.id === "b" ? { ...section, kind: "proposal" } : section))).toThrow("distinct");
});
it("remaps the active page without marking an unread merged page complete", async () => {
  const next = await organizeWikiDirectory(session, provider({ pages }), new AbortController().signal);
  expect(next.activeSectionId).toBe("a"); expect(next.completedSectionIds).toEqual([]);
  expect(next.notes).toBe("我的笔记"); expect(next.wikiDirectoryReview?.status).toBe("ready");
});
it("preserves original chronology and the earliest page ID when the AI reverses IDs", async () => {
  const next = await organizeWikiDirectory(session, provider({ pages: [{ ...pages[0], sectionIds: ["b", "a"] }, pages[1]] }), new AbortController().signal);
  expect(next.activeSectionId).toBe("a");
  expect(next.sections[0].id).toBe("a");
  expect(next.sections[0].body.indexOf("第一版")).toBeLessThan(next.sections[0].body.indexOf("第二版"));
});
it("retains all draft pages when a provider rejects the audit, and propagates cancellation", async () => {
  const next = await organizeWikiDirectory(session, provider({ pages: [] }), new AbortController().signal);
  expect(next.sections).toBe(sections); expect(next.wikiDirectoryReview?.status).toBe("pending");
  const controller = new AbortController(); controller.abort();
  await expect(organizeWikiDirectory(session, provider({ pages }), controller.signal)).rejects.toThrow();
});
it("preserves fenced code rather than deduplicating its internal blank-line fragments", () => {
  const code = "```ts\nconst version = 1;\n\nconst condition = true;\n```";
  const next = applyWikiDirectory([{ ...sections[0], body: code }, { ...sections[1], body: "独有条件。" }], [pages[0]]);
  expect(next[0].body).toContain(code); expect(next[0].body).toContain("独有条件。");
});
