import { expect, it } from "vitest";
import { queryTerms, searchScore } from "./query";
import { projectQueryPassages } from "../ai/project-query-materials";
import type { ConversationMessage } from "../shared/types";
import type { TranscriptPassage } from "./transcript-index";
const message = (id: string, content: string): ConversationMessage => ({ id, content, conversationId: "allowed", messageIndex: 0, role: "assistant", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 });
const passage = (raw: ConversationMessage): TranscriptPassage => ({ document: { id: raw.id, conversationId: raw.conversationId, episodeId: "", title: "Discussion", body: raw.content, terms: "" }, role: raw.role, text: raw.content, evidence: { messageId: raw.id, messageIndex: raw.messageIndex, excerpt: raw.content.slice(0, 240) } });
it("finds the reported Chinese product-reference question without conversational bigram noise", () => {
  const question = "有没有类似的相关产品可以供我参考？";
  expect(queryTerms(question)).not.toContain("有没");
  for (const text of ["可以参考 Boardly、WireMind 和 Fritzing，它们提供硬件设计能力。", "竞品对标：Boardly 与 WireMind，比较交互和硬件方案生成。"]) {
    expect(searchScore(question, text, true)).toBeGreaterThan(0);
    expect(projectQueryPassages(question, [passage(message("answer", text))]).length).toBeGreaterThan(0);
  }
  expect(searchScore(question, "今天讨论数据库备份。", true)).toBe(0);
});
