import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { carryWikiNavigation, createWikiGroup, placeWikiPage, wikiSections, wikiCategory, wikiReadingLocation } from "./wiki-navigation";
import { projectStateSignature, projectStateModel } from "./project-state";
import { carryReviewNotes } from "../canvas/review-notes";

it("classifies mixed titles by their primary subject and preserves user categories", () => {
  const session = projectSession();
  session.sections = ["核心架构与开发阶段规划", "用户旅程重构与新手导向体验", "实施里程碑与当前状态", "发布策略、验证与后续规划"].map((title, index) => ({ ...session.sections[0], id: String(index), title, wikiGroup: "开发进度" }));
  expect(wikiSections(session).map(section => section.wikiGroup)).toEqual(["技术架构", "产品设计", "开发进度", "发布与验证"]);
  session.sections[0].wikiGroupEdited = true;
  expect(wikiSections(session)[0].wikiGroup).toBe("开发进度");
});

it("groups unclassified compound headings while keeping deliberate manual root pages", () => {
  const page = projectSession().sections[0];
  const titles = ["项目愿景与核心定位", "后续里程碑与路线图", "小白用户体验重构", "采购链路扩展与实物验证"];
  expect(titles.map(title => wikiCategory({ ...page, title }))).toEqual(["项目定位", "开发进度", "产品设计", "发布与验证"]);
  expect(wikiCategory({ ...page, title: "特殊讨论" })).toBeUndefined();
  expect(wikiCategory({ ...page, wikiGroupEdited: true, wikiGroup: undefined })).toBeUndefined();
});

it("keeps Wiki labels independent from current-plan validity and source order", () => {
  const session = projectSession(), signature = projectStateSignature(session);
  const original = session.sections[0];
  session.sections[0] = { ...original, title: "我的架构说明", wikiOriginalTitle: original.title, wikiGroup: "自定义架构", wikiGroupEdited: true };
  session.sections.push({ ...original, id: "two", title: "其他主题" });
  const unchanged = { ...session, sections: session.sections.slice(0, 1) };
  expect(projectStateSignature(unchanged)).toBe(signature);
  expect(projectStateModel(unchanged)?.stale).toBe(false);
  session.wikiOrder = ["two", "one"];
  expect(wikiSections(session).map(item => item.id)).toEqual(["two", "one"]);
  expect(session.sections.map(item => item.id)).toEqual(["one", "two"]);
});

it("retains manual labels, groups and collapse state through a grounded update", () => {
  const old = projectSession(); old.sections[0] = { ...old.sections[0], title: "个人标题", wikiOriginalTitle: "核心流程", wikiGroup: "我的分组", wikiGroupEdited: true };
  old.wikiOrder = ["one"]; old.wikiCollapsedGroups = { "我的分组": true };
  const next = projectSession(); next.sections[0] = { ...next.sections[0], id: "new", title: "新的架构说明", wikiGroup: "AI 分组" };
  const carried = carryReviewNotes(old, next);
  expect(carried.sections?.[0]).toMatchObject({ id: "new", title: "个人标题", wikiGroup: "我的分组", wikiOriginalTitle: "新的架构说明" });
  expect(carried.wikiOrder).toEqual(["new"]);
  expect(carried.wikiCollapsedGroups).toEqual(old.wikiCollapsedGroups);
});

it("does not attach a personal label to an ambiguous new page", () => {
  const old = projectSession(); old.sections[0].wikiOriginalTitle = "Original";
  const next = projectSession(); next.sections = ["a", "b"].map(id => ({ ...next.sections[0], id }));
  const carried = carryWikiNavigation(old, next);
  expect(carried.sections.every(section => !section.wikiOriginalTitle)).toBe(true);
});

