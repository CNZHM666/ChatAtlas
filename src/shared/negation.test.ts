import { expect, it } from "vitest";
import { LEAVES_OUT, LEFT_OUT_LABEL, RULES_OUT_ZH } from "./negation";

it("tells a text ruling something out whatever its verb, and not the words that only start with 不", () => {
  for (const text of ["不引入服务器", "后续规划不再将云同步纳入开发范围", "绝不使用 chrome.storage.sync", "禁止网络请求", "避免依赖 setInterval", "无需注册", "不做账号系统", "不上传任何数据"]) expect(RULES_OUT_ZH.test(text), text).toBe(true);
  for (const text of ["界面不同于桌面版", "不断优化体验", "不仅支持本地，也支持导出", "首页不超过 3 个按钮", "这一点不错", "采用本地优先策略"]) expect(RULES_OUT_ZH.test(text), text).toBe(false);
});

it("reads what a limit leaves out after one shared set of words", () => {
  const object = (text: string) => text.match(new RegExp(String.raw`${LEAVES_OUT}[：:]?\s*([^。；;，,]+)`, "u"))?.[1];
  expect(object("V0.1 不做账号系统，所有数据仅存储在本地")).toBe("账号系统");
  expect(object("第一版不引入服务器")).toBe("服务器");
  expect(object("暂不开发：网站屏蔽")).toBe("网站屏蔽");
  expect(object("本阶段不包括 AI 助手")).toBe("AI 助手");
  expect(object("排除了社交排行榜")).toBe("社交排行榜");
  // A count is a limit, not an item left out.
  expect(object("禁止扩展至 3 个页面")).toBe("扩展至 3 个页面");
  expect(LEFT_OUT_LABEL.test("不引入")).toBe(true);
  expect(LEFT_OUT_LABEL.test("暂缓开发")).toBe(true);
  expect(LEFT_OUT_LABEL.test("仅保留")).toBe(false);
});
