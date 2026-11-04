import { describe, expect, it } from "vitest";
import { sourceChange } from "./source-freshness";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";

const message = (id: string, content: string): ConversationMessage => ({ id, content, conversationId: "source", role: "user", messageIndex: 0, contentHash: id, preview: content, createdAt: 1, updatedAt: 1 });
const session = { sourceSignatures: { source: { q1: sourceMessageSignature("Original"), q2: sourceMessageSignature("Condition B") } }, sourceOutlines: [{ conversationId: "source", chapters: [{ id: "stage", title: "Original conditions", messageIds: ["q1", "q2"], summary: "" }] }] } as unknown as FocusSession;
describe("source update notices", () => {
  it("compares actual text instead of import timestamps or contentHash labels", () => {
    expect(sourceChange(session, "source", [{ ...message("q1", "Original"), updatedAt: 500 }, message("q2", "Condition B")])).toMatchObject({ added: 0, changed: 0, removed: 0, unknown: false });
  });
  it("distinguishes added, changed and missing text and names affected chapters", () => {
    expect(sourceChange(session, "source", [message("q1", "Changed"), message("q3", "New")])).toMatchObject({ added: 1, changed: 1, removed: 1, affectedChapterTitles: ["Original conditions"] });
  });
  it("does not claim legacy analysis is current without a recorded signature", () => {
    expect(sourceChange({} as FocusSession, "source", [message("q1", "New")]).unknown).toBe(true);
  });
  it("detects role changes and reordering without treating insertions as reordered old discussions", () => {
    const old = { ...session, sourceMessageOrder: { source: ["q1", "q2"] }, sourceRoles: { source: { q1: "user", q2: "assistant" } } };
    const a = message("q1", "Original"), b = { ...message("q2", "Condition B"), role: "assistant" as const, messageIndex: 2 };
    expect(sourceChange(old, "source", [a, { ...message("new", "Inserted"), messageIndex: 1 }, b]).reordered).toBeUndefined();
    expect(sourceChange(old, "source", [{ ...a, messageIndex: 2 }, { ...b, messageIndex: 0 }]).reordered).toBe(true);
    expect(sourceChange(old, "source", [a, { ...b, role: "user" }]).changed).toBe(1);
  });
});
