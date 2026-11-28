import { describe, expect, it } from "vitest";
import { cleanEditableChapterProse } from "./chapter-editable-prose";

describe("cleanEditableChapterProse", () => {
  it("strips hidden source code captions, collapsed reference-example supplements, and internal citations", () => {
    const raw = [
      "### 核心价值主张",
      "",
      "产品核心价值在于把硬件想明白。[来源](#atlas-original-ref-1)",
      "",
      "*讨论中的原文代码 · AI 建议，未确认*",
      "",
      "```text",
      "用户一句话 -> 画布预览",
      "```",
      "",
      "<details data-atlas=\"atlas-wiki-supplement\">",
      "<summary>参考示例 · 1 项</summary>",
      "",
      "```ts",
      "interface Pin { id: string }",
      "```",
      "</details>",
      "",
      "后续验证基础拓扑稳定性。[S-1-a]",
    ].join("\n");

    expect(cleanEditableChapterProse(raw)).toBe(
      "### 核心价值主张\n\n产品核心价值在于把硬件想明白。\n\n后续验证基础拓扑稳定性。",
    );
  });

  it("keeps ordinary Markdown code blocks and user prose intact", () => {
    const markdown = "## 方案\n\n```ts\nconst x = 1;\n```\n\n继续推进。";
    expect(cleanEditableChapterProse(markdown)).toBe(markdown);
  });
});
