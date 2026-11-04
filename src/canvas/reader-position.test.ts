import { expect, it, vi } from "vitest";
import { readerPosition, readerQuestionIndex } from "./reader-position";
import type { ConversationMessage } from "../shared/types";
it("locates the current message without forcing layout on every offscreen message", () => {
  const top = vi.fn((index: number) => index * 120);
  expect(readerPosition(10000, top, 579900)).toBe(4832);
  expect(top.mock.calls.length).toBeLessThanOrEqual(14);
  expect(readerPosition(10, top, -10)).toBe(0);
  expect(readerPosition(0, top, 100)).toBe(-1);
  expect(readerPosition(3, top, 10000)).toBe(2);
});
it("keeps consecutive answers and corrections attached to the preceding question", () => {
  const messages = ["assistant", "user", "assistant", "assistant", "user", "assistant"].map((role, index) => ({ id: String(index), role })) as ConversationMessage[];
  expect([...readerQuestionIndex(messages)]).toEqual([["1", "1"], ["2", "1"], ["3", "1"], ["4", "4"], ["5", "4"]]);
});

it("follows an explicit reply parent across another branch instead of the nearest question", () => {
  const messages = [{ id: "q1", platformMessageId: "platform-q1", role: "user" }, { id: "q2", role: "user" }, { id: "a1", role: "assistant", replyToMessageId: "platform-q1" }, { id: "continuation", role: "assistant", replyToMessageId: "a1" }] as ConversationMessage[];
  expect(readerQuestionIndex(messages).get("a1")).toBe("q1");
  expect(readerQuestionIndex(messages).get("continuation")).toBe("q1");
});
