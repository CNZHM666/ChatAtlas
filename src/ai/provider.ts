import {modelUsageCostCny} from "../shared/model-pricing";
import type { AISettings, AITaskType } from "../shared/types";
import { requestBudget, requestMessages, validateProviderOutput } from "./request-policy";
import { AIProviderResponseError, AIProviderValidationError } from "./provider-errors";
import { providerResponse, readSse, type ProviderRequestDiagnostics } from "./provider-transport";
import { readClaudeResponse, readGeminiResponse, type ClaudePayload, type GeminiPayload } from "./provider-native-streams";
import { generationProfile } from "../shared/atlas/policy.js";
import { parseStructuredJson } from "../shared/atlas/tasks.js";
import {applyFocusLanguageRepair,focusLanguageRepairFields} from "./focus-language-repair";
import {taskData} from "./request-policy";
import { providerConcurrencyCeiling } from "./model-routing";
import { cacheablePrefix, officialHost, prefixSeenRecently, promptCacheKey, splitCacheablePrefix } from "./prompt-cache";
export { AIProviderHttpError, AIProviderResponseError, AIProviderValidationError } from "./provider-errors";

export interface StructuredAIRequest<T> {
  trace?: import("./ai-diagnostics").AITrace;
  system: string;
  prompt: string;
  validate: (value: unknown) => T;
  cacheIf?: (value: T) => boolean;
  /** Validated local reuse; no provider request or charge. */
  onCacheHit?: () => void;
  /** Reserve a caller's paid-call allowance only after local cache lookup. */
  beforeRequest?: () => void;
  /** Skip local reuse and replace it only after a successful validated request. */
  bypassCache?: boolean;
  priority?: number;
  temperature?: number;
  signal?: AbortSignal;
  taskType?: AITaskType;
  conversationIds?: string[];
  runId?: string;
  repair?: boolean;
  repairContent?: string;
  repairFields?: Array<{path:string;text:string}>;
  maxOutputTokens?: number;
  onUsage?: (usage: ProviderRequestUsage) => void;
  onDiagnostics?: (diagnostics: ProviderRequestDiagnostics) => void;
  /** Cumulative response text; provisional until final schema/source checks. */
  onResponseText?: (text: string) => void;
  maxAttempts?: 1 | 2;
  /** Up to three quiet resends, with growing pauses, when nothing was produced: a connection that never
   * opened, or a busy provider (429, 503). Without it, only one resend after a connection that never opened. */
  resendUnsent?: boolean;
  /** Calibrated writing only: multiplier for the local input estimate when checking the input budget. Not part of the cache identity. */
  inputBudgetScale?: number;
  coveragePlan?: { method: "full_direct" | "full_batched" | "sampled"; sourceCharacters: number; materialBlocks: number; plannedBatches: number };
}

/** Receipt for this request, including responses rejected by local validation. */
export interface ProviderRequestUsage { inputTokens: number; outputTokens: number; modelId?: string; requestId?: string; costCny?: number; pendingCostCny?: number; cacheHit?: boolean;
  /** Input tokens the provider read from its own prompt cache; included in inputTokens. */
  cachedInputTokens?: number }

export interface AvailableAIModel { id: string; name: string }
export interface ProviderCapabilities { textGeneration: boolean; structuredOutput: "native" | "json" | "prompt-only"; embeddings: boolean; maxContextTokens?: number; streaming?: boolean; conversationStructure?: boolean; requestUsage?: boolean; maxConcurrency?: number }
/** Long fixed instructions (the extraction and writing rules, sent unchanged with every request of a run) are marked
 * for DashScope's explicit context cache: a hit reads them at a fraction of the input price and starts faster. Short
 * ones stay plain, below the cache's minimum they would only cost the cache write. */
const CACHEABLE_SYSTEM = 3000;
export function cacheableMessages(messages: Array<{ role: "system" | "user"; content: string }>, baseUrl: string): Array<{ role: "system" | "user"; content: string | Array<{ type: "text"; text: string; cache_control?: { type: "ephemeral" } }> }> {
  if (!isDashScopeEndpoint(baseUrl)) return messages;
  return messages.map(message => message.role === "system" && message.content.length >= CACHEABLE_SYSTEM ? { role: message.role, content: [{ type: "text", text: message.content, cache_control: { type: "ephemeral" } }] } : message);
}

