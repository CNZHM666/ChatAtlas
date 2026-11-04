import { describe, expect, it } from "vitest";
import type { ConversationMessage } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { readerCitations } from "./reader-citations";
import { parseReaderSearchContext, readerSearchContext } from "../shared/message-location";

const message = (id: string, platformMessageId?: string): ConversationMessage => ({
  id, platformMessageId, conversationId: "c1", messageIndex: 0, role: "assistant", content: "text", preview: "text", contentHash: id, createdAt: 1, updatedAt: 1,
});
const session = (patch: Partial<FocusSession> = {}): FocusSession => ({
  id: "s1", title: "Project", goal: "", mode: "work", sourceConversationIds: ["c1"], createdAt: 1, updatedAt: 1,
  evidence: [{ id: "e1", conversationId: "c1", messageId: "p2", title: "", excerpt: "" }, { id: "e2", conversationId: "other", messageId: "m1", title: "", excerpt: "" }],
  sections: [{ id: "sec", title: "Chapter one", evidenceIds: ["e1", "e2"] }, { id: "sec2", title: "Chapter two", evidenceIds: ["e1"] }],
  ...patch,
} as unknown as FocusSession);

describe("reader citations", () => {
  it("maps chapter evidence to the cited message, also by platform id, and only for this conversation", () => {
    const result = readerCitations("c1", [message("m1"), message("m2", "p2")], [session()]);
    expect(result.get("m1")).toBeUndefined();
    expect(result.get("m2")?.map(item => item.section)).toEqual(["Chapter one", "Chapter two"]);
  });

  it("ignores deleted, preview and developer ledger sessions", () => {
    const messages = [message("m2", "p2")];
    for (const patch of [{ deletedAt: 1 }, { status: "preview" as const }, { ledgerTest: true as const }]) expect(readerCitations("c1", messages, [session(patch)]).size).toBe(0);
  });
});

describe("reader search links", () => {
  it("keeps valid hits and drops malformed ones", () => {
    expect(readerSearchContext({ query: "plan", hits: [{ messageId: "m1", excerpt: "x", sourceRange: { start: 2, end: 1 } }, { excerpt: "no id" }] })).toEqual({ query: "plan", hits: [{ messageId: "m1", excerpt: "x" }] });
    expect(readerSearchContext({ query: " ", hits: [{ messageId: "m1" }] })).toBeUndefined();
    expect(parseReaderSearchContext("{bad")).toBeUndefined();
    expect(parseReaderSearchContext(JSON.stringify({ query: "q", hits: [{ messageId: "m", excerpt: "e", sourceRange: { start: 0, end: 1 } }] }))?.hits[0].sourceRange).toEqual({ start: 0, end: 1, part: undefined, partIndex: undefined, excerpt: undefined });
  });
});
