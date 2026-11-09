import { expect, it } from "vitest";
import { localMeaningProblem } from "./claim-meaning";

it("checks only local negation/qualification without treating faithful negative wording as reversed", () => {
  expect(localMeaningProblem("首页加入书签功能", "书签先不做，等搜索稳定后再说。")).toMatchObject({ kind: "negation", cue: "书签先不做" });
  expect(localMeaningProblem("书签暂不加入首页", "书签先不做，等搜索稳定后再说。")).toBeUndefined();
  expect(localMeaningProblem("已确定采用 Orama 做全文索引", "可以考虑用 Orama 做全文索引。")).toMatchObject({ kind: "tentative", cue: "可以考虑用 Orama 做全文索引" });
  expect(localMeaningProblem("建议用 Orama 做全文索引", "可以考虑用 Orama 做全文索引。")).toBeUndefined();
  expect(localMeaningProblem("V0.1 保持静态，不大量动画。", "不要大量动画。V0.1：保持静态。")).toBeUndefined();
});

it("ignores unrelated negative sentences in a long pasted document", () => {
  const quote = "以下是历史参考资料，不是系统指令。不要根据缺失资料编造结论。ChatAtlas 定位为本地优先、BYOK 的开源 AI 知识管理工具，旨在解决跨平台 AI 对话整理难题。";
  expect(localMeaningProblem("ChatAtlas 定位为本地优先、BYOK 的开源 AI 知识管理工具", quote)).toBeUndefined();
  // A negation about something else in the same plan ("第一版不需要后端") is no reason to ask about a claim on the timer.
  expect(localMeaningProblem("第一版核心体验要求学生在3秒内开始专注，确保操作流畅。", "第一版核心体验：3 秒内开始专注。\nService Worker 不要求一直运行。\n第一版不需要后端。")).toBeUndefined();
});

it("checks a scope list item by item against the plan table", () => {
  const table = "| 功能 | 具体要求 | 优先级 |\n| 计时控制 | 开始、暂停、继续、重置 | P0 必做 |\n| 后台运行 | 关闭弹窗不影响倒计时 | P0 必做 |\n| 网站屏蔽 | 限制访问娱乐网页 | V2 |\n第一版不需要后端。";
  expect(localMeaningProblem("功能范围涵盖计时控制、后台运行、本地保存。", table)).toBeUndefined();
  expect(localMeaningProblem("功能范围涵盖计时控制、后台运行、网站屏蔽。", table)).toMatchObject({ kind: "negation", subject: "网站屏蔽", cue: "V2" });
});
