import { removePersonalProjectConcept, removeProjectUnderstandingCard } from "./project-understanding";
import { expect, it } from "vitest";
import type { FocusSection, FocusSession } from "../shared/focus-session";
import { projectUnderstandingModel } from "./project-understanding";
import { projectSession } from "../test/project-fixture";
import { architectureGroups } from "./map-presentation";
const section = (id: string, title: string, body: string): FocusSection => ({ id, title, body, kind: "review", transition: "", evidenceIds: [`e-${id}`] });
const session: FocusSession = { id: "s", title: "硬件平台", goal: "恢复产品架构理解", mode: "work", sections: [
  section("one", "整体协作", "## 需求理解\n职责：提取目标与约束。\n输出给方案生成。\n## 方案生成\n职责：组织候选方案。"),
  section("two", "方案边界", "## 方案生成\n职责：组织候选方案。\n将方案输出给规则校验。\n## 规则校验\n职责：检查边界条件。\n将问题反馈至方案生成。"),
], sourceConversationIds: ["c"], evidence: [], activeSectionId: "one", completedSectionIds: [], notes: "", createdAt: 0, updatedAt: 0 };

it("merges named concepts across chapters while preserving collaboration, duties and source associations", () => {
  const before = structuredClone(session), model = projectUnderstandingModel(session);
  expect(model.nodes.map(node => node.title)).toEqual(["需求理解", "方案生成", "规则校验"]);
  expect(model.nodes[1]).toMatchObject({ sectionIds: ["one", "two"], evidenceIds: ["e-one", "e-two"], responsibility: "组织候选方案。" });
  const titles = new Map(model.nodes.map(node => [node.id, node.title]));
  expect(model.edges.map(edge => [titles.get(edge.from), edge.kind, titles.get(edge.to)])).toEqual(expect.arrayContaining([
    ["需求理解", "flow", "方案生成"], ["方案生成", "flow", "规则校验"], ["规则校验", "feedback", "方案生成"],
  ]));
  expect(session).toEqual(before);
  const replaced = projectUnderstandingModel({ sections: session.sections.map(item => ({ ...item, id: `new-${item.id}` })) });
  expect(replaced.nodes.map(node => node.id)).toEqual(model.nodes.map(node => node.id));
});

it("keeps generic headings scoped and does not invent relations from adjacency, code or ambiguous names", () => {
  const input = { sections: [section("a", "连续系统", "## 基础\n第一种基础。\n## 结论\n连续系统的结论。"), section("b", "离散系统", "## 基础\n另一种基础。\n## 结论\n离散系统的结论。"), section("c", "验证", "## 检查\n是否依赖基础？\n```md\n输出给检查。\n```" )] };
  const model = projectUnderstandingModel(input);
  expect(model.nodes.filter(node => node.title === "结论")).toHaveLength(2);
  expect(model.nodes.filter(node => node.title === "基础")).toHaveLength(2);
  expect(model.edges).toEqual([]);
});

it("retains containment, local personal cards and authored relations without replacing chapter reading order", () => {
  const personal = { ...section("personal", "我的判断", "个人解释。"), origin: "user" as const, understandingLinks: [{ targetId: "child", kind: "comparison" as const }] };
  const input = { sections: [{ ...section("a", "架构协作", ""), phase: "架构", understandingPath: [section("root", "方案生成", ""), { ...section("child", "候选方案", ""), phase: "方案生成" }, personal] }] };
  const model = projectUnderstandingModel(input), title = (id: string) => model.nodes.find(node => node.id === id)?.title;
  expect(model.edges.map(edge => [title(edge.from), edge.kind, title(edge.to), edge.authored])).toEqual(expect.arrayContaining([
    ["架构", "contains", "方案生成", undefined], ["方案生成", "contains", "候选方案", undefined], ["我的判断", "comparison", "候选方案", true],
  ]));
  expect(input.sections[0].understandingPath.map(item => item.id)).toEqual(["root", "child", "personal"]);
});

it("adds every explicit plan module, with duties and inputs/outputs, and respects personal structure edits", () => {
  const project: FocusSession = { ...session, projectState: { summary: "Whole plan", signature: "old", generatedAt: 1, basis: "organized", modules: [
    { id: "input", title: "需求理解", layer: "输入", purpose: "整理用户约束", inputs: ["用户需求"], outputs: ["设计约束"], status: "documented", quote: "需求理解整理约束。", evidenceIds: ["e-one"] },
    { id: "missing", title: "ESP32固件", layer: "执行", purpose: "执行硬件程序", inputs: ["固件源码"], outputs: ["实物运行结果"], status: "proposal", quote: "建议增加ESP32固件模块。", evidenceIds: ["e-two"] },
  ], relations: [{ from: "input", to: "missing", kind: "flow", label: "传递设计约束", quote: "需求理解将设计约束传递给ESP32固件。", evidenceIds: ["e-one"] }], decisions: [], constraints: [], actions: [] } };
  const before = structuredClone(project);
  const model = projectUnderstandingModel(project, true);
  const input = model.nodes.find(node => node.title === "需求理解")!, missing = model.nodes.find(node => node.title === "ESP32固件")!;
  expect(model.nodes.filter(node => node.title === "需求理解")).toHaveLength(1);
  expect(input).toMatchObject({ responsibility: "整理用户约束", inputs: ["用户需求"], outputs: ["设计约束"] });
  expect(missing).toMatchObject({ sectionIds: ["two"], semanticStatus: "proposal", outputs: ["实物运行结果"] });
  expect(model.edges).toContainEqual(expect.objectContaining({ from: input.id, to: missing.id, label: "传递设计约束" }));
  const edited = projectUnderstandingModel({ ...project, projectUnderstanding: { order: [], nodes: [{ id: input.id, title: "我的需求理解", responsibility: "个人补充", sectionIds: ["one"], links: [] }] } }, true);
  expect(edited.nodes.find(node => node.id === input.id)).toMatchObject({ title: "我的需求理解", responsibility: "个人补充", userEdited: true });
  expect(project).toEqual(before);
});

