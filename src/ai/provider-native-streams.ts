import { AIProviderResponseError } from "./provider-errors";
import { readEventStream, type ResponseContext } from "./provider-transport";

export interface ClaudePayload {
  id?: string; model?: string; stop_reason?: string; reasoningCharacters?: number;
  content?: Array<{ type?: string; text?: string; thinking?: string }>;
  usage?: { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
}
export interface GeminiPayload {
  responseId?: string; modelVersion?: string; reasoningCharacters?: number;
  candidates?: Array<{ index?: number; finishReason?: string; content?: { parts?: Array<{ text?: string; thought?: boolean }> } }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number };
}

function parseChunk<T>(data: string, id?: string): T {
  try { return JSON.parse(data) as T; }
  catch { throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", id); }
}

/** Final usage is cumulative. Initial output_tokens is provisional, not a receipt. */
export async function readClaudeResponse(response: Response, context: ResponseContext, receipt: (payload: ClaudePayload) => void, onText?: (text: string) => void): Promise<ClaudePayload> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as ClaudePayload;
    context.diagnostics.requestId = payload.id ?? context.diagnostics.requestId;
    context.diagnostics.finishReason = payload.stop_reason;
    context.activity(payload.content?.filter(part => part.type === "text").reduce((n, part) => n + (part.text?.length ?? 0), 0), payload.content?.filter(part => part.type === "thinking").reduce((n, part) => n + (part.thinking?.length ?? 0), 0));
    return payload;
  }
  const payload: ClaudePayload = {};
  const blocks = new Map<number, string>();
  let characters = 0;
  let finalUsage = false;
  const preserveReceipt = () => { if (finalUsage) receipt(payload); };
  context.signal.addEventListener("abort", preserveReceipt, { once: true });
  try {
    await readEventStream(response, context.signal, ({ event, data }) => {
      const chunk = parseChunk<{ type?: string; message?: ClaudePayload; index?: number; content_block?: { type?: string; text?: string; thinking?: string }; delta?: { type?: string; text?: string; thinking?: string; stop_reason?: string }; usage?: ClaudePayload["usage"]; error?: unknown }>(data, payload.id);
      const type = chunk.type ?? event;
      if (type === "error" || chunk.error) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", payload.id);
      if (type === "message_start") {
        Object.assign(payload, chunk.message);
        context.diagnostics.requestId = payload.id ?? context.diagnostics.requestId;
      }
      if (type === "content_block_start" && chunk.content_block?.type === "text" && Number.isInteger(chunk.index)) {
        const text = chunk.content_block.text ?? ""; blocks.set(chunk.index!, text); characters += text.length; context.activity(text.length); onText?.([...blocks].sort(([a], [b]) => a - b).map(([, text]) => text).join(""));
      }
      if (type === "content_block_delta" && chunk.delta?.type === "text_delta" && typeof chunk.delta.text === "string" && blocks.has(chunk.index!)) {
        blocks.set(chunk.index!, blocks.get(chunk.index!)! + chunk.delta.text); characters += chunk.delta.text.length; context.activity(chunk.delta.text.length); onText?.([...blocks].sort(([a], [b]) => a - b).map(([, text]) => text).join(""));
      }
      if (type === "content_block_start" && chunk.content_block?.type === "thinking") context.activity(0, chunk.content_block.thinking?.length ?? 0);
      if (type === "content_block_delta" && chunk.delta?.type === "thinking_delta") context.activity(0, chunk.delta.thinking?.length ?? 0);
      if (characters > 1_000_000) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", payload.id);
      if (type === "message_delta") {
        payload.usage = { ...payload.usage, ...chunk.usage };
        if (chunk.delta?.stop_reason) { payload.stop_reason = chunk.delta.stop_reason; context.diagnostics.finishReason = payload.stop_reason; }
        if (payload.stop_reason && Number.isFinite(chunk.usage?.output_tokens)) finalUsage = true;
      }
      if (type === "message_stop") return true;
    });
    if (!payload.stop_reason) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", payload.id);
    payload.content = [...blocks].sort(([a], [b]) => a - b).map(([, text]) => ({ type: "text", text }));
    payload.reasoningCharacters = context.diagnostics.reasoningCharacters;
    return payload;
  } finally { context.signal.removeEventListener("abort", preserveReceipt); preserveReceipt(); }
}

/** Gemini ends at EOF, but a candidate finish reason is still mandatory. */
export async function readGeminiResponse(response: Response, context: ResponseContext, receipt: (payload: GeminiPayload) => void, onText?: (text: string) => void): Promise<GeminiPayload> {
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const payload = await response.json() as GeminiPayload;
    context.diagnostics.requestId = payload.responseId ?? context.diagnostics.requestId;
    context.diagnostics.finishReason = payload.candidates?.[0]?.finishReason;
    context.diagnostics.reasoningTokens = payload.usageMetadata?.thoughtsTokenCount;
    const parts = payload.candidates?.[0]?.content?.parts ?? [];
    context.activity(parts.filter(part => !part.thought).reduce((n, part) => n + (part.text?.length ?? 0), 0), parts.filter(part => part.thought).reduce((n, part) => n + (part.text?.length ?? 0), 0));
    return payload;
  }
  const payload: GeminiPayload = {};
  let text = "";
  let finishReason: string | undefined;
  const preserveReceipt = () => { if (finishReason) receipt(payload); };
  context.signal.addEventListener("abort", preserveReceipt, { once: true });
  try {
    await readEventStream(response, context.signal, ({ data }) => {
      const chunk = parseChunk<GeminiPayload & { error?: unknown }>(data, payload.responseId);
      if (chunk.error) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", payload.responseId);
      payload.responseId = chunk.responseId ?? payload.responseId; payload.modelVersion = chunk.modelVersion ?? payload.modelVersion;
      if (chunk.usageMetadata) payload.usageMetadata = { ...payload.usageMetadata, ...chunk.usageMetadata };
      context.diagnostics.requestId = payload.responseId ?? context.diagnostics.requestId;
      const candidate = chunk.candidates?.find((item) => item.index === undefined || item.index === 0);
      context.activity(0, candidate?.content?.parts?.filter(part => part.thought).reduce((n, part) => n + (part.text?.length ?? 0), 0));
      context.diagnostics.reasoningTokens = payload.usageMetadata?.thoughtsTokenCount;
      const delta = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
      text += delta; context.activity(delta.length); onText?.(text);
      if (text.length > 1_000_000) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", payload.responseId);
      finishReason = candidate?.finishReason ?? finishReason;
      context.diagnostics.finishReason = finishReason;
    }, true);
    if (!finishReason) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", payload.responseId);
    payload.candidates = [{ finishReason, content: { parts: [{ text }] } }];
    payload.reasoningCharacters = context.diagnostics.reasoningCharacters;
    return payload;
  } finally { context.signal.removeEventListener("abort", preserveReceipt); preserveReceipt(); }
}
