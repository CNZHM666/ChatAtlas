import { afterEach, expect, it, vi } from "vitest";
import { AI_PROVIDER_PRESETS, createAIProvider } from "./provider";
import type { AISettings } from "../shared/types";

const settings = (provider: AISettings["provider"], streaming = true): AISettings => ({ id: "ai-settings", provider, baseUrl: AI_PROVIDER_PRESETS.find((item) => item.id === provider)?.baseUrl || "https://gateway.example/v1", apiKey: "fixture", model: "opaque-model", streaming, updatedAt: 0 });
const request = { system: "JSON", prompt: "test", validate: (value: unknown) => value };
const event = (type: string, value: unknown) => `event: ${type}\r\ndata: ${JSON.stringify(value)}\r\n\r\n`;
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const claudeStart = event("message_start", { type: "message_start", message: { id: "claude-receipt", model: "claude", usage: { input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 20 } } });
const claudeText = event("content_block_start", { index: 1, content_block: { type: "text", text: '{"answer":"' } }) + event("content_block_delta", { index: 1, delta: { type: "text_delta", text: '保留更正"}' } });
const claudeFinish = event("message_delta", { delta: { stop_reason: "end_turn" }, usage: { output_tokens: 12 } });
const claudeStop = event("message_stop", { type: "message_stop" });
const geminiText = frame({ responseId: "gemini-receipt", candidates: [{ index: 0, content: { parts: [{ thought: true, text: "私有推理" }, { text: '{"answer":"保留更正"}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 2 } });
const geminiFinish = frame({ candidates: [{ index: 0, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 12, thoughtsTokenCount: 5 } });
function sse(text: string) { return new Response(text, { headers: { "content-type": "text/event-stream" } }); }
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each(["openai", "anthropic", "gemini"] as const)("publishes %s response text before completion, without exposing thought blocks", async protocol => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const bytes = new TextEncoder();
  const first = protocol === "anthropic" ? claudeStart + claudeText : protocol === "gemini" ? geminiText : frame({ choices: [{ index: 0, delta: { reasoning_content: "私有推理", content: '{"answer":"保留更正"}' } }] });
  const finish = protocol === "anthropic" ? claudeFinish + claudeStop : protocol === "gemini" ? geminiFinish : frame({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream<Uint8Array>({ start(stream) { controller = stream; stream.enqueue(bytes.encode(first)); } }), { headers: { "content-type": "text/event-stream" } })));
  const onResponseText = vi.fn(); let done = false;
  const pending = createAIProvider(settings(protocol)).generateStructured({ ...request, onResponseText }).then(value => { done = true; return value; });
  await vi.waitFor(() => expect(onResponseText).toHaveBeenCalledWith('{"answer":"保留更正"}'));
  expect(done).toBe(false); expect(onResponseText.mock.calls.flat().join(" ")).not.toContain("私有推理");
  controller.enqueue(bytes.encode(finish)); controller.close();
  expect(await pending).toEqual({ answer: "保留更正" });
});

it.each(AI_PROVIDER_PRESETS.filter((item) => item.protocol === "openai"))("streams $id without vendor-specific parameters on a custom host", async ({ id }) => {
  const fetchMock = vi.fn().mockResolvedValue(sse(frame({ id: "receipt", choices: [{ index: 0, delta: { content: '{"ok":true}' }, finish_reason: "stop" }] }) + frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } }) + "data: [DONE]\n\n"));
  vi.stubGlobal("fetch", fetchMock);
  const usage = vi.fn();
  await expect(createAIProvider({ ...settings(id), baseUrl: "https://gateway.example/v1" }).generateStructured({ ...request, onUsage: usage })).resolves.toEqual({ ok: true });
  const body = JSON.parse(fetchMock.mock.calls[0][1].body);
  expect(body.stream).toBe(true); expect(body.model).toBe("opaque-model");
  expect(body).not.toHaveProperty("enable_thinking"); expect(body).not.toHaveProperty("stream_options");
  expect(usage).toHaveBeenCalledOnce(); expect(fetchMock).toHaveBeenCalledOnce();
});

it("uses Claude native events, multiple text blocks, and final cumulative usage", async () => {
  const extra = event("content_block_start", { index: 0, content_block: { type: "thinking", text: "忽略推理" } });
  const bytes = new TextEncoder().encode(claudeStart + extra + event("ping", { type: "ping" }) + claudeText + claudeFinish + claudeStop);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { for (const byte of bytes) controller.enqueue(Uint8Array.of(byte)); controller.close(); } }), { headers: { "content-type": "text/event-stream" } })));
  const usage = vi.fn(), validate = vi.fn(request.validate), diagnostics = vi.fn();
  await expect(createAIProvider(settings("anthropic")).generateStructured({ ...request, validate, onUsage: usage, onDiagnostics: diagnostics })).resolves.toEqual({ answer: "保留更正" });
  expect(validate).toHaveBeenCalledOnce(); expect(usage).toHaveBeenCalledOnce();
  expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 30, outputTokens: 12, requestId: "claude-receipt" }));
  expect(diagnostics).toHaveBeenLastCalledWith(expect.objectContaining({ streaming: true, receivedCharacters: '{"answer":"保留更正"}'.length }));
});

