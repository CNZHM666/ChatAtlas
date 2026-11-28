import { describe, expect, it } from "vitest";
import { extractComparisonProse } from "./diff-prose";

describe("extractComparisonProse", () => {
  it("strips source code captions, fenced code blocks, reference example details, and internal links", () => {
    const raw = [
      "## 核心定位",
      "",
      "项目面向大学生与硬件初学者。[来源](#atlas-original-ref-1)",
      "",
      "*讨论中的原文代码 · AI 建议，未确认*",
      "",
      "```text",
      "┌──────────┐",
      "│ 画布预览 │",
      "└──────────┘",
      "```",
      "",
      "### 参考示例",
      "",
      "*讨论中的原文代码 · AI 建议，未确认*",
      "",
      "```ts",
      "interface Node { id: string }",
      "```",
      "",
      "<details data-atlas=\"atlas-wiki-supplement\">",
      "<summary>参考示例 · 2 项</summary>",
      "",
      "#### 1. 示例",
      "",
      "```text",
      "foo -> bar",
      "```",
      "</details>",
      "",
      "## 下一步",
      "",
      "先完成基础拓扑稳定性验证。[S-1-a]",
    ].join("\n");

    expect(extractComparisonProse(raw)).toBe(
      "## 核心定位\n\n项目面向大学生与硬件初学者。\n\n## 下一步\n\n先完成基础拓扑稳定性验证。",
    );
  });

  it("keeps normal prose, lists, and headings intact", () => {
    const prose = "## 决策\n\n- 采用 BYOK 策略。\n- 保留原文追溯能力。";
    expect(extractComparisonProse(prose)).toBe(prose);
  });
});
