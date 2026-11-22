import { describe, expect, it } from "vitest";
import { renumberedLists, splitJoinedTable, tidiedMarkdown, tidyGeneratedWikiMarkdown } from "./wiki-markdown-tidy";

describe("tidied Markdown", () => {
  it("deduplicates generated list labels, joins an adjacent restart and leaves fenced content literal", () => {
    const source = "### 独立研究章节\n\n1. **1. 收集**\n2. **2. 归组**\n3. 校验\n\n1. 保存\n2. 导出\n\n```text\n### 独立研究章节\n1. 1. 相同示例\n```";
    expect(tidyGeneratedWikiMarkdown(source)).toBe("### 外部研究与参考\n\n1. **收集**\n2. **归组**\n3. 校验\n\n4. 保存\n5. 导出\n\n```text\n### 独立研究章节\n1. 1. 相同示例\n```");
  });
  it("splits a table written on one line into its rows, and leaves || elsewhere", () => {
    expect(splitJoinedTable("| 层级 | 代表项目 || --- | --- || 重量级 | PX4-Autopilot, Drake |")).toBe("| 层级 | 代表项目 |\n| --- | --- |\n| 重量级 | PX4-Autopilot, Drake |");
    expect(splitJoinedTable("用 `a || b` 判断。")).toBe("用 `a || b` 判断。");
  });

  it("keeps overflow cells visible without inventing an association with the table heading", () => {
    const header = "| 问题 | 方案 |\n| --- | --- |";
    const valid = "| 入口 | 搜索 \\| 筛选 |";
    const malformed = "| 布局 | 另一处入口 | 将图标放在侧栏 |";
    const fenced = "\x60\x60\x60text\n" + header + "\n" + malformed + "\n\x60\x60\x60";
    expect(tidyGeneratedWikiMarkdown([header, valid, malformed, "", fenced].join("\n")))
      .toBe([header, valid, "", "- 布局\n- 另一处入口\n- 将图标放在侧栏", "", fenced].join("\n"));
  });

  it("numbers a list with an item left out in turn, and leaves code and lists not only climbing", () => {
    expect(renumberedLists("1. **第 1 周**：Git。\n2. **第 2 周**：Python。\n3. **第 3 周**：pytest。\n5. **约 4～6 周后**：ROS2。")).toBe("1. **第 1 周**：Git。\n2. **第 2 周**：Python。\n3. **第 3 周**：pytest。\n4. **约 4～6 周后**：ROS2。");
    expect(renumberedLists("1. a\n   接着说\n3. b")).toBe("1. a\n   接着说\n2. b");
    expect(renumberedLists("3. c\n2. b\n1. a")).toBe("3. c\n2. b\n1. a");
    expect(renumberedLists("```text\n1. a\n3. b\n```")).toBe("```text\n1. a\n3. b\n```");
  });

  it("changes the body with the paragraph", () => {
    const chapters = [{ id: "c", title: "", question: "", group: "", body: "### 里程碑\n\n1. a\n3. b", paragraphs: [{ subtopic: "里程碑", text: "1. a\n3. b", unitIds: [] }], problems: [] }];
    expect(tidiedMarkdown(chapters)).toBe(1);
    expect(chapters[0].body).toBe("### 里程碑\n\n1. a\n2. b");
  });
});
