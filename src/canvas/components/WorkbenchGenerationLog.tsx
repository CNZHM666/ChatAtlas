import { Circle, Clock3, Copy, ScrollText } from "lucide-react";
import { useEffect, useState } from "react";
import { workbenchRunActivity, type WorkbenchRequestActivity } from "../../ai/workbench-run-activity";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import type { AIUsageEvent, OrganizationRun } from "../../shared/types";
import { wikiStageCount, wikiStageName } from "../../shared/wiki-progress-labels";
import { listAIUsageForRun } from "../../storage/ai-usage";
import { getOrganizationRun } from "../../storage/organization-runs";
import { WorkbenchDialog } from "./WorkbenchDialog";
import { ProjectUpdateLog } from "../../sidecar/ProjectUpdateLog";
import type { ProjectUpdateLogEntry } from "../../sidecar/project-update-log";

export function GenerationLogButton({ zh, onClick }: { zh: boolean; onClick: () => void }) {
  return <button type="button" className="generation-log-trigger" onClick={onClick}><ScrollText size={15} aria-hidden="true"/>{zh ? "生成日志" : "Generation log"}</button>;
}

const code = (value?: string) => value && /^[\w.:[\]/-]{1,128}$/u.test(value) ? value : undefined;
const seconds = (value: number) => `${(value / 1000).toFixed(1)} s`;

