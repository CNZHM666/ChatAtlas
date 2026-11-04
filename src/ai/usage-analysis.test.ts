import { describe, expect, it } from "vitest";
import type { AIUsageEvent, AnalysisDiagnostics, OrganizationRun } from "../shared/types";
import type { FocusSession } from "../shared/focus-session";
import { analyzeOrganizationRuns, organizationAnalysisCsv } from "./usage-analysis";

const run: OrganizationRun = { id: "run-1", title: "Private conversation title", targetType: "conversation", targetIds: ["private-id"], startedAt: 1000, updatedAt: 1000, status: "waiting_review", stage: "proposal_ready", progress: 100, events: [], evaluation: { score: 4, note: "Private reviewer note" } };
const event = (id: string, fields: Partial<AIUsageEvent>): AIUsageEvent => ({ id, createdAt: 1000, runId: run.id, taskType: "question_snapshot", providerId: "openai", modelId: "test", conversationIds: ["private-id"], inputTokens: 100, outputTokens: 20, tokenSource: "provider", status: "completed", attempt: 1, durationMs: 400, ...fields });
const diagnostic: AnalysisDiagnostics = { id: "diagnostic-1", runId: run.id, createdAt: 1000, questionsAnalyzed: 2, cachedQuestionsReused: 3, rawMessagesLoaded: 2, aiRequests: 2, estimatedInputTokens: 0, estimatedOutputTokens: 0, relationsVerified: 0, bridgesGenerated: 0, questionCount: 5, topicCount: 2, relationCount: 1, bridgeCount: 0, schemaFailures: 1 };

