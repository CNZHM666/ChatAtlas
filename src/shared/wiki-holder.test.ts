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

it("marks a claim where it starts a sentence or list item, not where another sentence says it first", () => {
  const text = "技术选型上使用 React Flow，且严格禁止改变两个核心原则。\n\n- **核心原则**：禁止改变两个核心原则。";
  expect(withHolderMarks(text, [{ text: "禁止改变两个核心原则。", holder: "decided" }], true)).toBe("技术选型上使用 React Flow，且严格禁止改变两个核心原则。\n\n- **核心原则**：禁止改变两个核心原则。〔已定〕");
  // Said only once, mid-sentence, it is marked there.
  expect(withHolderMarks("前端使用 React Flow，且禁止改变两个核心原则。", [{ text: "禁止改变两个核心原则。", holder: "decided" }], true)).toBe("前端使用 React Flow，且禁止改变两个核心原则。〔已定〕");
});

it("marks a table row's item after what the row says of it", () => {
  const table = "| 事项 | 第一版 |\n| --- | --- |\n| 数据云同步 | 不做 |\n| 登录功能 | 不引入 |";
  expect(withHolderMarks(table, [{ text: "数据云同步", holder: "decided" }], true)).toContain("| 数据云同步 | 不做〔已定〕 |");
  // A later claim in the row keeps its own mark there.
  expect(withHolderMarks(table, [{ text: "登录功能", holder: "decided" }, { text: "不引入", holder: "user" }], true)).toContain("| 登录功能〔已定〕 | 不引入〔你〕 |");
});

it("marks an earlier point before the clause telling what replaced it", () => {
  const text = "用户明确表示存储方案和弹窗宽度的最终选择暂不决定，两个备选方案均保留；后续确认 Popup 宽度为 380px，本地存储采用分片键。";
  expect(withHolderMarks(text, [{ text, holder: "earlier" }], true)).toBe("用户明确表示存储方案和弹窗宽度的最终选择暂不决定，两个备选方案均保留〔此前〕；后续确认 Popup 宽度为 380px，本地存储采用分片键。");
});

it("never marks a table's head, which would break the table", () => {
  const table = "| 方案 | 宽度设定 | 高度目标 |\n| --- | --- | --- |\n| 后续变量化 | CSS变量 --popup-width | 约460–480px |";
  expect(withHolderMarks(table, [{ text: "| 方案 | 宽度设定 | 高度目标 |", holder: "earlier" }], true)).toBe(table);
  // A whole row is marked inside its last cell.
  expect(withHolderMarks(table, [{ text: "| 后续变量化 | CSS变量 --popup-width | 约460–480px |", holder: "earlier" }], true)).toContain("| 约460–480px〔此前〕 |");
});

it("never puts a mark inside a code block", () => {
  const text = "常见错误包括混淆赋值与比较。\n\n```python\ncheck_voltage(...)\n```";
  const marked = withHolderMarks(text, [{ text: "check_voltage(...)", holder: "corrected" }], true);
  expect(marked).toContain("```python\ncheck_voltage(...)\n```");
  expect(marked).not.toContain("check_voltage(...)〔");
  expect(marked).not.toContain("```〔");
});
