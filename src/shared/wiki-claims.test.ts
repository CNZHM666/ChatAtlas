import { expect, it } from "vitest";
import { groundWikiClaims, validateWikiClaims, wikiQuoteRange } from "./wiki-claims";
import { projectFixture, projectText } from "../test/project-fixture";
import type { ConversationMessage } from "./types";
it("keeps only conclusions whose quote belongs to the actual original message", () => {
  const sections = [{ ...projectFixture.sections[0], claims: [{ text: "优先验证核心流程", quote: "先验证核心流程", evidenceIds: ["e1"] }, { text: "已经发布", quote: "已经发布", evidenceIds: ["e1"] }] }];
  const result = groundWikiClaims(sections, projectFixture.evidence, [{ id: "message", conversationId: "source", content: projectText } as ConversationMessage]);
  expect(result[0].claims).toEqual([sections[0].claims[0]]);
  expect(validateWikiClaims(undefined, [])).toBeUndefined();
  expect(() => validateWikiClaims([{ text: "Bad", quote: "Bad", evidenceIds: ["made-up"] }], ["e1"])).toThrow();
});

it("finds a quote across Markdown emphasis, spacing and full- or half-width punctuation", () => {
  const content = "我认为这五个模块已经比较完整。\n\n其中对话库应该类似于 **AI 对话的文件管理器**，而不是又一个聊天机器人。";
  const range = wikiQuoteRange(content, "其中对话库应该类似于AI 对话的文件管理器,而不是又一个聊天机器人。");
  expect(range && content.slice(range.start, range.end)).toBe("其中对话库应该类似于 **AI 对话的文件管理器**，而不是又一个聊天机器人。");
  expect(wikiQuoteRange(content, "对话库是又一个聊天机器人")).toBeUndefined();
});