export interface ProviderUsageSnapshot { requests: number; inputTokens: number; outputTokens: number; reportedRequests: number; cachedInputTokens?: number; cacheHits?: number; cacheMisses?: number; retries?: number; costCny?: number; pendingCostCny?: number; lastModelId?: string; lastRequestId?: string }

export interface AtlasAIProvider {
  readonly supportsCacheMissGuard?:boolean;
  readonly id?: string;
  readonly modelId?: string;
  readonly capabilities?: ProviderCapabilities;
  getUsageSnapshot?(): ProviderUsageSnapshot;
  getAnalysisKey?(): Promise<string>;
  testConnection(): Promise<{ ok: true; model: string }>;
  generateStructured<T>(request: StructuredAIRequest<T>): Promise<T>;
  extract?<T>(request: StructuredAIRequest<T>): Promise<T>;
  decide?<T>(request: StructuredAIRequest<T>): Promise<T>;
  synthesize?<T>(request: StructuredAIRequest<T>): Promise<T>;
}

type AIProviderId = AISettings["provider"];
type ProviderProtocol = "openai" | "anthropic" | "gemini";

export interface AIProviderPreset {
  id: AIProviderId;
  label: string;
  labelEn?: string;
  baseUrl: string;
  protocol: ProviderProtocol;
}

