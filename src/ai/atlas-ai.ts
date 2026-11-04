import {directoryValidationCounts} from "./provider-errors";
import {failureOrigin} from "./failure-origin";
import { classifyAIRequest } from "./ai-diagnostics";
import { compactRequest } from "./compact-request";
import type { AISettings } from "../shared/types";
import { getDatabase } from "../storage/db";
import { recordAIUsage } from "../storage/ai-usage";
import { ANALYSIS_VERSION } from "./conversation-profiler";
import { AIProviderHttpError, AIProviderResponseError, AIProviderValidationError, createAIProvider, type AtlasAIProvider, type ProviderCapabilities, type ProviderUsageSnapshot, type ProviderRequestUsage, type StructuredAIRequest } from "./provider";
import { effectiveAISettings, hasAIConnection } from "./ai-mode";
import { atlasApiClient, CURRENT_FOCUS_TASK_VERSION, DemoApiError } from "./demo-api";
import { requestBudget, taskData } from "./request-policy";
import { POLICY_VERSION, TOKEN_ESTIMATE_VERSION, MAX_FOCUS_PASSAGES, estimateTokens, economyTask, focusStrategy, taskPolicy } from "../shared/atlas/policy.js";
import type { ProviderRequestDiagnostics } from "./provider-transport";
import { preferredOutputLocale } from "../shared/output-locale";
import { cacheAIResult, touchAIResult } from "../storage/ai-result-cache";
import { recordTokenSample, validInputScale, writingInputScale } from "./token-calibration";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY, MAX_CONCURRENCY, isReadingRequest, usesMainModelForPlanning } from "./model-routing";

/** A request stopped before sending because it exceeds a local input limit; nothing was billed. */
export class AILocalInputError extends Error {
  constructor(message: string, readonly code: "LOCAL_INPUT_BUDGET" | "LOCAL_INPUT_CHARACTERS") { super(message); this.name = "AILocalInputError"; }
}

export type AIRequestStateListener = (state: "waiting_model" | "retrying" | null, diagnostics?: ProviderRequestDiagnostics) => void;

export type AITaskRole = "extract" | "decision" | "synthesis";

export interface AtlasAI extends AtlasAIProvider {
  /** Stable model/policy identity for source extraction; presentation locale is separate. */
  getEvidenceAnalysisKey?():Promise<string>;
  recordLocalFailure?(request:Pick<StructuredAIRequest<unknown>,"taskType"|"prompt"|"trace"|"conversationIds">,code:string):Promise<void>;
  recordReuse?(request: StructuredAIRequest<unknown>, layer: "checkpoint" | "field"): Promise<void>;
  readonly canReuseProjectKnowledge?: boolean;
  readonly usesContentTokenEstimates?: boolean;
  readonly capabilities: ProviderCapabilities;
  extract<T>(request: StructuredAIRequest<T>): Promise<T>;
  decide<T>(request: StructuredAIRequest<T>): Promise<T>;
  synthesize<T>(request: StructuredAIRequest<T>): Promise<T>;
  discardFinalSynthesis?(): Promise<void>;
  hasCachedSynthesis?(request: StructuredAIRequest<unknown>): Promise<boolean>;
  prepareFocus?(requests: StructuredAIRequest<unknown>[], final: { goal: string; mode: string; analysisMode?: AISettings["analysisMode"] }): Promise<void>;
}

function fallbackHash(value: string): string {
  let hash = 2166136261;
  for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  return hash.toString(36);
}

async function inputHash(value: string): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return `${value.length}-${fallbackHash(value)}`;
}

export const MAX_AI_TASK_INPUT_CHARACTERS = 100_000;
const SEMANTIC_CACHE_VERSION = 5;
const TRANSIENT_DEMO_ERRORS = new Set(["RATE_LIMITED", "PROVIDER_BUSY", "PROVIDER_INVALID_RESPONSE"]);
/** Pause before resending a request whose connection failed without any response;
 * long enough for the browser to drop a dead pooled connection and open a new one. */
/** Pauses before each quiet resend; one resend by default, all three for a request with resendUnsent. A
 * connection can stay unreachable for a while (a proxy or VPN reconnecting), so a single resend after 2 s
 * often fails the same way; three cover about half a minute. */
const NETWORK_RETRY_DELAYS_MS = [2000, 8000, 20000];
/** A provider that is busy (429, 503) generated nothing: the same quiet resends, waiting at least as long as
 * it asks, at most this long. */
const BUSY_RETRY_MAX_MS = 30_000;
/** Multiplies every retry pause. Always 1 in the product; a test that exercises
 * many retries may set 0 so it does not wait in real time. */
export const aiRetryTiming = { scale: 1 };
/** Streaming providers send response headers within about 4 s of accepting a request.
 * A failure with no header inside this window means the connection never opened: on
 * Windows the TCP connect timeout ends such requests at about 21 s (every network
 * failure in one run took 20.4-20.9 s). The model never received them. */
const NETWORK_RETRY_WINDOW_MS = 30_000;

/** One quiet resend is safe only when the transport itself reports a failure with no
 * response header within the window; without that report billing is unknown. */
