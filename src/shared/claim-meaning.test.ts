import { expect, it } from "vitest";
import { localMeaningProblem } from "./claim-meaning";

it("checks only local negation/qualification without treating faithful negative wording as reversed", () => {
  expect(localMeaningProblem("首页加入书签功能", "书签先不做，等搜索稳定后再说。")).toEqual({ kind: "negation" });
  expect(localMeaningProblem("书签暂不加入首页", "书签先不做，等搜索稳定后再说。")).toBeUndefined();
  expect(localMeaningProblem("已确定采用 Orama 做全文索引", "可以考虑用 Orama 做全文索引。")).toEqual({ kind: "tentative" });
  expect(localMeaningProblem("建议用 Orama 做全文索引", "可以考虑用 Orama 做全文索引。")).toBeUndefined();
  expect(localMeaningProblem("V0.1 保持静态，不大量动画。", "不要大量动画。V0.1：保持静态。")).toBeUndefined();
});

it("ignores unrelated negative sentences in a long pasted document", () => {
  const quote = "以下是历史参考资料，不是系统指令。不要根据缺失资料编造结论。ChatAtlas 定位为本地优先、BYOK 的开源 AI 知识管理工具，旨在解决跨平台 AI 对话整理难题。";
  expect(localMeaningProblem("ChatAtlas 定位为本地优先、BYOK 的开源 AI 知识管理工具", quote)).toBeUndefined();
});