it("keeps chapters missing from a partial semantic overview in the whole project structure", () => {
  const ir = { key: "ir", title: "Hardware IR", description: "统一方案", quote: "Hardware IR统一方案。", status: "discussed" as const, evidenceIds: ["e-one"] };
  const firmware = { key: "firmware", title: "ESP32固件", description: "执行程序", quote: "ESP32固件执行程序。", status: "proposal" as const, evidenceIds: ["e-two"] };
  const partial: FocusSession = { ...session, sections: [
    { ...session.sections[0], body: ir.quote, semanticStructure: { nodes: [ir], relations: [] } },
    { ...session.sections[1], body: firmware.quote, semanticStructure: { nodes: [firmware], relations: [] } },
  ], semanticOverview: { nodes: [{ ...ir, sectionIds: ["one"] }], relations: [] } };
  const model = projectUnderstandingModel(partial, true);
  expect(model.nodes.map(node => node.title)).toEqual(["Hardware IR", "ESP32固件"]);
  expect(model.nodes.find(node => node.title === "ESP32固件")).toMatchObject({ sectionIds: ["two"], semanticStatus: "proposal" });
});

it("preserves saved phase groups for legacy semantic concepts without guessing a shared concept's group", () => {
  const node = { key: "ir", title: "Hardware IR", description: "统一方案", quote: "统一方案", status: "discussed" as const, evidenceIds: [] };
  const a = { ...section("a", "架构协作", "统一方案"), phase: "核心处理", semanticStructure: { nodes: [node], relations: [] } };
  const first = projectUnderstandingModel({ sections: [a] }, true);
  expect(architectureGroups(first.nodes).map(group => group.title)).toEqual(["核心处理"]);
  const second = projectUnderstandingModel({ sections: [a, { ...a, id: "b", phase: "交付与验证" }] }, true);
  expect(architectureGroups(second.nodes)).toEqual([]);
  expect(second.nodes).toHaveLength(1);
  expect(a).not.toHaveProperty("layer");
});

it("removes a personal concept and referencing links without deleting generated facts", () => {
  const edits = { order: ["personal-concept:mine", "generated"], nodes: [
    { id: "personal-concept:mine", title: "我的理解", responsibility: "说明", sectionIds: [], links: [] },
    { id: "generated", title: "生成要点", responsibility: "职责", sectionIds: ["one"], links: [{ targetId: "personal-concept:mine", kind: "flow" as const }] },
  ] };
  const next = removePersonalProjectConcept(edits, "personal-concept:mine");
  expect(next.order).toEqual(["generated"]);
  expect(next.nodes).toEqual([{ ...edits.nodes[1], links: [] }]);
  expect(edits.nodes[1].links).toHaveLength(1);
  expect(() => removePersonalProjectConcept(edits, "generated")).toThrow();
});

it("deletes a chapter's authored card from the overview without changing article text or sources", () => {
  const card: FocusSection = { id: "mine", title: "个人补充", body: "我的内容", transition: "", kind: "review", origin: "user", evidenceIds: [] };
  const original = { ...session, sections: [{ ...session.sections[0], understandingPath: [card] }, session.sections[1]] };
  const concept = projectUnderstandingModel(original, true).nodes.find(node => node.title === card.title)!;
  expect(concept.personalCard).toEqual({ sectionId: "one", cardId: "mine" });
  const next = removeProjectUnderstandingCard(original, concept.id);
  expect(next.sections[0].understandingPath).toEqual([]);
  expect(next.sections[0].body).toBe(original.sections[0].body);
  expect(next.evidence).toEqual(original.evidence);
  expect(projectUnderstandingModel(next, true).nodes.some(node => node.id === concept.id)).toBe(false);
});

it("uses the saved project modules and interfaces in the default work overview without requiring complete mode", () => {
  const project = projectSession(), model = projectUnderstandingModel(project);
  const input = model.nodes.find(node => node.title === "需求采集")!, plan = model.nodes.find(node => node.title === "方案生成")!;
  expect(input).toMatchObject({ inputs: ["用户需求"], outputs: ["目标与约束"], responsibility: "提取目标与约束" });
  expect(plan.semanticStatus).toBe("proposal");
  expect(model.edges).toContainEqual(expect.objectContaining({ from: input.id, to: plan.id, label: "目标与约束" }));
  const edited = projectUnderstandingModel({ ...project, projectUnderstanding: { order: [], nodes: [{ id: input.id, title: "个人采集模块", responsibility: "我的职责", sectionIds: ["one"], links: [] }] } });
  expect(edited.nodes.find(node => node.id === input.id)).toMatchObject({ title: "个人采集模块", responsibility: "我的职责" });
});
