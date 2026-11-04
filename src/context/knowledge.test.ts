import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { contextKnowledge } from "../test/context-fixture";
import { assertProjectKnowledgeCurrent, contextProjectSignature, readProjectKnowledge } from "./knowledge";
import { buildProjectContext } from "./engine";
import { defaultContextSections } from "./types";
import { retainSourceVersions } from "../storage/source-versions";

beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("conversations"); await db.clear("focusSessions"); });
async function seed() {
  const knowledge = contextKnowledge(), db = await getDatabase();
  await db.put("focusSessions", knowledge.session); for (const message of knowledge.messages) await db.put("messages", message); for (const conversation of knowledge.conversations) await db.put("conversations", conversation);
  return { ...knowledge, db };
}
it("takes an atomic readonly knowledge snapshot without mutating originals or schema", async () => {
  const { session, messages, db } = await seed(), names = [...db.objectStoreNames];
  const snapshot = await readProjectKnowledge(session);
  expect(snapshot.sourcesStale).toBe(false); expect(snapshot.messages).toEqual(messages);
  await assertProjectKnowledgeCurrent(session, snapshot.signature, true);
  expect(await db.getAll("messages")).toEqual(messages); expect(await db.get("focusSessions", session.id)).toEqual(session); expect([...db.objectStoreNames]).toEqual(names);
});
it.each(["edit", "delete", "new", "project"])("rejects already-generated context after a %s even if UI missed the event", async change => {
  const { session, messages, db } = await seed(), snapshot = await readProjectKnowledge(session);
  if (change === "edit") await db.put("messages", { ...messages[0], content: "后续不再采用该方案", updatedAt: 10 });
  if (change === "delete") await db.delete("messages", messages[0].id);
  if (change === "new") await db.put("messages", { ...messages[0], id: "new", messageIndex: 2, content: "新增修正" });
  if (change === "project") await db.put("focusSessions", { ...session, title: "修改项目标题" });
  await expect(assertProjectKnowledgeCurrent(session, snapshot.signature, true)).rejects.toThrow();
});
it("regeneration excludes deleted references even when retained original versions exist", async () => {
  const { session, messages, db } = await seed(); await retainSourceVersions(messages); await db.delete("messages", messages[0].id);
  expect(await db.count("sourceVersions")).toBeGreaterThan(0);
  const snapshot = await readProjectKnowledge(session), bundle = buildProjectContext(snapshot, { zh: true, task: "", length: "standard", sections: [...defaultContextSections] });
  expect(snapshot.sourcesStale).toBe(true); expect(bundle.sources.some(source => source.messageId === "m-db")).toBe(false);
});
it("does not invalidate context merely for reading navigation, but checks maintenance and knowledge edits", async () => {
  const { session, db } = await seed(), snapshot = await readProjectKnowledge(session);
  const navigated = { ...session, activeSectionId: "sidebar", updatedAt: 100, completedSectionIds: [] };
  await db.put("focusSessions", navigated); expect(contextProjectSignature(navigated)).toBe(contextProjectSignature(session));
  await assertProjectKnowledgeCurrent(navigated, snapshot.signature, true);
  await db.put("focusSessions", { ...navigated, projectMaintenance: {} });
  await expect(assertProjectKnowledgeCurrent(navigated, snapshot.signature, true)).rejects.toThrow();
});
it("honors cancellation without writing anything", async () => {
  const { session, db } = await seed(), controller = new AbortController(); controller.abort();
  await expect(readProjectKnowledge(session, controller.signal)).rejects.toThrow(); expect(await db.get("focusSessions", session.id)).toEqual(session);
});

it("explicit refresh reads the latest saved project and its new source scope atomically", async () => {
  const { session, messages, db } = await seed();
  const latest = { ...session, title: "最新项目", sourceConversationIds: ["other"], projectMaintenance: { overview: "最新个人修改" } };
  await db.put("focusSessions", latest);
  await db.put("conversations", { id: "other", title: "新材料", platform: "chatgpt", url: "https://chatgpt.com/c/other", updatedAt: 5, messageCount: 1 });
  await db.put("messages", { ...messages[0], id: "new", conversationId: "other" });
  const snapshot = await readProjectKnowledge(session, undefined, { refreshSaved: true });
  expect(snapshot.session).toEqual(latest); expect(snapshot.messages.map(item => item.id)).toEqual(["new"]);
  await assertProjectKnowledgeCurrent(snapshot.session, snapshot.signature, true);
  expect(await db.get("focusSessions", session.id)).toEqual(latest);
});
