import { expect, it } from "vitest";
import { restoredEmptyItems, restoredSkippedOrdinals, withoutEmptyHeadings } from "./wiki-empty-items";
import { UNDECIDED } from "./open-words";

it("gives an emptied ordinal item back from the unit telling it, and drops a bare marker it cannot place", () => {
  const plan = { id: "u1", statement: "分三版迭代：第一版保留原成长区；第二版增加Agent动态状态、10分钟守护、60秒复盘；第三版加入自动分组。" };
  const { text, restored } = restoredEmptyItems("1. **第一版**：保留原成长区。\n2.\n3. **第三版**：加入自动分组。", [plan]);
  expect(text).toBe("1. **第一版**：保留原成长区。\n2. **第二版**：增加Agent动态状态、10分钟守护、60秒复盘。\n3. **第三版**：加入自动分组。");
  expect(restored).toEqual([{ text: "增加Agent动态状态、10分钟守护、60秒复盘。", unitIds: ["u1"] }]);
  expect(restoredEmptyItems("- **首屏**：简洁。\n-\n- **对话层**：确定清单。", [plan]).text).toBe("- **首屏**：简洁。\n- **对话层**：确定清单。");
});

it("drops a subtopic heading that heads nothing", () => {
  expect(withoutEmptyHeadings("开头。\n\n### 海外\n\n| a |\n\n### 国内")).toBe("开头。\n\n### 海外\n\n| a |");
  expect(withoutEmptyHeadings("开头。\n\n### 空\n\n### 有\n\n内容。")).toBe("开头。\n\n### 有\n\n内容。");
});

it("reads 并存 as open only of options", () => {
  expect(UNDECIDED.test("两种方案并存，尚需选择。")).toBe(true);
  expect(UNDECIDED.test("这些不同时间点的数值并存，反映了波动状态。")).toBe(false);
});

it("gives back an ordered item a sentence left out, from the unit telling it and the one after it", () => {
  const plan = { id: "u1", statement: "分三版迭代：第一版保留原成长区并适配AI流程；第二版增加Agent动态状态、10分钟守护、60秒复盘、风险报告；第三版加入自动分组、小组任务。" };
  const { text, restored } = restoredSkippedOrdinals("开发规划分三版迭代：第一版保留原成长区并适配AI流程，第三版加入自动分组与小组任务。实施上坚持组件化。", [plan]);
  expect(text).toBe("开发规划分三版迭代：第一版保留原成长区并适配AI流程，第二版增加Agent动态状态、10分钟守护、60秒复盘、风险报告，第三版加入自动分组与小组任务。实施上坚持组件化。");
  expect(restored).toEqual([{ text: "第二版增加Agent动态状态、10分钟守护、60秒复盘、风险报告", unitIds: ["u1"] }]);
  expect(restoredSkippedOrdinals("第一版和第三版相同。", [plan]).text).toBe("第一版和第三版相同。");
  expect(restoredSkippedOrdinals("第一步打开，第三步关闭。", [plan]).text).toBe("第一步打开，第三步关闭。");
});