it("persists empty chapters and drag placement across grounded updates without changing prose or source order", () => {
  const original = projectSession();
  original.sections.push({ ...original.sections[0], id: "two", title: "其他页面" });
  const created = createWikiGroup(original, "我的章节");
  expect(created.wikiGroups).toEqual(["我的章节"]);
  const moved = placeWikiPage(created, "two", "我的章节");
  expect(moved.sections.map(item => [item.id, item.body])).toEqual(original.sections.map(item => [item.id, item.body]));
  expect(moved.sections[1]).toMatchObject({ wikiGroup: "我的章节", wikiGroupEdited: true });
  expect(moved.sourceMessageOrder).toEqual(original.sourceMessageOrder);
  expect(() => createWikiGroup(moved, " 我的章节 ")).toThrow("already exists");
  const updated = carryReviewNotes(moved, projectSession());
  expect(updated.wikiGroups).toEqual(["我的章节"]);
  expect(original.wikiGroups).toBeUndefined();
});

it("unifies bilingual generated groups while preserving explicit personal group names", () => {
  const session = projectSession();
  session.sections = ["Product Positioning", "产品定位", "Implementation Planning", "Product Design"].map((wikiGroup, index) => ({ ...session.sections[0], id: `g${index}`, title: "不同主题", wikiQuestion: "不同问题", wikiGroup }));
  expect(wikiSections(session).map(section => section.wikiGroup)).toEqual(["产品定位", "产品定位", "实施计划", "产品设计"]);
  session.sections[0].wikiGroupEdited = true;
  expect(wikiSections(session)[0].wikiGroup).toBe("Product Positioning");
  expect(session.sections[2].wikiGroup).toBe("Implementation Planning");
});

it("preserves a personal short navigation name when a Wiki page is regenerated",()=>{const old=projectSession();old.sections[0].wikiDisplayTitle="核心流程";const next=projectSession();next.sections[0].id="new-one";const carried=carryWikiNavigation(old,next);expect(carried.sections[0]).toMatchObject({id:"new-one",wikiDisplayTitle:"核心流程",body:next.sections[0].body});expect(old.sections[0].title).toBe(next.sections[0].title);});

it("retains canonical matter links and remaps related knowledge through a grounded chapter replacement",()=>{
 const old=projectSession();old.sections[0].matterLinks=[{id:"stable",type:"decision",signature:"confirmed",linkedAt:10}];old.sections[0].relatedKnowledgeIds=["two"];old.sections.push({...old.sections[0],id:"two",title:"另一章",evidenceIds:[],matterLinks:undefined,relatedKnowledgeIds:undefined});const next=structuredClone(old);next.sections[0].id="new-one";next.sections[1].id="new-two";next.sections.forEach(row=>{delete row.matterLinks;delete row.relatedKnowledgeIds;});
 const result=carryWikiNavigation(old,next);expect(result.sections[0].matterLinks).toEqual(old.sections[0].matterLinks);expect(result.sections[0].relatedKnowledgeIds).toEqual(["new-two"]);expect(result.sections[0].body).toBe(old.sections[0].body);
});

it("localizes generated category aliases without rewriting personal names",()=>{
 const session=projectSession();session.sections=["data_architecture","UI-UX","Experimental taxonomy"].map((wikiGroup,index)=>({...session.sections[0],id:String(index),wikiGroup,wikiQuestion:"边界"}));
 expect(wikiSections(session).map(section=>section.wikiGroup)).toEqual(["技术架构","产品设计","Experimental taxonomy"]);
 session.wikiGroups=["Experimental taxonomy"];
 expect(wikiSections(session).some(section=>section.wikiGroup==="Experimental taxonomy")).toBe(true);
});

it("shows a clean reading location without inventing a pending categorization task",()=>{
 const page={...projectSession().sections[0],title:"业务流程与操作",wikiGroup:undefined};
 expect(wikiReadingLocation(page,true)).toBe("Wiki");
 expect(wikiReadingLocation({...page,wikiGroup:"Uncategorized"},true)).toBe("Wiki");
 expect(wikiReadingLocation({...page,wikiGroup:"Hardware execution",wikiQuestion:"执行流程"},true)).toBe("Wiki / Hardware execution");
 expect(wikiReadingLocation({...page,wikiGroupEdited:true,wikiGroup:"我的分组"},true)).toBe("Wiki / 我的分组");
 expect(wikiReadingLocation({...page,wikiGroupEdited:true,wikiGroup:"待归类"},true)).toBe("Wiki / 待归类");
});
