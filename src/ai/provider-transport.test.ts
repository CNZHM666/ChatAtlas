import { afterEach, describe, expect, it, vi } from "vitest";
import { createAIProvider } from "./provider";
import { providerResponse, type ProviderRequestDiagnostics } from "./provider-transport";
import type { AISettings } from "../shared/types";

const settings: AISettings = { id: "ai-settings", provider: "qwen", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", apiKey: "test", model: "qwen3.8-flash", updatedAt: 0 };
const encoder = new TextEncoder();
const chunk = (content: string, finish?: string) => `data: ${JSON.stringify({ id: "stream-receipt", model: settings.model, choices: [{ index: 0, delta: { content }, finish_reason: finish ?? null }] })}\r\n\r\n`;
const receipt = `data: ${JSON.stringify({ id: "stream-receipt", choices: [], usage: { prompt_tokens: 120, completion_tokens: 15 } })}\n\n`;
const request = { system: "Return JSON", prompt: "test", validate: (value: unknown) => value };
const sse = (text: string) => new Response(text, { headers: { "content-type": "text/event-stream" } });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("provider response lifecycle", () => {
  it.each(["reading", "synthesis"])("includes JSON in %s batch messages before sending JSON mode", async (stage) => {
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      expect(body.response_format).toEqual({ type: "json_object" });
      if (!body.messages.some((message: { content: string }) => /json/iu.test(message.content))) return new Response(JSON.stringify({ error: { message: "'messages' must contain the word 'json'" } }), { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"notes":[{"title":"笔记","text":"中文正文"}]}' }, finish_reason: "stop" }] }));
    }));
    const validate = vi.fn((value: unknown) => value);
    await expect(createAIProvider({ ...settings, streaming: false }).generateStructured({ system: "整理材料", prompt: JSON.stringify({ intent: "复习", mode: "review", locale: "zh-CN", passages: [{ id: "p1", text: "原文" }], coverage: { stage, final: false } }), taskType: "focus_session", validate })).resolves.toMatchObject({ sections: [{ title: "笔记", body: "中文正文" }] });
    expect(validate).toHaveBeenCalledOnce();
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each(["openai-compatible", "anthropic", "gemini"] as const)("propagates cancellation through %s body reads", async (providerId) => {
    let transport!: AbortSignal;
    let enteredBody!: () => void;
    const entered = new Promise<void>((resolve) => { enteredBody = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      transport = init.signal!;
      return { ok: true, headers: new Headers(), json: () => { enteredBody(); return new Promise(() => undefined); } };
    }));
    const controller = new AbortController();
    const pending = createAIProvider({ ...settings, provider: providerId, baseUrl: "https://gateway.example/v1" }).generateStructured({ ...request, signal: controller.signal });
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await entered; controller.abort(); await check;
    expect(transport.aborted).toBe(true); expect(fetch).toHaveBeenCalledOnce();
  });
  it("cancels the underlying transport when the user cancels after response headers", async () => {
    let transport!: AbortSignal;
    let bodyRead!: () => void;
    const entered = new Promise<void>((resolve) => { bodyRead = resolve; });
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      transport = init.signal!;
      return { ok: true, headers: new Headers(), json: () => { bodyRead(); return new Promise(() => undefined); } };
    }));
    const controller = new AbortController();
    const pending = providerResponse("https://test.example", { signal: controller.signal }, (response) => response.json());
    const check = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await entered;
    controller.abort(); await check;
    expect(transport.aborted).toBe(true);
  });

  it("uses one 90-second deadline for non-streaming headers and body together", async () => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => Date.now());
    let transport!: AbortSignal;
    let diagnostics: ProviderRequestDiagnostics | undefined;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      transport = init.signal!;
      await new Promise((resolve) => setTimeout(resolve, 70_000));
      return { ok: true, headers: new Headers(), json: () => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 40_000)) };
    }));
    const pending = providerResponse("https://test.example", {}, (response) => response.json(), { onDiagnostics: (value) => { diagnostics = value; } });
    const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(90_000); await check;
    expect(transport.aborted).toBe(true);
    expect(diagnostics).toMatchObject({ responseHeadersMs: 70_000, timeoutStage: "response_body" });
  });

  it("assembles Chinese UTF-8 split at every byte and retains the trailing usage-only frame", async () => {
    const bytes = encoder.encode(chunk('{"answer":"更正：保留条件"}', "stop") + receipt + "data: [DONE]\n\n");
    const progress: ProviderRequestDiagnostics[] = [];
    const usage = vi.fn();
    const validate = vi.fn(request.validate);
    const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>().mockImplementation(async () => new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const provider = createAIProvider(settings);
    await expect(provider.generateStructured({ ...request, validate, onUsage: usage, onDiagnostics: (value) => progress.push(value) })).resolves.toEqual({ answer: "更正：保留条件" });
    expect(validate).toHaveBeenCalledOnce(); expect(usage).toHaveBeenCalledOnce();
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 120, outputTokens: 15, requestId: "stream-receipt" }));
    expect(progress.at(-1)).toMatchObject({ streaming: true, firstTokenMs: expect.any(Number), receivedCharacters: '{"answer":"更正：保留条件"}'.length });
    expect(JSON.parse(fetchMock.mock.calls[0][1]?.body as string)).toMatchObject({ stream: true, stream_options: { include_usage: true }, enable_thinking: false, response_format: { type: "json_object" } });
    expect(provider.capabilities?.maxConcurrency).toBe(10); // DashScope is a large hosted API.
  });

  it("lets an active stream finish after 90 seconds without accepting partial JSON", async () => {
    vi.useFakeTimers();
    const validate = vi.fn(request.validate);
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ start(controller) {
      for (const [time, text] of [[30_000, chunk('{"ok":')], [60_000, chunk("t")], [90_000, chunk("r")], [120_000, chunk("ue}", "stop")], [140_000, receipt + "data: [DONE]\n\n"]] as const) setTimeout(() => controller.enqueue(encoder.encode(text)), time);
    } }), { headers: { "content-type": "text/event-stream" } })));
    const pending = createAIProvider(settings).generateStructured({ ...request, validate });
    await vi.advanceTimersByTimeAsync(120_000); expect(validate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20_000); await expect(pending).resolves.toEqual({ ok: true });
    expect(validate).toHaveBeenCalledOnce();
  });

  it("aborts an idle stream and reports that output had already started", async () => {
    vi.useFakeTimers();
    let transport!: AbortSignal;
    let diagnostics: ProviderRequestDiagnostics | undefined;
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => {
      transport = init.signal!;
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(encoder.encode(chunk('{"ok":'))); }, cancel }), { headers: { "content-type": "text/event-stream" } });
    }));
    const pending = createAIProvider(settings).generateStructured({ ...request, onDiagnostics: (value) => { diagnostics = value; } });
    const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(45_000); await check;
    expect(transport.aborted).toBe(true); expect(cancel).toHaveBeenCalledOnce();
    expect(diagnostics).toMatchObject({ timeoutStage: "stream_idle", receivedCharacters: 6, requestId: "stream-receipt" });
  });

  it("bounds the wait for the first output even when headers arrive immediately", async () => {
    vi.useFakeTimers();
    let diagnostics: ProviderRequestDiagnostics | undefined;
    const cancel = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(new ReadableStream({ cancel }), { headers: { "content-type": "text/event-stream", "x-request-id": "queued-request" } })));
    const pending = createAIProvider(settings).generateStructured({ ...request, onDiagnostics: (value) => { diagnostics = value; } });
    const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT", requestId: "queued-request" });
    await vi.advanceTimersByTimeAsync(90_000); await check;
    expect(cancel).toHaveBeenCalledOnce();
    expect(diagnostics).toMatchObject({ timeoutStage: "first_token", receivedCharacters: 0 });
    expect(diagnostics?.firstTokenMs).toBeUndefined();
  });

  it("enforces an overall deadline even on a continuously active stream", async () => {
    vi.useFakeTimers();
    let diagnostics: ProviderRequestDiagnostics | undefined;
    let transport!: AbortSignal;
    vi.stubGlobal("fetch", vi.fn(async (_url, init: RequestInit) => { transport = init.signal!; return new Response(); }));
    const pending = providerResponse("https://test.example", {}, async (_response, context) => {
      const timer = setInterval(() => context.activity(1), 30_000);
      context.signal.addEventListener("abort", () => clearInterval(timer), { once: true });
      return new Promise(() => undefined);
    }, { streaming: true, onDiagnostics: (value) => { diagnostics = value; } });
    const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
    await vi.advanceTimersByTimeAsync(180_000); await check;
    expect(transport.aborted).toBe(true); expect(diagnostics?.timeoutStage).toBe("total");
  });

  it.each([chunk('{"ok":true}'), chunk('{"ok":true}', "stop")])("rejects a cut stream instead of confirming even parseable JSON", async (text) => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(text)));
    const validate = vi.fn(request.validate);
    await expect(createAIProvider(settings).generateStructured({ ...request, validate })).rejects.toMatchObject({ code: "PROVIDER_STREAM_INCOMPLETE" });
    expect(validate).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
  });

  it("records billed usage on a truncated stream without accepting the result", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => sse(chunk('{"ok":', "length") + receipt + "data: [DONE]\n\n")));
    const usage = vi.fn();
    await expect(createAIProvider(settings).generateStructured({ ...request, onUsage: usage })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_TRUNCATED" });
    expect(usage).toHaveBeenCalledOnce(); expect(fetch).toHaveBeenCalledOnce();
  });
});
