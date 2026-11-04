import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { reextractSessionKnowledge } from "./wiki-knowledge-session";
import type { FocusSession } from "../shared/focus-session";
import type { Conversation, ConversationMessage } from "../shared/types";
import type { StructuredAIRequest } from "./provider";

it("extracts a saved document's sources again into a fresh ledger without the old organization", async () => {
  const db = await getDatabase(), conversation: Conversation = { id: "again", title: "检索", platform: "chatgpt", url: "", messageCount: 2, updatedAt: 1 };
  const messages: ConversationMessage[] = ["我建议全文索引用 Orama，每 30 秒增量更新。", "好，就这样。"].map((content, index) => ({ id: `again-${index}`, conversationId: "again", messageIndex: index, role: index ? "user" : "assistant", content, preview: content, contentHash: String(index), createdAt: 1, updatedAt: 1 }));
  await db.put("conversations", conversation); for (const message of messages) await db.put("messages", message);
  const prompts: string[] = [];
  const ai = { generateStructured: async <T,>(request: StructuredAIRequest<T>): Promise<T> => {
    prompts.push(JSON.parse(request.prompt).presentation);
    const passages = JSON.parse(request.prompt).passages as Array<{ id: string; role: string }>;
    return request.validate({ units: [{ subject: "全文索引", statement: "全文索引使用 Orama。", kind: "decision", details: "30 秒", quoteKey: `${passages[0].id}:1`, adoption: "proposal" }] });
  } };
  const session = { id: "s", title: "检索", sourceConversationIds: ["again"], locale: "zh-CN" } as FocusSession;
  const ledger = await reextractSessionKnowledge(session, ai, new AbortController().signal);
  expect(prompts).toEqual(["wiki_unit_extract"]);
  expect(ledger).toMatchObject({ status: "complete", materials: 2 });
  expect(ledger.organization).toBeUndefined();expect(ledger.draft).toBeUndefined();
  expect(ledger.batches[0].units[0]).toMatchObject({ subject: "全文索引", details: ["30 秒"], evidence: { messageId: "again-0" } });
  // A source that is no longer stored stops the run instead of producing a partial ledger.
  await expect(reextractSessionKnowledge({ ...session, sourceConversationIds: ["again", "gone"] }, ai, new AbortController().signal)).rejects.toThrow("no longer stored");
});
