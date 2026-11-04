import type { AISettings } from "../shared/types";
import { AI_PROVIDER_PRESETS } from "./provider";
import { effectiveAISettings } from "./ai-mode";
import { recordAIUsage } from "../storage/ai-usage";
import { estimateTokens } from "../shared/atlas/policy.js";
import { providerResponse, type ProviderRequestDiagnostics } from "./provider-transport";

export interface EmbeddingProvider {
  readonly modelKey: string;
  readonly providerId?: string;
  readonly modelId?: string;
  readonly version?: string;
  embedText(text: string, signal?: AbortSignal): Promise<number[]>;
  embedBatch(texts: string[], signal?: AbortSignal): Promise<number[][]>;
}

export function configuredEmbeddingProvider(settings: AISettings, taskRunId?: string, conversationIds: string[] = []): EmbeddingProvider | null {
  const model = settings.embeddingModel?.trim();
  const preset = AI_PROVIDER_PRESETS.find((item) => item.id === settings.provider);
  if (!model || !settings.apiKey || !settings.baseUrl || preset?.protocol !== "openai") return null;
  const version = settings.embeddingVersion?.trim() || "1";
  const modelKey = `${settings.provider}:${settings.baseUrl.replace(/\/+$/u, "")}:${model}:${version}`;
  const runId = taskRunId ?? `embedding-${crypto.randomUUID()}`;
  const embedBatch = async (texts: string[], signal?: AbortSignal): Promise<number[][]> => {
    if (!texts.length) return [];
    const startedAt = performance.now();
    const requestStartedAt = Date.now();
    let diagnostics: ProviderRequestDiagnostics = {};
    let errorCode: string | undefined;
    let reportedTokens: number | undefined;
    let status: "completed" | "failed" = "failed";
    try {
    const body = await providerResponse(`${settings.baseUrl.replace(/\/+$/u, "")}/embeddings`, { method: "POST", headers: { authorization: `Bearer ${settings.apiKey}`, "content-type": "application/json" }, body: JSON.stringify({ model, input: texts }), signal }, (response) => response.json(), { onDiagnostics: (value) => { diagnostics = value; } }) as { id?: string; data?: Array<{ index?: number; embedding?: unknown }>; usage?: { total_tokens?: number; prompt_tokens?: number } };
    const tokens = body.usage?.total_tokens ?? body.usage?.prompt_tokens;
    reportedTokens = typeof tokens === "number" && Number.isFinite(tokens) && tokens >= 0 ? tokens : undefined;
    diagnostics.requestId = body.id ?? diagnostics.requestId;
    const ordered = [...(body.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (ordered.length !== texts.length || ordered.some((item, index) => item.index !== index || !Array.isArray(item.embedding) || !item.embedding.length || item.embedding.some((value: unknown) => typeof value !== "number" || !Number.isFinite(value)))) throw new Error("Embedding provider returned invalid vectors.");
    const vectors = ordered.map((item) => item.embedding as number[]);
    if (vectors.some((vector) => vector.length !== vectors[0].length)) throw new Error("Embedding dimensions changed within one batch.");
    status = "completed";
    return vectors;
    } catch (error) { errorCode = error && typeof error === "object" && "code" in error ? String(error.code) : error instanceof Error && error.name === "AbortError" ? "PROVIDER_ABORTED" : "PROVIDER_INVALID_RESPONSE"; throw error; } finally {
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId, taskType: "embedding", feature:"embedding",operation:"embedding:batch",operationId:crypto.randomUUID(),timing:{queueMs:diagnostics.queueMs,responseMs:diagnostics.responseMs}, providerId: settings.provider, modelId: model, conversationIds, inputTokens: 0, outputTokens: 0, embeddingTokens: reportedTokens ?? (status === "completed" ? estimateTokens(texts.join("\n")) : 0), tokenSource: reportedTokens !== undefined ? "provider" : status === "completed" ? "estimated" : "unavailable", status, attempt: 1, durationMs: Math.round(performance.now() - startedAt), requestStartedAt, estimatedInputTokens: estimateTokens(texts.join("\n")), errorCode, ...diagnostics }).catch(() => undefined);
    }
  };
  return { modelKey, providerId: settings.provider, modelId: model, version, embedBatch, embedText: async (text, signal) => (await embedBatch([text], signal))[0] };
}

/** The embedding model for organizing a Wiki, as an option to spread into the organizer's input: none in demo mode
 * or without a configured model, so the organizer recalls by words. */
export function embeddingsFor(settings: AISettings, runId?: string): { embeddings?: EmbeddingProvider } {
  const embeddings = configuredEmbeddingProvider(settings, runId);
  return embeddings ? { embeddings } : {};
}

export async function resolveEmbeddingProvider(settings: AISettings, _signal?: AbortSignal, runId?: string, conversationIds?: string[]): Promise<EmbeddingProvider | null> {
  void _signal; // Per-request cancellation is passed to embedBatch.
  return configuredEmbeddingProvider(effectiveAISettings(settings), runId, conversationIds);
}
