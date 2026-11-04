import { AIProviderHttpError, AIProviderResponseError } from "./provider-errors";
import { providerQueue } from "./request-queue";

export interface ProviderRequestDiagnostics {
  streaming?: boolean;
  responseHeadersMs?: number;
  firstTokenMs?: number;
  receivedCharacters?: number;
  reasoningCharacters?: number;
  reasoningTokens?: number;
  outputTokenLimit?: number;
  finishReason?: string;
  timeoutStage?: "response_headers" | "response_body" | "first_token" | "stream_idle" | "total";
  requestId?: string;
  queueMs?: number;
  responseMs?: number;
}

export interface ResponseContext {
  activity: (textCharacters?: number, reasoningCharacters?: number) => void;
  signal: AbortSignal;
  diagnostics: ProviderRequestDiagnostics;
}

/** One owner keeps cancellation and deadlines alive until the body is consumed. */
export async function providerResponse<T>(url: string, init: RequestInit, read: (response: Response, context: ResponseContext) => Promise<T>, options: { streaming?: boolean; priority?: number; onDiagnostics?: (value: ProviderRequestDiagnostics) => void } = {}): Promise<T> {
  const queuedAt = performance.now(), queue = providerQueue(url);
  let release:()=>void;
  try { release=await queue.acquire(init.signal ?? undefined, options.priority ?? (url.endsWith("/embeddings") ? 0 : 1)); }
  catch(error){options.onDiagnostics?.({streaming:Boolean(options.streaming),queueMs:Math.round(performance.now()-queuedAt)});throw error;}
  const controller = new AbortController();
  const started = performance.now();
  const diagnostics: ProviderRequestDiagnostics = { streaming: Boolean(options.streaming), receivedCharacters: 0, queueMs: Math.round(performance.now() - queuedAt) };
  let phase: NonNullable<ProviderRequestDiagnostics["timeoutStage"]> = "response_headers";
  let idleTimer: ReturnType<typeof setTimeout>;
  let response: Response | undefined;
  const abort = () => controller.abort(init.signal?.reason ?? new DOMException("Cancelled", "AbortError"));
  const timeout = (stage: NonNullable<ProviderRequestDiagnostics["timeoutStage"]>) => {
    diagnostics.timeoutStage = stage;
    controller.abort(new AIProviderResponseError("PROVIDER_TIMEOUT", diagnostics.requestId));
  };
  const armIdle = (ms: number) => { globalThis.clearTimeout(idleTimer); idleTimer = globalThis.setTimeout(() => timeout(phase), ms); };
  const totalTimer = globalThis.setTimeout(() => timeout(options.streaming ? "total" : phase), options.streaming ? 180_000 : 90_000);
  armIdle(90_000);
  let rejectAbort: (error: unknown) => void = () => undefined;
  const cancelled = new Promise<never>((_, reject) => { rejectAbort = reject; });
  const cancelWait = () => rejectAbort(controller.signal.reason);
  controller.signal.addEventListener("abort", cancelWait, { once: true });
  init.signal?.addEventListener("abort", abort, { once: true });
  if (init.signal?.aborted) abort();
  const execute = async () => {
    controller.signal.throwIfAborted();
    response = await fetch(url, { ...init, signal: controller.signal });
    if (controller.signal.aborted) {
      void response.body?.cancel().catch(() => undefined);
      controller.signal.throwIfAborted();
    }
    diagnostics.responseHeadersMs = Math.round(performance.now() - started);
    diagnostics.requestId = response.headers?.get("x-request-id") ?? response.headers?.get("request-id") ?? undefined;
    phase = options.streaming ? "first_token" : "response_body";
    armIdle(90_000);
    if (!response.ok) {
      // Do not let a stuck error body hide the HTTP status or trigger a schema repair.
      armIdle(15_000);
      const detail = await Promise.race([response.text(), cancelled]).catch(() => "");
      const retryAfter = response.headers?.get("Retry-After");
      const seconds = retryAfter ? Number(retryAfter) : NaN;
      const retryAfterMs = Number.isFinite(seconds) ? Math.max(0, seconds * 1000) : retryAfter ? Math.max(0, Date.parse(retryAfter) - Date.now()) : undefined;
      if (response.status === 429) queue.rateLimited(retryAfterMs);
      throw new AIProviderHttpError(response.status, detail, Number.isFinite(retryAfterMs) ? retryAfterMs : undefined, diagnostics.requestId);
    }
    return read(response, { signal: controller.signal, diagnostics, activity: (characters = 0, reasoning = 0) => {
      controller.signal.throwIfAborted();
      if (reasoning > 0) diagnostics.reasoningCharacters = (diagnostics.reasoningCharacters ?? 0) + reasoning;
      if (characters > 0) {
        diagnostics.firstTokenMs ??= Math.round(performance.now() - started);
        diagnostics.receivedCharacters = (diagnostics.receivedCharacters ?? 0) + characters;
        options.onDiagnostics?.({ ...diagnostics });
      }
      if (characters > 0 || reasoning > 0) { phase = "stream_idle"; armIdle(45_000); }
    } });
  };
  try { const result=await Promise.race([execute(), cancelled]);queue.succeeded();return result; }
  finally {
    globalThis.clearTimeout(totalTimer); globalThis.clearTimeout(idleTimer!);
    init.signal?.removeEventListener("abort", abort);
    controller.signal.removeEventListener("abort", cancelWait);
    if (controller.signal.aborted) void response?.body?.cancel().catch(() => undefined);
    release();
    diagnostics.responseMs = Math.round(performance.now() - started);
    options.onDiagnostics?.({ ...diagnostics });
  }
}

/** Decode SSE across arbitrary network/UTF-8 boundaries; never expose partial JSON. */
export async function readSse(response: Response, signal: AbortSignal, onData: (data: string) => void): Promise<void> {
  return readEventStream(response, signal, ({ data }) => { if (data === "[DONE]") return true; onData(data); });
}

/** Native protocols have their own completion events; only Gemini permits EOF. */
export async function readEventStream(response: Response, signal: AbortSignal, onEvent: (event: { event: string; data: string }) => boolean | void, allowEof = false): Promise<void> {
  if (!response.body) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let ended = false;
  const abort = () => { void reader.cancel().catch(() => undefined); };
  signal.addEventListener("abort", abort, { once: true });
  try {
    while (!ended) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/u.exec(buffer))) {
        const frame = buffer.slice(0, match.index); buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/u).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).replace(/^ /u, "")).join("\n");
        const event = frame.split(/\r?\n/u).find((line) => line.startsWith("event:"))?.slice(6).trim() || "message";
        if (data && onEvent({ event, data }) === true) { ended = true; break; }
      }
      if (buffer.length > 1_000_000) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE");
      if (done) break;
    }
    if (!ended && (!allowEof || buffer.trim())) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE");
  } finally {
    signal.removeEventListener("abort", abort);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
