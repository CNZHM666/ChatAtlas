import { describe, expect, it } from "vitest";
import { sourceReviewOutline } from "./source-review-outline";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";

const messages: ConversationMessage[] = Array.from({ length: 6 }, (_, index) => ({ id: `m${index}`, conversationId: "source", messageIndex: index, role: index % 2 ? "assistant" : "user", content: `Original ${index}`, contentHash: `${index}`, preview: "", createdAt: 1, updatedAt: 1 }));
const review: FocusSession = { id: "cross", goal: "Compare", title: "Review", mode: "review", sourceConversationIds: ["source", "other"], evidence: [], sections: [], notes: "", activeSectionId: "", completedSectionIds: [], createdAt: 1, updatedAt: 1, sourceOutlines: [{ conversationId: "source", messageSignatures: Object.fromEntries(messages.map((message) => [message.id, sourceMessageSignature(message.content)])), chapters: [{ id: "first", title: "Initial question", summary: "Original reasoning", messageIds: ["m0", "m1"] }, { id: "second", title: "Later correction", summary: "Revised condition", messageIds: ["m2", "m3", "m4", "m5"] }] }] };
describe("shared source outline", () => {
  it("retains the full source structure when a newer revision only covers one topic", () => {
    const partial: FocusSession = { ...review, id: "partial", rootSessionId: review.id, createdAt: 2, scope: { kind: "goal" }, sourceOutlines: review.sourceOutlines?.map(outline => ({ ...outline, scope: "partial" })) };
    expect(sourceReviewOutline("source", messages, [partial, review]).chapters.map(chapter => chapter.title)).toEqual(["Initial question", "Later correction"]);
    expect(sourceReviewOutline("source", messages, [partial]).chapters).toEqual([]);
  });
  it("uses a completed pending preview's neutral outline immediately", () => {
    expect(sourceReviewOutline("source", messages, [{ ...review, status: "preview" }]).chapters).toHaveLength(2);
  });
  it("reuses neutral chapters from a cross-conversation review without duplicating questions", () => {
    const { chapters } = sourceReviewOutline("source", messages, [review]);
    expect(chapters.map((item) => item.title)).toEqual(["Initial question", "Later correction"]);
    expect(chapters.flatMap((item) => item.questionIds)).toEqual(["conversation-message-m0", "conversation-message-m2", "conversation-message-m4"]);
  });
  it("rejects stale structure after a source changes or gains a message", () => {
    expect(sourceReviewOutline("source", messages.map((item, index) => index === 3 ? { ...item, content: "Changed answer" } : item), [review]).chapters).toEqual([]);
    expect(sourceReviewOutline("source", [...messages, { ...messages[0], id: "new", messageIndex: 6 }], [review]).chapters).toEqual([]);
  });
  it("rejects unchanged text whose order or role changed", () => {
    const tracked = { ...review, sourceOutlines: review.sourceOutlines?.map(outline => ({ ...outline, messageOrder: messages.map(message => message.id), messageRoles: Object.fromEntries(messages.map(message => [message.id, message.role])) })) };
    expect(sourceReviewOutline("source", messages.map(message => ({ ...message, messageIndex: 5 - message.messageIndex })), [tracked]).chapters).toEqual([]);
    expect(sourceReviewOutline("source", messages.map(message => message.id === "m1" ? { ...message, role: "user" } : message), [tracked]).chapters).toEqual([]);
  });
  it("keeps split answer continuations with their original question without losing summaries", () => {
    const split = { ...review, sourceOutlines: [{ conversationId: "source", chapters: [
      { id: "start", title: "Question", summary: "Initial condition", messageIds: ["m0"] },
      { id: "continued", title: "Answer correction", summary: "Critical exception", messageIds: ["m1"] },
      { id: "next", title: "Follow-up", summary: "New question", messageIds: ["m2", "m3"] },
    ] }] };
    const result = sourceReviewOutline("source", messages, [split]);
    expect(result.chapters).toHaveLength(2);
    expect(result.chapters[0].summary).toContain("Critical exception");
    expect(result.chapters[0].questionIds).toEqual(["conversation-message-m0"]);
    expect(result.anchors.start).toBe("m0");
  });
});
