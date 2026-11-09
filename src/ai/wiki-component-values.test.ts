import { expect, it } from "vitest";
import { droppedOrphanPartNotes } from "./wiki-component-values";

it("drops a note on the parts' values once the sentence listing them is gone, and keeps one that follows its list", () => {
  const alone = "全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。这些差异是组件例外还是后来的规范，讨论中未明确。";
  const listed = "全局圆角统一控制在6px~8px，但部分组件另有取值：输入框 20~26px。这些差异是组件例外还是后来的规范，讨论中未明确。";
  const chapter = { body: `开头。\n\n### 布局\n\n${alone}\n\n${listed}`, paragraphs: [{ text: alone }, { text: listed }] };
  expect(droppedOrphanPartNotes([chapter])).toBe(1);
  expect(chapter.paragraphs[0].text).toBe("全局圆角统一控制在6px~8px，禁止使用16px以上的大圆角。");
  expect(chapter.paragraphs[1].text).toBe(listed);
  expect(chapter.body).not.toContain("大圆角。这些差异");
});
