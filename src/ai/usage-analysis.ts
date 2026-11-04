import {wikiQualityCsvMetrics,WIKI_QUALITY_CSV_COLUMNS} from "../shared/wiki-quality-metrics";
import {projectDocument} from "../export/project-document";
import {failuresByOrigin,isSentUsage,usageFailureOrigin} from "./failure-origin";
import { aiFeatureLabel, usageFeature } from "./ai-diagnostics";
import { analyzeAILifecycle, aiRequestExport } from "./lifecycle-analysis";
import type { AIUsageEvent, AnalysisDiagnostics, OrganizationRun } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";

export interface OrganizationAnalysis {
  wikiQuality?:ReturnType<typeof wikiQualityCsvMetrics>;
  failuresByOrigin:ReturnType<typeof failuresByOrigin>;
  /** Provider prompt-cache reads; undefined when no request reported them. */
  cachedInputTokens?: number;
  /** Local estimate divided by provider-reported input, over requests with both. */
  estimateRatio?: number;
  estimateRatioByStage?: Array<{stage:string;requests:number;estimated:number;actual:number;ratio:number}>;
  /** Writing requests stopped by the local pre-send check, without a paid call. */
  preflightBlocks: number;
  /** Models that served paid requests in each stage, to confirm economy/main routing. */
  modelsByStage?: Array<{stage:string;models:string[]}>;
  /** Frozen writing input scale (1 = uncalibrated). */
  writingInputScale?: number;
  lifecycle: ReturnType<typeof analyzeAILifecycle>;
  byStage?: Array<{stage:string;requests:number;cacheHits:number;failed:number;inputTokens:number;outputTokens:number;durationMs:number;timed:number;unavailable:number}>;
  run: OrganizationRun;
  diagnostics?: AnalysisDiagnostics;
  synthetic?: boolean;
  statusScope: "wiki" | "run";
  outcomes?: { wiki: "ready"; architecture: "ready" | "failed" | "unavailable"; history: "ready" | "failed" | "partial" | "unavailable" };
  readingCacheHits?: number;
  cacheHits: number;
  embeddingTokens: number;
  costCny: number;
  pendingCostCny: number;
  unpricedRequests: number;
  requests: number;
  failedRequests: number;
  retries: number;
  recoveryRequests: number;
  recoveryReservedOutputTokens: number;
  generationAttempts: number;
  latestGenerationMs?: number;
  requestQueueMs?: number;
  maxSchedulingMs?: number;
  inputTokens: number;
  outputTokens: number;
  providerTokens: number;
  estimatedTokens: number;
  unavailableRequests: number;
  requestDurationMs: number;
  elapsedMs?: number;
  elapsedScope?: "latest_generation" | "run";
  firstReadableMs?: number;
  queueMs?: number;
  timedRequests: number;
  models: string[];
  errorCodes: string[];
  requestIds: string[];
  stages: string[];
  taskVersions: string[];
  failures: Array<{ directoryValidation?:AIUsageEvent["directoryValidation"];claimValidation?:AIUsageEvent["claimValidation"];origin?:AIUsageEvent["failureOrigin"];code: string; requestId?: string; stage?: string; durationMs?: number; citationDiagnostics?: AIUsageEvent["citationDiagnostics"]; validationPaths?: string[]; ownershipValidation?:AIUsageEvent["ownershipValidation"] }>;
  observedRequestSpanMs?: number;
  focusCoverage?: FocusSession["coverage"];
  focusPlan?: AIUsageEvent["coveragePlan"];
  sentInputTokensEstimate: number;
  requestTransport: Array<{ taskType: AIUsageEvent["taskType"]; stage?: string; requestId?: string; durationMs?: number; estimatedInputTokens?: number; tokenEstimateVersion?: string; actualInputTokens?: number; actualOutputTokens?: number; tokenSource?: AIUsageEvent["tokenSource"]; costCny?: number; responseHeadersMs?: number; firstTokenMs?: number; receivedCharacters?: number; reasoningCharacters?: number; reasoningTokens?: number; outputTokenLimit?: number; finishReason?: string; timeoutStage?: string; streaming?: boolean }>;
  byTask: Array<{ feature?:import("./ai-diagnostics").AIFeature; task: AIUsageEvent["taskType"]; requests: number; tokens: number; durationMs: number }>;
}

