import {ChevronDown,Download,ListChecks,RefreshCw} from "lucide-react";
import { AIChainDiagnostics } from "./AIChainDiagnostics";
import { aiFeatures, aiFeatureLabel, usageFeature, type AIFeature } from "../../ai/ai-diagnostics";
import { aiDiagnosticExport } from "../../ai/lifecycle-analysis";
import type { AIUsageEvent } from "../../shared/types";
import { useCallback, useEffect, useRef, useState } from "react";
import { analyzeOrganizationRuns, organizationAnalysisCsv, organizationLatency, type OrganizationAnalysis } from "../../ai/usage-analysis";
import { listAnalysisDiagnostics } from "../../ai/semantic-analysis";
import { listAIUsage } from "../../storage/ai-usage";
import { listOrganizationRuns, saveOrganizationEvaluation } from "../../storage/organization-runs";
import { listFocusSessions } from "../../storage/focus-sessions";

const number = (value: number) => value.toLocaleString();
const percent = (value: number | undefined) => value === undefined ? "—" : `${Math.round(value * 100)}%`;
const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;

function AnalysisItem({ row, zh, onSaved }: { row: OrganizationAnalysis; zh: boolean; onSaved: (updated: OrganizationAnalysis["run"]) => void }) {
  const [score, setScore] = useState(row.run.evaluation?.score ? String(row.run.evaluation.score) : "");
  const [note, setNote] = useState(row.run.evaluation?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  // A collapsed run renders only its summary; the detail tables can hold hundreds of requests.
  const [open, setOpen] = useState(false);
  const diagnostic = row.diagnostics;
  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const updated = await saveOrganizationEvaluation(row.run.id, score ? Number(score) : undefined, note);
      onSaved(updated);
      setMessage(zh ? "已保存" : "Saved");
    } catch {
      setMessage(zh ? "保存失败" : "Save failed");
    } finally {
      setSaving(false);
    }
  };
  const statusLabels: Record<string, string> = { completed: "已完成", failed: "失败", cancelled: "已取消", waiting_review: "待确认", running: "处理中", queued: "等待中" };
  const features=[...new Set(row.lifecycle.events.map(usageFeature))];
  const title=row.synthetic?features.length===1?aiFeatureLabel(features[0],zh):zh?"AI 任务":"AI task":row.run.title;
  return <details className="developer-analysis-run" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{title}</span><strong>{number(row.requests)} {zh ? "次请求" : "requests"}<small>{number(row.inputTokens + row.outputTokens + row.embeddingTokens)} tokens</small></strong></summary>
    {open ? <div className="developer-analysis-detail">
      <div className="developer-analysis-meta"><span>{new Date(row.run.startedAt).toLocaleString()}</span><span>{row.statusScope === "wiki" ? zh ? "Wiki 已生成" : "Wiki generated" : row.run.projectAnalysisReview ? row.run.projectAnalysisReview==="accepted" ? zh?"已采用":"Accepted" : zh?"保留原记录":"Original kept" : zh ? statusLabels[row.run.status] ?? row.run.status : row.run.status}</span>{row.outcomes ? <span>{zh ? "架构" : "Architecture"} · {row.outcomes.architecture === "ready" ? zh ? "已生成" : "Ready" : row.outcomes.architecture === "failed" ? zh ? "待重试" : "Retry needed" : zh ? "未生成" : "Unavailable"} / {zh ? "版本" : "History"} · {row.outcomes.history === "ready" ? zh ? "已生成" : "Ready" : row.outcomes.history === "failed" ? zh ? "待重试" : "Retry needed" : row.outcomes.history === "partial" ? zh ? "整理中" : "Partial" : zh ? "未生成" : "Unavailable"}</span> : null}</div>
      <div className="developer-analysis-metrics">
        <div><strong>{row.elapsedMs === undefined ? "—" : seconds(row.elapsedMs)}</strong><span>{row.elapsedScope === "latest_generation" ? zh ? "最近一次生成等待" : "Latest generation wait" : zh ? "任务等待" : "Task wait"}</span></div>
        <div><strong>{row.timedRequests ? seconds(row.requestDurationMs) : "—"}</strong><span>{zh ? "请求累计耗时" : "Summed request time"}</span></div>
        <div><strong>{row.failedRequests} / {row.retries}</strong><span>{zh ? "失败 / 请求内重试" : "Failures / request retries"}</span></div>
        <div><strong>{row.recoveryRequests}</strong><span>{zh?"结构修复与局部恢复请求":"Repair and recovery requests"}</span></div>
        <div><strong>{row.cacheHits}</strong><span>{zh ? "缓存复用" : "Cache hits"}</span></div>
        <div><strong>{number(row.inputTokens)} / {number(row.outputTokens)}</strong><span>{zh ? "输入 / 输出 Token" : "Input / output tokens"}</span></div>
        <div><strong>{row.unpricedRequests === row.requests && row.requests ? "—" : `¥${row.costCny.toFixed(4)}`}</strong><span>{zh ? "费用估算" : "Estimated cost"}</span></div>
      </div>
      {row.recoveryRequests?<p className="developer-analysis-note">{zh?"修复与恢复请求会另外计数，可能与请求内重试重叠。预留输出上限用于限制自动恢复，不是账户余额或实际消耗；各次生成分别有界。":"Repairs and recoveries are counted separately and may overlap request retries. Reserved output limits bound automatic recovery; they are not account balance or billed usage. Each generation has its own limit."}</p>:null}
      <p>{zh?"失败来源":"Failure origins"} · {Object.entries(row.failuresByOrigin).map(([key,count])=>`${({local:zh?"本地拦截":"Local",model:zh?"模型输出":"Model",provider:zh?"服务商":"Provider",network:zh?"网络":"Network",unknown:zh?"未分类":"Unknown"} as Record<string,string>)[key]} ${count}`).join(" · ")}</p>
      <AIChainDiagnostics data={row.lifecycle} zh={zh}/>
      {row.failures.some(failure=>failure.claimValidation?.length)?<details className="developer-analysis-extra"><summary>{zh?"声明字段错误":"Claim field errors"}</summary><ul>{row.failures.flatMap((failure,index)=>(failure.claimValidation??[]).map(issue=><li key={`${index}:${issue.path}:${issue.reason}`}><code>{issue.path}</code> · {({array_required:zh?"需要数组":"Array required",too_many_claims:zh?"声明超过 12 条":"More than 12 claims",object_required:zh?"需要声明对象":"Claim object required",required_text:zh?"缺少非空文字":"Nonempty text required",text_too_long:zh?"文字超过长度上限":"Text exceeds limit",evidence_required:zh?"缺少引用编号":"Evidence IDs required",unknown_evidence:zh?"引用不在本章节来源内":"Evidence outside section sources"} as Record<string,string>)[issue.reason]??issue.reason}</li>))}</ul></details>:null}
      {row.run.pipelineSpans?.length?<details className="developer-analysis-extra"><summary>{zh?"已测本地处理阶段":"Measured local phases"}</summary><div className="developer-stage-table"><table><thead><tr><th>{zh?"功能 / 阶段":"Feature / phase"}</th><th>{zh?"耗时 / 结果":"Duration / result"}</th></tr></thead><tbody>{row.run.pipelineSpans.map(span=><tr key={span.id}><td>{aiFeatureLabel(span.feature,zh)} · {span.phase}</td><td>{seconds(span.durationMs)} / {span.status}{span.reason?<small> · {span.reason}</small>:null}{span.counts?<small> · {Object.entries(span.counts).filter(([,value])=>Number.isFinite(value)).map(([key,value])=>`${({inputCount:zh?"材料":"Materials",mainCount:zh?"主章节":"Main chapters",requests:zh?"请求":"Requests",repairCount:zh?"修复":"Repairs",protectedCount:zh?"个人页面":"Protected",finalCount:zh?"最终章节":"Final chapters"} as Record<string,string>)[key]??key}: ${value}`).join(" · ")}</small>:null}</td></tr>)}</tbody></table></div><p>{zh?"只显示已埋点的本地阶段；缺少记录不代表耗时为零。阶段可能嵌套，不应与请求耗时直接相加。":"Only instrumented local phases appear; missing is not zero. Nested phases must not be added to request durations."}</p></details>:null}
      {row.unpricedRequests || row.unavailableRequests ? <p className="developer-analysis-note">{[row.unpricedRequests ? zh ? `${row.unpricedRequests} 次费用未知` : `${row.unpricedRequests} unpriced requests` : "", row.unavailableRequests ? zh ? `${row.unavailableRequests} 次用量未知` : `${row.unavailableRequests} requests with unknown usage` : ""].filter(Boolean).join(" · ")}</p> : null}
      {row.run.projectAnalysis||row.byStage?.length?<details className="developer-analysis-extra"><summary>{zh?"分阶段耗时与请求":"Phase timing and requests"}</summary>
        {row.run.projectAnalysis?<><p>{zh?`本次任务 ${row.run.id} · ${row.run.projectAnalysis.partial?"部分完成":"独立尝试"} · 缓存命中 ${row.run.projectAnalysis.reusedRequests} 次 · 参考 ${row.run.projectAnalysis.reusedWikiSections} 篇 Wiki`:`Run ${row.run.id} · ${row.run.projectAnalysis.partial?"partial":"separate attempt"} · ${row.run.projectAnalysis.reusedRequests} cache hits · ${row.run.projectAnalysis.reusedWikiSections} Wiki references`}</p><div className="developer-stage-table"><table><thead><tr><th>{zh?"业务阶段":"Phase"}</th><th>{zh?"阶段墙钟耗时":"Wall time"}</th><th>{zh?"本阶段计数":"Phase count"}</th></tr></thead><tbody>{row.run.projectAnalysis.phases.map((phase,index)=><tr key={index}><td>{phase.phase}</td><td>{phase.finishedAt!==undefined?seconds(Math.max(0,phase.finishedAt-phase.startedAt)):zh?"进行中":"Running"}</td><td>{phase.total?`${phase.completed??0}/${phase.total}`:"—"}</td></tr>)}</tbody></table></div></>:null}
        {row.byStage?.length?<div className="developer-stage-table"><table><thead><tr><th>{zh?"请求阶段":"Request stage"}</th><th>{zh?"请求 / 缓存 / 失败":"Calls / cache / failed"}</th><th>{zh?"请求累计耗时":"Summed request time"}</th><th>{zh?"输入 / 输出 Token":"Input / output tokens"}</th></tr></thead><tbody>{row.byStage.map(stage=><tr key={stage.stage}><td>{stage.stage}</td><td>{stage.requests} / {stage.cacheHits} / {stage.failed}</td><td>{stage.timed?seconds(stage.durationMs):"—"}</td><td>{stage.unavailable===stage.requests&&stage.requests?"—":`${number(stage.inputTokens)} / ${number(stage.outputTokens)}`}{stage.unavailable?` · ${stage.unavailable} ${zh?"次用量未知":"unknown usage"}`:""}</td></tr>)}</tbody></table></div>:null}
        <p>{zh?"并发请求累计耗时可以大于阶段墙钟耗时；复用和 Wiki 参考量不能直接换算成节省的 Token。零请求的本地复用仍会记录本次耗时。":"Overlapping requests can sum to more than wall time. Reuse/Wiki counts do not directly measure saved tokens. Cache-only attempts retain their own timing."}</p>
      </details>:null}
      <details className="developer-analysis-extra"><summary>{zh ? "请求与诊断" : "Requests and diagnostics"}</summary>
        {row.run.error?<p><strong>{zh?"本次失败说明：":"Attempt failure: "}</strong><code>{row.run.error}</code></p>:null}
        <dl><div><dt>{zh ? "模型" : "Model"}</dt><dd>{row.models.join(", ") || "—"}</dd></div>
          <div><dt>{zh ? "Token 来源" : "Token source"}</dt><dd>{zh ? "服务商 / 估算" : "Reported / estimated"}: {number(row.providerTokens)} / {number(row.estimatedTokens)}</dd></div>
          {row.observedRequestSpanMs !== undefined ? <div><dt>{zh ? "请求时间跨度" : "Request span"}</dt><dd>{seconds(row.observedRequestSpanMs)}</dd></div> : null}
          {row.pendingCostCny ? <div><dt>{zh ? "待核实费用" : "Pending cost"}</dt><dd>¥{row.pendingCostCny.toFixed(4)}</dd></div> : null}
          {row.latestGenerationMs !== undefined ? <div><dt>{zh?"最近一次生成":"Latest generation"}</dt><dd>{seconds(row.latestGenerationMs)}</dd></div>:null}
          {row.generationAttempts ? <div><dt>{zh?"生成尝试（含续跑）":"Generation attempts, including resume"}</dt><dd>{row.generationAttempts}</dd></div>:null}
          {row.recoveryRequests ? <div><dt>{zh?"恢复请求预留输出上限（全任务累计）":"Reserved recovery output limits (whole task)"}</dt><dd>{number(row.recoveryReservedOutputTokens)} tokens</dd></div>:null}
          {row.requestQueueMs !== undefined ? <div><dt>{zh?"请求排队累计":"Summed request queue time"}</dt><dd>{seconds(row.requestQueueMs)}</dd></div>:null}
          {row.maxSchedulingMs !== undefined ? <div><dt>{zh?"最长批次调度等待":"Longest batch scheduling wait"}</dt><dd>{seconds(row.maxSchedulingMs)}</dd></div>:null}
          {row.firstReadableMs !== undefined ? <div><dt>{zh ? "首次可阅读（整轮起算）" : "First readable (whole task)"}</dt><dd>{seconds(row.firstReadableMs)}</dd></div> : null}
        </dl>
        {row.errorCodes.length ? <div className="developer-error-list">{row.errorCodes.map((code) => <div key={code}><code>{code}</code><strong>{row.failures.filter((failure) => failure.code === code).length} {zh ? "次" : "times"}</strong></div>)}</div> : null}
        {row.byTask.length ? <div className="ai-usage-list">{row.byTask.map((task) => <div key={`${task.feature??""}:${task.task}`}><span>{aiFeatureLabel(task.feature??usageFeature({taskType:task.task}),zh)}</span><strong>{task.requests} · {number(task.tokens)} tokens</strong></div>)}</div> : null}
        {row.requestTransport.length?<details className="developer-analysis-extra"><summary>{zh?"逐请求传输指标":"Per-request transport"}</summary>{row.requestTransport.map((request,index)=><div className="developer-request-metrics" key={`${request.requestId??"request"}:${index}`}><strong>{index+1} · {request.stage??request.taskType}</strong><dl><div><dt>ID</dt><dd>{request.requestId??"—"}</dd></div><div><dt>{zh?"首包 / 首字":"Headers / first token"}</dt><dd>{request.responseHeadersMs!==undefined?seconds(request.responseHeadersMs):"—"} / {request.firstTokenMs!==undefined?seconds(request.firstTokenMs):"—"}</dd></div><div><dt>{zh?"耗时 / 接收字数":"Time / characters"}</dt><dd>{request.durationMs!==undefined?seconds(request.durationMs):"—"} / {request.receivedCharacters??"—"}</dd></div><div><dt>{zh?"实际输入 / 输出":"Reported input / output"}</dt><dd>{request.actualInputTokens??"—"} / {request.actualOutputTokens??"—"}</dd></div><div><dt>{zh?"结束 / 超时阶段":"Finish / timeout"}</dt><dd>{request.finishReason??"—"} / {request.timeoutStage??"—"}</dd></div></dl></div>)}</details>:null}
        {diagnostic ? <p>{zh ? "结构观察" : "Structure signals"}: {diagnostic.schemaFailures} {zh ? "次校验失败" : "schema failures"} · {zh ? "待复核率" : "Needs review"} {percent(diagnostic.needsReviewRate)} · {zh ? "无证据关系率" : "Unsupported relations"} {percent(diagnostic.unsupportedRelationRate)}</p> : null}
      </details>
      {!row.synthetic ? <details className="developer-analysis-extra"><summary>{zh ? "评价与备注" : "Evaluation and notes"}</summary><label>{zh ? "结果评分（人工，1–5）" : "Result score (manual, 1–5)"}<select value={score} onChange={(event) => setScore(event.target.value)}><option value="">{zh ? "未评分" : "Unrated"}</option>{[1, 2, 3, 4, 5].map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label>{zh ? "测试备注" : "Test note"}<textarea value={note} maxLength={300} onChange={(event) => setNote(event.target.value)} /></label>
        <div className="developer-analysis-actions"><button type="button" onClick={() => void save()} disabled={saving}>{zh ? "保存评价" : "Save evaluation"}</button>{message ? <span role="status">{message}</span> : null}</div>
      </details> : null}
    </div> : null}
  </details>;

}

