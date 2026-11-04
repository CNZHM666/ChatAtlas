import { afterEach, describe, expect, it, vi } from "vitest";
import { generationProfile, taskPolicy } from "../shared/atlas/policy.js";
import { createAIProvider } from "./provider";
import type { AISettings } from "../shared/types";
import type { ProviderRequestDiagnostics } from "./provider-transport";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const cases = [
  ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "deepseek-v4.1-flash", { enable_thinking: false }, 0],
  ["qwen", "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "vanchin/deepseek-v4.1-flash", { enable_thinking: false }, 0],
  ["qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "deepseek-v3.2-think", { enable_thinking: false }, 0],
  ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3.8-flash", { enable_thinking: false }, 0],
  ["qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1", "qwen3-235b-a22b-thinking-2507", {}, 4096],
  ["deepseek", "https://api.deepseek.com/v1", "deepseek-reasoner", { thinking: { type: "disabled" } }, 0],
  ["moonshot", "https://api.moonshot.cn/v1", "kimi-k2.6", { thinking: { type: "disabled" } }, 0],
  ["moonshot", "https://api.moonshot.ai/v1", "kimi-k3", { reasoning_effort: "low" }, 4096],
  ["openai-compatible", "https://open.bigmodel.cn/api/paas/v4", "glm-5.3", { thinking: { type: "enabled" }, reasoning_effort: "low" }, 4096],
  ["openai-compatible", "https://api.z.ai/api/paas/v4", "glm-5.2", { thinking: { type: "disabled" } }, 0],
  ["openai-compatible", "https://tokenhub.tencentmaas.com/v1", "hy3", { thinking: { type: "disabled" } }, 0],
  ["openai-compatible", "https://tokenhub-intl.tencentcloudmaas.com/v1", "kimi-k2.6", { thinking: { type: "disabled" } }, 0],
  ["openai-compatible", "https://tokenhub-intl.tencentcloudmaas.com/v1", "minimax-m2.7", {}, 4096],
  ["openai-compatible", "https://api.minimaxi.com/v1", "MiniMax-M3.1-Flash-Preview", { reasoning_effort: "low", reasoning_split: true }, 4096],
  ["openai-compatible", "https://api.minimax.io/v1", "MiniMax-M2.7", { reasoning_split: true }, 4096],
  ["siliconflow", "https://api.siliconflow.cn/v1", "deepseek-ai/DeepSeek-V4.1-Flash", { enable_thinking: false }, 0],
  ["volcengine", "https://ark.cn-beijing.volces.com/api/v3", "doubao-seed-2-0-pro", { thinking: { type: "disabled" } }, 0],
  ["openai", "https://api.openai.com/v1", "gpt-5.4", { reasoning_effort: "none" }, 0],
  ["openai", "https://api.openai.com/v1", "gpt-6.1-sol", { reasoning_effort: "low" }, 4096],
  ["openai", "https://api.openai.com/v1", "o1-mini", {}, 8192],
  ["openrouter", "https://openrouter.ai/api/v1", "deepseek/deepseek-v4.1-flash", { reasoning: { enabled: false } }, 0],
  ["openrouter", "https://openrouter.ai/api/v1", "google/gemini-3.1-pro-preview", { reasoning: { effort: "low" } }, 4096],
  ["openrouter", "https://openrouter.ai/api/v1", "openai/gpt-5-pro", { reasoning: { effort: "high" } }, 8192],
  ["anthropic", "https://api.anthropic.com/v1", "claude-sonnet-4-6", { thinking: { type: "disabled" } }, 0],
  ["anthropic", "https://api.anthropic.com/v1", "claude-sonnet-5-5", { thinking: { type: "between_tools" }, output_config: { effort: "low" } }, 1024],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-flash", { thinkingConfig: { thinkingBudget: 0 } }, 0],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-2.5-pro", { thinkingConfig: { thinkingBudget: 128 } }, 512],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-3.1-flash-lite-preview", { thinkingConfig: { thinkingLevel: "minimal" } }, 1024],
  ["gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini-3.8-flash", { thinkingConfig: { thinkingLevel: "low" } }, 4096],
] as const;

