import { expect, it } from "vitest";
import { literalNegationCorrection, localMeaningProblem } from "./claim-meaning";

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

it("compares matched actions one at a time, including in mixed positive and negative sentences", () => {
  const source = "首版不要自动同步采购草稿，但允许手动同步采购草稿。不要上传元件照片。";
  expect(localMeaningProblem("首版不要自动同步采购草稿，但允许手动同步采购草稿。", source)).toBeUndefined();
  expect(localMeaningProblem("首版支持手动同步采购草稿。", source)).toBeUndefined();
  expect(localMeaningProblem("首版支持识别元件照片。", source)).toBeUndefined();
  expect(localMeaningProblem("首版支持自动同步收藏。", source)).toBeUndefined();
  expect(localMeaningProblem("首版不要导出订单，仍会自动同步采购草稿。", source)).toMatchObject({
    kind: "negation", claimExcerpt: "仍会自动同步采购草稿", cue: "首版不要自动同步采购草稿",
  });
  expect(localMeaningProblem("V2 支持自动同步采购草稿。", source)).toBeUndefined();
  expect(localMeaningProblem("Automatically sync purchase drafts.", "Do not automatically sync purchase drafts.")).toMatchObject({ kind: "negation" });
  expect(localMeaningProblem("Sync purchase drafts.", "Should we not sync purchase drafts?")).toBeUndefined();
});

it("checks a scope list item by item against the plan table", () => {
  const table = "| 功能 | 具体要求 | 优先级 |\n| 计时控制 | 开始、暂停、继续、重置 | P0 必做 |\n| 后台运行 | 关闭弹窗不影响倒计时 | P0 必做 |\n| 网站屏蔽 | 限制访问娱乐网页 | V2 |\n第一版不需要后端。";
  expect(localMeaningProblem("功能范围涵盖计时控制、后台运行、本地保存。", table)).toBeUndefined();
  expect(localMeaningProblem("功能范围涵盖计时控制、后台运行、网站屏蔽。", table)).toMatchObject({ kind: "negation", subject: "网站屏蔽", cue: "V2" });
  expect(localMeaningProblem("V2 涵盖计时控制、后台运行、网站屏蔽。", table)).toBeUndefined();
});

it("accepts equivalent prohibitions and ignores a rejected quoted example", () => {
  expect(localMeaningProblem("不交给 LLM 判断。", "不要交给 LLM 判断。")).toBeUndefined();
  expect(localMeaningProblem("交给 LLM 判断。", "不要交给 LLM 判断。")).toMatchObject({ kind: "negation" });
  expect(localMeaningProblem("严禁强制英文 Web Font 渲染中文。", "不要强制英文 Web Font 渲染中文。")).toBeUndefined();
  expect(localMeaningProblem("不要强制英文 Web Font 渲染中文。", "严禁强制英文 Web Font 渲染中文。")).toBeUndefined();
  expect(localMeaningProblem("强制英文 Web Font 渲染中文。", "严禁强制英文 Web Font 渲染中文。")).toMatchObject({ kind: "negation" });

  const claim = "未配置 API Key 时，用户仍可使用 Demo、拖拽节点、编辑 IR、查看 BOM、Validator、LocalInterpreter 及示例项目，仅复杂自然语言 AI 功能受限。";
  const source = "不要把整个产品锁死：\n\n> “没有 API Key 就什么都不能用。”\n\n你完全可以让没 API 的人依然能够：\n\n- 编辑 IR\n- 查看 BOM";
  expect(localMeaningProblem(claim, source)).toBeUndefined();
  expect(localMeaningProblem(claim, "> “没有 API Key 就什么都不能用。”")).toBeUndefined();
  expect(localMeaningProblem("没有 API Key 时也能编辑 IR。", "没有 API Key 时不能编辑 IR。")).toMatchObject({ kind: "negation" });
});

it("recognizes negation before new predicates without mistaking a noun or a question for a restriction", () => {
  expect(localMeaningProblem("本轮不重排消息优先级。", "本轮不要重排消息优先级。")).toBeUndefined();
  expect(localMeaningProblem("本轮重排消息优先级。", "本轮不重排消息优先级。")).toMatchObject({ kind: "negation" });
  expect(localMeaningProblem("规则引擎改变阈值。", "规则引擎不改变阈值。")).toMatchObject({ kind: "negation" });
  expect(localMeaningProblem("改用钢制外壳。", "采用不锈钢外壳。")).toBeUndefined();
  expect(localMeaningProblem("支持新元件。", "未知元件待补充。")).toBeUndefined();
  expect(localMeaningProblem("重排消息优先级。", "重排不重排消息优先级？")).toBeUndefined();
  expect(literalNegationCorrection("使用锈钢外壳。", "使用不锈钢外壳。")).toBeUndefined();
  expect(literalNegationCorrection("本轮重排消息优先级。", "本轮不重排消息优先级。")).toBe("本轮不重排消息优先级。");
});
