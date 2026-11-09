import { describe, expect, it } from "vitest";
import { renumberedLists, splitJoinedTable, tidiedMarkdown } from "./wiki-markdown-tidy";

describe("tidied Markdown", () => {
  it("splits a table written on one line into its rows, and leaves || elsewhere", () => {
    expect(splitJoinedTable("| 层级 | 代表项目 || --- | --- || 重量级 | PX4-Autopilot, Drake |")).toBe("| 层级 | 代表项目 |\n| --- | --- |\n| 重量级 | PX4-Autopilot, Drake |");
    expect(splitJoinedTable("用 `a || b` 判断。")).toBe("用 `a || b` 判断。");
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