function inferredStatus(usage: AIUsageEvent[]): "failed" | "completed" {
  const unresolved=usage.filter(event=>event.status==="failed"&&!usage.some(next=>next.status!=="failed"&&event.operationId&&next.operationId===event.operationId&&next.attempt>event.attempt&&next.createdAt>=event.createdAt));
  const failure = Math.max(0, ...unresolved.map(event => event.createdAt));
  // A later sibling writing batch cannot resolve another batch's failure.
  // Whole-run success needs a saved result or an explicit pipeline completion.
  if(unresolved.some(event=>event.taskType==="focus_session"&&event.stage?.endsWith(":final")))return "failed";
  const final = usage.some(event => event.taskType === "focus_session" && event.stage?.endsWith(":final") && event.status !== "failed" && event.createdAt >= failure);
  return failure && !final ? "failed" : "completed";
}

/** documentMetrics builds each saved Wiki's full export for the CSV quality columns.
 * It is the expensive part; the diagnostics view leaves it to the CSV download. */
export function analyzeOrganizationRuns(runs: OrganizationRun[], events: AIUsageEvent[], diagnostics: AnalysisDiagnostics[], focusSessions: FocusSession[] = [], options: { documentMetrics?: boolean } = {}): OrganizationAnalysis[] {
  const documentMetrics = options.documentMetrics ?? true;
  // Keep the exported pipeline ledger consistent with the metrics calculated
  // here, even if a live run appends another span before the user exports.
  runs=runs.map(run=>({...run,...(run.pipelineSpans?{pipelineSpans:run.pipelineSpans.map(span=>({...span,...(span.counts?{counts:{...span.counts}}:{})}))}:{})}));
  const focusByRun = new Map(focusSessions.filter((item) => item.runId).map((item) => [item.runId!, item]));
  const eventsByRun = new Map<string, AIUsageEvent[]>();
  for (const event of events) {
    const runId=event.runId??`request:${event.id}`;
    const group = eventsByRun.get(runId) ?? [];
    group.push(event);
    eventsByRun.set(runId, group);
  }
  const diagnosticsByRun = new Map<string, AnalysisDiagnostics[]>();
  for (const item of diagnostics) if (item.runId) diagnosticsByRun.set(item.runId, [...diagnosticsByRun.get(item.runId) ?? [], item]);
  const knownIds = new Set(runs.map((run) => run.id));
  const synthetic: OrganizationRun[] = [...eventsByRun].filter(([id]) => !knownIds.has(id)).map(([id, usage]) => ({ id, title: usage.some((event) => event.taskType === "focus_session") ? "目标阅读与查找 / Goal reading" : usage.every((event) => event.taskType === "embedding") ? "语义索引 / Semantic index" : `${aiFeatureLabel(usageFeature(usage[0]),true)} / ${aiFeatureLabel(usageFeature(usage[0]),false)}`, targetType: "conversation", targetIds: [...new Set(usage.flatMap((event) => event.conversationIds))], startedAt: Math.min(...usage.map((event) => event.requestStartedAt ?? event.createdAt)), updatedAt: Math.max(...usage.map((event) => event.createdAt)), status: inferredStatus(usage), stage: "proposal_ready", progress: 100, events: [] }));
  return [...runs, ...synthetic].sort((a, b) => b.startedAt - a.startedAt).map((run) => {
    const focus = focusByRun.get(run.id);
    const usage = eventsByRun.get(run.id) ?? [];
    const requests = usage.filter((event) => isSentUsage(event));
    const tasks = new Map<string, { feature?:import("./ai-diagnostics").AIFeature; task: AIUsageEvent["taskType"]; requests: number; tokens: number; durationMs: number }>();
    for (const event of usage) {
      const feature=usageFeature(event), key=event.taskType==="other"?`${feature}:other`:event.taskType;
      const task = tasks.get(key) ?? {...(event.taskType==="other"?{feature}:{}), task: event.taskType, requests: 0, tokens: 0, durationMs: 0 };
      task.requests += Number(isSentUsage(event));
      task.tokens += event.inputTokens + event.outputTokens + (event.embeddingTokens ?? 0);
      task.durationMs += event.durationMs ?? 0;
      tasks.set(key, task);
    }
    const fragments = diagnosticsByRun.get(run.id) ?? [];
    const stages=new Map<string,NonNullable<OrganizationAnalysis["byStage"]>[number]>();
    for(const event of usage){const name=event.stage??"unclassified",stage=stages.get(name)??{stage:name,requests:0,cacheHits:0,failed:0,inputTokens:0,outputTokens:0,durationMs:0,timed:0,unavailable:0};if(event.status==="cached")stage.cacheHits++;else{stage.requests+=Number(isSentUsage(event));stage.failed+=Number(event.status==="failed");stage.inputTokens+=event.inputTokens;stage.outputTokens+=event.outputTokens;stage.unavailable+=Number(event.tokenSource==="unavailable");if(event.durationMs!==undefined){stage.durationMs+=event.durationMs;stage.timed++;}}stages.set(name,stage);}
    const latest = [...fragments].sort((a, b) => b.createdAt - a.createdAt)[0];
    const sum = (field: keyof AnalysisDiagnostics) => fragments.reduce((total, item) => total + (typeof item[field] === "number" ? item[field] as number : 0), 0);
    const combined = fragments.length <= 1 ? latest : latest && {
      ...latest,
      questionsAnalyzed: sum("questionsAnalyzed"), cachedQuestionsReused: sum("cachedQuestionsReused"),
      rawMessagesLoaded: sum("rawMessagesLoaded"), aiRequests: sum("aiRequests"), questionCount: sum("questionCount"),
      schemaFailures: sum("schemaFailures"), topicCount: sum("topicCount"), relationCount: sum("relationCount"),
      compressionRatio: fragments.find((item) => item.compressionRatio !== undefined)?.compressionRatio,
    };
    const generations=(run.pipelineSpans??[]).filter(span=>span.phase==="wiki:generation").sort((a,b)=>a.startedAt-b.startedAt);
    const generationStart=run.executionStartedAt??generations[0]?.startedAt;
    const generationEnd=generations.length?Math.max(...generations.map(span=>span.startedAt+span.durationMs)):undefined;
    const ready=run.readyAt??(run.projectAnalysis?run.completedAt:undefined)??generationEnd;
    const runElapsed=generationStart!==undefined&&ready!==undefined?Math.max(0,ready-generationStart):undefined;
    const latestGenerationMs=focus?.coverage?.elapsedMs??generations.at(-1)?.durationMs;
    const recoveries=requests.filter(event=>event.recoveryReason!==undefined);
    return {
      wikiQuality:documentMetrics&&focus?.sections.some(section=>section.body.trim())?wikiQualityCsvMetrics(projectDocument(focus,{overview:true,wikiIds:focus.sections.map(section=>section.id),matters:false,history:false,sources:false},"md").text):undefined,
      failuresByOrigin:failuresByOrigin(usage),
      lifecycle:analyzeAILifecycle(usage),
      byStage:[...stages.values()],
      run: focus ? { ...run, status: "completed" as const } : run.diagnosticOnly ? {...run,status:run.pipelineSpans?.some(span=>span.status==="failed"&&!run.pipelineSpans?.some(next=>next.phase===span.phase&&next.status==="completed"&&next.startedAt>=span.startedAt))?"failed" as const:run.pipelineSpans?.some(span=>span.phase==="wiki:generation"&&span.status==="completed"&&!usage.some(event=>event.status==="failed"&&event.createdAt>span.startedAt+span.durationMs))?"completed" as const:inferredStatus(usage)} : run,
      statusScope: focus ? "wiki" as const : "run" as const,
      outcomes: focus ? { wiki: "ready" as const, architecture: focus.projectStateAnalysis?.status === "failed" ? "failed" as const : focus.projectState ? "ready" as const : "unavailable" as const, history: focus.projectHistoryStatus?.status ?? (focus.projectHistoryAnalysis ? "ready" as const : "unavailable" as const) } : undefined,
      focusCoverage: focus?.coverage,
      focusPlan: usage.flatMap((event) => event.coveragePlan ? [event.coveragePlan] : []).sort((a, b) => b.plannedBatches - a.plannedBatches)[0],
      sentInputTokensEstimate: usage.filter((event) => isSentUsage(event)).reduce((sum, event) => sum + (event.estimatedInputTokens ?? 0), 0),
      requestTransport: usage.filter((event) => isSentUsage(event)).map((event) => ({ taskType: event.taskType, stage: event.stage, requestId: event.requestId, durationMs: event.durationMs, estimatedInputTokens: event.estimatedInputTokens, tokenEstimateVersion: event.tokenEstimateVersion, actualInputTokens: event.tokenSource === "provider" ? event.inputTokens : undefined, actualOutputTokens: event.tokenSource === "provider" ? event.outputTokens : undefined, tokenSource: event.tokenSource, costCny: event.costCny, responseHeadersMs: event.responseHeadersMs, firstTokenMs: event.firstTokenMs, receivedCharacters: event.receivedCharacters, reasoningCharacters: event.reasoningCharacters, reasoningTokens: event.reasoningTokens, outputTokenLimit: event.outputTokenLimit, finishReason: event.finishReason, timeoutStage: event.timeoutStage, streaming: event.streaming })),
      synthetic: !knownIds.has(run.id)||Boolean(run.diagnosticOnly),
      readingCacheHits: usage.filter(event=>event.status==="cached"&&event.cacheLayer==="result"&&event.taskType==="focus_session"&&event.stage==="reading").length,
      cacheHits: usage.filter((event) => event.status === "cached").length,
      embeddingTokens: usage.reduce((sum, event) => sum + (event.embeddingTokens ?? 0), 0),
      costCny: usage.reduce((sum, event) => sum + (event.costCny ?? 0), 0),
      pendingCostCny: usage.reduce((sum, event) => sum + (event.pendingCostCny ?? 0), 0),
      unpricedRequests: usage.filter((event) => isSentUsage(event) && event.costCny === undefined).length,
      diagnostics: combined,
      requests: usage.filter((event) => isSentUsage(event)).length,
      failedRequests: usage.filter((event) => event.status === "failed").length,
      retries: requests.filter((event) => event.attempt > 1).length,
      recoveryRequests: recoveries.length,
      recoveryReservedOutputTokens: recoveries.reduce((sum,event)=>sum+(event.outputTokenLimit??0),0),
      generationAttempts: generations.length,
      latestGenerationMs,
      requestQueueMs: requests.some(event=>event.queueMs!==undefined)?requests.reduce((sum,event)=>sum+(event.queueMs??0),0):undefined,
      maxSchedulingMs: requests.some(event=>event.schedulingMs!==undefined)?Math.max(...requests.map(event=>event.schedulingMs??0)):undefined,
      inputTokens: usage.reduce((sum, event) => sum + event.inputTokens, 0),
      ...estimateMetrics(requests),
      cachedInputTokens: requests.some(event=>event.cachedInputTokens!==undefined)?requests.reduce((sum,event)=>sum+(event.cachedInputTokens??0),0):undefined,
      preflightBlocks: Math.max(usage.filter(event=>event.requestSent===false&&event.errorCode?.startsWith("WIKI_PREFLIGHT_")).length,(run.pipelineSpans??[]).filter(span=>span.phase==="wiki:preflight").length),
      modelsByStage: modelsByStage(requests),
      writingInputScale: (()=>{const span=[...run.pipelineSpans??[]].reverse().find(item=>item.phase==="wiki:writing-calibration"),value=Number(span?.reason?.replace(/^scale=/u,""));return Number.isFinite(value)&&value>0?value:undefined;})(),
      outputTokens: usage.reduce((sum, event) => sum + event.outputTokens, 0),
      providerTokens: usage.filter((event) => event.tokenSource === "provider").reduce((sum, event) => sum + event.inputTokens + event.outputTokens + (event.embeddingTokens ?? 0), 0),
      estimatedTokens: usage.filter((event) => event.tokenSource === "estimated").reduce((sum, event) => sum + event.inputTokens + event.outputTokens + (event.embeddingTokens ?? 0), 0),
      unavailableRequests: usage.filter((event) => event.tokenSource === "unavailable").length,
      elapsedMs: runElapsed??latestGenerationMs,
      elapsedScope: runElapsed!==undefined?"run":latestGenerationMs!==undefined?"latest_generation":undefined,
      firstReadableMs: generationStart !== undefined && run.firstReadableAt !== undefined ? Math.max(0, run.firstReadableAt - generationStart) : undefined,
      queueMs: run.executionStartedAt !== undefined ? Math.max(0, run.executionStartedAt - run.startedAt) : undefined,
      requestDurationMs: usage.reduce((sum, event) => sum + (event.durationMs ?? 0), 0),
      timedRequests: usage.filter((event) => event.durationMs !== undefined && isSentUsage(event)).length,
      models: [...new Set(usage.map((event) => `${event.providerId}/${event.modelId}`))],
      errorCodes: [...new Set([...usage.flatMap((event) => event.errorCode ? [event.errorCode] : []),...(run.pipelineSpans??[]).flatMap(span=>span.status==="failed"&&span.reason&&/^PROVIDER_[A-Z_a-z0-9]+$/u.test(span.reason)?[span.reason]:[])])],
      requestIds: [...new Set(usage.flatMap((event) => event.requestId ? [event.requestId] : []))],
      stages: [...new Set(usage.flatMap((event) => event.stage ? [event.stage] : []))],
      taskVersions: [...new Set(usage.flatMap((event) => event.taskVersion ? [event.taskVersion] : []))],
      failures: [...usage.filter((event) => event.status === "failed").map((event) => {
        const {ownershipValidation,claimValidation,directoryValidation}=aiRequestExport([event])[0];
        return {...(directoryValidation?{directoryValidation}:{}),...(claimValidation?{claimValidation}:{}),...(usageFailureOrigin(event)?{origin:usageFailureOrigin(event)}:{}),code:event.errorCode??"UNKNOWN",requestId:event.requestId,stage:event.stage,durationMs:event.durationMs,...(event.citationDiagnostics?{citationDiagnostics:event.citationDiagnostics}:{}),...(event.validationPaths?{validationPaths:event.validationPaths}:{}),...(ownershipValidation?{ownershipValidation}:{})};
      }),...(run.pipelineSpans??[]).flatMap(span=>span.status==="failed"&&span.reason&&/^PROVIDER_[A-Z_a-z0-9]+$/u.test(span.reason)&&!usage.some(event=>event.errorCode===span.reason)?[{code:span.reason,stage:span.phase,durationMs:span.durationMs}]:[])],
      observedRequestSpanMs: requests.length && requests.every((event) => event.requestStartedAt !== undefined) ? Math.max(0, Math.max(...requests.map((event) => event.createdAt)) - Math.min(...requests.map((event) => event.requestStartedAt!))) : undefined,
      byTask: [...tasks.values()].sort((a, b) => b.tokens - a.tokens),
    };
  });
}

