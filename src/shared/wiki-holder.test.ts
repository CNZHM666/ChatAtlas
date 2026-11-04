import { expect, it } from "vitest";
import { wikiHolderOf, withHolderMarks } from "./wiki-holder";

it("holds a sentence as decided only when every unit is the user's decision, and as the weakest holder otherwise", () => {
  expect(wikiHolderOf(["confirmed", "confirmed"])).toBe("decided");
  expect(wikiHolderOf(["confirmed", "proposal"])).toBe("ai");
  expect(wikiHolderOf(["relayed", "stated"])).toBe("material");
  expect(wikiHolderOf(["stated", "reported"])).toBe("user");
  // A replaced or unsettled point is marked as such, whoever proposed it.
  expect(wikiHolderOf(["history", "proposal"])).toBe("earlier");
  expect(wikiHolderOf(["open", "proposal"])).toBe("open");
  expect(wikiHolderOf([])).toBeUndefined();
});

it("puts a mark after the sentence ending each run, past closing emphasis, and none for text it cannot find", () => {
  const text = "第一版只做导入。索引使用 **Orama 全文检索**。首页只保留搜索入口。";
  // Status marks stay past closing emphasis; the assistant's text, the default, carries none.
  expect(withHolderMarks(text, [{ text: "索引使用 Orama 全文检索。", holder: "open" }, { text: "首页只保留搜索入口。", holder: "material" }, { text: "不存在的句子。", holder: "user" }], true))
    .toBe("第一版只做导入。索引使用 **Orama 全文检索**。〔未定〕首页只保留搜索入口。〔资料〕");
  expect(withHolderMarks("第一版只做导入。", [{ text: "第一版只做导入。", holder: "ai" }], true)).toBe("第一版只做导入。");
});


it("never puts a mark inside the next sentence's bold, and marks pasted material only where it states a choice or rule", () => {
  // The run ends before "**核心体验…**": its mark stays outside that bold.
  expect(withHolderMarks("可复用的项目知识。**核心体验是找回、理解和继续**。", [{ text: "可复用的项目知识。", holder: "decided" }], true))
    .toBe("可复用的项目知识。〔已定〕**核心体验是找回、理解和继续**。");
  // A description from pasted material reads like the rest; a rule from it keeps its mark.
  expect(withHolderMarks("索引使用 Orama。第一版只做 ChatGPT 导入。", [{ text: "索引使用 Orama。", holder: "material" }, { text: "第一版只做 ChatGPT 导入。", holder: "material" }], true))
    .toBe("索引使用 Orama。第一版只做 ChatGPT 导入。〔资料〕");
  // What the code does now, from pasted material, is no suggestion: it keeps its mark.
  expect(withHolderMarks("消息全文索引正在建设中。", [{ text: "消息全文索引正在建设中。", holder: "material" }], true)).toBe("消息全文索引正在建设中。〔资料〕");
});

it("marks a claim ending on a clause where it ends, so the rest of the sentence keeps its own mark", () => {
  const text = "采用浅色极简首页，包含居中欢迎区，并认可推开式分屏作为默认交互模式。";
  expect(withHolderMarks(text, [{ text: "采用浅色极简首页，包含居中欢迎区", holder: "decided" }, { text: "并认可推开式分屏作为默认交互模式。", holder: "material" }], true))
    .toBe("采用浅色极简首页，包含居中欢迎区〔已定〕，并认可推开式分屏作为默认交互模式。");
  // Pasted material naming no decision reads as unmarked: the part after the decided clause carries no 〔已定〕.
});

it("never puts a mark inside a quotation a claim ends in", () => {
  expect(withHolderMarks("主标题为“你今天想做什么硬件？”，中央为大输入框。", [{ text: "主标题为“你今天想做什么硬件？", holder: "user" }], true))
    .toBe("主标题为“你今天想做什么硬件？”〔你〕，中央为大输入框。");
});
