import type { AtlasAIProvider, ProviderUsageSnapshot, StructuredAIRequest } from "./provider";
import type { EmbeddingProvider } from "./embedding-provider";
import { recordAIUsage } from "../storage/ai-usage";
import { estimateTokens } from "../shared/atlas/policy.js";
import { focusOutputIssue } from "../shared/atlas/tasks.js";
import { AIProviderValidationError } from "./provider-errors";

type DemoSession = { token: string; expiresAt: string; taskVersion?: string; policyVersion?: string; features?: { asyncTasks?: boolean; conversationStructure?: boolean; compactOrganization?: boolean; outputLocale?: boolean; contentTokenEstimates?: boolean; projectKnowledge?: boolean; projectQuery?: boolean; projectQueryAgent?: boolean }; models?: { main: string; economy: string }; embedding: { modelKey: string; dimensions: number }; baseUrl?: string };
export type DemoReceipt = { inputTokens: number; outputTokens: number; embeddingTokens?: number; costCny?: number; pendingCostCny?: number; modelId?: string; cacheHit?: boolean; unknownAttempts?: number };
type DemoUsage = { available: boolean; reason: "DEMO_QUOTA_EXHAUSTED" | "DEMO_BUDGET_EXHAUSTED" | null; remaining: { requests: number; analyze: number; compose: number } };

const STORAGE_KEY = "atlas-demo-session-v1";
export const CURRENT_FOCUS_TASK_VERSION = 13;
const PENDING_TASKS_KEY = "atlas-demo-pending-tasks-v1";
type PendingTask = { key: string; requestId: string; token: string; expiresAt: string };

function readPendingTasks(): PendingTask[] {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(PENDING_TASKS_KEY) || "[]");
    return Array.isArray(saved) ? saved.filter((item): item is PendingTask => Boolean(item && typeof item.key === "string" && /^[a-f0-9]{64}$/.test(item.requestId) && typeof item.token === "string" && Date.parse(item.expiresAt) > Date.now())) : [];
  } catch { return []; }
}
const SESSION_TIMEOUT_MS = 45000;
const REQUEST_TIMEOUT_MS = 90000;
const TASK_ROUTE: Record<string, "analyze" | "compose"> = {
  project_query_plan: "compose",
  focus_session: "compose",
  conversation_structure: "analyze", question_snapshot: "analyze", conversation_profile: "analyze", chapter_planning: "analyze", composition_judge: "analyze",
  source_retrieval: "compose", knowledge_planning: "compose", global_merge: "compose", insight_judge: "compose", relation_judge: "compose",
};