export function WorkbenchGenerationLog({ runId, zh, running, retrying, awaitingConfirmation, progress, failed, errorCode, chapterEvents, onClose }: {
  runId: string; zh: boolean; running: boolean; retrying: boolean; awaitingConfirmation: boolean;
  progress?: FocusAnalysisProgress; failed?: boolean; errorCode?: string; chapterEvents?: ProjectUpdateLogEntry[]; onClose: () => void;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [events, setEvents] = useState<AIUsageEvent[]>();
  const [steps, setSteps] = useState<NonNullable<OrganizationRun["pipelineSpans"]>>([]);
  const [activity, setActivity] = useState(() => workbenchRunActivity(runId));
  const [unavailable, setUnavailable] = useState(false);
  const [copy, setCopy] = useState<"copied" | "failed">();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    let live = true, reading = false;
    const refresh = async () => {
      setNow(Date.now());
      setActivity(workbenchRunActivity(runId));
      if (reading) return;
      reading = true;
      try {
        const [rows, run] = await Promise.all([listAIUsageForRun(runId), getOrganizationRun(runId)]);
        if (live) { setEvents(rows); setSteps(run?.pipelineSpans ?? []); setUnavailable(false); }
      }
      catch { if (live) setUnavailable(true); }
      finally { reading = false; }
    };
    void refresh();
    const timer = running ? window.setInterval(() => void refresh(), 1000) : undefined;
    return () => { live = false; if (timer !== undefined) window.clearInterval(timer); };
  }, [runId, running]);
  const stage = progress?.ledger ? `${wikiStageName(progress.ledger.stage, zh)} · ${wikiStageCount(progress.ledger, zh)}`
    : progress?.phase === "directory" ? t("核对目录", "Reviewing the directory")
    : progress?.stage === "verification" ? t("核对结论与依据", "Verifying claims and sources")
    : progress?.final ? t("生成正文", "Writing the document")
    : progress ? t("读取来源", "Reading sources") : running ? t("准备材料", "Preparing materials") : undefined;
  const state = awaitingConfirmation ? t("等待你的确认", "Awaiting your confirmation") : retrying ? t("正在重试", "Retrying")
    : running ? t("进行中", "In progress") : failed ? t("生成中断", "Generation interrupted") : t("本次生成记录", "Run activity");
  const active = running ? activity.filter(item => item.state !== "finished").reverse() : [];
  const rows = events?.slice(0, 80) ?? [];
  const time = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  const names = (value?: string) => {
    if (!value) return t("模型请求", "Model request");
    if (/extract|coverage:reading|reading/u.test(value)) return t("读取材料、抽取知识", "Reading and extraction");
    if (/verify|check|proofread/u.test(value)) return t("核对正文与依据", "Verification");
    if (/write|synthesis|opening|rewrite/u.test(value)) return t("生成或改写正文", "Writing and revision");
    if (/plan|directory|subject|group|merge|owner/u.test(value)) return t("整理主题与目录", "Subjects and directory");
    if (/overview/u.test(value)) return t("生成总览", "Writing the overview");
    return t("模型请求", "Model request");
  };
  const output = (item?: WorkbenchRequestActivity) => item?.excerpt ? <details className="generation-log-output">
    <summary>{t("查看模型输出片段", "View model output excerpt")}</summary>
    <p>{t("当前窗口暂存，未核对的模型原始输出。", "Unverified model output held in this window.")}</p>
    <pre>{(item.outputLength ?? 0) > item.excerpt.length ? "…\n" : ""}{item.excerpt}</pre>
  </details> : null;
  const copyLog = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify({ state, stage, errorCode: code(errorCode), requests: rows.map(event => ({
        at: event.createdAt, operation: code(event.operation ?? event.stage), model: code(event.modelId), attempt: event.attempt, status: event.status,
        durationMs: event.durationMs, queueMs: event.queueMs, firstTokenMs: event.firstTokenMs, receivedCharacters: event.receivedCharacters,
        outputTokens: event.outputTokens, tokenSource: event.tokenSource, timeoutStage: code(event.timeoutStage), finishReason: code(event.finishReason),
        errorCode: code(event.errorCode), validationPaths: event.validationPaths?.map(code).filter(Boolean),
      })), active: active.map(item => ({ operation: code(item.operation), model: code(item.modelId), attempt: item.attempt, state: item.state,
        elapsedMs: now - item.startedAt, receivedCharacters: item.diagnostics?.receivedCharacters ?? item.outputLength })),
      steps: steps.slice(-50).map(step => ({ phase: code(step.phase), startedAt: step.startedAt, durationMs: step.durationMs, status: step.status, reason: code(step.reason), counts: step.counts })) }, null, 2));
      setCopy("copied");
    } catch { setCopy("failed"); }
  };
  return <WorkbenchDialog title={t("生成日志", "Generation log")} closeLabel={t("关闭日志", "Close log")} className="generation-log-dialog" onClose={onClose}>
    <div className="generation-log-summary">
      <div><strong><Circle size={8} fill="currentColor" aria-hidden="true"/>{state}</strong>{stage && <span>{stage}</span>}{errorCode && <code>{code(errorCode)}</code>}</div>
      <button type="button" onClick={() => void copyLog()}><Copy size={14} aria-hidden="true"/>{t("复制诊断", "Copy diagnostics")}</button>
      {copy && <small role="status">{copy === "copied" ? t("已复制诊断信息", "Diagnostics copied") : t("无法访问剪贴板", "Clipboard unavailable")}</small>}
    </div>
    <div className="generation-log-body" role="region" aria-label={t("模型请求记录", "Model request activity")} tabIndex={0}>
      {chapterEvents?.length ? <div className="first-wiki-progress"><ProjectUpdateLog entries={chapterEvents} zh={zh} id="saved-first-wiki-log"/></div> : null}
      {active.length > 0 && <section><h3>{t("正在处理", "Active requests")}</h3><ul>
        {active.map(item => {
          const received = item.diagnostics?.receivedCharacters || item.outputLength || 0;
          const activityLabel = item.state === "validating" ? t("校验输出", "Validating output") : received ? t(`接收中 · ${received} 字符`, `Receiving · ${received} chars`)
            : item.diagnostics?.responseHeadersMs !== undefined ? item.diagnostics.streaming ? t("等待首字", "Waiting for first token") : t("读取响应", "Reading response")
            : t("等待模型返回", "Awaiting model response");
          return <li key={`${item.operationId}:${item.attempt}`}>
            <div className="generation-log-row"><Clock3 size={16} aria-hidden="true"/><div><strong>{names(item.operation)}</strong><small>{item.modelId} · {t(`第 ${item.attempt} 次`, `Attempt ${item.attempt}`)} · {seconds(Math.max(0, now - item.startedAt))}</small></div>
              <span>{activityLabel}</span></div>
            {output(item)}
          </li>;
        })}
      </ul></section>}
      <section><h3>{t("请求记录", "Request history")}{events && <small>{events.length > rows.length ? `${rows.length}/${events.length}` : rows.length}</small>}</h3>
        {rows.length ? <ul>{rows.map(event => {
          const local = event.providerId === "local";
          const excerpt = activity.find(item => item.operationId === event.operationId && item.attempt === event.attempt);
          const result = event.status === "failed" ? t("失败", "Failed") : event.status === "cached" ? t("已复用", "Reused") : t("完成", "Complete");
          return <li key={event.id}>
            <div className="generation-log-row"><Circle size={8} fill="currentColor" aria-hidden="true"/><div><strong>{names(event.operation ?? event.stage)}</strong><small>{time.format(event.createdAt)} · {local ? t("本地处理", "Local processing") : event.modelId}{event.durationMs !== undefined ? ` · ${seconds(event.durationMs)}` : ""}</small></div><span data-result={event.status}>{result}</span></div>
            <details className="generation-log-metrics"><summary>{t("请求详情", "Request details")}{event.errorCode && <code>{code(event.errorCode)}</code>}</summary>
              <div><code>{code(event.operation ?? event.stage)}</code><span>{t(`第 ${event.attempt} 次`, `Attempt ${event.attempt}`)}</span>
                {event.firstTokenMs !== undefined && <span>{t("首字", "First token")} {seconds(event.firstTokenMs)}</span>}
                {event.queueMs !== undefined && <span>{t("排队", "Queue")} {seconds(event.queueMs)}</span>}
                {event.receivedCharacters !== undefined && <span>{t("接收字符", "Received characters")} {event.receivedCharacters}</span>}
                {!local && event.tokenSource !== "unavailable" && <span>{t("输出", "Output")} {event.outputTokens} tokens</span>}
                {(event.timeoutStage || event.finishReason) && <code>{code(event.timeoutStage ?? event.finishReason)}</code>}
                {event.validationPaths?.length ? <code>{event.validationPaths.map(code).filter(Boolean).join(", ")}</code> : null}</div></details>
            {output(excerpt)}
          </li>;
        })}</ul> : <p className="generation-log-empty">{unavailable ? t("暂时无法读取请求记录。", "Request history is unavailable.") : events ? t("暂无已完成的模型请求。", "No requests have finished yet.") : t("正在读取请求记录…", "Loading requests…")}</p>}
      </section>
      {steps.length > 0 && <details className="generation-log-steps"><summary>{t("处理步骤", "Processing steps")} · {steps.length}</summary><ul>
        {steps.slice(-30).reverse().map(step => {
          const counts = step.counts ?? {};
          const details = [
            counts.coverageDuplicate ? t(`复用 ${counts.coverageDuplicate} 段重复材料`, `Reused ${counts.coverageDuplicate} duplicate passages`) : undefined,
            counts.recoveredReferenceItems ? t(`从原文补回 ${counts.recoveredReferenceItems} 条参考机制`, `Recovered ${counts.recoveredReferenceItems} reference mechanisms from the source`) : undefined,
            counts.source_structure_used ? t("沿用原文结构", "Used source structure") : undefined,
            counts.source_structure_fallback_scope ? t("来源较多或尚未读完，使用完整目录整理", "Used full organization for broader or incomplete sources") : undefined,
            counts.source_structure_fallback_review ? t("存在待核对的决策或归属", "Decisions or ownership need review") : undefined,
            counts.source_structure_fallback_structure ? t("原文结构不足以直接生成目录", "Source structure requires directory planning") : undefined,
            counts.source_structure_fallback_layout ? t("沿用项目已有目录", "Kept the project directory") : undefined,
            counts.fit_budget_limited ? t(`${counts.fit_budget_limited} 项目录核对超过预算`, `${counts.fit_budget_limited} placement checks exceeded budget`) : undefined,
            counts.research_required ? t(`正文覆盖 ${counts.research_covered}/${counts.research_required}`, `Content coverage ${counts.research_covered}/${counts.research_required}`) : undefined,
            counts.research_conclusions_required ? t(`设计启示 ${counts.research_conclusions_covered}/${counts.research_conclusions_required}`, `Takeaways ${counts.research_conclusions_covered}/${counts.research_conclusions_required}`) : undefined,
            counts.write_supplements ? t(`补写请求 ${counts.write_supplements} 次`, `${counts.write_supplements} follow-up writing requests`) : undefined,
          ].filter(Boolean).join(" · ");
          return <li key={step.id}><code>{code(step.phase)}</code><span>{step.status === "failed" ? t("失败", "Failed") : step.status === "skipped" ? t("跳过", "Skipped") : t("完成", "Complete")} · {seconds(step.durationMs)}{details && ` · ${details}`}</span></li>;
        })}
      </ul></details>}
    </div>
  </WorkbenchDialog>;
}
