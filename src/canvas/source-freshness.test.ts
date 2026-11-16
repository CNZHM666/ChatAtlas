import { describe, expect, it } from "vitest";
import "fake-indexeddb/auto";
import { currentSourceChange, sourceChange } from "./source-freshness";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { sourceVersion } from "../storage/source-versions";

const message = (id: string, content: string): ConversationMessage => ({ id, content, conversationId: "source", role: "user", messageIndex: 0, contentHash: id, preview: content, createdAt: 1, updatedAt: 1 });
const session = { sourceSignatures: { source: { q1: sourceMessageSignature("Original"), q2: sourceMessageSignature("Condition B") } }, sourceOutlines: [{ conversationId: "source", chapters: [{ id: "stage", title: "Original conditions", messageIds: ["q1", "q2"], summary: "" }] }] } as unknown as FocusSession;
describe("source update notices", () => {
  it("compares actual text instead of import timestamps or contentHash labels", () => {
    expect(sourceChange(session, "source", [{ ...message("q1", "Original"), updatedAt: 500 }, message("q2", "Condition B")])).toMatchObject({ added: 0, changed: 0, removed: 0, unknown: false });
  });
  it("keeps the same update fingerprint across capture metadata and detects a different edit with the same count", () => {
    const original = { ...message("reply", "Original"), role: "assistant" as const };
    const first = { ...original, content: "Edited answer" };
    const capturedAgain = { ...first, content: "Edited answer \uE200cite\uE202turn0search0\uE201", updatedAt: 6 };
    const second = { ...first, content: "Edited again" };
    const change = sourceChange(session, "source", [first], [original]);
    expect(change.fingerprint).toBeTruthy();
    expect(sourceChange(session, "source", [capturedAgain], [original]).fingerprint).toBe(change.fingerprint);
    expect(sourceChange(session, "source", [second], [original])).toMatchObject({ changed: 1 });
    expect(sourceChange(session, "source", [second], [original]).fingerprint).not.toBe(change.fingerprint);
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
  it("ignores citation markup and capture IDs while preserving content and code edits", () => {
    const old = { ...message("legacy", "First answer \uE200cite\uE202turn0search0\uE201"), role: "assistant" as const };
    const current = { ...old, id: "native", platformMessageId: "reply", content: "First answer" };
    expect(sourceChange(session, "source", [current], [old])).toMatchObject({ added: 0, changed: 0, removed: 0 });
    expect(sourceChange(session, "source", [{ ...current, id: old.id, content: "Changed answer" }], [old]).changed).toBe(1);
    expect(sourceChange(session, "source", [{ ...current, content: "First answer" }], [{ ...old, platformMessageId: "other" }])).toMatchObject({ added: 1, removed: 1 });
    const code = { ...old, content: "~~~py\nif active:\n  execute()\n~~~" };
    expect(sourceChange(session, "source", [{ ...code, content: code.content.replace("  execute","    execute") }], [code]).changed).toBe(1);
    const tool = { ...old, content: "Raw platform transport" };
    expect(sourceChange(session, "source", [{ ...tool, contentKind: "tool" }], [tool]).removed).toBe(0);
    expect(sourceChange(session, "source", [tool], [{ ...tool, contentKind: "tool" }]).added).toBe(0);
  });
  it("checks saved originals for scoped projects and waits for incomplete local sync", async () => {
    const db = await getDatabase();
    const id = "freshness-scope";
    const original = [message("original-q", "First"), { ...message("original-a", "Older reply"), messageIndex: 1 }]
      .map(item => ({ ...item, conversationId: id }));
    const version = sourceVersion(id, original, 1);
    const base = { ...session, scope: { kind: "goal" as const }, sourceConversationIds: [id], sourceVersionIds: { [id]: version.id },
      sourceSignatures: { [id]: { [original[0].id]: sourceMessageSignature(original[0].content) } } };
    const metadata = { id, platform: "chatgpt" as const, title: "Thread", url: "", messageCount: 2, updatedAt: 2, importState: "complete" as const };
    await db.put("sourceVersions", version);
    await db.put("conversations", { ...metadata, hydrationState: "metadata_only" });
    await db.put("messages", original[0]);
    expect(await currentSourceChange(base, id)).toMatchObject({ added: 0, changed: 0, removed: 0 });
    await db.put("messages", original[1]);
    await db.put("conversations", { ...metadata, hydrationState: "hydrated" });
    expect(await currentSourceChange(base, id)).toMatchObject({ added: 0, changed: 0, removed: 0 });
    await db.put("messages", { ...message("new-scope-reply", "New reply"), conversationId: id, messageIndex: 2 });
    expect(await currentSourceChange(base, id)).toMatchObject({ added: 1, changed: 0, removed: 0 });
    await db.delete("messages", original[1].id);
    expect(await currentSourceChange(base, id)).toMatchObject({ added: 1, changed: 0, removed: 1 });
    await db.delete("messages", "new-scope-reply");
    expect(await currentSourceChange(base, id)).toMatchObject({ added: 0, changed: 0, removed: 1 });
  });
});