export class DemoApiError extends Error {
  constructor(readonly code: string, readonly status: number, readonly usage?: DemoReceipt, readonly requestId?: string, readonly details?: { dimension?: string; required?: number; limit?: number; pendingCny?: number }) {
    super(code === "DEMO_QUOTA_EXHAUSTED" ? "体验额度已用完。连接自己的 AI 后可以继续整理。"
      : code === "DEMO_BUDGET_EXHAUSTED" ? "ChatAtlas AI 共享额度不足以处理本次请求。可减少对话来源、稍后重试或连接自己的 AI。"
      : code === "DEMO_UNAVAILABLE" ? "ChatAtlas AI 服务暂时不可用。你仍可使用已有内容，或连接自己的 AI。"
      : code === "DEMO_NOT_CONFIGURED" ? "当前版本未配置 ChatAtlas AI 服务地址，请更新或重新构建扩展。"
      : code === "DEMO_SERVICE_NOT_DEPLOYED" ? "当前 ChatAtlas AI 服务地址没有提供所需接口。请部署匹配的 ChatAtlas 后端，或在 AI 设置中使用自己的 API。"
      : code === "DEMO_CONNECTION_FAILED" ? "无法连接 ChatAtlas AI 服务，请检查网络、扩展权限或服务地址。"
      : code === "DEMO_SESSION_TIMEOUT" ? "建立 ChatAtlas AI 会话超时：45 秒内未收到完整响应。请检查代理是否能访问 ChatAtlas 服务，或在 AI 设置中测试连接。"
      : code === "DEMO_SERVICE_OUTDATED" ? "ChatAtlas AI 后端版本过旧，不支持当前任务。请部署与扩展匹配的后端，或连接自己的 AI。"
      : code === "DEMO_REQUEST_TIMEOUT" ? "ChatAtlas AI 请求超时，请稍后重试。"
      : code === "DEMO_INVALID_RESPONSE" ? "ChatAtlas AI 服务返回了无效数据，请稍后重试。"
      : code === "DEMO_HTTP_ERROR" ? "ChatAtlas AI 服务请求失败，请稍后重试。"
      : code === "ORIGIN_NOT_ALLOWED" ? "当前扩展未获 ChatAtlas AI 服务授权，请检查服务端来源设置。"
      : code === "PROVIDER_TIMEOUT" ? "ChatAtlas AI 模型响应超时，请稍后重试。"
      : code === "PROVIDER_BUSY" ? "ChatAtlas AI 模型繁忙，请稍后重试。"
      : code === "PROVIDER_ERROR" ? "模型服务请求失败。已完成的批次会保留，重试时优先复用；请检查服务端上游错误日志。"
      : code === "PROVIDER_AUTH_ERROR" ? "模型服务认证失败，请检查后端的模型密钥和访问权限。"
      : code === "PROVIDER_REQUEST_REJECTED" ? "模型服务拒绝了请求，请检查后端的模型名称、参数或地域配置。"
      : code === "DEMO_DATABASE_BUSY" ? "任务记录暂时繁忙。已完成的批次会保留，请稍后继续。"
      : code === "DEMO_DATABASE_ERROR" ? "任务记录读写失败，请检查后端数据库日志；已有结果会优先复用。"
      : code === "IDEMPOTENCY_CONFLICT" ? "请求记录与当前内容冲突，请重新打开本次目标后继续。"
      : code === "TASK_NOT_FOUND" ? "暂时找不到原任务记录，请检查服务端部署与数据库；未自动发起新的生成。"
      : code === "TASK_RESULT_EXPIRED" ? "原任务结果已过期，需要重新生成。"
      : code === "RATE_LIMITED" ? "请求太频繁，请稍后重试。"
      : code === "REQUEST_IN_PROGRESS" ? "ChatAtlas AI 正在处理上一次请求，请稍后重试。"
      : code === "PROVIDER_INVALID_RESPONSE" ? "ChatAtlas AI 返回的内容格式不完整，请重试。"
      : code === "PROVIDER_STREAM_INCOMPLETE" ? "ChatAtlas AI 响应连接中断，结果尚未完成；用量可能已产生，请稍后重试。"
      : code === "PROVIDER_RESPONSE_REJECTED" ? "ChatAtlas AI 未完成文本回答，请调整请求后重试。"
      : code === "PROVIDER_EMPTY_RESPONSE" ? "ChatAtlas AI 未返回可用文本，请检查后端所选模型和接口。"
      : code === "PROVIDER_OUTPUT_TRUNCATED" ? "ChatAtlas AI 的生成内容超出输出上限。请缩小本次目标或减少来源后重试。"
      : code === "PROVIDER_REASONING_LIMIT" ? "模型思考耗尽输出额度，尚未生成正文。已完成的分析会保留，请检查服务端模型的思考配置。"
      : code === "PAYLOAD_TOO_LARGE" ? "这次分析的内容过长。请减少来源或选择更简洁的分析模式。"
      : code === "INVALID_REQUEST" ? "这次分析请求与服务端格式不匹配，请更新 ChatAtlas 后重试。"
      : code === "UNAUTHORIZED" ? "ChatAtlas AI 会话已失效，请重试以重新连接。"
      : code === "PROVIDER_USAGE_PENDING" ? "上一次请求的模型用量正在核实，已保留任务记录。请稍后查看，避免重复生成。"
      : "整理暂时失败，请重试。");
    if (details?.dimension) {
      const names: Record<string, string> = { input_tokens: "输入内容", output_tokens: "生成内容", requests: "请求次数", analyze: "分析次数", compose: "成果生成次数", embedding_tokens: "检索索引", daily_budget: "今日共享预算", monthly_budget: "本月共享预算", task_input: "本次内容长度" };
      this.message += `（${names[details.dimension] ?? details.dimension}达到限制${details.pendingCny ? "，其中包含待核实用量" : ""}）`;
    }
  }
}

