import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { invalidateStoredMessageSearchIndex } from "../storage/messages";
import { findHistory } from "./home-history";
import { searchMemory } from "../sidecar/context-engine";

beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("conversations"); invalidateStoredMessageSearchIndex(); });

it("finds the same messages in the same order in the workbench and the sidebar", async () => {
  const db = await getDatabase();
  const sources = ["a", "b", "c"].map(id => ({ id, title: `对话 ${id}`, platform: "chatgpt", url: "", updatedAt: 1, messageCount: 2 }));
  for (const source of sources) await db.put("conversations", source);
  const messages = [
    ["a", "a1", "全文检索使用 Orama 建立本地索引，索引按消息保存。"],
    ["b", "b1", "Orama 索引需要持久化，Service Worker 可能被终止。"],
    ["c", "c1", "首页只保留搜索入口，其他功能收进菜单。"],
    ["a", "a2", "后来决定 Orama 索引增量更新，只处理新增消息。"],
  ];
  for (const [index, [conversationId, id, content]] of messages.entries()) await db.put("messages", { id, conversationId, role: "assistant", content, messageIndex: index, createdAt: 1, updatedAt: 1, contentHash: id, preview: content });
  invalidateStoredMessageSearchIndex();
  const workbench = (await findHistory("Orama 索引", sources)).matches.flatMap(match => match.messages.map(message => message.id));
  const sidebar = (await searchMemory("Orama 索引", sources)).hits.map(hit => hit.id);
  expect(sidebar).toHaveLength(3);
  // The workbench groups by conversation; within that, the order is the shared one.
  expect([...workbench].sort((x, y) => sidebar.indexOf(x) - sidebar.indexOf(y))).toEqual(sidebar);
  expect(new Set(workbench)).toEqual(new Set(sidebar));
});