export const AI_PROVIDER_PRESETS: AIProviderPreset[] = [
  { id: "openai", label: "OpenAI", baseUrl: "https://api.openai.com/v1", protocol: "openai" },
  { id: "anthropic", label: "Anthropic", baseUrl: "https://api.anthropic.com/v1", protocol: "anthropic" },
  { id: "gemini", label: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta", protocol: "gemini" },
  { id: "deepseek", label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", protocol: "openai" },
  { id: "qwen", label: "通义千问 / 阿里云百炼", labelEn: "Alibaba Cloud Qwen / DashScope", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", protocol: "openai" },
  { id: "moonshot", label: "Kimi / 月之暗面", labelEn: "Moonshot Kimi", baseUrl: "https://api.moonshot.cn/v1", protocol: "openai" },
  { id: "zhipu", label: "智谱 GLM", labelEn: "Zhipu GLM", baseUrl: "https://open.bigmodel.cn/api/paas/v4", protocol: "openai" },
  { id: "minimax", label: "MiniMax", baseUrl: "https://api.minimaxi.com/v1", protocol: "openai" },
  { id: "siliconflow", label: "硅基流动 SiliconFlow", labelEn: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", protocol: "openai" },
  { id: "baidu", label: "百度智能云千帆", labelEn: "Baidu Qianfan", baseUrl: "https://qianfan.baidubce.com/v2", protocol: "openai" },
  { id: "volcengine", label: "火山引擎方舟 / 豆包", labelEn: "Volcengine Ark / Doubao", baseUrl: "https://ark.cn-beijing.volces.com/api/v3", protocol: "openai" },
  { id: "tencent", label: "腾讯云 TokenHub / 混元", labelEn: "Tencent TokenHub / Hunyuan", baseUrl: "https://tokenhub.tencentmaas.com/v1", protocol: "openai" },
  { id: "lingyi", label: "零一万物 Yi", labelEn: "01.AI Yi", baseUrl: "https://api.lingyiwanwu.com/v1", protocol: "openai" },
  { id: "stepfun", label: "阶跃星辰 StepFun", labelEn: "StepFun", baseUrl: "https://api.stepfun.com/v1", protocol: "openai" },
  { id: "openrouter", label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", protocol: "openai" },
  { id: "openai-compatible", label: "OpenAI Compatible", baseUrl: "", protocol: "openai" },
];

/** An embedding model each provider documents for its OpenAI-compatible /embeddings endpoint, offered as a
 * one-click choice; providers without a known one leave the field for the user to fill. */
const RECOMMENDED_EMBEDDING: Partial<Record<AIProviderId, string>> = { openai: "text-embedding-3-small", qwen: "text-embedding-v4", siliconflow: "BAAI/bge-m3", zhipu: "embedding-3" };
export const recommendedEmbeddingModel = (provider: AIProviderId) => RECOMMENDED_EMBEDDING[provider];
/** Listed models that are embedding models, by their usual names. */
export const embeddingModelsOf = (models: AvailableAIModel[]) => models.filter(model => /embed|bge|e5-|m3e/iu.test(model.id));

const cachedTokens = (value?: number) => Number.isFinite(value) && value! >= 0 ? value : undefined;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`;
}

function presetFor(provider: AIProviderId): AIProviderPreset {
  return AI_PROVIDER_PRESETS.find((preset) => preset.id === provider) ?? AI_PROVIDER_PRESETS.at(-1)!;
}

function isDashScopeEndpoint(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    return url.protocol === "https:" && (url.hostname === "dashscope.aliyuncs.com" || url.hostname === "dashscope-intl.aliyuncs.com" || url.hostname === "cn-hongkong.dashscope.aliyuncs.com" || url.hostname.endsWith(".maas.aliyuncs.com")) && /^\/compatible-mode\/v1\/?$/u.test(url.pathname);
  } catch { return false; }
}

/** Discovery must use the same region/workspace as generation, including custom endpoints. */
export function providerModelsUrl(settings: Pick<AISettings, "provider" | "baseUrl">): string {
  return isDashScopeEndpoint(settings.baseUrl) ? `${new URL(settings.baseUrl).origin}/api/v1/models` : endpoint(settings.baseUrl, "models");
}

/** Normalize native resource prefixes and the known legacy ID; compatible proxy IDs are opaque. */
export function canonicalModelId(settings: Pick<AISettings, "baseUrl" | "model"> & Partial<Pick<AISettings, "provider">>): string {
  const model = settings.model.trim();
  if (settings.provider === "gemini") return model.replace(/^models\//u, "");
  return isDashScopeEndpoint(settings.baseUrl) && /^qwen3\.8-flash$/iu.test(model) ? "qwen3.8-flash" : model;
}

export function discoveredModelId(model: string, available: AvailableAIModel[], settings: Pick<AISettings, "baseUrl"> & Partial<Pick<AISettings, "provider">>): string {
  const canonical = canonicalModelId({ ...settings, model });
  const exact = available.find((item) => item.id === model || item.id === canonical);
  const names = available.filter((item) => item.name === model);
  return exact?.id ?? (names.length === 1 ? names[0].id : model);
}

function authHeaders(settings: AISettings, protocol = presetFor(settings.provider).protocol): HeadersInit {
  if (protocol === "anthropic") return { "Content-Type": "application/json", "x-api-key": settings.apiKey, "anthropic-version": "2023-06-01" };
  if (protocol === "gemini") return { "Content-Type": "application/json", "x-goog-api-key": settings.apiKey };
  return { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey}` };
}

function parseJsonText(content: string): unknown {
  return parseStructuredJson(content);
}

function structuredContent<T>(request: StructuredAIRequest<T>, content: string): T {
  if (request.taskType !== "focus_session") return validateProviderOutput(request, parseJsonText(content));
  let parsed: unknown;
  try {
    parsed = parseJsonText(content);
    if(request.repairFields?.length&&request.repairContent) parsed=applyFocusLanguageRepair(parseJsonText(request.repairContent),request.repairFields,parsed);
    return validateProviderOutput(request, parsed);
  }
  catch (cause) {
    const error = cause instanceof AIProviderValidationError ? cause : new AIProviderValidationError("invalid_json");
    if (error.code === "PROVIDER_SCHEMA_missing_section_text" && parsed && typeof parsed === "object" && "sections" in parsed && Array.isArray(parsed.sections)) {
      error.fieldPaths = parsed.sections.flatMap((section, index) => ["title", "body"].filter(field => !section || typeof section[field] !== "string" || !section[field].trim()).map(field => `sections[${index}].${field}`));
    }
    // Never repair invented citations or absent support by guessing evidence.
    if(error.code==="PROVIDER_SCHEMA_wrong_output_language"&&!request.repairContent){
      const fields=focusLanguageRepairFields(parsed,taskData(request.prompt)??{});
      if(fields.length){error.repairContent=content;error.repairFields=fields;}
    } else if (content.length <= 16000 && /_(?:invalid_json|invalid_section_type|wiki_owner_missing_or_unknown|wiki_owner_evidence_mismatch)$/u.test(error.code)) error.repairContent = content;
    throw error;
  }
}

function normalizeModels(payload: unknown, protocol: ProviderProtocol): AvailableAIModel[] {
  if (!payload || typeof payload !== "object") return [];
  const record = payload as Record<string, unknown>;
  const output = record.output && typeof record.output === "object" ? record.output as Record<string, unknown> : undefined;
  const values = [record.data, record.models, output?.models, output?.data].find(Array.isArray) as Array<Record<string, unknown>> | undefined;
  if (!values) return [];
  const seen = new Set<string>();
  return values.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    if (typeof item.status === "string" && !["online", "active", "available", "ready"].includes(item.status.toLowerCase())) return [];
    const rawId = typeof item.model === "string" ? item.model : typeof item.id === "string" ? item.id : typeof item.name === "string" ? item.name : "";
    const id = protocol === "gemini" ? rawId.replace(/^models\//u, "") : rawId;
    if (!id || seen.has(id)) return [];
    if (Array.isArray(item.supportedGenerationMethods) && !(item.supportedGenerationMethods as unknown[]).includes("generateContent")) return [];
    seen.add(id);
    const name = typeof item.display_name === "string" ? item.display_name : typeof item.displayName === "string" ? item.displayName : typeof item.name === "string" && protocol !== "gemini" ? item.name : id;
    return [{ id, name }];
  });
}

export async function listAvailableModels(settings: AISettings, signal?: AbortSignal): Promise<AvailableAIModel[]> {
  const preset = presetFor(settings.provider);
  const url = providerModelsUrl(settings);
  const paginated = isDashScopeEndpoint(settings.baseUrl);
  const models = new Map<string, AvailableAIModel>();
  const visited = new Set<string>();
  let cursor: string | undefined;
  let received = 0;
  for (let page = 1; page <= 50; page++) {
    const requestUrl = new URL(url);
    if (paginated) { requestUrl.searchParams.set("page_no", String(page)); requestUrl.searchParams.set("page_size", "100"); requestUrl.searchParams.set("capabilities", "TG"); }
    else if (cursor) requestUrl.searchParams.set(preset.protocol === "gemini" ? "pageToken" : "after_id", cursor);
    if (visited.has(requestUrl.toString())) throw new Error("模型列表分页重复，请检查 API 地址或手动填写模型 ID。");
    visited.add(requestUrl.toString());
    const payload = await providerResponse(requestUrl.toString(), { headers: authHeaders(settings, preset.protocol), signal }, (response) => response.json()) as { nextPageToken?: string; has_more?: boolean; last_id?: string; output?: { total?: number; models?: unknown[] } };
    const available = normalizeModels(payload, preset.protocol);
    available.forEach((item) => models.set(item.id, item));
    if (paginated) {
      received += payload?.output?.models?.length ?? 0;
      if (!Number.isFinite(payload?.output?.total) || received >= payload.output!.total!) return [...models.values()];
      if (!payload.output?.models?.length) throw new Error("模型列表分页未完整返回，请检查 API 地址或手动填写模型 ID。");
    } else {
      cursor = preset.protocol === "gemini" && typeof payload?.nextPageToken === "string" ? payload.nextPageToken : preset.protocol === "anthropic" && payload?.has_more && typeof payload.last_id === "string" ? payload.last_id : undefined;
      if (!cursor) {
        if (preset.protocol === "anthropic" && payload?.has_more) throw new Error("模型列表缺少分页游标，请检查 API 地址或手动填写模型 ID。");
        return [...models.values()];
      }
    }
    if (page === 50) throw new Error("模型列表超过分页上限，请手动填写模型 ID。");
  }
  return [...models.values()];
}

export class OpenAICompatibleProvider implements AtlasAIProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities = { textGeneration: true, structuredOutput: "prompt-only", embeddings: false, conversationStructure: true, requestUsage: true };
  private readonly usage: ProviderUsageSnapshot = { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
  constructor(private readonly settings: AISettings) {
    this.settings = { ...settings, model: canonicalModelId(settings) }; this.id = settings.provider; this.modelId = this.settings.model;
    Object.assign(this.capabilities, { streaming: settings.streaming !== false, maxConcurrency: providerConcurrencyCeiling(settings.baseUrl) });
    if (generationProfile(settings.baseUrl, this.modelId).jsonMode) this.capabilities.structuredOutput = "json";
  }
  getUsageSnapshot(): ProviderUsageSnapshot { return { ...this.usage }; }

  private async complete(messages: Array<{ role: "system" | "user"; content: string }>, signal?: AbortSignal, outputTokens = 32, temperature?: number, onUsage?: StructuredAIRequest<unknown>["onUsage"], onDiagnostics?: StructuredAIRequest<unknown>["onDiagnostics"], structured = false, priority = 1, onResponseText?: (text: string) => void): Promise<string> {
    this.usage.requests += 1;
    const streaming = Boolean(this.capabilities.streaming);
    const host = new URL(this.settings.baseUrl).hostname;
    const profile = generationProfile(this.settings.baseUrl, this.modelId);
    const usageOptions = isDashScopeEndpoint(this.settings.baseUrl) || ["api.openai.com", "api.deepseek.com"].includes(host);
    type Payload = { id?: string; model?: string; reasoningCharacters?: number; choices?: Array<{ index?: number; delta?: { content?: string; reasoning_content?: string }; message?: { content?: string | Array<{ type?: string; text?: string }>; reasoning_content?: string }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number }; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number; cached_tokens?: number }; error?: unknown };
    let recordedUsage = false;
    const recordUsage = (payload: Payload) => {
      if (!recordedUsage && payload.usage && Number.isFinite(payload.usage.prompt_tokens) && payload.usage.prompt_tokens! >= 0 && Number.isFinite(payload.usage.completion_tokens) && payload.usage.completion_tokens! >= 0) {
        recordedUsage = true;
        // OpenAI/DashScope, DeepSeek and Moonshot report automatic prefix-cache reads differently.
        const cachedInputTokens = cachedTokens(payload.usage.prompt_tokens_details?.cached_tokens ?? payload.usage.prompt_cache_hit_tokens ?? payload.usage.cached_tokens);
        this.usage.inputTokens += payload.usage.prompt_tokens!;
        this.usage.outputTokens += payload.usage.completion_tokens!;
        this.usage.reportedRequests += 1;
        if (cachedInputTokens !== undefined) this.usage.cachedInputTokens = (this.usage.cachedInputTokens ?? 0) + cachedInputTokens;
        const costCny=modelUsageCostCny(this.id,payload.model??this.modelId,payload.usage.prompt_tokens!,payload.usage.completion_tokens!,cachedInputTokens);
        if(costCny!==undefined)this.usage.costCny=(this.usage.costCny??0)+costCny;
        onUsage?.({ inputTokens: payload.usage.prompt_tokens!, outputTokens: payload.usage.completion_tokens!, modelId: payload.model ?? this.modelId, requestId: payload.id, ...(costCny===undefined?{}:{costCny}), ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }) });
      }
    };
    // Atlas keeps stable instructions ahead of per-batch text, so compatible
    // providers' automatic prefix caches already apply. OpenAI additionally
    // routes requests sharing a key to the same cache.
    const prefix = officialHost(this.settings.baseUrl, "api.openai.com") ? cacheablePrefix(messages[0]?.role === "system" ? messages[0].content : "") : undefined;
    const payload = await providerResponse(endpoint(this.settings.baseUrl, "chat/completions"), {
      method: "POST",
      signal,
      headers: authHeaders(this.settings, "openai"),
      body: JSON.stringify({ model: this.settings.model, messages: cacheableMessages(messages, this.settings.baseUrl), [profile.tokenParameter]: outputTokens, ...(temperature === undefined || profile.omitTemperature ? {} : { temperature }), stream: streaming, ...(streaming && usageOptions ? { stream_options: { include_usage: true } } : {}), ...profile.parameters, ...(structured && profile.jsonMode ? { response_format: { type: "json_object" } } : {}), ...(prefix ? { prompt_cache_key: promptCacheKey(prefix) } : {}) }),
    }, async (response, context): Promise<Payload> => {
      context.diagnostics.outputTokenLimit = outputTokens;
      if (!response.headers.get("content-type")?.includes("text/event-stream")) {
        const value = await response.json() as Payload;
        context.diagnostics.requestId = value.id ?? context.diagnostics.requestId;
        context.diagnostics.finishReason = value.choices?.[0]?.finish_reason;
        const raw = value.choices?.[0]?.message;
        context.diagnostics.receivedCharacters = typeof raw?.content === "string" ? raw.content.length : 0;
        context.diagnostics.reasoningCharacters = raw?.reasoning_content?.length ?? 0;
        context.diagnostics.reasoningTokens = value.usage?.completion_tokens_details?.reasoning_tokens;
        return value;
      }
      let content = "";
      let finish: string | undefined;
      let id: string | undefined;
      let model: string | undefined;
      let latestUsage: Payload | undefined;
      let finalUsage = false;
      const preserveReceipt = () => { if (latestUsage && (finish || finalUsage)) recordUsage(latestUsage); };
      context.signal.addEventListener("abort", preserveReceipt, { once: true });
      try { await readSse(response, context.signal, (data) => {
        let chunk: Payload;
        try { chunk = JSON.parse(data) as Payload; } catch { throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", id); }
        if (chunk.error) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", id);
        id = chunk.id ?? id; model = chunk.model ?? model;
        context.diagnostics.requestId = id ?? context.diagnostics.requestId;
        if (chunk.usage) { latestUsage = { ...chunk, id, model }; context.diagnostics.reasoningTokens = chunk.usage.completion_tokens_details?.reasoning_tokens; if (!chunk.choices?.length) finalUsage = true; }
        const choice = chunk.choices?.find((item) => item.index === undefined || item.index === 0);
        const text = choice?.delta?.content;
        if (typeof text === "string") { content += text; context.activity(text.length); onResponseText?.(content); }
        const reasoning = choice?.delta?.reasoning_content;
        if (typeof reasoning === "string" && reasoning.length) context.activity(0, reasoning.length);
        if (content.length > 1_000_000) throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", id);
        if (choice?.finish_reason) { finish = choice.finish_reason; context.diagnostics.finishReason = finish; }
      }); } finally { context.signal.removeEventListener("abort", preserveReceipt); preserveReceipt(); }
      if (!finish) throw new AIProviderResponseError("PROVIDER_STREAM_INCOMPLETE", id);
      return { id, model, reasoningCharacters: context.diagnostics.reasoningCharacters, usage: latestUsage?.usage, choices: [{ message: { content }, finish_reason: finish }] };
    }, { streaming, onDiagnostics, priority });
    recordUsage(payload);
    const rawContent = payload.choices?.[0]?.message?.content;
    const content = typeof rawContent === "string" ? rawContent : Array.isArray(rawContent) ? rawContent.filter((part) => part.type === "text" && typeof part.text === "string").map((part) => part.text).join("") : "";
    if (payload.choices?.[0]?.finish_reason === "length") {
      const tokens = payload.usage?.completion_tokens_details?.reasoning_tokens;
      throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", payload.id, { outputTokenLimit: outputTokens, receivedCharacters: content.trim().length, reasoningCharacters: payload.reasoningCharacters ?? payload.choices?.[0]?.message?.reasoning_content?.length ?? 0, ...(Number.isFinite(tokens) && tokens! >= 0 ? { reasoningTokens: tokens } : {}) });
    }
    if (payload.choices?.[0]?.finish_reason && payload.choices[0].finish_reason !== "stop") throw new AIProviderResponseError("PROVIDER_RESPONSE_REJECTED", payload.id);
    if (!content) throw new AIProviderResponseError("PROVIDER_EMPTY_RESPONSE", payload.id);
    return content;
  }

  async testConnection(): Promise<{ ok: true; model: string }> {
    await this.complete([{ role: "user", content: "Reply with OK." }], undefined, 32 + generationProfile(this.settings.baseUrl, this.modelId).reasoningReserve);
    return { ok: true, model: this.settings.model };
  }

  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const content = await this.complete(requestMessages(request), request.signal, request.maxOutputTokens ?? requestBudget(request, this.modelId, this.settings.baseUrl).maxOutputTokens, request.temperature, request.onUsage, request.onDiagnostics, true, request.priority, request.onResponseText);
    request.onResponseText?.(content);
    return structuredContent(request, content);
  }
}