export function networkResendable(error: unknown, transport: Pick<ProviderRequestDiagnostics, "queueMs" | "responseHeadersMs">, sentForMs: number): boolean {
  return error instanceof TypeError && transport.queueMs !== undefined && transport.responseHeadersMs === undefined && sentForMs < NETWORK_RETRY_WINDOW_MS;
}

class DefaultAtlasAI implements AtlasAI {
  readonly supportsCacheMissGuard=true;
  canReuseProjectKnowledge: boolean;
  usesContentTokenEstimates: boolean;
  readonly id: string;
  readonly modelId: string;
  readonly capabilities: ProviderCapabilities;
  private readonly finalResults = new Map<string, number>();
  private activeCalls = 0;
  private concurrencyControl = new AdaptiveConcurrency(1);
  private cacheHits = 0;
  private cacheMisses = 0;
  private retries = 0;
  private readonly inFlight = new Map<string, { promise: Promise<unknown>; signal?: AbortSignal; cacheIf?: unknown }>();
  private readonly cacheNamespace: string;
  private readonly baseUrl: string;

  constructor(private readonly provider: AtlasAIProvider, settings: AISettings, private readonly signal?: AbortSignal, private readonly runId: string = crypto.randomUUID(), private readonly onRequestState?: AIRequestStateListener, private readonly economyProvider?: AtlasAIProvider) {
    this.baseUrl = settings.baseUrl;
    this.id = provider.id ?? settings.provider;
    this.usesContentTokenEstimates = this.id !== "atlas-demo";
    this.canReuseProjectKnowledge = this.id !== "atlas-demo";
    this.modelId = provider.modelId ?? (settings.economyModel && settings.economyModel !== settings.model ? `${settings.model}+${settings.economyModel}` : settings.model);
    const meteredRequests = provider.capabilities?.requestUsage && (!economyProvider || economyProvider.capabilities?.requestUsage);
    const ceiling=meteredRequests ? Math.max(1,Math.min(MAX_CONCURRENCY,provider.capabilities?.maxConcurrency??(this.id==="atlas-demo"?2:DEFAULT_CONCURRENCY),economyProvider?.capabilities?.maxConcurrency??MAX_CONCURRENCY)) : 1;
    this.concurrencyControl = new AdaptiveConcurrency(ceiling);
    const control=this.concurrencyControl,concurrency=()=>control.current();
    this.capabilities = { ...(provider.capabilities ?? { textGeneration: true, structuredOutput: "prompt-only", embeddings: false }), get maxConcurrency(){return concurrency();} };
    this.cacheNamespace = `${this.id}:${this.modelId}:${settings.baseUrl.replace(/\/+$/u, "")}`;
  }