it("uses Gemini SSE EOF, excludes thoughts and charges final thinking tokens once", async () => {
  const fetchMock = vi.fn().mockResolvedValue(sse(geminiText + geminiFinish)); vi.stubGlobal("fetch", fetchMock);
  const provider = createAIProvider(settings("gemini")), usage = vi.fn();
  await expect(provider.generateStructured({ ...request, onUsage: usage })).resolves.toEqual({ answer: "保留更正" });
  expect(String(fetchMock.mock.calls[0][0])).toContain(":streamGenerateContent?alt=sse");
  expect(usage).toHaveBeenCalledOnce(); expect(usage).toHaveBeenCalledWith(expect.objectContaining({ inputTokens: 10, outputTokens: 17, requestId: "gemini-receipt" }));
});

it.each([
  ["anthropic", claudeStart + claudeText, 0],
  ["anthropic", claudeStart + claudeText + claudeFinish, 1],
  ["anthropic", claudeStart + claudeText + event("error", { error: { type: "overloaded_error" } }), 0],
  ["gemini", geminiText, 0],
  ["gemini", geminiText + geminiFinish + 'data: {"unfinished":', 1],
] as const)("rejects incomplete %s responses, retaining only final receipts", async (id, text, count) => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(text)));
  const validate = vi.fn(request.validate), usage = vi.fn();
  await expect(createAIProvider(settings(id)).generateStructured({ ...request, validate, onUsage: usage })).rejects.toMatchObject({ code: "PROVIDER_STREAM_INCOMPLETE" });
  expect(validate).not.toHaveBeenCalled(); expect(usage).toHaveBeenCalledTimes(count); expect(fetch).toHaveBeenCalledOnce();
});

it.each(["anthropic", "gemini"] as const)("retains %s usage on truncation without accepting the preview", async (id) => {
  const text = id === "anthropic" ? claudeStart + claudeText + claudeFinish.replace("end_turn", "max_tokens") + claudeStop : geminiText + geminiFinish.replace("STOP", "MAX_TOKENS");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(sse(text))); const usage = vi.fn(), validate = vi.fn(request.validate);
  await expect(createAIProvider(settings(id)).generateStructured({ ...request, onUsage: usage, validate })).rejects.toMatchObject({ code: "PROVIDER_OUTPUT_TRUNCATED" });
  expect(usage).toHaveBeenCalledOnce(); expect(validate).not.toHaveBeenCalled();
});

it.each(["anthropic", "gemini", "deepseek"] as const)("supports explicit non-streaming %s compatibility without a second request", async (id) => {
  const payload = id === "anthropic" ? { content: [{ type: "text", text: "OK" }] } : id === "gemini" ? { candidates: [{ content: { parts: [{ text: "OK" }] } }] } : { choices: [{ message: { content: "OK" } }] };
  const fetchMock = vi.fn().mockResolvedValue(Response.json(payload)); vi.stubGlobal("fetch", fetchMock);
  await createAIProvider(settings(id, false)).testConnection();
  if (id === "gemini") expect(String(fetchMock.mock.calls[0][0])).toContain(":generateContent");
  else expect(JSON.parse(fetchMock.mock.calls[0][1].body).stream).toBe(false);
  expect(fetchMock).toHaveBeenCalledOnce();
});

it.each(["anthropic", "gemini"] as const)("permits an active %s stream beyond 90 seconds and validates only at completion", async (id) => {
  vi.useFakeTimers();
  const first = id === "anthropic" ? claudeStart + claudeText : geminiText;
  const last = id === "anthropic" ? claudeFinish + claudeStop : geminiFinish;
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) {
    controller.enqueue(new TextEncoder().encode(first));
    for (const delay of [30000, 60000, 90000]) setTimeout(() => controller.enqueue(new TextEncoder().encode(id === "anthropic" ? event("content_block_delta", { index: 1, delta: { type: "text_delta", text: " " } }) : frame({ candidates: [{ content: { parts: [{ text: " " }] } }] }))), delay);
    setTimeout(() => { controller.enqueue(new TextEncoder().encode(last)); controller.close(); }, 100000);
  } }), { headers: { "content-type": "text/event-stream" } })));
  const validate = vi.fn(request.validate); const pending = createAIProvider(settings(id)).generateStructured({ ...request, validate });
  await vi.advanceTimersByTimeAsync(95000); expect(validate).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(5000); await expect(pending).resolves.toEqual({ answer: "保留更正" }); expect(validate).toHaveBeenCalledOnce();
});

it.each(["anthropic", "gemini", "openai"] as const)("preserves final %s usage before a missing terminator times out", async (id) => {
  vi.useFakeTimers();
  const text = id === "anthropic" ? claudeStart + claudeText + claudeFinish : id === "gemini" ? geminiText + geminiFinish : frame({ id: "receipt", choices: [{ delta: { content: '{"ok":true}' }, finish_reason: "stop" }] }) + frame({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 12 } });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); } }), { headers: { "content-type": "text/event-stream" } })));
  const usage = vi.fn(), validate = vi.fn(request.validate);
  const pending = createAIProvider(settings(id)).generateStructured({ ...request, onUsage: usage, validate }).catch((error: unknown) => { expect(usage).toHaveBeenCalledOnce(); throw error; });
  const check = expect(pending).rejects.toMatchObject({ code: "PROVIDER_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(45000); await check; expect(validate).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledOnce();
});