class AnthropicProvider implements AtlasAIProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities = { textGeneration: true, structuredOutput: "prompt-only", embeddings: false, conversationStructure: true, requestUsage: true };
  private readonly usage: ProviderUsageSnapshot = { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
  constructor(private readonly settings: AISettings) { this.id = settings.provider; this.modelId = settings.model; Object.assign(this.capabilities, { streaming: settings.streaming !== false, maxConcurrency: providerConcurrencyCeiling(settings.baseUrl) }); }
  getUsageSnapshot(): ProviderUsageSnapshot { return { ...this.usage }; }

  private async complete(system: string, prompt: string, signal?: AbortSignal, outputTokens = 32, onUsage?: StructuredAIRequest<unknown>["onUsage"], onDiagnostics?: StructuredAIRequest<unknown>["onDiagnostics"], priority = 1, onResponseText?: (text: string) => void): Promise<string> {
    this.usage.requests += 1;
    let recorded = false;
    const record = (payload: ClaudePayload) => {
      if (recorded || !payload.usage || !Number.isFinite(payload.usage.input_tokens) || payload.usage.input_tokens! < 0 || !Number.isFinite(payload.usage.output_tokens) || payload.usage.output_tokens! < 0) return;
      recorded = true;
      const cacheTokens = (value?: number) => Number.isFinite(value) ? Math.max(0, value!) : 0;
      const inputTokens = payload.usage.input_tokens! + cacheTokens(payload.usage.cache_creation_input_tokens) + cacheTokens(payload.usage.cache_read_input_tokens);
      const cachedInputTokens = cachedTokens(payload.usage.cache_read_input_tokens);
      this.usage.inputTokens += inputTokens; this.usage.outputTokens += payload.usage.output_tokens!; this.usage.reportedRequests += 1;
      if (cachedInputTokens !== undefined) this.usage.cachedInputTokens = (this.usage.cachedInputTokens ?? 0) + cachedInputTokens;
      onUsage?.({ inputTokens, outputTokens: payload.usage.output_tokens!, modelId: payload.model ?? this.modelId, requestId: payload.id, ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }) });
    };
    const streaming = this.settings.streaming !== false;
    // Claude caches only explicitly marked prefixes. Split the identical text
    // into blocks; the model reads the same system prompt either way. Only the
    // first-party API is marked, and only for a prefix already sent recently,
    // so a one-off request never pays for an unused cache write.
    const prefix = officialHost(this.settings.baseUrl, "api.anthropic.com") ? cacheablePrefix(system) : undefined;
    const cached = prefix !== undefined && prefixSeenRecently(prefix);
    const { suffix } = splitCacheablePrefix(system);
    const systemBlocks = cached ? [{ type: "text", text: prefix, cache_control: { type: "ephemeral" } }, ...(suffix ? [{ type: "text", text: suffix }] : [])] : system;
    const payload = await providerResponse(endpoint(this.settings.baseUrl, "messages"), {
      method: "POST",
      signal,
      headers: authHeaders(this.settings, "anthropic"),
      body: JSON.stringify({ model: this.settings.model, max_tokens: outputTokens, system: systemBlocks, messages: [{ role: "user", content: prompt }], stream: streaming, ...generationProfile(this.settings.baseUrl, this.modelId).parameters }),
    }, (response, context) => { context.diagnostics.outputTokenLimit = outputTokens; return readClaudeResponse(response, context, record, onResponseText); }, { streaming, onDiagnostics, priority });
    record(payload);
    const content = payload.content?.filter((part) => part.type === "text").map((part) => part.text ?? "").join("") ?? "";
    if (payload.stop_reason === "max_tokens") throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", payload.id, { outputTokenLimit: outputTokens, receivedCharacters: content.trim().length, reasoningCharacters: payload.reasoningCharacters ?? payload.content?.filter(part => part.type === "thinking").reduce((n, part) => n + (part.thinking?.length ?? 0), 0) });
    if (payload.stop_reason && !["end_turn", "stop_sequence"].includes(payload.stop_reason)) throw new AIProviderResponseError("PROVIDER_RESPONSE_REJECTED", payload.id);
    if (!content) throw new AIProviderResponseError("PROVIDER_EMPTY_RESPONSE");
    return content;
  }

  async testConnection(): Promise<{ ok: true; model: string }> {
    await this.complete("Reply briefly.", "Reply with OK.", undefined, 32 + generationProfile(this.settings.baseUrl, this.modelId).reasoningReserve);
    return { ok: true, model: this.settings.model };
  }

  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const messages = requestMessages(request);
    const content = await this.complete(messages[0].content, messages[1].content, request.signal, request.maxOutputTokens ?? requestBudget(request, this.modelId, this.settings.baseUrl).maxOutputTokens, request.onUsage, request.onDiagnostics, request.priority, request.onResponseText);
    request.onResponseText?.(content);
    return structuredContent(request, content);
  }
}

