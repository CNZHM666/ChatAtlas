import { expect, it } from "vitest";
import { matchesTerms, questionSearchTerms, rankQuestionMatches } from "./question-search";

const texts = new Map([
  ["a", { head: "第一周学习安排", body: "先学 Git 基础，再练 Git 分支。" }],
  ["b", { head: "Git 命令记忆策略", body: "按场景记命令。" }],
  ["c", { head: "简历怎么写", body: "可以写上你的 GitHub 项目。" }],
  ["d", { head: "PR 流程", body: "git push 之后在 GitHub 上点 Compare & pull request，git 分支要先推送。" }],
]);
const ids = ["a", "b", "c", "d"];

it("lists questions that say the words first, then answers by how much they say about them, each with its line", () => {
  const found = rankQuestionMatches(ids, texts, "git");
  expect(found.map(item => item.id)).toEqual(["b", "d", "a", "c"]);
  expect(found[0]).toEqual({ id: "b", inQuestion: true });
  expect(found[1].snippet).toContain("git push");
});

it("needs every word typed, wherever each is found", () => {
  expect(rankQuestionMatches(ids, texts, "Git 分支").map(item => item.id)).toEqual(["d", "a"]);
  expect(rankQuestionMatches(ids, texts, "简历 GitHub").map(item => item.id)).toEqual(["c"]);
  expect(rankQuestionMatches(ids, texts, "Rust")).toEqual([]);
});

it("folds case and width, and keeps a Chinese phrase whole", () => {
  expect(questionSearchTerms("  ＧＩＴ  分支 ")).toEqual(["git", "分支"]);
  expect(matchesTerms("学习安排", ["学习安排"])).toBe(true);
  expect(matchesTerms("学习的安排", ["学习安排"])).toBe(false);
  expect(rankQuestionMatches(ids, texts, "")).toHaveLength(4);
});
