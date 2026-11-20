import { sourceMessageSignature } from "../shared/source-signature";

export interface ModelTokenLimits {
  maxContextTokens?: number;
  maxInputTokens?: number;
  maxOutputTokens?: number;
}

const STORE_KEY = "atlas-provider-model-limits-v1";
type ModelEndpoint = { provider: string; baseUrl: string };
const identity = (settings: ModelEndpoint, id: string) => sourceMessageSignature(JSON.stringify([settings.provider, settings.baseUrl.replace(/\/+$/u, ""), id]));
let limits: Record<string, ModelTokenLimits> | undefined;
const read = () => {
  if (!limits) {
    try {
      const parsed = JSON.parse(globalThis.localStorage?.getItem(STORE_KEY) ?? "{}");
      limits = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    } catch { limits = {}; }
  }
  return limits!;
};
const bound = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 64 ? value : undefined;

export function reportedModelLimits(model: Record<string, unknown>): ModelTokenLimits {
  const route = model.top_provider as Record<string, unknown> | undefined;
  return {
    maxContextTokens: bound(model.context_length) ?? bound(route?.context_length),
    maxInputTokens: bound(model.inputTokenLimit) ?? bound(model.max_input_tokens),
    maxOutputTokens: bound(model.outputTokenLimit) ?? bound(model.max_output_tokens) ?? bound(model.max_completion_tokens) ?? bound(route?.max_completion_tokens),
  };
}

export function rememberProviderModelLimits(settings: ModelEndpoint, models: Array<ModelTokenLimits & { id: string }>) {
  const store = read();
  for (const { id, maxContextTokens, maxInputTokens, maxOutputTokens } of models) {
    const key = identity(settings, id);
    delete store[key];
    if (maxContextTokens || maxInputTokens || maxOutputTokens) store[key] = { maxContextTokens, maxInputTokens, maxOutputTokens };
  }
  limits = Object.fromEntries(Object.entries(store).slice(-1000));
  try { globalThis.localStorage?.setItem(STORE_KEY, JSON.stringify(limits)); } catch { /* Discovery still works without storage. */ }
}

export function providerModelLimits(settings: ModelEndpoint, id: string): ModelTokenLimits {
  const stored = read()[identity(settings, id)];
  return stored ? {
    maxContextTokens: bound(stored.maxContextTokens), maxInputTokens: bound(stored.maxInputTokens), maxOutputTokens: bound(stored.maxOutputTokens),
  } : {};
}
