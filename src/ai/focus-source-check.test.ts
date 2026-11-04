import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import type { ConversationMessage } from "../shared/types";
import { projectSession } from "../test/project-fixture";
import { sourceMessageSignature } from "../shared/source-signature";
import { verifyFocusSources } from "./focus-source-check";

it.each(["content", "role", "order"])("blocks publishing when raw %s changes after generation", async change => {
  const id = `snapshot-${change}`;
  const messages: ConversationMessage[] = [0, 1].map(index => ({ id: `${id}-${index}`, conversationId: id, messageIndex: index, role: index ? "assistant" : "user", content: `Original ${index}`, preview: "", contentHash: "", createdAt: 1, updatedAt: 1 }));
  const session = projectSession(); session.sourceConversationIds = [id];
  session.sourceMessageOrder = { [id]: messages.map(message => message.id) };
  session.sourceSignatures = { [id]: Object.fromEntries(messages.map(message => [message.id, sourceMessageSignature(message.content)])) };
  session.sourceRoles = { [id]: Object.fromEntries(messages.map(message => [message.id, message.role])) };
  const db = await getDatabase(); for (const message of messages) await db.put("messages", message);
  await verifyFocusSources(session, new AbortController().signal);
  await db.put("messages", { ...messages[0], ...(change === "content" ? { content: "Changed" } : change === "role" ? { role: "assistant" as const } : { messageIndex: 3 }) });
  await expect(verifyFocusSources(session, new AbortController().signal)).rejects.toThrow(/changed during analysis|分析期间变化/u);
});
it("ignores changes outside a confirmed goal scope", async () => {
  const db = await getDatabase(), id = "snapshot-scoped";
  const selected: ConversationMessage = { id: `${id}-chosen`, conversationId: id, messageIndex: 0, role: "user", content: "Chosen", preview: "", contentHash: "", createdAt: 1, updatedAt: 1 };
  const session = projectSession(); session.sourceConversationIds = [id];
  session.scope = { kind: "goal", blocks: [{ conversationId: id, title: "Chosen", messageIds: [selected.id], messageSignatures: {} }] };
  session.sourceMessageOrder = { [id]: [selected.id] }; session.sourceSignatures = { [id]: { [selected.id]: sourceMessageSignature(selected.content) } }; session.sourceRoles = { [id]: { [selected.id]: selected.role } };
  await db.put("messages", selected); await db.put("messages", { ...selected, id: `${id}-excluded`, messageIndex: 1, content: "New unrelated content" });
  await verifyFocusSources(session, new AbortController().signal);
});