export function DeveloperAnalysis({ locale }: { locale: string }) {
  const zh = locale !== "en";
  const [usage,setUsage]=useState<AIUsageEvent[]>([]),[feature,setFeature]=useState<AIFeature|"all">("all");
  const [rows, setRows] = useState<OrganizationAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [exporting, setExporting] = useState(false);
  const sources = useRef<{ runs: Parameters<typeof analyzeOrganizationRuns>[0]; events: AIUsageEvent[]; diagnostics: Parameters<typeof analyzeOrganizationRuns>[2]; focusSessions: Parameters<typeof analyzeOrganizationRuns>[3] }>();
  const refresh = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const [runs, events, diagnostics, focusSessions] = await Promise.all([listOrganizationRuns(), listAIUsage(), listAnalysisDiagnostics(), listFocusSessions()]);
      setUsage(events);
      sources.current = { runs, events, diagnostics, focusSessions };
      // Wiki quality columns need a full export per saved Wiki: built only for the CSV.
      setRows(analyzeOrganizationRuns(runs, events, diagnostics, focusSessions, { documentMetrics: false }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);
  const shown=feature==="all"?rows:rows.filter(row=>row.lifecycle.events.some(event=>usageFeature(event)===feature)||row.run.pipelineSpans?.some(span=>span.feature===feature));
  const latency = organizationLatency(shown);
  const downloadRequests=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(aiDiagnosticExport(usage.filter(event=>feature==="all"||usageFeature(event)===feature),shown.map(row=>row.run)),null,2)],{type:"application/json"}));const link=document.createElement("a");link.href=url;link.download="atlas-ai-request-diagnostics.json";link.click();window.setTimeout(()=>URL.revokeObjectURL(url),0);};
  const download = () => {
    const input = sources.current;if (!input || exporting) return;
    setExporting(true);
    // Let the button show its busy state before the export work starts.
    window.setTimeout(() => {
     try {
    const ids = new Set(shown.map(row => row.run.id));
    const complete = analyzeOrganizationRuns(input.runs, input.events, input.diagnostics, input.focusSessions).filter(row => ids.has(row.run.id));
    const blob = new Blob([organizationAnalysisCsv(complete)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `ai-organization-analysis-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
     } finally { setExporting(false); }
    }, 0);
  };
  return <div className="developer-analysis">
    <div className="developer-analysis-heading"><label><select aria-label={zh?"按 AI 功能筛选":"Filter AI feature"} value={feature} onChange={event=>setFeature(event.target.value as typeof feature)}><option value="all">{zh?"全部 AI 功能":"All AI features"}</option>{Object.keys(aiFeatures).map(key=><option key={key} value={key}>{aiFeatureLabel(key as AIFeature,zh)}</option>)}</select></label><div><button type="button" onClick={() => void refresh()} disabled={loading}><RefreshCw size={14} aria-hidden="true" className={loading?"spin":undefined}/>{zh ? "刷新" : "Refresh"}</button><details className="developer-export-menu"><summary><Download size={14} aria-hidden="true"/>{zh?"导出":"Export"}<ChevronDown size={13} aria-hidden="true"/></summary><div><button type="button" onClick={download} disabled={loading || exporting || !shown.length} aria-busy={exporting || undefined} title={zh ? "不含对话正文、标题或备注" : "No conversation content, titles, or notes"}>{exporting ? zh ? "正在生成 CSV…" : "Preparing CSV…" : zh ? "导出 CSV" : "Export CSV"}</button><button type="button" onClick={downloadRequests} disabled={loading||!usage.length}>{zh?"导出逐请求 JSON":"Export request JSON"}</button></div></details></div></div>
    {loading ? <p>{zh ? "读取中…" : "Loading…"}</p> : error ? <p>{zh ? "读取分析记录失败。" : "Could not load analysis records."}</p> : shown.length ? <>
      {latency.count ? <p>{zh ? "已测任务实际耗时" : "Measured task latency"} · P50 {seconds(latency.p50!)} · P95 {seconds(latency.p95!)} · {latency.count} {zh ? "个已测任务" : "measured runs"}</p> : null}
      {shown.slice(0, expanded ? undefined : 8).map((row) => <AnalysisItem key={row.run.id} row={row} zh={zh} onSaved={(updated) => setRows((current) => current.map((item) => item.run.id === updated.id ? { ...item, run: updated } : item))} />)}
      {shown.length > 8 ? <button type="button" className="ai-usage-more" onClick={() => setExpanded((value) => !value)}>{expanded ? zh ? "收起" : "Show less" : zh ? `查看全部 ${shown.length} 次整理` : `Show all ${shown.length} runs`}</button> : null}
    </> : <div className="developer-analysis-empty"><ListChecks size={22} aria-hidden="true"/><strong>{zh ? feature==="all"?"暂无任务记录。":"该功能暂无诊断记录。" : feature==="all"?"No task records yet.":"No diagnostics for this feature yet."}</strong><p>{zh?"整理文档后，可查看请求、耗时和失败原因。":"After organizing a document, review requests, timings and failures here."}</p></div>}
  </div>;
}
