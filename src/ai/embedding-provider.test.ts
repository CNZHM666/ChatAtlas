import { afterEach, expect, it, vi } from "vitest";
import { configuredEmbeddingProvider } from "./embedding-provider";
import { recordAIUsage } from "../storage/ai-usage";
import type { AISettings } from "../shared/types";
vi.mock("../storage/ai-usage", () => ({ recordAIUsage: vi.fn().mockResolvedValue(undefined) }));
const settings: AISettings = { id: "ai-settings", provider: "deepseek", baseUrl: "https://gateway.example/v1", apiKey: "fixture", model: "chat", embeddingModel: "vector", updatedAt: 0 };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("orders vectors by their exact input indices and retains receipt metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ index: 1, embedding: [3, 4] }, { index: 0, embedding: [1, 2] }], usage: { total_tokens: 12 } }, { headers: { "x-request-id": "vector-receipt" } })));
  await expect(configuredEmbeddingProvider(settings)!.embedBatch(["a", "b"])).resolves.toEqual([[1, 2], [3, 4]]);
  expect(recordAIUsage).toHaveBeenLastCalledWith(expect.objectContaining({ tokenSource: "provider", embeddingTokens: 12, requestId: "vector-receipt", status: "completed" }));
});
it("rejects duplicated input indices while preserving the charged usage", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ index: 0, embedding: [1, 2] }, { index: 0, embedding: [3, 4] }], usage: { total_tokens: 12 } })));
  await expect(configuredEmbeddingProvider(settings)!.embedBatch(["a", "b"])).rejects.toThrow("invalid vectors");
  expect(recordAIUsage).toHaveBeenLastCalledWith(expect.objectContaining({ tokenSource: "provider", embeddingTokens: 12, status: "failed" })); expect(fetch).toHaveBeenCalledOnce();
});
it("cancels a body stalled after headers and records unknown usage without resubmitting", async () => {
  vi.useFakeTimers(); let signal!: AbortSignal;
  vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => { signal = init.signal!; return { ok: true, headers: new Headers({ "x-request-id": "stalled" }), json: () => new Promise(() => undefined) }; }));
  const pending = configuredEmbeddingProvider(settings)!.embedText("a"); const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(90000); await check; expect(signal.aborted).toBe(true); expect(fetch).toHaveBeenCalledOnce();
  expect(recordAIUsage).toHaveBeenLastCalledWith(expect.objectContaining({ tokenSource: "unavailable", embeddingTokens: 0, errorCode: "PROVIDER_TIMEOUT", requestId: "stalled", timeoutStage: "response_body" }));
});