function modelsByStage(requests: AIUsageEvent[]) {
  const stages = new Map<string, Set<string>>();
  for (const event of requests) { const stage = event.stage ?? event.taskType; stages.set(stage, (stages.get(stage) ?? new Set()).add(`${event.providerId}/${event.modelId}`)); }
  return stages.size ? [...stages].map(([stage, models]) => ({ stage, models: [...models] })) : undefined;
}

/** Estimate accuracy only where the provider reported real input tokens. */
function estimateMetrics(requests: AIUsageEvent[]) {
  const comparable = requests.filter(event => event.tokenSource === "provider" && (event.estimatedInputTokens ?? 0) > 0 && event.inputTokens > 0);
  if (!comparable.length) return {};
  const stages = new Map<string, { stage: string; requests: number; estimated: number; actual: number; ratio: number }>();
  for (const event of comparable) {
    const stage = event.stage ?? event.taskType, row = stages.get(stage) ?? { stage, requests: 0, estimated: 0, actual: 0, ratio: 0 };
    row.requests++; row.estimated += event.estimatedInputTokens!; row.actual += event.inputTokens; stages.set(stage, row);
  }
  const round = (value: number) => Math.round(value * 100) / 100;
  const estimated = comparable.reduce((sum, event) => sum + event.estimatedInputTokens!, 0), actual = comparable.reduce((sum, event) => sum + event.inputTokens, 0);
  return { estimateRatio: round(estimated / actual), estimateRatioByStage: [...stages.values()].map(row => ({ ...row, ratio: round(row.estimated / row.actual) })) };
}

