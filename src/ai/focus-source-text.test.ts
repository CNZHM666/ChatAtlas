import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import type { Conversation, ConversationMessage } from "../shared/types";
import { getDatabase } from "../storage/db";
import { saveConversationCapture } from "../storage/messages";
import { transcriptPassages } from "../search/transcript-index";
import { coverageMaterials } from "./focus-coverage";
import { loadFullReadingPassages } from "./focus-source-text";

const source: Conversation = { id: "reading-source", platform: "chatgpt", title: "Long discussion", url: "", messageCount: 2, updatedAt: 1 };
const messages: ConversationMessage[] = [
  { id: "question", conversationId: source.id, messageIndex: 0, role: "user", content: "This needs earlier context", preview: "", contentHash: "q", createdAt: 1, updatedAt: 1 },
  { id: "answer", conversationId: source.id, messageIndex: 1, role: "assistant", content: "Earlier explanation🙂\n".repeat(700) + "Final correction: do not accept the earlier proposal.", preview: "", contentHash: "a", createdAt: 1, updatedAt: 1 },
];

beforeEach(async () => { const db = await getDatabase(); await db.clear("messages"); await db.clear("conversations"); await db.clear("transcriptIndexes"); });
describe("direct source loading for full reading", () => {
  it("preserves the same chronological material and evidence without building a search index", async () => {
    await saveConversationCapture({ conversation: source, messages: [...messages].reverse(), capturedAt: 1 }, { warmIndex: false });
    const loaded = await loadFullReadingPassages([source], new AbortController().signal);
    expect(loaded.missing).toBe(0);
    expect(loaded.passages).toHaveLength(2);
    expect(coverageMaterials(loaded.passages, [source])).toEqual(coverageMaterials(transcriptPassages(source, messages), [source]));
    expect(await (await getDatabase()).count("transcriptIndexes")).toBe(0);
  });

  it("reports absent text and respects cancellation before reading", async () => {
    expect((await loadFullReadingPassages([source], new AbortController().signal)).missing).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(loadFullReadingPassages([source], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