function apiBaseUrl(): string {
  const url = import.meta.env.VITE_ATLAS_API_BASE_URL?.trim();
  if (!url) throw new DemoApiError("DEMO_NOT_CONFIGURED", 0);
  return url.replace(/\/+$/u, "");
}

function readSavedSession(): DemoSession | null {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null") as DemoSession | null;
    return value?.baseUrl === apiBaseUrl() && value.token && Date.parse(value.expiresAt) > Date.now() + 30000 && value.embedding?.modelKey ? value : null;
  } catch { return null; }
}

async function digest(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
  }
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return `${value.length.toString(16)}-${hash.toString(16)}`;
}

export class AtlasApiClient {
  private pendingSession: Promise<DemoSession> | null = null;
  private optimizationProtocolChecked = false;
  private session: DemoSession | null = readSavedSession();
  private readonly pendingTasks = new Map(readPendingTasks().map((item) => [item.key, item]));

  private saveTask(key: string, requestId: string, session: DemoSession) {
    const task = { key, requestId, token: session.token, expiresAt: session.expiresAt };
    this.pendingTasks.set(key, task);
    try { localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify([...readPendingTasks().filter((item) => item.key !== key), task].slice(-100))); } catch { /* In-memory resume remains available. */ }
  }

  private forgetTask(key?: string) {
    if (!key) return;
    this.pendingTasks.delete(key);
    try { localStorage.setItem(PENDING_TASKS_KEY, JSON.stringify(readPendingTasks().filter((item) => item.key !== key))); } catch { /* A saved completed handle is safe to query again. */ }
  }

  async createDemoSession(signal?: AbortSignal): Promise<DemoSession> {
    signal?.throwIfAborted();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), SESSION_TIMEOUT_MS);
    const cancel = () => controller.abort(signal?.reason);
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      const response = await fetch(`${apiBaseUrl()}/api/atlas/demo/session`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}", signal: controller.signal });
      if (!response.ok) throw await this.readError(response);
      const session = await response.json().catch(() => { throw new DemoApiError("DEMO_INVALID_RESPONSE", response.status); }) as DemoSession;
      if (!session?.token || !session.embedding?.modelKey || !(Date.parse(session.expiresAt) > Date.now() + 30000)) throw new DemoApiError("DEMO_INVALID_RESPONSE", response.status);
      session.baseUrl = apiBaseUrl();
      this.session = session;
      this.optimizationProtocolChecked = true;
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(session)); } catch { /* The in-memory session remains usable. */ }
      return session;
    } catch (cause) {
      if (cause instanceof DemoApiError) throw cause;
      if (signal?.aborted) throw signal.reason;
      throw new DemoApiError(controller.signal.aborted ? "DEMO_SESSION_TIMEOUT" : "DEMO_CONNECTION_FAILED", controller.signal.aborted ? 504 : 0);
    } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
  }

  async getSession(signal?: AbortSignal, requireCurrentProtocol = false, minimumTaskVersion = 0, requiredFeature?: "projectQuery" | "projectQueryAgent"): Promise<DemoSession> {
    signal?.throwIfAborted();
    if (this.session && Date.parse(this.session.expiresAt) > Date.now() + 30000
      && (!minimumTaskVersion || Number(this.session.taskVersion) >= minimumTaskVersion)
      && (!requiredFeature || this.session.features?.[requiredFeature])
      && (!requireCurrentProtocol || this.session.features?.asyncTasks && this.session.features?.conversationStructure && (this.session.features?.compactOrganization || this.optimizationProtocolChecked))) return this.session;
    // Session creation is shared: cancelling one task must not abort other tasks
    // or a Settings connection test. Each caller can still stop waiting promptly.
    this.pendingSession ??= this.createDemoSession().finally(() => { this.pendingSession = null; });
    if (!signal) return this.pendingSession;
    const pending = this.pendingSession;
    return new Promise<DemoSession>((resolve, reject) => {
      const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); };
      signal.addEventListener("abort", abort, { once: true });
      pending.then((value) => { signal.removeEventListener("abort", abort); resolve(value); }, (cause) => { signal.removeEventListener("abort", abort); reject(cause); });
    });
  }

  private async readError(response: Response): Promise<DemoApiError> {
    const payload = await response.json().catch(() => ({})) as { code?: string; usage?: DemoReceipt; requestId?: string; details?: { dimension?: string; required?: number; limit?: number; pendingCny?: number } };
    const code = payload.code || ([404, 405].includes(response.status) ? "DEMO_SERVICE_NOT_DEPLOYED" : response.status === 503 ? "DEMO_UNAVAILABLE" : "DEMO_HTTP_ERROR");
    return new DemoApiError(code, response.status, payload.usage, payload.requestId, payload.details);
  }

  private async request<T>(path: string, body?: unknown, signal?: AbortSignal, idempotencyKey?: string, runId?: string, taskKey?: string, pinnedSession?: DemoSession): Promise<T> {
    let session = pinnedSession ?? await this.getSession(signal);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      signal?.throwIfAborted();
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
      const cancel = () => controller.abort(signal?.reason);
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const response = await fetch(`${apiBaseUrl()}/api/atlas/demo/${path}`, {
          method: body === undefined ? "GET" : "POST", signal: controller.signal,
          headers: { authorization: `Bearer ${session.token}`, ...(body === undefined ? {} : { "content-type": "application/json" }), ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}), ...(runId ? { "X-ChatAtlas-Run-Id": runId } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        if (response.status === 401 && attempt === 0 && !pinnedSession) {
          this.session = null;
          localStorage.removeItem(STORAGE_KEY);
          session = await this.getSession(signal);
          continue;
        }
        if (!response.ok) {
          const failure = await this.readError(response);
          if (failure.code === "REQUEST_IN_PROGRESS" && failure.requestId && session.features?.asyncTasks) {
            if (taskKey) this.saveTask(taskKey, failure.requestId, session);
            return this.waitTask<T>(failure.requestId, signal, session, taskKey);
          }
          throw failure;
        }
        const value = await response.json().catch(() => { throw new DemoApiError("DEMO_INVALID_RESPONSE", response.status); }) as T & { requestId?: string };
        if (response.status === 202 && value.requestId) {
          if (taskKey) this.saveTask(taskKey, value.requestId, session);
          return this.waitTask<T>(value.requestId, signal, session, taskKey);
        }
        return value;
      } catch (cause) {
        if (cause instanceof DemoApiError) throw cause;
        if (signal?.aborted) throw signal.reason;
        throw new DemoApiError(controller.signal.aborted ? "DEMO_REQUEST_TIMEOUT" : "DEMO_CONNECTION_FAILED", controller.signal.aborted ? 504 : 0);
      } finally { clearTimeout(timer); signal?.removeEventListener("abort", cancel); }
    }
    throw new DemoApiError("UNAUTHORIZED", 401);
  }

  getDemoUsage(signal?: AbortSignal): Promise<DemoUsage> { return this.request("usage", undefined, signal); }

  private async waitTask<T>(requestId: string, signal?: AbortSignal, session?: DemoSession, taskKey?: string): Promise<T> {
    const deadline = Date.now() + 150000;
    let delay = 1000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal?.reason); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", abort); resolve(); }, delay);
        signal?.addEventListener("abort", abort, { once: true });
      });
      let state: { status: string; response?: T; failure?: { code: string; status: number }; usage?: DemoReceipt };
      try { state = await this.request(`tasks/${requestId}`, undefined, signal, undefined, undefined, undefined, session); }
      catch (cause) {
        if (signal?.aborted) throw signal.reason;
        if (cause instanceof DemoApiError && (["RATE_LIMITED", "DEMO_DATABASE_BUSY", "DEMO_CONNECTION_FAILED", "DEMO_REQUEST_TIMEOUT"].includes(cause.code) || ["DEMO_HTTP_ERROR", "DEMO_UNAVAILABLE", "DEMO_DATABASE_ERROR"].includes(cause.code) && cause.status >= 500)) {
          delay = Math.min(6000, delay * 1.6);
          continue; // A failed GET is not a failed generation. Keep the same task.
        }
        if (cause instanceof DemoApiError) throw new DemoApiError(cause.code, cause.status, cause.usage, requestId, cause.details);
        throw cause;
      }
      if (state.status === "succeeded" && state.response) { this.forgetTask(taskKey); return state.response; }
      if (state.status === "expired") { this.forgetTask(taskKey); throw new DemoApiError("TASK_RESULT_EXPIRED", 410, state.usage, requestId); }
      if (state.status === "failed") {
        if ((state.failure?.code ?? "PROVIDER_USAGE_PENDING") !== "PROVIDER_USAGE_PENDING") this.forgetTask(taskKey);
        throw new DemoApiError(state.failure?.code ?? "PROVIDER_USAGE_PENDING", state.failure?.status ?? 502, state.usage, requestId);
      }
      delay = Math.min(6000, delay * 1.4);
    }
    throw new DemoApiError("REQUEST_IN_PROGRESS", 409, undefined, requestId);
  }

  async embed(texts: string[], signal?: AbortSignal, runId?: string): Promise<{ requestId?: string; vectors: number[][]; modelKey: string; dimensions: number; usage: DemoReceipt & { embeddingTokens: number } }> {
    const body = { texts };
    return this.request("embed", body, signal, await digest(JSON.stringify(body) + (await this.getSession(signal)).embedding.modelKey), runId);
  }

  async preflightFocus(steps: Array<{ inputTokens: number; strategy: "review" | "answer" | "work"; intermediate: boolean; analysisMode?: "fast" | "balanced" | "deep"; passageCount?: number }>, signal?: AbortSignal): Promise<void> {
    await this.request("focus-preflight", { steps }, signal);
  }

  async runTask(taskType: string, data: Record<string, unknown>, signal?: AbortSignal, salt = "", runId?: string, repair = false): Promise<{ result: unknown; usage: DemoReceipt; requestId?: string }> {
    const route = TASK_ROUTE[taskType];
    if (!route) throw new DemoApiError("INVALID_REQUEST", 400);
    const session = await this.getSession(signal, taskType === "focus_session" || taskType === "conversation_structure", taskType === "focus_session" ? CURRENT_FOCUS_TASK_VERSION : 0);
    if ((taskType === "focus_session" && (!session.features?.asyncTasks || !(Number(session.taskVersion) >= CURRENT_FOCUS_TASK_VERSION))) || (taskType === "conversation_structure" && !session.features?.conversationStructure)) throw new DemoApiError("DEMO_SERVICE_OUTDATED", 409);
    const compatibleData = { ...data };
    // Older services accept locale only for goal reading. Their other task
    // schemas must keep working until the shared backend is updated.
    if (taskType !== "focus_session" && !session.features?.outputLocale) delete compatibleData.locale;
    if (!session.features?.compactOrganization) { delete compatibleData.localPlan; delete compatibleData.qualityTier; }
    if (!session.features?.asyncTasks) { delete compatibleData.strategy; delete compatibleData.coverage; delete compatibleData.enrich; }
    const body = { taskType, data: compatibleData, ...(repair && session.features?.asyncTasks ? { repair } : {}) };
    const idempotencyKey = await digest(JSON.stringify(body) + salt + (session.taskVersion ?? "") + (session.policyVersion ?? "") + JSON.stringify(session.models ?? {}));
    const taskKey = `${apiBaseUrl()}:${route}:${idempotencyKey}`;
    const pending = this.pendingTasks.get(taskKey) ?? readPendingTasks().find((item) => item.key === taskKey);
    if (pending && Date.parse(pending.expiresAt) > Date.now()) return this.waitTask(pending.requestId, signal, { ...session, token: pending.token, expiresAt: pending.expiresAt }, taskKey);
    return this.request(route, body, signal, idempotencyKey, runId, taskKey);
  }
}