describe("organization usage analysis", () => {
  it("snapshots pipeline spans so a later live update cannot disagree with exported attempt counts",()=>{
    const input={...run,pipelineSpans:[{id:"generation-1",feature:"wiki" as const,phase:"wiki:generation",startedAt:1000,durationMs:100,status:"failed" as const,reason:"PROVIDER_SCHEMA_invalid_wiki_claim"}]};
    const rows=analyzeOrganizationRuns([input],[],[]);
    input.pipelineSpans.push({...input.pipelineSpans[0],id:"generation-2",startedAt:2000});
    expect(rows[0].generationAttempts).toBe(1);expect(rows[0].run.pipelineSpans).toHaveLength(1);
    expect(organizationAnalysisCsv(rows)).not.toContain("generation-2");
  });
  it("keeps whole-run and latest-generation clocks separate and counts repairs outside request retries",()=>{
    const task={...run,executionStartedAt:1000,firstReadableAt:3500,pipelineSpans:[
      {id:"first",feature:"wiki" as const,phase:"wiki:generation",status:"failed" as const,startedAt:1000,durationMs:1000},
      {id:"second",feature:"wiki" as const,phase:"wiki:generation",status:"completed" as const,startedAt:3000,durationMs:800},
    ]};
    const repair=event("repair",{operationId:"repair",recoveryReason:"schema",recoveryDepth:1,outputTokenLimit:2400,queueMs:25,schedulingMs:500});
    const rows=analyzeOrganizationRuns([task],[repair,event("retry",{attempt:2})],[]);
    expect(rows[0]).toMatchObject({elapsedMs:2800,elapsedScope:"run",latestGenerationMs:800,firstReadableMs:2500,generationAttempts:2,recoveryRequests:1,recoveryReservedOutputTokens:2400,retries:1,requestQueueMs:25,maxSchedulingMs:500});
    const csv=organizationAnalysisCsv(rows);for(const header of ["latest_generation_ms","generation_attempts","recovery_requests","recovery_reserved_output_tokens","first_readable_scope","request_metrics_scope"])expect(csv).toContain(header);
  });
  it("does not report a failed writing batch as completed when an unrelated in-flight batch finishes later",()=>{
    const failed=event("failed-write",{taskType:"focus_session",stage:"synthesis:final",operationId:"failed-batch",status:"failed",createdAt:2000});
    const sibling=event("sibling-write",{taskType:"focus_session",stage:"synthesis:final",operationId:"sibling-batch",status:"completed",createdAt:3000});
    expect(analyzeOrganizationRuns([], [failed,sibling],[])[0].run.status).toBe("failed");
    const complete={...run,diagnosticOnly:true,pipelineSpans:[{id:"pipeline",feature:"wiki" as const,phase:"wiki:generation",status:"completed" as const,startedAt:1000,durationMs:3000}]};
    expect(analyzeOrganizationRuns([complete],[failed,sibling],[])[0].run.status).toBe("completed");
    expect(analyzeOrganizationRuns([complete],[failed,sibling,{...failed,id:"later",createdAt:5000}],[])[0].run.status).toBe("failed");
  });
  it("exports local convergence failure counts without inventing failed provider requests",()=>{
    const code="PROVIDER_SCHEMA_wiki_directory_no_convergence",span={id:"local-validation",feature:"wiki" as const,phase:"wiki:topic-planning",startedAt:20,durationMs:3,status:"failed" as const,reason:code,counts:{candidateCount:12,convergenceCount:1}};
    const localRun={...run,status:"completed" as const,diagnosticOnly:true,pipelineSpans:[span]};const rows=analyzeOrganizationRuns([localRun],[event("response",{status:"completed",createdAt:19})],[]);
    expect(rows[0].run.status).toBe("failed");expect(rows[0].requests).toBe(1);expect(rows[0].failedRequests).toBe(0);expect(rows[0].errorCodes).toContain(code);expect(rows[0].failures).toContainEqual({code,stage:"wiki:topic-planning",durationMs:3});expect(organizationAnalysisCsv(rows)).toContain("candidateCount");
    const resolved={...localRun,pipelineSpans:[span,{...span,id:"later",startedAt:30,status:"completed" as const,reason:undefined}]};expect(analyzeOrganizationRuns([resolved],[event("next",{createdAt:31})],[])[0].run.status).toBe("completed");
  });
  it("exports per-stage metrics and cache-only attempt time without leaking a pending project draft",()=>{
    const draftRun={...run,executionStartedAt:1000,readyAt:1600,projectAnalysis:{kind:"architecture" as const,sessionId:"p",phases:[{phase:"verifying",startedAt:1000,finishedAt:1600,completed:2,total:2}],reusedRequests:1,reusedWikiSections:2},projectStateDraft:{summary:"private pending source body"} as FocusSession["projectState"]};
    const rows=analyzeOrganizationRuns([draftRun],[event("e",{stage:"project:verify",durationMs:600}),event("cached",{stage:"project:verify",status:"cached",durationMs:0,inputTokens:0,outputTokens:0})],[]);
    expect(rows[0].elapsedMs).toBe(600);expect(rows[0].byStage).toEqual([expect.objectContaining({stage:"project:verify",requests:1,cacheHits:1,durationMs:600})]);
    const csv=organizationAnalysisCsv(rows);expect(csv).toContain("phase_timings");expect(csv).toContain("request_stage_metrics");expect(csv).not.toContain("private pending source body");
  });
  it("separates a readable Wiki from failed architecture and incomplete history, with safe schema paths", () => {
    const focus: FocusSession = { id: "partial-product", runId: run.id, goal: "private", mode: "work", title: "private", sourceConversationIds: [], evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 1, updatedAt: 1, projectStateAnalysis: { status: "failed", error: "private source content" }, projectHistoryStatus: { status: "partial" } };
    const rows = analyzeOrganizationRuns([run], [event("missing-text", { status: "failed", errorCode: "PROVIDER_SCHEMA_missing_section_text", validationPaths: ["sections[0].body"] })], [], [focus]);
    expect(rows[0]).toMatchObject({ statusScope: "wiki", outcomes: { wiki: "ready", architecture: "failed", history: "partial" } });
    const csv = organizationAnalysisCsv(rows);
    expect(csv).toContain("architecture_status"); expect(csv).toContain("sections[0].body");
    expect(csv).not.toContain("private source content");
  });
  it("exports reasoning exhaustion counts and the actual output cap for diagnosis", () => {
    const rows = analyzeOrganizationRuns([run], [event("reasoning-limit", { status: "failed", receivedCharacters: 0, reasoningCharacters: 4500, reasoningTokens: 1200, outputTokenLimit: 1200, finishReason: "length" })], []);
    expect(rows[0].requestTransport[0]).toMatchObject({ receivedCharacters: 0, reasoningCharacters: 4500, reasoningTokens: 1200, outputTokenLimit: 1200, finishReason: "length" });
    expect(organizationAnalysisCsv(rows)).toContain("reasoningTokens");
  });
  it("reports a recovered final generation as completed while retaining failed request receipts", () => {
    const failed = event("failed", { taskType: "focus_session", status: "failed", stage: "reading", createdAt: 2000 });
    const final = event("final", { taskType: "focus_session", stage: "synthesis:final", createdAt: 3000 });
    const result = analyzeOrganizationRuns([], [final, failed], [])[0];
    expect(result.run.status).toBe("completed"); expect(result.failedRequests).toBe(1);
    expect(result.requestTransport[0].taskType).toBe("focus_session");
    expect(analyzeOrganizationRuns([], [final, { ...failed, createdAt: 4000 }], [])[0].run.status).toBe("failed");
    expect(analyzeOrganizationRuns([], [failed], [])[0].run.status).toBe("failed");
    expect(analyzeOrganizationRuns([], [failed, { ...final, status: "cached" }], [])[0].run.status).toBe("completed");
  });
  it("recovers only the same operation after a failed attempt and keeps unrelated failures visible", () => {
    const failed = event("first", { status:"failed", operationId:"op-a", createdAt:2000, attempt:1 });
    const retry = event("retry", { operationId:"op-a", createdAt:3000, attempt:2 });
    const rows = analyzeOrganizationRuns([], [failed,retry], []);
    expect(rows[0].run.status).toBe("completed");expect(rows[0].failedRequests).toBe(1);
    expect(analyzeOrganizationRuns([], [failed,{...retry,operationId:"op-b"}], [])[0].run.status).toBe("failed");
    expect(analyzeOrganizationRuns([], [failed,{...retry,attempt:1}], [])[0].run.status).toBe("failed");
  });
  it("exports an unknown price as blank instead of claiming a free request", () => {
    const rows = analyzeOrganizationRuns([run], [event("unpriced", {})], []);
    const csv = organizationAnalysisCsv(rows).split("\n");
    const headings = csv[0].split(",").map((value) => value.replaceAll('"', ""));
    const cells = csv[1].split(",");
    expect(cells[headings.indexOf("usage_cost_cny")]).toBe('""');
    expect(rows[0].unpricedRequests).toBe(1);
  });
  it("exports citation counts and paths without source text or source identifiers", () => {
    const citationDiagnostics = { allowedEvidenceCount: 8, unknownEvidenceCount: 1, citationPaths: ["sections[0]"] };
    const rows = analyzeOrganizationRuns([run], [event("bad-citation", { status: "failed", errorCode: "PROVIDER_SCHEMA_unknown_evidence_id", citationDiagnostics })], []);
    expect(rows[0].failures[0].citationDiagnostics).toEqual(citationDiagnostics);
    const csv = organizationAnalysisCsv(rows);
    expect(csv).toContain("sections[0]");
    expect(csv).not.toContain("private-id");
  });
  it("keeps source plans and transport timings for failed runs without inventing billed usage", () => {
    const rows = analyzeOrganizationRuns([], [event("timeout-plan", { status: "failed", tokenSource: "unavailable", inputTokens: 0, outputTokens: 0, errorCode: "PROVIDER_TIMEOUT", stage: "reading", responseHeadersMs: 20, firstTokenMs: 350, receivedCharacters: 450, streaming: true, timeoutStage: "stream_idle", estimatedInputTokens: 7500,
      coveragePlan: { method: "full_batched", sourceCharacters: 56000, materialBlocks: 30, plannedBatches: 9 } })], []);
    expect(rows[0]).toMatchObject({ unavailableRequests: 1, providerTokens: 0, sentInputTokensEstimate: 7500, focusPlan: { sourceCharacters: 56000, plannedBatches: 9 } });
    expect(rows[0].focusCoverage).toBeUndefined();
    const csv = organizationAnalysisCsv(rows);
    expect(csv).toContain('"56000"'); expect(csv).toContain("stream_idle"); expect(csv).toContain("firstTokenMs");
    expect(csv).not.toContain("Private conversation title"); expect(csv).not.toContain("private-id");
  });
  it("uses the saved focus result's measured wait and exports scope/batch metrics without source content", () => {
    const focus: FocusSession = { id: "saved-focus", runId: run.id, goal: "Private goal", mode: "review", title: "Private result", sourceConversationIds: ["private-id"], evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 5000, updatedAt: 5000,
      coverage: { method: "full_direct", sourceCount: 1, processedSegments: 49, totalSegments: 49, elapsedMs: 2500, sourceCharacters: 500, batchCount: 1 } };
    const rows = analyzeOrganizationRuns([], [event("failed", { status: "failed" }), event("recovered", { status: "completed" })], [], [focus]);
    expect(rows[0].elapsedMs).toBe(2500);
    expect(rows[0].run.status).toBe("completed");
    expect(rows[0].failedRequests).toBe(1);
    const csv = organizationAnalysisCsv(rows);
    expect(csv).toContain("coverage_method"); expect(csv).toContain("full_direct"); expect(csv).toContain('"2500"');
    expect(csv).not.toContain("Private goal"); expect(csv).not.toContain("Private result");
  });
  it("exports the failing stage and request ID and distinguishes overlapping request time", () => {
    const rows = analyzeOrganizationRuns([run], [
      event("first", { requestStartedAt: 1000, createdAt: 2100, durationMs: 1100, stage: "reading", taskVersion: "7", requestId: "first-request" }),
      event("second", { requestStartedAt: 1000, createdAt: 2200, durationMs: 1200, stage: "reading", taskVersion: "7", requestId: "failed-request", status: "failed", errorCode: "TASK_NOT_FOUND" }),
    ], []);
    expect(rows[0].requestDurationMs).toBe(2300);
    expect(rows[0].observedRequestSpanMs).toBe(1200);
    expect(rows[0].elapsedMs).toBeUndefined();
    expect(rows[0].failures).toEqual([{ code: "TASK_NOT_FOUND", requestId: "failed-request", stage: "reading", durationMs: 1200 }]);
    const csv = organizationAnalysisCsv(rows);
    expect(csv).toContain("TASK_NOT_FOUND");
    expect(csv).toContain("failed-request");
    expect(csv).toContain("task_versions");
    expect(csv).not.toContain("private-id");
  });

  it("excludes cache hits without request timestamps from the observed network span and labels latest-generation wait", () => {
    const focus: FocusSession = { id: "latest", runId: run.id, goal: "G", mode: "review", title: "T", sourceConversationIds: [], evidence: [], sections: [], activeSectionId: "", completedSectionIds: [], notes: "", createdAt: 5000, updatedAt: 5000, coverage: { method: "full_batched", sourceCount: 1, processedSegments: 2, totalSegments: 2, elapsedMs: 500 } };
    const rows = analyzeOrganizationRuns([run], [event("paid", { requestStartedAt: 1000, createdAt: 2200 }), event("cached", { status: "cached", durationMs: 0, createdAt: 4000, inputTokens: 0, outputTokens: 0 })], [], [focus]);
    expect(rows[0]).toMatchObject({ observedRequestSpanMs: 1200, elapsedMs: 500, elapsedScope: "latest_generation", cacheHits: 1 });
    expect(organizationAnalysisCsv(rows)).toContain('"latest_generation","automatic"');
  });

  it("groups request attempts by run and keeps provider, estimated, and unavailable usage distinct", () => {
    const rows = analyzeOrganizationRuns([run], [event("reported", {}), event("estimated", { taskType: "chapter_planning", tokenSource: "estimated", inputTokens: 30, outputTokens: 10, durationMs: 100 }), event("failed", { status: "failed", tokenSource: "unavailable", inputTokens: 0, outputTokens: 0, attempt: 2, durationMs: 50 }), event("legacy", { runId: undefined, inputTokens: 999 })], [diagnostic]);
    expect(rows[0]).toMatchObject({ requests: 3, failedRequests: 1, retries: 1, inputTokens: 130, outputTokens: 30, providerTokens: 120, estimatedTokens: 40, unavailableRequests: 1, requestDurationMs: 550, timedRequests: 3 });
    expect(rows[0].diagnostics).toEqual(diagnostic);
    expect(rows[0].byTask).toEqual([{ task: "question_snapshot", requests: 2, tokens: 120, durationMs: 450 }, { task: "chapter_planning", requests: 1, tokens: 40, durationMs: 100 }]);
  });

  it("exports comparable metrics without conversation titles, ids, or reviewer notes", () => {
    const csv = organizationAnalysisCsv(analyzeOrganizationRuns([run], [event("reported", {})], [diagnostic]));
    expect(csv).toContain('"run-1"');
    expect(csv).toContain('"4"');
    expect(csv).not.toContain("Private conversation title");
    expect(csv).not.toContain("private-id");
    expect(csv).not.toContain("Private reviewer note");
  });
  it("exports receipt tokens and estimate versions separately, keeping unknown costs unknown", () => {
    const rows = analyzeOrganizationRuns([run], [event("reported", { tokenEstimateVersion: "2", taskVersion: "client-6", estimatedInputTokens: 160 }), event("estimate", { tokenSource: "estimated", inputTokens: 200 })], []);
    expect(rows[0].requestTransport[0]).toMatchObject({ tokenEstimateVersion: "2", actualInputTokens: 100, actualOutputTokens: 20, tokenSource: "provider" });
    expect(rows[0].requestTransport[1].actualInputTokens).toBeUndefined();
    expect(rows[0].requestTransport[0].costCny).toBeUndefined();
    expect(organizationAnalysisCsv(rows)).toContain("actualInputTokens");
  });
  it("exports provider cache reads, estimate accuracy by stage, pre-send blocks and the writing scale",()=>{
    const task={...run,pipelineSpans:[
      {id:"calibration",feature:"wiki" as const,phase:"wiki:writing-calibration",status:"skipped" as const,startedAt:1000,durationMs:0,reason:"scale=0.55"},
      {id:"blocked",feature:"wiki" as const,phase:"wiki:preflight",status:"skipped" as const,startedAt:1100,durationMs:0,reason:"empty_roster"},
    ]};
    const rows=analyzeOrganizationRuns([task],[
      event("read",{stage:"reading",estimatedInputTokens:2000,inputTokens:1000,cachedInputTokens:0}),
      event("write",{stage:"synthesis:final",estimatedInputTokens:3000,inputTokens:1500,cachedInputTokens:1200}),
      event("estimated-only",{stage:"synthesis:final",estimatedInputTokens:900,inputTokens:900,tokenSource:"estimated"}),
    ],[]);
    expect(rows[0]).toMatchObject({cachedInputTokens:1200,estimateRatio:2,preflightBlocks:1,writingInputScale:0.55});
    expect(rows[0].estimateRatioByStage).toEqual([{stage:"reading",requests:1,estimated:2000,actual:1000,ratio:2},{stage:"synthesis:final",requests:1,estimated:3000,actual:1500,ratio:2}]);
    const csv=organizationAnalysisCsv(rows);
    for(const header of ["cached_input_tokens","estimate_to_actual_input_ratio","estimate_ratio_by_stage","preflight_blocks","writing_input_scale"])expect(csv).toContain(header);
    // Without provider cache reports the field stays unknown rather than zero.
    expect(analyzeOrganizationRuns([run],[event("plain",{})],[])[0].cachedInputTokens).toBeUndefined();
  });
});

