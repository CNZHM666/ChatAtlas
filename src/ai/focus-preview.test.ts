import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDatabase } from "../storage/db";
import type { Conversation, ConversationMessage } from "../shared/types";
import { generateFocusSession } from "./focus-session";
import type { StructuredAIRequest } from "./provider";
import { requestBudget } from "./request-policy";

const { synthesize, prepareFocus } = vi.hoisted(() => ({ synthesize: vi.fn(), prepareFocus: vi.fn() }));
vi.mock("./atlas-ai", () => ({ createAtlasAI: () => ({ synthesize, prepareFocus }) }));
vi.mock("../storage/knowledge-graph", () => ({ getAISettings: async () => ({ mode: "byok", provider: "qwen", apiKey: "test", baseUrl: "https://test.example/v1", model: "qwen3.8-flash" }) }));
vi.mock("./provider", async (original) => ({ ...await original<typeof import("./provider")>(), hasProviderPermission: async () => true }));
const source: Conversation = { id: "preview-source", title: "控制系统讨论", platform: "chatgpt", url: "", messageCount: 154, updatedAt: 1 };
async function seed(long: boolean) {
  const db = await getDatabase();
  await db.clear("messages");
  const count = long ? 154 : 2;
  for (let index = 0; index < count; index++) {
    const message: ConversationMessage = { id: `m${index}`, conversationId: source.id, messageIndex: index, role: index % 2 ? "assistant" : "user", content: index === count - 1 ? "更正：稳定性只有在离散系统的极点模小于 1 时成立。" : `${index}: 原始问题与推导条件。${long ? "控制系统的背景材料。".repeat(180) : ""}`, preview: "", contentHash: `${index}`, createdAt: 1, updatedAt: 1 };
    await db.put("messages", message);
  }
}
beforeEach(() => {
  vi.clearAllMocks();
  synthesize.mockImplementation(async <T>(request: StructuredAIRequest<T>) => {
    const payload = JSON.parse(request.prompt);
    return request.validate({ title: "复习", sections: [{ title: "条件与修正", body: "回看条件和更正。", transition: "", kind: "review", evidenceIds: payload.passages.map((p: { id: string }) => p.id) }] });
  });
});
describe("shared source analysis", () => {
  it("reads a roughly 300k-character conversation in bounded source batches before composing the review", async () => {
    await seed(true);
    const result = await generateFocusSession("复习控制系统", "answer", [source], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, {complete:true});
    expect(synthesize.mock.calls.length).toBeGreaterThan(2);
    expect(prepareFocus).toHaveBeenCalledOnce();
    expect(result.coverage).toMatchObject({ method: "full_batched", sourceCount: 1 });
    const requests = synthesize.mock.calls.map(([request]) => request as StructuredAIRequest<unknown>);
    const reading = requests.map((request) => JSON.parse(request.prompt)).filter((payload) => payload.coverage.stage === "reading");
    expect(reading.flatMap((payload) => payload.passages).some((p: { text: string }) => p.text.includes("更正：稳定性"))).toBe(true);
    expect(new Set(result.evidence.map((item) => item.messageId)).size).toBe(154);
    for (const request of requests) expect(requestBudget(request).inputTokens).toBeLessThanOrEqual(requestBudget(request).maxInputTokens);
  });
  it("generates a complete short single-source preview in one request", async () => {
    await seed(false);
    const result = await generateFocusSession("复习", "answer", [source], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, {complete:true});
    expect(result.coverage?.method).toBe("full_direct");
    expect(synthesize).toHaveBeenCalledTimes(1);
  });
  it("keeps the complete-reading action compatible with legacy sampled results", async () => {
    await seed(true);
    const result = await generateFocusSession("复习", "answer", [source], "zh-CN", new AbortController().signal, undefined, undefined, undefined, undefined, { complete: true });
    expect(result.coverage?.method).toBe("full_batched");
    expect(prepareFocus).toHaveBeenCalledOnce();
    expect(synthesize.mock.calls.length).toBeGreaterThan(2);
  });
  it("still supports a targeted answer without pretending to analyze the full source", async () => {
    await seed(true);
    const result = await generateFocusSession("极点的稳定性条件是什么？", "answer", [source], "zh-CN", new AbortController().signal);
    expect(synthesize).toHaveBeenCalledOnce();
    expect(prepareFocus).not.toHaveBeenCalled();
    expect(result.coverage?.method).toBe("sampled");
  });
});

it("blocks retired review generation before any provider request",async()=>{
 await expect(generateFocusSession("复习","review",[source],"zh-CN",new AbortController().signal)).rejects.toThrow("复习模式已移除");
 expect(synthesize).not.toHaveBeenCalled();expect(prepareFocus).not.toHaveBeenCalled();
});