export const atlasApiClient = new AtlasApiClient();

export class ServerProxyLLMProvider implements AtlasAIProvider {
  readonly id = "atlas-demo";
  readonly modelId = "atlas-demo";
  readonly capabilities = { textGeneration: true, structuredOutput: "json" as const, embeddings: true, conversationStructure: true, requestUsage: true };
  private readonly usage: ProviderUsageSnapshot = { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
  getUsageSnapshot(): ProviderUsageSnapshot { return { ...this.usage }; }
  async testConnection(): Promise<{ ok: true; model: string }> {
    const session = await atlasApiClient.getSession(undefined, true);
    if (!session.features?.asyncTasks || !session.features?.conversationStructure) throw new DemoApiError("DEMO_SERVICE_OUTDATED", 409);
    return { ok: true, model: this.modelId };
  }
  async generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> {
    const taskType = request.taskType || "";
    let data: Record<string, unknown>;
    try {
      const parsed = JSON.parse(request.prompt) as Record<string, unknown>;
      data = Object.fromEntries(Object.entries(parsed).filter(([key]) => !["task", "target", "schema"].includes(key)));
    } catch { throw new DemoApiError("INVALID_REQUEST", 400); }
    this.usage.requests += 1;
    this.usage.lastRequestId = undefined;
    this.usage.lastModelId = undefined;
    let response;
    const acceptUsage = (usage: DemoReceipt, requestId?: string) => {
      request.onUsage?.({ ...usage, requestId });
      this.usage.inputTokens += usage.inputTokens || 0;
      this.usage.outputTokens += usage.outputTokens || 0;
      this.usage.costCny = (this.usage.costCny ?? 0) + (usage.costCny ?? 0);
      this.usage.pendingCostCny = (this.usage.pendingCostCny ?? 0) + (usage.pendingCostCny ?? 0);
      this.usage.lastModelId = usage.modelId;
      this.usage.lastRequestId = requestId;
      this.usage.reportedRequests += 1;
      if (usage.cacheHit) this.usage.cacheHits = (this.usage.cacheHits ?? 0) + 1;
    };
    try { response = await atlasApiClient.runTask(taskType, data, request.signal, request.system, request.runId, request.repair); }
    catch (cause) { if (cause instanceof DemoApiError) { if (cause.usage) acceptUsage(cause.usage, cause.requestId); else this.usage.lastRequestId = cause.requestId; } throw cause; }
    acceptUsage(response.usage, response.requestId);
    if (taskType === "focus_session") {
      const issue = focusOutputIssue(response.result, data);
      if (issue) throw new AIProviderValidationError(issue);
    }
    return request.validate(response.result);
  }
}

export async function demoEmbeddingProvider(signal?: AbortSignal, taskRunId?: string, conversationIds: string[] = []): Promise<EmbeddingProvider> {
  const session = await atlasApiClient.getSession(signal);
  const runId = taskRunId ?? `embedding-${crypto.randomUUID()}`;
  const embed = async (texts: string[], taskSignal?: AbortSignal) => {
    const startedAt = performance.now();
    let receipt: DemoReceipt | undefined;
    let requestId: string | undefined;
    let status: "completed" | "failed" | "cached" = "failed";
    try {
      const result = await atlasApiClient.embed(texts, taskSignal ?? signal, runId);
      receipt = result.usage; requestId = result.requestId;
      if (result.modelKey !== session.embedding.modelKey || result.vectors.some((vector) => vector.length !== session.embedding.dimensions)) throw new DemoApiError("EMBEDDING_MODEL_CHANGED", 409);
      status = receipt.cacheHit ? "cached" : "completed";
      return result.vectors;
    } catch (cause) { if (cause instanceof DemoApiError && cause.usage) receipt = cause.usage; throw cause; }
    finally {
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId, taskType: "embedding", requestId, providerId: "atlas-demo", modelId: receipt?.modelId ?? session.embedding.modelKey, conversationIds, inputTokens: 0, outputTokens: 0, embeddingTokens: receipt?.embeddingTokens ?? (status === "completed" ? estimateTokens(texts.join("\n")) : 0), tokenSource: receipt ? "provider" : "unavailable", costCny: receipt?.costCny, pendingCostCny: receipt?.pendingCostCny, status, attempt: 1, durationMs: Math.round(performance.now() - startedAt) }).catch(() => undefined);
    }
  };
  return {
    modelKey: session.embedding.modelKey,
    providerId: "atlas-demo",
    modelId: session.embedding.modelKey.split(":")[1],
    version: session.embedding.modelKey.split(":")[2],
    embedBatch: embed,
    embedText: async (text, taskSignal) => (await embed([text], taskSignal))[0],
  };
}
