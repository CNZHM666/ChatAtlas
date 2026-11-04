import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "./db";
import { saveConversationCapture, getMessagesForConversation } from "./messages";
import { readSessionSource, retainSourceVersions } from "./source-versions";
import { createAtlasBackup, restoreAtlasBackup } from "./atlas-backup";
import { sourceMessageSignature } from "../shared/source-signature";
import type { FocusSession } from "../shared/focus-session";
import type { ConversationCapture, ConversationMessage } from "../shared/types";
const raw = (content: string): ConversationMessage => ({ id: "m", conversationId: "source-version", messageIndex: 0, role: "user", content, preview: content, contentHash: content, createdAt: 1, updatedAt: 1 });
const capture = (content: string): ConversationCapture => ({ conversation: { id: "source-version", title: "Source", platform: "chatgpt", url: "", updatedAt: 1, messageCount: 1, sourceRevision: "export-revision" }, capturedAt: 1, messages: [raw(content)] });
const session: FocusSession = { id: "session", title: "Read", goal: "Read", mode: "work", sourceConversationIds: ["source-version"], sourceSignatures: { "source-version": { m: sourceMessageSignature("原方案 A") } }, evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1 };
beforeEach(async () => { const db = await getDatabase(); for (const store of ["messages", "conversations", "sourceVersions"] as const) await db.clear(store); });
it("retains distinct widget revisions and restores their payloads through a local backup", async () => {
  const first = { ...raw("【原平台交互内容】"), uiParts: [{ ordinal: 0, raw: '{"html":"<p>first</p>"}' }] };
  const second = { ...first, uiParts: [{ ordinal: 0, raw: '{"html":"<p>second</p>"}' }] };
  const previous = await retainSourceVersions([first]);
  const latest = await retainSourceVersions([second]);
  expect(previous["source-version"]).not.toBe(latest["source-version"]);
  const backup = await createAtlasBackup();
  await restoreAtlasBackup(backup);
  expect((await (await getDatabase()).get("sourceVersions", previous["source-version"]))?.messages[0].uiParts).toEqual(first.uiParts);
});
it("keeps original versions immutable and deduplicates repeated imports without changing export revision", async () => {
  await saveConversationCapture(capture("原方案 A"), { warmIndex: false });
  await saveConversationCapture(capture("新方案 B"), { warmIndex: false });
  await saveConversationCapture(capture("新方案 B"), { warmIndex: false });
  const db = await getDatabase(), versions = await db.getAllFromIndex("sourceVersions", "by-conversation", "source-version");
  expect(versions).toHaveLength(2);
  expect((await db.get("conversations", "source-version"))?.sourceRevision).toBe("export-revision");
  expect((await getMessagesForConversation("source-version"))[0].content).toBe("新方案 B");
  expect((await readSessionSource(session, "source-version"))[0].content).toBe("原方案 A");
});
it("reads the per-claim historical version even after a newer project version was accepted", async () => {
  const ids = await retainSourceVersions([raw("原方案 A")]);
  const latest = await retainSourceVersions([raw("新方案 B")]);
  const historical = { ...session, sourceVersionIds: latest, evidence: [{ id: "e", conversationId: "source-version", messageId: "m", title: "Source", excerpt: "原方案 A", sourceVersionId: ids["source-version"] }] };
  expect((await readSessionSource(historical, "source-version", "m"))[0].content).toBe("原方案 A");
});
it("does not substitute changed current originals when a legacy historical snapshot is unavailable", async () => {
  const db = await getDatabase(); await db.put("messages", raw("新方案 B"));
  expect(await readSessionSource(session, "source-version")).toEqual([]);
});
it("distinguishes two citations of the same message across versions", async () => {
  const old = await retainSourceVersions([raw("原方案 A")]), latest = await retainSourceVersions([raw("新方案 B")]);
  const combined = { ...session, sourceVersionIds: latest, evidence: [
    { id: "before", conversationId: "source-version", messageId: "m", title: "Source", excerpt: "原方案 A", sourceVersionId: old["source-version"] },
    { id: "after", conversationId: "source-version", messageId: "m", title: "Source", excerpt: "新方案 B", sourceVersionId: latest["source-version"] },
  ] };
  expect((await readSessionSource(combined, "source-version", "m", old["source-version"]))[0].content).toBe("原方案 A");
  expect((await readSessionSource(combined, "source-version", "m", latest["source-version"]))[0].content).toBe("新方案 B");
  expect((await readSessionSource(combined, "source-version", "m"))[0].content).toBe("新方案 B");
  expect(await readSessionSource(combined, "source-version", "m", "missing-historical-version")).toEqual([]);
});
it("includes retained originals in backup and restores them without stale reading caches", async () => {
  await saveConversationCapture(capture("原方案 A"), { warmIndex: false });
  const backup = await createAtlasBackup();
  await saveConversationCapture(capture("新方案 B"), { warmIndex: false });
  await getMessagesForConversation("source-version");
  await restoreAtlasBackup(backup);
  expect((await getMessagesForConversation("source-version"))[0].content).toBe("原方案 A");
  expect((await getDatabase()).getAll("sourceVersions")).resolves.toHaveLength(1);
});