it("exports only computable Wiki quality cells and leaves unavailable documents blank",()=>{
 const focus:FocusSession={id:"quality",runId:run.id,goal:"g",mode:"review",title:"t",sourceConversationIds:[],evidence:[],sections:[{id:"one",transition:"",kind:"review",title:"检索",body:"## 读取\n\nIndexedDB 保存用户数据。",evidenceIds:[]}],activeSectionId:"one",completedSectionIds:[],notes:"",createdAt:1,updatedAt:1};
 const rows=analyzeOrganizationRuns([run],[],[],[focus]);
 expect(rows[0].wikiQuality).toMatchObject({chapter_count:1,subtopic_count:1,bold_count:0});
 const csv=organizationAnalysisCsv(rows);expect(csv).toContain('"chapter_count"');expect(csv).toContain('"repeated_terms"');expect(csv).not.toContain("IndexedDB 保存用户数据");
 const unavailable=organizationAnalysisCsv(analyzeOrganizationRuns([run],[],[]));
 expect(unavailable.trimEnd().split("\r\n")[1].endsWith(',""'.repeat(12))).toBe(true);
 expect(analyzeOrganizationRuns([run],[],[],[{...focus,sections:[]}])[0].wikiQuality).toBeUndefined();
 // The diagnostics view skips the per-Wiki export; only the CSV download builds it.
 const view=analyzeOrganizationRuns([run],[],[],[focus],{documentMetrics:false})[0];
 expect(view.wikiQuality).toBeUndefined();expect(view.statusScope).toBe("wiki");
});
