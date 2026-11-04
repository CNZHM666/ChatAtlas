import { expect, it } from "vitest";
import { joinedResults } from "./focus-coverage";
import { readingTitle } from "../shared/reading-title";
const section = { id: "s", title: "模型约束", body: "核对当前约束。", kind: "review" as const, evidenceIds: ["e1"], transition: "" };
it("keeps one compact result title and removes only identical source-bound duplicates", () => {
  const result = joinedResults([{ title: "ChatAtlas 项目演进", sections: [section] }, { title: "ChatAtlas 项目演进：后续架构讨论", sections: [section, { ...section, body: "追加新的约束。" }, { ...section, evidenceIds: ["e2"] }] }], "zh-CN");
  expect(result.title).toBe("ChatAtlas 项目演进"); expect(result.sections).toHaveLength(3);
  expect(result.sections.map(item => item.body)).toContain("追加新的约束。");
  expect(readingTitle("输入 / 输出")).toBe("输入 / 输出");
  expect(readingTitle("ChatAtlas 项目演进 / " + "ChatAtlas 架构迭代 ".repeat(15))).toBe("ChatAtlas 项目演进");
  expect(Array.from(readingTitle("完整的长标题".repeat(20)))).toHaveLength(48);
});
