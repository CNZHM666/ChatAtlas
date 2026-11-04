import { expect, it } from "vitest";
import { wikiUserChooses } from "./wiki-user-choice";

it("keeps feasibility questions and unused objects separate from a decision", () => {
  expect(wikiUserChooses("可以做那种拍照识别的吗，用户拍以前不用的电子产品看看能不能废物利用，你感觉怎么样")).toBe(false);
  expect(wikiUserChooses("我想知道是否应该使用云端同步？")).toBe(false);
  expect(wikiUserChooses("Could we use a hosted database? What do you think?")).toBe(false);
  expect(wikiUserChooses("以前不用的设备可以识别吗？")).toBe(false);
  expect(wikiUserChooses("识别以前不用的零件是一个想法。")).toBe(false);
});

it("retains explicit choices even when the user also asks for advice", () => {
  for (const quote of ["我决定增加书签，怎么实现？", "我想让用户自己接 API，不想别人用我自己的 Key。", "不用云端数据库，只用本地存储。", "应该首屏先展示欢迎页，再进入画布，你给我分析一下。", "我喜欢这种设计", "我的项目还有个功能就是所有 AI 的管家。", "We decided to keep local storage."]) expect(wikiUserChooses(quote), quote).toBe(true);
});
