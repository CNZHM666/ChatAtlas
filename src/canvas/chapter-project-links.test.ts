import { expect, it } from "vitest";
import { chapterProjectLinks } from "./chapter-project-links";
import { projectSession } from "../test/project-fixture";

it("links only a unique canonical module with the same source and quoted context", () => {
  const session = projectSession(), section = session.sections[0];
  const step = { ...section, id: "step", title: "需求采集", body: "需求采集提取目标与约束。" };
  expect(chapterProjectLinks(section, [step], session)).toMatchObject([{ stepId: "step", moduleId: "module:input", module: { inputs: ["用户需求"], outputs: ["目标与约束"] } }]);
  expect(chapterProjectLinks(section, [{ ...step, body: "旧方案：需求采集负责采购。" }], session)).toEqual([]);
  expect(chapterProjectLinks(section, [{ ...step, evidenceIds: ["different-source"] }], session)).toEqual([]);
  expect(chapterProjectLinks({ ...section, userEdited: true }, [step], session)).toEqual([]);
  expect(chapterProjectLinks(section, [{ ...step, origin: "user" }], session)).toEqual([]);
  session.projectState!.modules.push({ ...session.projectState!.modules[0], id: "ambiguous" });
  expect(chapterProjectLinks(section, [step], session)).toEqual([]);
});