describe("documented model generation controls", () => {
  it.each(cases)("sends compatible bounded controls for %s / %s / %s", async (providerId, baseUrl, model, parameters, reserve) => {
    const profile = generationProfile(baseUrl, model);
    expect(profile.parameters).toEqual(parameters); expect(profile.reasoningReserve).toBe(reserve);
    const data = { questions: [{ questionId: "q1", conversationId: "c1", question: "fixture" }] };
    const limit = taskPolicy("question_snapshot", data, model, baseUrl).maxOutputTokens;
    expect(limit).toBe(taskPolicy("question_snapshot", data).maxOutputTokens + reserve);
    const fetchMock = vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const config = providerId === "gemini" ? body.generationConfig : body;
      expect(config).toMatchObject(parameters);
      expect(config[providerId === "gemini" ? "maxOutputTokens" : profile.tokenParameter]).toBe(limit);
      if (profile.omitTemperature) expect(body.temperature).toBeUndefined();
      if (profile.tokenParameter === "max_completion_tokens") expect(body.max_tokens).toBeUndefined();
      if (!Object.hasOwn(parameters, "enable_thinking")) expect(body.enable_thinking).toBeUndefined();
      return new Response(JSON.stringify(providerId === "anthropic" ? { content: [{ type: "text", text: '{"ok":true}' }], stop_reason: "end_turn" } : providerId === "gemini" ? { candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }] } : { choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    const settings: AISettings = { id: "ai-settings", provider: providerId as AISettings["provider"], baseUrl, model, apiKey: "fixture", streaming: false, updatedAt: 1 };
    await expect(createAIProvider(settings).generateStructured({ system: "Return JSON", prompt: JSON.stringify(data), taskType: "question_snapshot", validate: value => value })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(["qwen3.8-flash", "deployment-123", "gemini-2.5-flash", "gpt-5.4"])("does not guess capabilities of an opaque custom gateway: %s", model => {
    expect(generationProfile("https://custom.example/v1", model)).toMatchObject({ parameters: {}, reasoningReserve: 0, tokenParameter: "max_tokens" });
  });
  it("never augments embedding output budgets", () => {
    expect(taskPolicy("embed", {}, "deepseek-r1", "https://example.com/v1").maxOutputTokens).toBe(taskPolicy("embed", {}).maxOutputTokens);
  });
  it("diagnoses reasoning-only exhaustion, preserves usage, and avoids another paid attempt", async () => {
    const usage = vi.fn(); const diagnostics = vi.fn();
    const fetchMock = vi.fn(async () => new Response('data: {"id":"r1","choices":[{"delta":{"reasoning_content":"private thinking"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":1200,"completion_tokens_details":{"reasoning_tokens":1200}}}\n\ndata: [DONE]\n\n', { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider({ id: "ai-settings", provider: "openai-compatible", baseUrl: "https://gateway.example/v1", model: "reasoning-fixture", apiKey: "fixture", updatedAt: 1 });
    await expect(provider.generateStructured({ system: "JSON", prompt: "Test", maxOutputTokens: 1200, onUsage: usage, onDiagnostics: diagnostics, validate: value => value })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_TRUNCATED", requestId: "r1", outputDiagnostics: { outputTokenLimit: 1200, receivedCharacters: 0, reasoningTokens: 1200, reasoningCharacters: 16 } });
    expect(fetchMock).toHaveBeenCalledOnce(); expect(usage).toHaveBeenCalledOnce();
    expect(diagnostics.mock.calls.at(-1)?.[0]).toMatchObject({ outputTokenLimit: 1200, reasoningTokens: 1200, reasoningCharacters: 16, finishReason: "length" });
    expect(JSON.stringify(diagnostics.mock.calls)).not.toContain("private thinking");
  });
  it.each(["anthropic", "gemini", "openai-compatible"] as const)("keeps active %s reasoning streams alive without retaining thought text", async providerId => {
    vi.useFakeTimers();
    const encoder = new TextEncoder();
    const frame = (value: unknown) => encoder.encode(`data: ${JSON.stringify(value)}\n\n`);
    let stream!: ReadableStreamDefaultController<Uint8Array>; let finalDiagnostics: ProviderRequestDiagnostics | undefined;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) { stream = controller; } }), { headers: { "content-type": "text/event-stream" } })));
    const pending = createAIProvider({ id: "ai-settings", provider: providerId, baseUrl: "https://gateway.example/v1", model: "fixture", apiKey: "fixture", updatedAt: 1 }).generateStructured({ system: "JSON", prompt: "Test", validate: value => value, onDiagnostics: value => { finalDiagnostics = value; } });
    await vi.advanceTimersByTimeAsync(0);
    if (providerId === "anthropic") {
      stream.enqueue(frame({ type: "message_start", message: { id: "native", usage: { input_tokens: 10, output_tokens: 0 } } }));
      stream.enqueue(frame({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } }));
    }
    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(30_000);
      stream.enqueue(frame(providerId === "anthropic" ? { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "private" } } : providerId === "gemini" ? { candidates: [{ content: { parts: [{ thought: true, text: "private" }] } }] } : { choices: [{ delta: { reasoning_content: "private" } }] }));
      await vi.advanceTimersByTimeAsync(0);
    }
    if (providerId === "anthropic") {
      stream.enqueue(frame({ type: "content_block_start", index: 1, content_block: { type: "text", text: '{"ok":true}' } }));
      stream.enqueue(frame({ type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 20 } }));
      stream.enqueue(frame({ type: "message_stop" }));
    } else if (providerId === "gemini") stream.enqueue(frame({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 15 } }));
    else { stream.enqueue(frame({ choices: [{ delta: { content: '{"ok":true}' }, finish_reason: "stop" }] })); stream.enqueue(encoder.encode("data: [DONE]\n\n")); }
    stream.close();
    await expect(pending).resolves.toEqual({ ok: true });
    expect(finalDiagnostics).toMatchObject({ receivedCharacters: 11, reasoningCharacters: 28 });
    expect(JSON.stringify(finalDiagnostics)).not.toContain("private");
    expect(fetch).toHaveBeenCalledOnce();
  });
});
