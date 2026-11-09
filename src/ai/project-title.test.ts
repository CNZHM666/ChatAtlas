import { expect, it } from "vitest";
import { fallbackProjectTitle } from "./project-title";

it("titles a project by its topic or its conversations, never by the request asking for it", () => {
  // The workbench's own request names nothing: the conversation's title.
  expect(fallbackProjectTitle("把全部已选对话整理成一个项目", ["Python 入门与开源贡献"], true)).toBe("Python 入门与开源贡献");
  expect(fallbackProjectTitle("Create a project from all selected conversations", ["Budget app", "Budget v2"], false)).toBe("Budget app and 1 more");
  expect(fallbackProjectTitle("把全部已选对话整理成一个项目", ["规划番茄钟扩展 MVP", "专注计时器V0.1评审"], true)).toBe("规划番茄钟扩展 MVP 等 2 个对话");
  // A request naming its topic gives the topic; a goal written as such stays.
  expect(fallbackProjectTitle("帮我整理成一个项目：专注计时器", ["a"], true)).toBe("专注计时器");
  expect(fallbackProjectTitle("番茄钟扩展第一版", ["a"], true)).toBe("番茄钟扩展第一版");
});
