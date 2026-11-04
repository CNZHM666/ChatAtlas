import { describe, expect, it } from "vitest";
import type { ConversationChapter, ConversationMessage } from "../shared/types";
import { buildContextEpisodes } from "./context-episodes";

const chapter = (order: number, questionIds: string[]): ConversationChapter => ({ id: `chapter-${order}`, conversationId: "c", title: `阶段 ${order}`, questionIds: questionIds.map((id) => `conversation-message-${id}`), order, collapsed: true, source: "auto", createdAt: 1, updatedAt: 1 });
const messages: ConversationMessage[] = Array.from({ length: 12 }, (_, index) => ({ id: index % 2 ? `a${(index + 1) / 2}` : `q${index / 2 + 1}`, conversationId: "c", messageIndex: index, role: index % 2 ? "assistant" : "user", content: `Turn ${index}`, preview: `Turn ${index}`, contentHash: `${index}`, createdAt: 1, updatedAt: 1 }));

describe("context episodes", () => {
  it("keeps complete adjacent question and answer turns inside chapter boundaries", () => {
    const episodes = buildContextEpisodes([chapter(0, ["q1", "q2", "q3", "q4"]), chapter(1, ["q5", "q6"])], messages, [
      { chapterOrder: 0, title: "Initial idea", questionIds: ["q1", "q2"] },
      { chapterOrder: 0, title: "Follow-up", contextHeader: "The earlier discussion defined the matrix.", questionIds: ["q3", "q4"] },
      { chapterOrder: 1, title: "Decision", questionIds: ["q5", "q6"] },
    ]);
    expect(episodes.map((item) => item.messageIds)).toEqual([
      ["q1", "a1", "q2", "a2"], ["q3", "a3", "q4", "a4"], ["q5", "a5", "q6", "a6"],
    ]);
    expect(episodes[1].contextHeader).toBe("The earlier discussion defined the matrix.");
  });
  it("uses chapter order rather than array position when finding the next boundary", () => {
    const episodes = buildContextEpisodes([chapter(1, ["q3", "q4"]), chapter(0, ["q1", "q2"])], messages.slice(0, 8));
    expect(episodes.map((item) => item.messageIds)).toEqual([["q1", "a1", "q2", "a2"], ["q3", "a3", "q4", "a4"]]);
  });

  it("does not turn every question and answer into a separate episode", () => {
    const episodes = buildContextEpisodes([chapter(0, ["q1", "q2", "q3", "q4"])], messages.slice(0, 8), [1, 2, 3, 4].map((index) => ({ chapterOrder: 0, title: `Question ${index}`, questionIds: [`q${index}`] })));
    expect(episodes).toHaveLength(1);
    expect(episodes[0].messageIds).toEqual(["q1", "a1", "q2", "a2", "q3", "a3", "q4", "a4"]);
  });

  it("ignores interleaved AI episode boundaries and keeps the chapter intact", () => {
    const episodes = buildContextEpisodes([chapter(0, ["q1", "q2", "q3", "q4", "q5", "q6"])], messages, [
      { chapterOrder: 0, title: "Bad", questionIds: ["q1", "q3"] },
      { chapterOrder: 0, title: "Bad", questionIds: ["q2", "q4", "q5", "q6"] },
    ]);
    expect(episodes.map((item) => item.questionIds)).toEqual([["q1", "q2", "q3", "q4", "q5", "q6"]]);
  });
  it("preserves all turns in a 90-question conversation while keeping episode anchors sparse", () => {
    const longMessages: ConversationMessage[] = Array.from({ length: 180 }, (_, index) => ({
      id: `${index % 2 ? "a" : "q"}${Math.floor(index / 2) + 1}`, conversationId: "c", messageIndex: index,
      role: index % 2 ? "assistant" : "user", content: `Turn ${index}`, preview: `Turn ${index}`,
      contentHash: `${index}`, createdAt: 1, updatedAt: 1,
    }));
    const chapters = Array.from({ length: 6 }, (_, order) => chapter(order, Array.from({ length: 15 }, (_, index) => `q${order * 15 + index + 1}`)));
    const plans = chapters.flatMap((item) => [
      { chapterOrder: item.order, title: "Entry", questionIds: item.questionIds.slice(0, 4).map((id) => id.replace("conversation-message-", "")) },
      { chapterOrder: item.order, title: "Development", questionIds: item.questionIds.slice(4, 10).map((id) => id.replace("conversation-message-", "")) },
      { chapterOrder: item.order, title: "Application", questionIds: item.questionIds.slice(10).map((id) => id.replace("conversation-message-", "")) },
    ]);
    const episodes = buildContextEpisodes(chapters, longMessages, plans);
    expect(episodes).toHaveLength(18);
    expect(episodes.flatMap((item) => item.messageIds)).toEqual(longMessages.map((item) => item.id));
    expect(episodes.every((item) => item.messageIds.length >= 8 && item.messageIds.length <= 12)).toBe(true);
  });
});