  async getAnalysisKey(): Promise<string> {
    const session = this.id === "atlas-demo" ? await atlasApiClient.getSession(this.signal, true) : undefined;
    this.usesContentTokenEstimates = !session || Boolean(session.features?.contentTokenEstimates);
    this.canReuseProjectKnowledge = !session || Boolean(session.features?.projectKnowledge);
    return `${this.cacheNamespace}:${this.economyProvider?.modelId ?? ""}:${SEMANTIC_CACHE_VERSION}:${POLICY_VERSION}:${session?.taskVersion ?? ""}:${JSON.stringify(session?.models ?? {})}:${Boolean(session?.features?.compactOrganization)}:${preferredOutputLocale()}`;
  }
  async getEvidenceAnalysisKey():Promise<string>{
    return `${this.cacheNamespace}:${this.economyProvider?.modelId??""}:${SEMANTIC_CACHE_VERSION}:${POLICY_VERSION}`;
  }
  async testConnection(): Promise<{ ok: true; model: string }> {
    const at=performance.now(),requestStartedAt=Date.now();
    try { const result=await this.provider.testConnection();await recordAIUsage({id:crypto.randomUUID(),createdAt:Date.now(),runId:this.runId,taskType:"other",feature:"connection",operation:"connection:test",providerId:this.id,modelId:this.modelId,conversationIds:[],inputTokens:0,outputTokens:0,tokenSource:"unavailable",status:"completed",attempt:1,requestStartedAt,durationMs:Math.round(performance.now()-at)}).catch(()=>undefined);return result; }
    catch(error){await recordAIUsage({id:crypto.randomUUID(),createdAt:Date.now(),runId:this.runId,taskType:"other",feature:"connection",operation:"connection:test",providerId:this.id,modelId:this.modelId,conversationIds:[],inputTokens:0,outputTokens:0,tokenSource:"unavailable",status:"failed",attempt:1,requestStartedAt,durationMs:Math.round(performance.now()-at),failureOrigin:failureOrigin(error),errorCode:"CONNECTION_FAILED"}).catch(()=>undefined);throw error;}
  }
  async recordLocalFailure(request:Pick<StructuredAIRequest<unknown>,"taskType"|"prompt"|"trace"|"conversationIds">,code:string) {
    const identity=classifyAIRequest(request.taskType,request.prompt,request.trace);
    await recordAIUsage({id:crypto.randomUUID(),createdAt:Date.now(),runId:this.runId,...identity,stage:identity.operation,taskType:request.taskType??"other",providerId:this.id,modelId:this.modelId,conversationIds:request.conversationIds??[],inputTokens:0,outputTokens:0,tokenSource:"provider",status:"failed",failureOrigin:"local",requestSent:false,errorCode:code,costCny:0,pendingCostCny:0,attempt:1,durationMs:0}).catch(()=>undefined);
  }
  async recordReuse(request: StructuredAIRequest<unknown>, layer: "checkpoint" | "field") {
    await recordAIUsage({id:crypto.randomUUID(),createdAt:Date.now(),runId:this.runId,taskType:request.taskType??"other",...classifyAIRequest(request.taskType,request.prompt,request.trace),operationId:crypto.randomUUID(),cacheLayer:layer,stage:classifyAIRequest(request.taskType,request.prompt,request.trace).operation,providerId:this.id,modelId:this.modelId,conversationIds:request.conversationIds??[],inputTokens:0,outputTokens:0,tokenSource:"provider",status:"cached",attempt:1,durationMs:0}).catch(()=>undefined);
  }
  getUsageSnapshot(): ProviderUsageSnapshot {
    const main = this.provider.getUsageSnapshot?.() ?? { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
    const economy = this.economyProvider?.getUsageSnapshot?.() ?? { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 };
    return { requests: main.requests + economy.requests, inputTokens: main.inputTokens + economy.inputTokens, outputTokens: main.outputTokens + economy.outputTokens, reportedRequests: main.reportedRequests + economy.reportedRequests, cacheHits: this.cacheHits + (main.cacheHits ?? 0) + (economy.cacheHits ?? 0), cacheMisses: this.cacheMisses, retries: this.retries, costCny: (main.costCny ?? 0) + (economy.costCny ?? 0), pendingCostCny: (main.pendingCostCny ?? 0) + (economy.pendingCostCny ?? 0) };
  }
  generateStructured<T>(request: StructuredAIRequest<T>): Promise<T> { return this.run("decision", request); }
  extract<T>(request: StructuredAIRequest<T>): Promise<T> { return this.run("extract", { ...request, temperature: request.temperature ?? .15 }); }
  decide<T>(request: StructuredAIRequest<T>): Promise<T> { return this.run("decision", { ...request, temperature: request.temperature ?? .05 }); }
  synthesize<T>(request: StructuredAIRequest<T>): Promise<T> { return this.run("synthesis", { ...request, temperature: request.temperature ?? .3 }); }

  private async cacheIdentity(role: AITaskRole, request: Pick<StructuredAIRequest<unknown>, "system" | "prompt" | "taskType" | "temperature" | "maxOutputTokens" | "repair" | "repairContent">, modelId: string, taskVersion: string) {
    const parameters = JSON.stringify([request.temperature ?? (role === "synthesis" ? .3 : role === "extract" ? .15 : .05), request.maxOutputTokens ?? null, request.repair ?? false, request.repairContent ?? ""]);
    const hash = await inputHash(`${ANALYSIS_VERSION}:${SEMANTIC_CACHE_VERSION}:${POLICY_VERSION}:${taskVersion}:${this.cacheNamespace}:${modelId}:${role}:${request.taskType ?? "other"}:${parameters}:${request.system}:${request.prompt}`);
    return { hash, id: `${this.id}:${modelId}:${role}:${hash}` };
  }

  async discardFinalSynthesis(): Promise<void> {
    const tx = (await getDatabase()).transaction("semanticDecisionCache", "readwrite");
    for (const [id, createdAt] of this.finalResults) {
      const row = await tx.store.get(id);
      if (row?.createdAt === createdAt) await tx.store.delete(id);
    }
    await tx.done;
    this.finalResults.clear();
  }

  async hasCachedSynthesis(request: StructuredAIRequest<unknown>): Promise<boolean> {
    if (request.bypassCache) return false;
    this.signal?.throwIfAborted();
    const session = this.id === "atlas-demo" ? await atlasApiClient.getSession(this.signal, true, CURRENT_FOCUS_TASK_VERSION) : undefined;
    const version = session ? `${session.taskVersion ?? "1"}:${JSON.stringify(session.models ?? {})}` : "";
    const db = await getDatabase(), models = [this.provider.modelId ?? this.modelId, ...(this.economyProvider?.modelId && isReadingRequest(request.taskType, taskData(request.prompt)) ? [this.economyProvider.modelId] : [])];
    for (const model of models) if (await db.get("semanticDecisionCache", (await this.cacheIdentity("synthesis", request, model, version)).id)) return true;
    return false;
  }

  async prepareFocus(requests: StructuredAIRequest<unknown>[], final: { goal: string; mode: string; analysisMode?: AISettings["analysisMode"] }): Promise<void> {
    if (this.id !== "atlas-demo") return;
    const session = await atlasApiClient.getSession(this.signal, true, CURRENT_FOCUS_TASK_VERSION);
    const version = `${session.taskVersion ?? "1"}:${JSON.stringify(session.models ?? {})}`;
    const modelId = this.provider.modelId ?? this.modelId;
    const db = await getDatabase();
    const steps: Array<{ inputTokens: number; strategy: "review" | "answer" | "work"; intermediate: boolean; analysisMode?: AISettings["analysisMode"]; passageCount?: number }> = [];
    for (const request of requests) {
      this.signal?.throwIfAborted();
      const { id } = await this.cacheIdentity("synthesis", request, modelId, version);
      if (!request.bypassCache && await db.get("semanticDecisionCache", id)) continue;
      const data = taskData(request.prompt);
      const mode = data?.analysisMode;
      steps.push({ inputTokens: requestBudget(request, session.models?.main, undefined, false, !session.features?.contentTokenEstimates).inputTokens, strategy: "review", intermediate: true, analysisMode: mode === "fast" || mode === "deep" ? mode : "balanced", passageCount: Array.isArray(data?.passages) ? data.passages.length : undefined });
    }
    // Fully cached reading must remain usable even when new generation is blocked.
    // The final call has its own server guard; its exact cache key is known later.
    if (!steps.length) return;
    const strategy = focusStrategy(final.goal, final.mode);
    steps.push({ inputTokens: taskPolicy("focus_session", { strategy }).maxInputTokens, strategy, intermediate: false, analysisMode: final.analysisMode, passageCount: MAX_FOCUS_PASSAGES });
    const started = performance.now();
    try { await atlasApiClient.preflightFocus(steps, this.signal); }
    catch (cause) {
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, taskType: "focus_session", providerId: this.id, modelId: session.models?.main ?? modelId, taskVersion: session.taskVersion, stage: "preflight", requestId: cause instanceof DemoApiError ? cause.requestId : undefined,
        conversationIds: [...new Set(requests.flatMap((request) => request.conversationIds ?? []))], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "failed", failureOrigin:this.signal?.aborted?undefined:failureOrigin(cause), costCny: 0, pendingCostCny: 0, attempt: 1, durationMs: Math.round(performance.now() - started), errorCode: cause instanceof DemoApiError ? cause.code : this.signal?.aborted ? "CANCELLED" : "PREFLIGHT_FAILED" }).catch(() => undefined);
      throw cause;
    }
  }

  private async run<T>(role: AITaskRole, request: StructuredAIRequest<T>): Promise<T> {
    const sources = [...new Set([this.signal, request.signal].filter((value): value is AbortSignal => Boolean(value)))];
    const linked = sources.length > 1 ? new AbortController() : undefined;
    const forwardAbort = (event: Event) => linked?.abort((event.target as AbortSignal).reason);
    if (linked) for (const source of sources) {
      if (source.aborted) linked.abort(source.reason);
      else source.addEventListener("abort", forwardAbort, { once: true });
    }
    const signal = linked?.signal ?? sources[0];
    this.activeCalls++;
    try { return await this.runTask(role, request, signal); }
    finally { for (const source of sources) source.removeEventListener("abort", forwardAbort); if (--this.activeCalls === 0) this.onRequestState?.(null); }
  }

  private async runTask<T>(role: AITaskRole, request: StructuredAIRequest<T>, signal?: AbortSignal): Promise<T> {
    const preparationStarted=performance.now(), operationId=request.trace?.operationId??crypto.randomUUID();
    signal?.throwIfAborted();
    // Language is part of the request and cache identity, including older
    // chapter/profile/composition tasks. Never rewrite source text or IDs.
    const data = taskData(request.prompt);
    if (data && request.taskType && request.taskType !== "other" && data.locale === undefined) {
      request = { ...request, prompt: JSON.stringify({ ...JSON.parse(request.prompt), locale: preferredOutputLocale() }) };
    }
    const routed = taskData(request.prompt);
    let useEconomy = usesMainModelForPlanning(request.taskType, routed) ? false : request.taskType && request.taskType !== "other" ? economyTask(request.taskType, routed) : role !== "synthesis";
    // Reading originals goes to the economy model, unless the main model already
    // read this exact batch: a saved analysis is reused rather than paid for again.
    if (this.economyProvider && this.id !== "atlas-demo" && isReadingRequest(request.taskType, routed) && !request.bypassCache) {
      const { id: mainId } = await this.cacheIdentity(role, request, this.provider.modelId ?? this.modelId, "");
      useEconomy = !await (await getDatabase()).get("semanticDecisionCache", mainId);
    }
    const provider = useEconomy ? this.economyProvider ?? this.provider : this.provider;
    const modelId = provider.modelId ?? this.modelId;
    const identity=classifyAIRequest(request.taskType,request.prompt,request.trace);
    const rejectInput = async (message: string, code: AILocalInputError["code"]) => {
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, ...identity,operationId,taskType: request.taskType ?? "other", providerId: this.id, modelId, conversationIds: request.conversationIds ?? [], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "failed", failureOrigin:"local",requestSent:false,errorCode: "TASK_INPUT_LIMIT", costCny: 0, attempt: 1, durationMs: 0 }).catch(() => undefined);
      throw new AILocalInputError(message, code);
    };
    const inputCharacters = request.system.length + request.prompt.length;
    if (inputCharacters > MAX_AI_TASK_INPUT_CHARACTERS) await rejectInput(`AI task input exceeds ${MAX_AI_TASK_INPUT_CHARACTERS} characters`, "LOCAL_INPUT_CHARACTERS");
    const focusTask = request.taskType === "focus_session";
    const session = this.id === "atlas-demo" ? await atlasApiClient.getSession(signal, focusTask, focusTask ? CURRENT_FOCUS_TASK_VERSION : 0) : undefined;
    const payload = taskData(request.prompt);
    const stage = payload?.coverage as { stage?: string; final?: boolean } | undefined;
    const diagnostic = { ...identity,operationId,parentOperationId:request.trace?.parentOperationId,recoveryReason:request.trace?.recoveryReason,recoveryDepth:request.trace?.recoveryDepth,schedulingMs:request.trace?.schedulingMs, stage: stage?.stage ? `${stage.stage}${stage.final ? ":final" : ""}` : [payload?.presentation, payload?.stage].filter(item => typeof item === "string").join(":") || undefined, taskVersion: session?.taskVersion ?? `client-${POLICY_VERSION}`, tokenEstimateVersion: session && !session.features?.contentTokenEstimates ? "1" : TOKEN_ESTIMATE_VERSION, coveragePlan: request.coveragePlan };
    if (session && focusTask && !(Number(session.taskVersion) >= CURRENT_FOCUS_TASK_VERSION)) throw new DemoApiError("DEMO_SERVICE_OUTDATED", 409);
    const taskVersion = session ? `${session.taskVersion ?? "1"}:${JSON.stringify(session.models ?? {})}` : "";
    const budgetModel = session?.models ? economyTask(request.taskType ?? "other", taskData(request.prompt)) ? session.models.economy : session.models.main : modelId;
    const wireRequest = compactRequest(request);
    const initialBudget = requestBudget(wireRequest, budgetModel, this.baseUrl, false, Boolean(session && !session.features?.contentTokenEstimates));
    let budget = initialBudget;
    // Without an explicit scale, the model's calibrated estimate applies: the local
    // estimate runs about twice the provider's real count, and refusing a request
    // that would fit (an overview, an audit) costs more than sending it.
    const inputScale = request.inputBudgetScale === undefined ? writingInputScale(budgetModel) : validInputScale(request.inputBudgetScale);
    if (budget.inputTokens * inputScale > budget.maxInputTokens) await rejectInput(`AI task exceeds its input budget (${budget.inputTokens}/${budget.maxInputTokens} estimated tokens). Reduce sources or split this task.`, "LOCAL_INPUT_BUDGET");
    const preparationMs=Math.round(performance.now()-preparationStarted), cacheStarted=performance.now();
    const { hash, id } = await this.cacheIdentity(role, request, modelId, taskVersion);
    const db = await getDatabase();
    const cached = request.bypassCache ? undefined : await db.get("semanticDecisionCache", id);
    signal?.throwIfAborted();
    const cacheLookupMs=Math.round(performance.now()-cacheStarted);
    if (cached) {
      if (focusTask && (stage?.final || !stage)) this.finalResults.set(id, cached.createdAt);
      void touchAIResult(cached, isReadingRequest(request.taskType, payload) ? [...new Set(request.conversationIds ?? [])] : undefined).catch(() => undefined);
      // The provider already validated and normalized this value before it was stored.
      // The key includes the prompt schema and analysis version; re-validating it as raw model JSON breaks cache hits.
      this.cacheHits += 1;
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, ...diagnostic, taskType: request.taskType ?? "other", providerId: this.id, modelId, conversationIds: [...new Set(request.conversationIds ?? [])], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "cached", cacheLayer:"result",timing:{preparationMs,cacheLookupMs}, costCny: 0, pendingCostCny: 0, attempt: 1, durationMs: 0 }).catch(() => undefined);
      request.onCacheHit?.();
      return cached.result as T;
    }
    // Equivalent fixed-contract focus requests can overlap before the first
    // cache write. Share their work only within the same cancellation scope.
    const flightKey = `${id}:${request.temperature ?? ""}:${request.maxOutputTokens ?? ""}:${Boolean(request.repair)}:${request.repairContent ?? ""}`;

    const pending = focusTask && !request.bypassCache ? this.inFlight.get(flightKey) : undefined;
    if (pending && pending.signal === signal && pending.cacheIf === request.cacheIf) {
      const waitStarted=performance.now();
      const result = await pending.promise;
      signal?.throwIfAborted();
      this.cacheHits += 1;
      await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, ...diagnostic, taskType: request.taskType ?? "other", providerId: this.id, modelId, conversationIds: [...new Set(request.conversationIds ?? [])], inputTokens: 0, outputTokens: 0, tokenSource: "provider", status: "cached", cacheLayer:"inflight",timing:{preparationMs,cacheLookupMs,clientMs:Math.round(performance.now()-waitStarted)}, costCny: 0, pendingCostCny: 0, attempt: 1, durationMs: 0 }).catch(() => undefined);
      request.onCacheHit?.();
      return structuredClone(result) as T;
    }
    const generate = async (): Promise<T> => {
      signal?.throwIfAborted();
      request.beforeRequest?.();
      this.cacheMisses += 1;
      let failure: unknown;
      let repairStructure = Boolean(request.repair);
      let repairContent: string | undefined;
      let repairFields: StructuredAIRequest<T>["repairFields"];
      let homeValidationFields: string[] = [];
      let lastBackoffMs=0,quietResends=0;
      for (let attempt = 0; attempt < (request.maxAttempts ?? 2); attempt += 1) {
        signal?.throwIfAborted();
        request.onResponseText?.("");
        const before = provider.capabilities?.requestUsage ? { requests: 0, inputTokens: 0, outputTokens: 0, reportedRequests: 0 } : provider.getUsageSnapshot?.();
        let receipt: ProviderRequestUsage | undefined;
        let transport: ProviderRequestDiagnostics = {};
        let validationMs=0,cacheWriteMs:number|undefined,finishedAt:number|undefined;
        const timing=()=>({preparationMs:attempt===0?preparationMs:0,cacheLookupMs:attempt===0?cacheLookupMs:0,validationMs:Math.round(validationMs),cacheWriteMs,queueMs:transport.queueMs,responseMs:transport.responseMs,backoffMs:lastBackoffMs,clientMs:Math.max(0,Math.round((finishedAt??performance.now())-startedAt)-(transport.queueMs??0)-(transport.responseMs??0)-Math.round(validationMs))});
        let lastProgress = -Infinity;
        const usageAfter = (): ProviderUsageSnapshot | undefined => receipt ? { requests: 1, reportedRequests: 1, inputTokens: receipt.inputTokens, outputTokens: receipt.outputTokens, costCny: receipt.costCny, pendingCostCny: receipt.pendingCostCny, cacheHits: Number(receipt.cacheHit), lastModelId: receipt.modelId, lastRequestId: receipt.requestId, ...(receipt.cachedInputTokens === undefined ? {} : { cachedInputTokens: receipt.cachedInputTokens }) } : provider.capabilities?.requestUsage ? undefined : provider.getUsageSnapshot?.();
        const system = `${request.system}${attempt && repairStructure ? "\nYour previous response failed schema validation. Repair it once and return only a schema-valid JSON object." : ""}${attempt && homeValidationFields.length ? `\nInvalid fields: ${homeValidationFields.join(", ")}. Follow expectedShape and the supplied IDs exactly. Return empty optional fields when unused.` : ""}`;
        const startedAt = performance.now();
        const attemptRequest = { ...wireRequest, priority: request.priority ?? (request.taskType === "project_query_plan" || data?.presentation === "project_query" ? 2 : stage?.stage?.startsWith("structure:") ? 0 : 1), repair: repairStructure, ...(repairContent === undefined ? {} : { repairContent,repairFields }) };
        budget = requestBudget(homeValidationFields.length ? { ...attemptRequest, system } : attemptRequest, budgetModel, this.baseUrl, false, Boolean(session && !session.features?.contentTokenEstimates));
        if (budget.inputTokens * inputScale > budget.maxInputTokens) throw failure;
        const requestStartedAt = Date.now();
        try {
          this.onRequestState?.("waiting_model");
          const result = await provider.generateStructured({ ...attemptRequest, validate:value=>{const validationStarted=performance.now();try{return attemptRequest.validate(value);}finally{validationMs+=performance.now()-validationStarted;}}, onResponseText: request.onResponseText, signal: signal ?? request.signal, system, runId: this.runId, maxOutputTokens: Math.min(budget.maxOutputTokens, request.maxOutputTokens ?? Infinity), onUsage: (usage) => { receipt = usage; request.onUsage?.(usage); }, onDiagnostics: (value) => {
            transport = {...transport,...value}; request.onDiagnostics?.(value);
            if ((value.receivedCharacters ?? 0) > 0 && performance.now() - lastProgress >= 500 && !signal?.aborted) {
              lastProgress = performance.now(); this.onRequestState?.("waiting_model", value);
            }
          } });
          if (this.activeCalls <= 1) this.onRequestState?.(null);
          signal?.throwIfAborted();
          const after = usageAfter();
          const reported = Boolean(before && after && after.reportedRequests > before.reportedRequests);
          if (reported && receipt) recordTokenSample(budgetModel, budget.inputTokens, receipt.inputTokens);

          finishedAt=performance.now();
          const cacheWriteStarted=performance.now();
          // A local cache write failure must not retry (and re-bill) a successful provider response.
          if (request.cacheIf?.(result) !== false) {
            const createdAt = Date.now();
            await cacheAIResult({ id, taskType: role, inputHash: hash, analysisVersion: ANALYSIS_VERSION, providerId: this.id, modelId, result, createdAt, ...(isReadingRequest(request.taskType, payload) ? {readingConversationIds: [...new Set(request.conversationIds ?? [])]} : {}) }).catch(() => undefined);
            if (focusTask && (stage?.final || !stage)) this.finalResults.set(id, createdAt);
          }
          cacheWriteMs=Math.round(performance.now()-cacheWriteStarted);
          await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, ...diagnostic, ...transport, timing:timing(), estimatedInputTokens: budget.inputTokens, ...(receipt?.cachedInputTokens === undefined ? {} : { cachedInputTokens: receipt.cachedInputTokens }), requestStartedAt, durationMs: Math.round(finishedAt-startedAt), taskType: request.taskType ?? "other", providerId: this.id, modelId: after?.lastModelId ?? modelId, requestId: after?.lastRequestId ?? transport.requestId, conversationIds: [...new Set(request.conversationIds ?? [])], inputTokens: reported ? Math.max(0, after!.inputTokens - before!.inputTokens) : budget.inputTokens, outputTokens: reported ? Math.max(0, after!.outputTokens - before!.outputTokens) : estimateTokens(result), tokenSource: reported ? "provider" : "estimated", status: (after?.cacheHits ?? 0) > (before?.cacheHits ?? 0) ? "cached" : "completed", costCny: after?.costCny === undefined ? undefined : after.costCny - (before?.costCny ?? 0), pendingCostCny: after?.pendingCostCny === undefined ? undefined : after.pendingCostCny - (before?.pendingCostCny ?? 0), attempt: attempt + 1 }).catch(() => undefined);
          this.concurrencyControl.success();
          return result;
        } catch (error) {
          if (this.activeCalls <= 1) this.onRequestState?.(null);
          const after = usageAfter();
          const reported = Boolean(before && after && after.reportedRequests > before.reportedRequests);
          if (reported && receipt) recordTokenSample(budgetModel, budget.inputTokens, receipt.inputTokens);
          await recordAIUsage({ id: crypto.randomUUID(), createdAt: Date.now(), runId: this.runId, ...diagnostic, ...transport, timing:timing(), estimatedInputTokens: budget.inputTokens, ...(receipt?.cachedInputTokens === undefined ? {} : { cachedInputTokens: receipt.cachedInputTokens }), requestStartedAt, durationMs: Math.round(performance.now() - startedAt), taskType: request.taskType ?? "other", providerId: this.id, modelId: after?.lastModelId ?? modelId, requestId: after?.lastRequestId ?? transport.requestId ?? (error instanceof DemoApiError || error instanceof AIProviderHttpError || error instanceof AIProviderResponseError ? error.requestId : undefined), conversationIds: [...new Set(request.conversationIds ?? [])], inputTokens: reported ? Math.max(0, after!.inputTokens - before!.inputTokens) : 0, outputTokens: reported ? Math.max(0, after!.outputTokens - before!.outputTokens) : 0, tokenSource: reported ? "provider" : "unavailable", costCny: after?.costCny === undefined ? undefined : after.costCny - (before?.costCny ?? 0), pendingCostCny: after?.pendingCostCny === undefined ? undefined : after.pendingCostCny - (before?.pendingCostCny ?? 0), status: "failed", failureOrigin:signal?.aborted?undefined:failureOrigin(error,request.prompt), citationDiagnostics: error instanceof AIProviderValidationError ? error.citationDiagnostics : undefined, validationPaths: error instanceof AIProviderValidationError ? error.fieldPaths : undefined, claimValidation:error instanceof AIProviderValidationError?error.wikiClaimIssues:undefined, directoryValidation:directoryValidationCounts(error), ownershipValidation: error instanceof AIProviderValidationError ? error.wikiOwnershipDetails : undefined, errorCode: error instanceof DemoApiError || error instanceof AIProviderResponseError || error instanceof AIProviderHttpError || error instanceof AIProviderValidationError ? error.code : error instanceof TypeError ? "NETWORK_USAGE_UNKNOWN" : signal?.aborted ? "CANCELLED" : error instanceof Error && /Incomplete history field verification/u.test(error.message) ? "HISTORY_VERIFICATION_INCOMPLETE" : error instanceof Error && /(?:Invalid|Incomplete|Missing|changed stage identity).*?(?:history|version)|(?:History|Version).*?(?:Invalid|Incomplete|Missing|changed stage identity)/iu.test(error.message) ? "HISTORY_SCHEMA_INVALID" : error instanceof Error && /(?:evidence|quote|claim)/iu.test(error.message) ? "SOURCE_EVIDENCE_INVALID" : "STRUCTURE_OR_PROVIDER_ERROR", attempt: attempt + 1 }).catch(() => undefined);
          failure = error;
          if (["home_task_plan", "home_task_review"].includes(String(data?.presentation)) && error instanceof AIProviderValidationError) {
            homeValidationFields = (error.fieldPaths ?? []).filter(path => /^[a-zA-Z.[\]0-9_]{1,100}$/u.test(path)).slice(0, 8);
          }
          if (error instanceof AIProviderHttpError && error.status === 429 || error instanceof DemoApiError && ["RATE_LIMITED", "PROVIDER_BUSY"].includes(error.code)) this.concurrencyControl.rateLimited();
          signal?.throwIfAborted();
          // The transport reports a connection that failed before any response header, or the
          // provider answered busy (429, 503): nothing was produced, so nothing was billed. Quiet
          // resends with growing pauses, outside the validation attempts, instead of failing a
          // whole run the user would restart by hand. Without the transport's own report, or
          // after the window, billing is unknown and nothing is repeated.
          const sentFor = performance.now() - startedAt - (transport.queueMs ?? 0);
          // Only a request that asks for it is resent when busy, or more than once.
          const busy = Boolean(request.resendUnsent) && error instanceof AIProviderHttpError && (error.status === 429 || error.status === 503);
          if (quietResends < (request.resendUnsent ? NETWORK_RETRY_DELAYS_MS.length : 1) && (busy || networkResendable(error, transport, sentFor))) {
            const pause = busy ? Math.min(BUSY_RETRY_MAX_MS, Math.max(NETWORK_RETRY_DELAYS_MS[quietResends], (error as AIProviderHttpError).retryAfterMs ?? 0)) : NETWORK_RETRY_DELAYS_MS[quietResends];
            quietResends += 1;
            this.onRequestState?.("retrying");
            const backoffStarted=performance.now();
            await new Promise<void>((resolve, reject) => {
              const timer = globalThis.setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, pause * aiRetryTiming.scale);
              const onAbort = () => { globalThis.clearTimeout(timer); reject(signal?.reason); };
              signal?.addEventListener("abort", onAbort, { once: true });
            });
            lastBackoffMs=Math.round(performance.now()-backoffStarted);
            this.retries += 1;attempt -= 1;
            continue;
          }
          if (attempt < 1) {
            if (request.maxAttempts === 1) break;
            // History owns targeted extraction repair and format splitting.
            // A second whole-batch generation here would multiply that work.
            if (data?.presentation === "product_history" && !(error instanceof AIProviderHttpError) && !(error instanceof DemoApiError)) break;
            // Resending the entire source after a schema failure is another paid
            // generation, not a targeted repair. Let the user retry explicitly.
            const boundedRepair = focusTask && this.id !== "atlas-demo" && error instanceof AIProviderValidationError && typeof error.repairContent === "string";
            if (focusTask && !boundedRepair && (error instanceof DemoApiError ? error.code === "PROVIDER_INVALID_RESPONSE" : !(error instanceof AIProviderHttpError))) break;
            if (boundedRepair) {repairContent = (error as AIProviderValidationError).repairContent;repairFields=(error as AIProviderValidationError).repairFields;}
            if (error instanceof DemoApiError && (!TRANSIENT_DEMO_ERRORS.has(error.code) || error.code === "DEMO_UNAVAILABLE" && attempt > 0)) break;
            if (error instanceof DemoApiError && error.code === "PROVIDER_INVALID_RESPONSE" && request.taskType === "focus_session" && attempt > 0) break;
            if (error instanceof AIProviderHttpError && error.status !== 429) break;
            if (error instanceof AIProviderResponseError) break;
            if (error instanceof TypeError || error instanceof DOMException && error.name === "AbortError") break;
            if (!(error instanceof DemoApiError) && !(error instanceof AIProviderHttpError) && !(error instanceof TypeError) && attempt > 0) break;
            repairStructure = error instanceof DemoApiError ? error.code === "PROVIDER_INVALID_RESPONSE" : !(error instanceof AIProviderHttpError || error instanceof TypeError);
            this.onRequestState?.("retrying");
            const backoffMs = error instanceof DemoApiError
              ? error.status === 429 || error.code === "REQUEST_IN_PROGRESS" ? 1200 * (attempt + 1) : 500 * (attempt + 1)
              : error instanceof AIProviderHttpError
              ? Math.min(5000, error.retryAfterMs ?? (error.status === 429 ? 1000 : 400))
              : repairStructure ? 140 + Math.floor(Math.random() * 80) : 400;
            const backoffStarted=performance.now();
            await new Promise<void>((resolve, reject) => {
              signal?.throwIfAborted();
              const timer = globalThis.setTimeout(() => { signal?.removeEventListener("abort", onAbort); resolve(); }, backoffMs * aiRetryTiming.scale);
              const onAbort = () => { globalThis.clearTimeout(timer); reject(signal?.reason); };
              signal?.addEventListener("abort", onAbort, { once: true });
            });
            lastBackoffMs=Math.round(performance.now()-backoffStarted);
            this.retries += 1;
          }
        }
      }
      throw failure instanceof Error ? failure : new Error("Structured AI task failed after validation retry");
    };
    const promise = generate();
    const flight = { promise, signal, cacheIf: request.cacheIf };
    if (focusTask && !request.bypassCache) this.inFlight.set(flightKey, flight);
    try { return await promise; }
    finally { if (this.inFlight.get(flightKey) === flight) this.inFlight.delete(flightKey); }
  }
}

export function createAtlasAI(settings: AISettings, signal?: AbortSignal, runId?: string, onRequestState?: AIRequestStateListener): AtlasAI {
  settings = effectiveAISettings(settings);
  if (!hasAIConnection(settings)) throw new Error("请先连接自己的 AI API / Connect your AI API first.");
  const economy = settings.economyModel && settings.economyModel !== settings.model ? createAIProvider({ ...settings, model: settings.economyModel }) : undefined;
  return new DefaultAtlasAI(createAIProvider(settings), settings, signal, runId, onRequestState, economy);
}

export function createAtlasAIFromProvider(provider: AtlasAIProvider, settings: AISettings, signal?: AbortSignal, runId?: string, onRequestState?: AIRequestStateListener): AtlasAI {
  return new DefaultAtlasAI(provider, settings, signal, runId, onRequestState);
}
