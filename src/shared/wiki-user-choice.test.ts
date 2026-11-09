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

it("reads the user's English decisions, labelled or worded as a limit, and still not a question", () => {
  for (const quote of ["Decided: v1 is web only, no native mobile app.", "Confirmed: dashboard top bar is 48px and the global corner radius is 8px.", "For v1, do not include bank syncing or receipt OCR.", "No multi-currency in v1, USD only.", "Never send transaction data to any server in v1.", "Change of plan: use IndexedDB through Dexie instead.", "We'll go with monthly budgets."]) expect(wikiUserChooses(quote), quote).toBe(true);
  for (const quote of ["Should we only support USD?", "How does this compare with YNAB and Mint?", "Can you sketch the data model for transactions?"]) expect(wikiUserChooses(quote), quote).toBe(false);
});

it("reads a decision after a leading mark, and neither an undecided point nor a pasted review as one", () => {
  expect(wikiUserChooses("★ Confirmed: dashboard top bar is 48px.")).toBe(true);
  expect(wikiUserChooses("★ I can't decide whether budgets should be monthly or per pay period. What are the tradeoffs? Let's leave it open for now.")).toBe(false);
  expect(wikiUserChooses("Here is feedback a friend pasted from their review, what do you think?\n> \"The app should support multiple currencies from day one.\"")).toBe(false);
  expect(wikiUserChooses("确定：第一版不做账号系统。存储方案先不定。")).toBe(true);
  expect(wikiUserChooses("存储方案和弹窗宽度我先不定，两个方案都留着。")).toBe(false);
});