class GeminiProvider implements AtlasAIProvider {
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities = { textGeneration: true, structuredOutput: "json", embeddings: false, conversationStructure: true, requestUsage: true };
  private readonly usage: ProviderUsageSnapshot = { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
  constructor(private readonly settings: AISettings) { this.settings = { ...settings, model: canonicalModelId(settings) }; this.id = settings.provider; this.modelId = this.settings.model; Object.assign(this.capabilities, { streaming: settings.streaming !== false, maxConcurrency: providerConcurrencyCeiling(settings.baseUrl) }); }
  getUsageSnapshot(): ProviderUsageSnapshot { return { ...this.usage }; }

  private async complete(system: string, prompt: string, json = false, signal?: AbortSignal, outputTokens = 32, onUsage?: StructuredAIRequest<unknown>["onUsage"], onDiagnostics?: StructuredAIRequest<unknown>["onDiagnostics"], priority = 1, onResponseText?: (text: string) => void): Promise<string> {
    this.usage.requests += 1;
    const streaming = this.settings.streaming !== false;
    let recorded = false;
    const record = (payload: GeminiPayload) => {
      if (recorded || !payload.usageMetadata || !Number.isFinite(payload.usageMetadata.promptTokenCount) || payload.usageMetadata.promptTokenCount! < 0 || !Number.isFinite(payload.usageMetadata.candidatesTokenCount) || payload.usageMetadata.candidatesTokenCount! < 0) return;
      recorded = true;
      const output = payload.usageMetadata.candidatesTokenCount! + (Number.isFinite(payload.usageMetadata.thoughtsTokenCount) ? Math.max(0, payload.usageMetadata.thoughtsTokenCount!) : 0);
      // Gemini's implicit cache needs no request change; it reports reused prefix tokens.
      const cachedInputTokens = cachedTokens(payload.usageMetadata.cachedContentTokenCount);
      this.usage.inputTokens += payload.usageMetadata.promptTokenCount!; this.usage.outputTokens += output; this.usage.reportedRequests += 1;
      if (cachedInputTokens !== undefined) this.usage.cachedInputTokens = (this.usage.cachedInputTokens ?? 0) + cachedInputTokens;
      onUsage?.({ inputTokens: payload.usageMetadata.promptTokenCount!, outputTokens: output, modelId: payload.modelVersion ?? this.modelId, requestId: payload.responseId, ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }) });
    };
    const payload = await providerResponse(endpoint(this.settings.baseUrl, `models/${encodeURIComponent(this.settings.model)}:${streaming ? "streamGenerateContent?alt=sse" : "generateContent"}`), {
      method: "POST",
      signal,
      headers: authHeaders(this.settings, "gemini"),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { maxOutputTokens: outputTokens, ...(json ? { responseMimeType: "application/json" } : {}), ...generationProfile(this.settings.baseUrl, this.modelId).parameters },
      }),
    }, (response, context) => { context.diagnostics.outputTokenLimit = outputTokens; return readGeminiResponse(response, context, record, onResponseText); }, { streaming, onDiagnostics, priority });
    record(payload);
    const content = payload.candidates?.[0]?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("") ?? "";
    if (payload.candidates?.[0]?.finishReason === "MAX_TOKENS") throw new AIProviderResponseError("PROVIDER_OUTPUT_TRUNCATED", payload.responseId, { outputTokenLimit: outputTokens, receivedCharacters: content.trim().length, reasoningCharacters: payload.reasoningCharacters, reasoningTokens: payload.usageMetadata?.thoughtsTokenCount });
    if (payload.candidates?.[0]?.finishReason && payload.candidates[0].finishReason !== "STOP") throw new AIProviderResponseError("PROVIDER_RESPONSE_REJECTED", payload.responseId);
    if (!content) throw new AIProviderResponseError("PROVIDER_EMPTY_RESPONSE");
    return content;
  }

  async testConnection(): Promise<{ ok: true; model: string }> {
    await this.complete("Reply briefly.", "Reply with OK.", false, undefined, 32 + generationProfile(this.settings.baseUrl, this.modelId).reasoningReserve);
    return { ok: true, model: this.settings.model };
  }

  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const messages = requestMessages(request);
    const content = await this.complete(messages[0].content, messages[1].content, true, request.signal, request.maxOutputTokens ?? requestBudget(request, this.modelId, this.settings.baseUrl).maxOutputTokens, request.onUsage, request.onDiagnostics, request.priority, request.onResponseText);
    request.onResponseText?.(content);
    return structuredContent(request, content);
  }
}

export function createAIProvider(settings: AISettings): AtlasAIProvider {
  const protocol = presetFor(settings.provider).protocol;
  if (protocol === "anthropic") return new AnthropicProvider(settings);
  if (protocol === "gemini") return new GeminiProvider(settings);
  return new OpenAICompatibleProvider(settings);
}

export async function requestProviderPermission(baseUrl: string, modelsUrl?: string): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions?.request) return true;
  const origins = [...new Set([baseUrl, modelsUrl].filter((value): value is string => Boolean(value)).map((value) => { const url = new URL(value); return `${url.protocol}//${url.host}/*`; }))];
  return chrome.permissions.request({ origins });
}

export async function hasProviderPermission(baseUrl: string): Promise<boolean> {
  if (typeof chrome === "undefined" || !chrome.permissions?.contains) return true;
  const url = new URL(baseUrl);
  return chrome.permissions.contains({ origins: [`${url.protocol}//${url.host}/*`] });
}
