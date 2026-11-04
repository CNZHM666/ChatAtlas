import { afterEach, describe, expect, it, vi } from "vitest";
import type { AISettings } from "../shared/types";
import { AI_PROVIDER_PRESETS, AIProviderHttpError, canonicalModelId, createAIProvider, discoveredModelId, listAvailableModels, providerModelsUrl } from "./provider";

const settings = (provider: AISettings["provider"], baseUrl: string): AISettings => ({
  id: "ai-settings",
  provider,
  baseUrl,
  apiKey: "test-secret",
  model: "",
  updatedAt: 1,
});

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("AI provider model discovery", () => {
  it("reports missing chapter fields without persisting provider prose or inventing a repair", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ title: "Result", sections: [{ title: "Section", body: "", kind: "review", transition: "", evidenceIds: ["e1"] }] }) } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "Content-Type": "application/json" } })));
    const provider = createAIProvider({ ...settings("openai-compatible", "https://fixture.invalid/v1"), model: "fixture" });
    await expect(provider.generateStructured({ taskType: "focus_session", system: "", prompt: JSON.stringify({ intent: "Review", mode: "review", passages: [{ id: "e1", text: "Source" }], coverage: { final: true }, locale: "en" }), validate: value => value })).rejects.toMatchObject({ code: "PROVIDER_SCHEMA_missing_section_text", fieldPaths: ["sections[0].body"], repairContent: undefined });
  });
  it("handles harmless JSON punctuation in one provider request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: '```json\n{/* comment */"title":"Result", "sections":[{"title":"Section","body":"literal ,} // example", "kind":"review","transition":"","evidenceIds":["e1",],},],}\n```' } }], usage: { prompt_tokens: 100, completion_tokens: 100 } }), { headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider({ ...settings("openai-compatible", "https://fixture.invalid/v1"), model: "fixture" });
    const result = await provider.generateStructured({ taskType: "focus_session", system: "", prompt: JSON.stringify({ intent: "Review", mode: "review", passages: [{ id: "e1", text: "Source" }], coverage: { final: true }, locale: "en" }), validate: value => value });
    expect(result).toMatchObject({ title: "Result", sections: [{ body: "literal ,} // example", evidenceIds: ["e1"] }] });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
  it("handles a manually entered Gemini resource name without doubling its models prefix", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "OK" }] } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider({ ...settings("gemini", "https://generativelanguage.googleapis.com/v1beta"), model: "models/gemini-test" });
    await provider.testConnection();
    expect(provider.modelId).toBe("gemini-test");
    expect(fetchMock.mock.calls[0][0]).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test:streamGenerateContent?alt=sse");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not select an arbitrary version when multiple IDs share one display name", () => {
    const models = [{ id: "version-a", name: "Shared name" }, { id: "version-b", name: "Shared name" }];
    expect(discoveredModelId("Shared name", models, { baseUrl: "https://gateway.example/v1" })).toBe("Shared name");
    expect(discoveredModelId("version-b", models, { baseUrl: "https://gateway.example/v1" })).toBe("version-b");
  });
  it("keeps DashScope API IDs separate from display names and follows its actual page lengths", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { total: 2, page_size: 1, models: [{ model: "qwen3.8-flash", name: "Qwen3.8-Flash" }] } })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ output: { total: 2, page_size: 1, models: [{ model: "qwen-plus", name: "通义千问 Plus" }] } })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listAvailableModels(settings("qwen", "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"))).resolves.toEqual([{ id: "qwen3.8-flash", name: "Qwen3.8-Flash" }, { id: "qwen-plus", name: "通义千问 Plus" }]);
    expect(fetchMock.mock.calls.map(([url]) => String(url))).toEqual([1, 2].map((page) => `https://dashscope-intl.aliyuncs.com/api/v1/models?page_no=${page}&page_size=100&capabilities=TG`));
    expect(providerModelsUrl(settings("qwen", "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1"))).toBe("https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/models");
  });

  it("uses a custom Qwen gateway for discovery and preserves opaque model IDs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "models/Qwen3.8-Flash", name: "Qwen" }] })));
    vi.stubGlobal("fetch", fetchMock);
    await expect(listAvailableModels(settings("qwen", "https://my-gateway.example/v1"))).resolves.toEqual([{ id: "models/Qwen3.8-Flash", name: "Qwen" }]);
    expect(fetchMock.mock.calls[0][0]).toBe("https://my-gateway.example/v1/models");
    expect(canonicalModelId({ baseUrl: "https://my-gateway.example/v1", model: "Qwen3.8-Flash" })).toBe("Qwen3.8-Flash");
  });

  it("repairs the old official Qwen display ID without an extra model-list request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] })));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider({ ...settings("qwen", "https://dashscope.aliyuncs.com/compatible-mode/v1"), model: "Qwen3.8-Flash" });
    await provider.generateStructured({ system: "JSON", prompt: "Test", validate: (value) => value });
    expect(provider.modelId).toBe("qwen3.8-flash");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ model: "qwen3.8-flash", enable_thinking: false });
  });

  it("does not add Qwen-specific parameters to a custom gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] })));
    vi.stubGlobal("fetch", fetchMock);
    await createAIProvider({ ...settings("qwen", "https://my-gateway.example/v1"), model: "Qwen3.8-Flash" }).testConnection();
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.model).toBe("Qwen3.8-Flash");
    expect(body).not.toHaveProperty("enable_thinking");
  });

  it.each([
    { provider: "gemini" as const, first: { models: [{ name: "models/gemini-a" }], nextPageToken: "cursor-a" }, second: { models: [{ name: "models/gemini-b" }] }, parameter: "pageToken", ids: ["gemini-a", "gemini-b"] },
    { provider: "anthropic" as const, first: { data: [{ id: "claude-a" }], has_more: true, last_id: "cursor-a" }, second: { data: [{ id: "claude-b" }], has_more: false }, parameter: "after_id", ids: ["claude-a", "claude-b"] },
  ])("reads every $provider model page", async ({ provider, first, second, parameter, ids }) => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(first))).mockResolvedValueOnce(new Response(JSON.stringify(second)));
    vi.stubGlobal("fetch", fetchMock);
    expect((await listAvailableModels(settings(provider, "https://native.example/v1"))).map((item) => item.id)).toEqual(ids);
    expect(fetchMock.mock.calls[1][0]).toBe(`https://native.example/v1/models?${parameter}=cursor-a`);
  });

  it("stops a broken repeated cursor instead of looping through model requests", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ models: [{ name: "models/gemini-a" }], nextPageToken: "same" }))));
    await expect(listAvailableModels(settings("gemini", "https://native.example/v1"))).rejects.toThrow("分页重复");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps a useful model-not-found diagnostic without exposing raw error JSON", () => {
    const error = new AIProviderHttpError(404, JSON.stringify({ error: { code: "model_not_found", message: "opaque secret" }, request_id: "request-model-404" }));
    expect(error).toMatchObject({ code: "PROVIDER_MODEL_NOT_FOUND", requestId: "request-model-404", status: 404 });
    expect(error.message).toContain("API 模型 ID");
    expect(error.message).not.toContain("opaque secret");
  });

  it("explains a missing JSON instruction without showing truncated provider payloads", () => {
    const error = new AIProviderHttpError(400, JSON.stringify({ error: { message: "'messages' must contain the word 'json' in some form, to use 'response_format' of type 'json_object'." } }), undefined, "json-request");
    expect(error).toMatchObject({ code: "PROVIDER_HTTP_400", requestId: "json-request" });
    expect(error.message).toContain("JSON 输出指令");
    expect(error.message).not.toContain("response_format");
  });

  it("combines Claude text blocks and excludes Gemini thoughts from structured output", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ content: [{ type: "thinking", text: "not the result" }, { type: "text", text: '{"ok":' }, { type: "text", text: "true}" }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ thought: true, text: '{"ok":false}' }, { text: '{"ok":true}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, thoughtsTokenCount: 20 } }))));
    const request = { system: "JSON", prompt: "Test", validate: (value: unknown) => value };
    await expect(createAIProvider({ ...settings("anthropic", "https://native.example/v1"), model: "claude-test" }).generateStructured(request)).resolves.toEqual({ ok: true });
    const gemini = createAIProvider({ ...settings("gemini", "https://native.example/v1"), model: "gemini-test" });
    await expect(gemini.generateStructured(request)).resolves.toEqual({ ok: true });
    expect(gemini.getUsageSnapshot?.()).toMatchObject({ inputTokens: 10, outputTokens: 25, requests: 1 });
  });
  it("discovers models from an OpenAI-compatible provider without hardcoded model ids", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ id: "future-model-v9" }, { id: "offline-model", status: "offline" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAvailableModels(settings("deepseek", "https://api.deepseek.com/v1"))).resolves.toEqual([
      { id: "future-model-v9", name: "future-model-v9" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.deepseek.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer test-secret" }),
    }));
  });

  it("uses Anthropic's native model-list authentication", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [{ id: "claude-dynamic", display_name: "Claude Dynamic" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listAvailableModels(settings("anthropic", "https://api.anthropic.com/v1"))).resolves.toEqual([
      { id: "claude-dynamic", name: "Claude Dynamic" },
    ]);
    expect(fetchMock).toHaveBeenCalledWith("https://api.anthropic.com/v1/models", expect.objectContaining({
      headers: expect.objectContaining({ "x-api-key": "test-secret", "anthropic-version": "2023-06-01" }),
    }));
  });

  it("normalizes Gemini model names and hides models that cannot generate content", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [
      { name: "models/gemini-dynamic", displayName: "Gemini Dynamic", supportedGenerationMethods: ["generateContent"] },
      { name: "models/embedding-only", supportedGenerationMethods: ["embedContent"] },
    ] }), { status: 200 })));

    await expect(listAvailableModels(settings("gemini", "https://generativelanguage.googleapis.com/v1beta"))).resolves.toEqual([
      { id: "gemini-dynamic", name: "Gemini Dynamic" },
    ]);
  });

  it("offers the major domestic providers as presets", () => {
    const ids = new Set(AI_PROVIDER_PRESETS.map((provider) => provider.id));
    expect([...ids]).toEqual(expect.arrayContaining([
      "deepseek", "qwen", "moonshot", "zhipu", "minimax", "siliconflow", "baidu", "volcengine", "tencent", "lingyi", "stepfun",
    ]));
  });

  it("records provider-reported tokens separately from request estimates", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"answer":"ok"}' } }], usage: { prompt_tokens: 123, completion_tokens: 17 },
    }), { status: 200 })));
    const provider = createAIProvider({ ...settings("deepseek", "https://api.deepseek.com/v1"), model: "test-model" });
    await expect(provider.generateStructured({ system: "Return JSON", prompt: "test", validate: (value) => value })).resolves.toEqual({ answer: "ok" });
    expect(provider.getUsageSnapshot?.()).toEqual({ requests: 1, inputTokens: 123, outputTokens: 17, reportedRequests: 1 });
  });

  it("fails a response whose body never completes instead of leaving a task waiting forever", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: () => new Promise(() => undefined) }));
    const pending = listAvailableModels(settings("deepseek", "https://api.deepseek.com/v1"));
    const expected = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(90_000);
    await expected;
  });
});
