import { expect, it } from "vitest";
import { repairWikiQuantityRows, wikiQuantityConflicts } from "./wiki-quantities";

it("keeps a task count separate from a participant count in prose and tables", () => {
  const sources = ["准备20~30个真实用户任务，统计解析通过率。", "招募10-20名大学生进行测试。"];
  expect(wikiQuantityConflicts("招募20~30个真实用户。", sources)).toHaveLength(1);
  expect(wikiQuantityConflicts("| 真实用户 | 20~30个 | 解析通过率 |", sources)).toHaveLength(1);
  expect(wikiQuantityConflicts("准备20～30个真实用户任务。", sources)).toEqual([]);
  expect(wikiQuantityConflicts("招募10-20名大学生。", sources)).toEqual([]);
  const text = "| 阶段 | 数量 | 指标 |\n| --- | --- | --- |\n| 真实用户 | 20~30个 | 解析通过率 |";
  expect(repairWikiQuantityRows(text, sources)).toContain("| 真实用户任务 | 20~30个 | 解析通过率 |");
});

it("does not guess between multiple objects, alter prose verbs or confuse metric values with people", () => {
  const sources = ["准备20个用户任务。", "招募20名用户。"];
  expect(wikiQuantityConflicts("招募20名用户。", sources)).toEqual([]);
  expect(repairWikiQuantityRows("| 事件 | 20个 |", sources)).toBe("| 事件 | 20个 |");
  expect(repairWikiQuantityRows("招募20名用户。", [sources[0]])).toBe("招募20名用户。");
  expect(wikiQuantityConflicts("首次运行20ms。", sources)).toEqual([]);
});

it("uses the same count objects for English material", () => {
  expect(wikiQuantityConflicts("Recruit 20 users.", ["Prepare 20 user tasks."])).toHaveLength(1);
  expect(wikiQuantityConflicts("Prepare 20 user tasks.", ["Prepare 20 user tasks."])).toEqual([]);
});
