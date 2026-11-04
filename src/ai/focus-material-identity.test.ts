import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { stabilizeMaterialIdentity } from "./focus-material-identity";
it("keeps material IDs through middle insertion, deletion and subsequent append without dropping text", async () => {
  const db = await getDatabase(); await db.clear("semanticDecisionCache");
  const run = async (ids: string[]) => {
    const materials = ids.map((messageId, index) => ({ id: `e:identity:${index}:1`, conversationId: "identity", messageId, rawEvidenceIds: [`e:identity:${index}:1`], text: messageId }));
    return stabilizeMaterialIdentity(materials, materials.map(item => ({ id: item.id, conversationId: item.conversationId, messageId: item.messageId, title: "", excerpt: item.text })), new AbortController().signal);
  };
  const original = await run(["a", "b", "c"]), inserted = await run(["a", "new", "b", "c"]);
  for (const ref of original.evidence) expect(inserted.evidence.find(item => item.messageId === ref.messageId)?.id).toBe(ref.id);
  expect(inserted.evidence.find(item => item.messageId === "new")?.id).toBe("e:identity:3:1");
  const removed = await run(["b", "c", "another"]);
  expect(removed.materials.map(item => item.text)).toEqual(["b", "c", "another"]);
  expect(removed.materials.map(item => item.id)).toEqual(["e:identity:1:1", "e:identity:2:1", "e:identity:4:1"]);
  expect(removed.materials.every(item => item.rawEvidenceIds[0] === item.id)).toBe(true);
});
