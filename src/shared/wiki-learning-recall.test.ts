import { describe, expect, it } from "vitest";
import { recallAtChapterEnd, recallOf, recallQuote } from "./wiki-learning-recall";

describe("recall questions", () => {
  it("writes one as a quote under its card, and reads it back", () => {
    const quote = recallQuote("多个条件都为 True 时，执行哪一个？", "从上往下判断，\n遇到第一个 True 即停止。", true);
    expect(quote).toBe("> **回忆**：多个条件都为 True 时，执行哪一个？\n>\n> 从上往下判断， 遇到第一个 True 即停止。");
    expect(recallOf(quote)).toEqual({ question: "多个条件都为 True 时，执行哪一个？", answer: "从上往下判断， 遇到第一个 True 即停止。" });
  });

  it("gathers them at the chapter's end for a file, questions first and naming their card, answers after", () => {
    const body = ["### 条件判断 · 已会", "if 从上往下判断。", recallQuote("多个条件为真时执行哪个？", "第一个为真的。", true),
      "### 边界条件处理", "```python\nif v > 3:\n\n    print(v)\n```", recallQuote("「边界条件处理」容易错在哪里？", "区分 > 与 >=。", true)].join("\n\n");
    expect(recallAtChapterEnd(body, true)).toBe("### 条件判断 · 已会\n\nif 从上往下判断。\n\n### 边界条件处理\n\n```python\nif v > 3:\n\n    print(v)\n```\n\n"
      + "### 本章回忆题\n\n先不看上文，试着回答；答案在题目之后。\n\n1. 多个条件为真时执行哪个？（「条件判断」）\n2. 「边界条件处理」容易错在哪里？\n\n**参考答案**\n\n1. 第一个为真的。\n2. 区分 > 与 >=。");
    expect(recallAtChapterEnd("### 计划\n\n> 引用不是回忆题。", true)).toBe("### 计划\n\n> 引用不是回忆题。");
  });

  it("names a numbered card by its number, and an exercise's heading is no card", () => {
    const body = ["### 2.1 条件判断 · 已会", recallQuote("多个条件为真时执行哪个？", "第一个为真的。", true),
      "### 2.2 边界条件处理", "#### 练习 1", "```python\nif v > 3:\n```", recallQuote("「边界条件处理」容易错在哪里？", "区分 > 与 >=。", true)].join("\n\n");
    const gathered = recallAtChapterEnd(body, true);
    expect(gathered).toContain("1. 多个条件为真时执行哪个？（「2.1 条件判断」）\n2. 「2.2 边界条件处理」容易错在哪里？");
  });
});