function csvCell(value: string | number | undefined): string {
  const raw = String(value ?? "");
  const text = /^[=+\-@\t\r]/u.test(raw) ? `'${raw}` : raw;
  return `"${text.replace(/"/gu, '""')}"`;
}

export function organizationAnalysisCsv(rows: OrganizationAnalysis[]): string {
  const headers = ["run_id", "started_at", "target_type", "conversation_count", "status", "models", "requests", "failed_requests", "retries", "input_tokens", "output_tokens", "provider_tokens", "estimated_tokens", "unavailable_requests", "request_duration_ms", "timed_requests", "questions_analyzed", "cached_questions", "schema_failures", "unsupported_relation_rate", "needs_review_rate", "compression_ratio", "score", "cache_hits", "embedding_tokens", "usage_cost_cny", "pending_cost_cny", "unpriced_requests", "elapsed_ms", "first_readable_ms", "queue_ms", "error_codes", "request_ids", "stages", "task_versions", "observed_request_span_ms", "failed_request_details", "coverage_method", "source_characters", "material_blocks", "planned_batches", "planned_coverage_method", "sent_input_tokens_estimate", "request_transport_details", "elapsed_scope", "retry_scope", "status_scope", "wiki_status", "architecture_status", "history_status", "project_analysis_kind", "phase_timings", "reused_analysis_results", "reviewed_wiki_references", "request_stage_metrics", "request_lifecycle", "bottleneck_signals", "local_pipeline_spans", "latest_generation_ms", "generation_attempts", "recovery_requests", "recovery_reserved_output_tokens", "request_queue_ms", "max_scheduling_ms", "first_readable_scope", "request_metrics_scope", "cached_input_tokens", "estimate_to_actual_input_ratio", "estimate_ratio_by_stage", "preflight_blocks", "writing_input_scale", "models_by_stage", "failures_by_origin", "reading_cache_hits",...WIKI_QUALITY_CSV_COLUMNS];
  const lines = rows.map(({ run, diagnostics, ...metrics }) => [run.id, new Date(run.startedAt).toISOString(), run.targetType, run.targetIds.length, run.status, metrics.models.join(";"), metrics.requests, metrics.failedRequests, metrics.retries, metrics.inputTokens, metrics.outputTokens, metrics.providerTokens, metrics.estimatedTokens, metrics.unavailableRequests, metrics.requestDurationMs, metrics.timedRequests, diagnostics?.questionsAnalyzed, diagnostics?.cachedQuestionsReused, diagnostics?.schemaFailures, diagnostics?.unsupportedRelationRate, diagnostics?.needsReviewRate, diagnostics?.compressionRatio, run.evaluation?.score || undefined, metrics.cacheHits, metrics.embeddingTokens, metrics.unpricedRequests && !metrics.costCny ? undefined : metrics.costCny, metrics.pendingCostCny, metrics.unpricedRequests, metrics.elapsedMs, metrics.firstReadableMs, metrics.queueMs, metrics.errorCodes.join(";"), metrics.requestIds.join(";"), metrics.stages.join(";"), metrics.taskVersions.join(";"), metrics.observedRequestSpanMs, JSON.stringify(metrics.failures), metrics.focusCoverage?.method, metrics.focusCoverage?.sourceCharacters ?? metrics.focusPlan?.sourceCharacters, metrics.focusCoverage?.processedSegments ?? metrics.focusPlan?.materialBlocks, metrics.focusCoverage?.batchCount ?? metrics.focusPlan?.plannedBatches, metrics.focusPlan?.method, metrics.sentInputTokensEstimate, JSON.stringify(metrics.requestTransport), metrics.elapsedScope, "automatic", metrics.statusScope, metrics.outcomes?.wiki, metrics.outcomes?.architecture, metrics.outcomes?.history, run.projectAnalysis?.kind, run.projectAnalysis ? JSON.stringify(run.projectAnalysis.phases) : undefined, run.projectAnalysis?.reusedRequests, run.projectAnalysis?.reusedWikiSections, JSON.stringify(metrics.byStage),JSON.stringify(aiRequestExport(metrics.lifecycle.events)),metrics.lifecycle.findings.join(";"),JSON.stringify(run.pipelineSpans??[]),metrics.latestGenerationMs,metrics.generationAttempts,metrics.recoveryRequests,metrics.recoveryReservedOutputTokens,metrics.requestQueueMs,metrics.maxSchedulingMs,metrics.firstReadableMs===undefined?undefined:"run","run",metrics.cachedInputTokens,metrics.estimateRatio,metrics.estimateRatioByStage?JSON.stringify(metrics.estimateRatioByStage):undefined,metrics.preflightBlocks,metrics.writingInputScale,metrics.modelsByStage?JSON.stringify(metrics.modelsByStage):undefined,JSON.stringify(metrics.failuresByOrigin),metrics.readingCacheHits,...WIKI_QUALITY_CSV_COLUMNS.map(column=>metrics.wikiQuality?.[column])].map(csvCell).join(","));
  return `\uFEFF${headers.map(csvCell).join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
}

/** Only measured, completed organization work; never substitute summed parallel time. */
export function organizationLatency(rows: OrganizationAnalysis[]) {
  const complete = rows.filter((row) => row.run.targetType === "conversation" && !row.run.projectAnalysis && !row.synthetic && row.elapsedMs !== undefined);
  const percentile = (values: number[], p: number) => values.length ? [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1] : undefined;
  const elapsed = complete.map((row) => row.elapsedMs!);
  const readable = complete.flatMap((row) => row.firstReadableMs === undefined ? [] : [row.firstReadableMs]);
  return { count: complete.length, p50: percentile(elapsed, .5), p95: percentile(elapsed, .95), firstReadableP50: percentile(readable, .5) };
}
