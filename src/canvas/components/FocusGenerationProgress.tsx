import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, CirclePause, LoaderCircle } from "lucide-react";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import type { FocusMode, FocusScope } from "../../shared/focus-session";
import { workbenchRunActivity } from "../../ai/workbench-run-activity";
import {WikiPlanningStatus} from "./WikiPlanningStatus";
import { GenerationLogButton } from "./WorkbenchGenerationLog";
import { wikiProgressStep, wikiStageCount, wikiStageName, wikiStepTitle } from "../../shared/wiki-progress-labels";

export function FocusGenerationProgress({ zh, detail, sourceCount, retrying, mode = "review", scopeKind, onCancel, onLog, runId, compact = false, awaitingConfirmation = false }: { zh: boolean; detail?: FocusAnalysisProgress; sourceCount: number; retrying: boolean; mode?: FocusMode; scopeKind?: FocusScope["kind"]; onCancel: () => void; onLog?: () => void; runId?: string; compact?: boolean; awaitingConfirmation?: boolean }) {
  const clockStart = useRef(Date.now() - (detail?.elapsedMs ?? 0));
  const [seconds, setSeconds] = useState(() => Math.floor((detail?.elapsedMs ?? 0) / 1000));
  const [liveActivity, setLiveActivity] = useState(() => (!compact && runId ? workbenchRunActivity(runId) : []));
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const timer = setInterval(() => {
      setSeconds(Math.floor((Date.now() - clockStart.current) / 1000));
      if (!compact && runId) setLiveActivity(workbenchRunActivity(runId));
    }, 1000);
    return () => clearInterval(timer);
  }, [compact, runId]);
  useEffect(() => {
    if (!compact) return;
    const closeOutside = (event: PointerEvent) => { if (menu.current && event.target instanceof Node && !menu.current.contains(event.target) && !document.querySelector(".generation-log-dialog[open]")) menu.current.open = false; };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && menu.current?.open && !document.querySelector(".generation-log-dialog[open]")) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside); document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [compact]);
  const elapsed = zh ? seconds < 60 ? `已用 ${seconds} 秒` : `已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds}s elapsed`;
  const title = zh ? "生成进度" : "Generation progress";
  const activeRequests = liveActivity.filter(item => item.state !== "finished");
  const liveTicker = !compact && activeRequests.length > 0 ? <div className="focus-generation-live-log" aria-live="polite">
    <span className="focus-live-dot" aria-hidden="true" />
    <span>{activeRequests.length > 1
      ? zh ? `${activeRequests.length} 个模型请求正在并行处理` : `${activeRequests.length} AI requests running in parallel`
      : zh ? `正在请求 ${activeRequests[0].modelId || "模型"}（第 ${activeRequests[0].attempt} 次）` : `Requesting ${activeRequests[0].modelId || "model"} (attempt ${activeRequests[0].attempt})`}</span>
  </div> : null;
  const actions = <div className="focus-generation-controls">{!compact && onLog && <GenerationLogButton zh={zh} onClick={onLog}/>}<button type="button" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button></div>;
  const Icon = awaitingConfirmation ? CirclePause : LoaderCircle;
  const present = (panel: ReactNode, activity: string, meter?: string) => compact ?
    <div className="focus-header-progress-group">
      <details ref={menu} className={`focus-header-progress${awaitingConfirmation ? " is-awaiting-confirmation" : ""}`}>
        <summary aria-label={zh ? "查看生成进度" : "View generation progress"}><Icon size={15} aria-hidden="true"/><span>{activity}</span>{meter ? <small>{meter}</small> : null}</summary>
        <div className="focus-header-progress-popover">{panel}</div>
      </details>
      {onLog && <GenerationLogButton zh={zh} onClick={onLog}/>}
    </div> : panel;
  if (awaitingConfirmation) {
    const activity = zh ? "等待确认" : "Awaiting confirmation";
    return present(<section className="focus-generation-progress is-awaiting-confirmation" aria-label={title}>
      <div className="focus-generation-heading-row"><strong role="status"><Icon size={18} aria-hidden="true"/>{activity}</strong><small>{elapsed}</small></div>
      <div className="focus-generation-actions"><small>{zh ? "确认后继续写作" : "Writing continues after confirmation"}</small>{actions}</div>
    </section>, activity);
  }
  const directory = detail?.phase === "directory";
  const step = !detail ? 0 : detail.final || directory ? 2 : 1;
  const compose = zh ? mode === "work" ? "生成项目内容" : mode === "answer" ? "生成回答" : "生成复习回顾" : mode === "work" ? "Compose project" : mode === "answer" ? "Compose answer" : "Compose review";
  const labels = zh ? ["准备材料", mode === "work" ? "理解与整理来源" : "理解来源", compose] : ["Prepare materials", mode === "work" ? "Read and organize sources" : "Read sources", compose];
  const sourceDone = detail?.completedSourceIds.length ?? 0;
  const reading = !directory && detail?.stage === "reading" && !detail.final;
  const total = reading ? detail.totalSegments : detail?.final && detail.total > 1 ? detail.total : 0;
  const completed = Math.min(total, Math.max(0, (reading ? detail.processedSegments : detail?.completed) ?? 0));
  const counts = directory ? zh ? `${sourceDone}/${sourceCount} 条对话已理解` : `${sourceDone}/${sourceCount} sources read` : detail && !detail.final ? zh ? `${detail.processedSegments}/${detail.totalSegments || "…"} 段 · ${sourceDone}/${sourceCount} 条对话` : `${detail.processedSegments}/${detail.totalSegments || "…"} passages · ${sourceDone}/${sourceCount} sources`
      : zh ? `${sourceCount} 条所选对话` : `${sourceCount} selected conversations`;
  const recovery = Boolean(detail?.final && detail.recoverySplits);
  // The knowledge-unit ledger has its own three steps; organizing names which of its seven parts is running.
  const ledger = detail?.ledger;
  if (ledger) {
    const ledgerStep = wikiProgressStep(ledger.stage), measured = ledger.total > 1 || ledger.done > 0 ? ledger.total : 0, done = Math.min(measured, ledger.done);
    const where = ledgerStep === 0 && ledger.stage === "extract"
      ? zh ? `${wikiStageCount(ledger, zh)} · ${sourceCount} 条对话` : `${wikiStageCount(ledger, zh)} · ${sourceCount} sources`
      : ledger.stage === "proofread" ? zh ? "校对依据、状态和章节衔接" : "Checking evidence, status and chapter flow"
      : ledgerStep < 2 ? `${wikiStageName(ledger.stage, zh, true)}${measured ? ` · ${wikiStageCount(ledger, zh)}` : ""}`
      : zh ? `已写 ${wikiStageCount(ledger, zh)}` : `${wikiStageCount(ledger, zh)} written`;
    const percent = measured ? Math.round(done / measured * 100) : undefined;
    const activity = ledger.stage === "cover" || ledger.stage === "proofread" ? wikiStageName(ledger.stage, zh)
      : ledgerStep === 1 ? zh ? "正在整理" : "Organizing" : wikiStepTitle(ledgerStep, zh);
    const status = retrying ? zh ? "重试中" : "Retrying" : activity;
    const coverage = ledger.coverage;
    const remaining = [
      coverage?.failed ? zh ? `读取失败可重试 · ${coverage.failed} 条` : `${coverage.failed} source messages can be retried` : "",
      coverage?.pending ? zh ? `依据不足待判断 · ${coverage.pending} 条` : `${coverage.pending} source messages need an evidence decision` : "",
    ].filter(Boolean);
    const steps = zh ? ["抽取知识点", "整理目录", "逐章写作"] : ["Extract", "Organize", "Write"];
    const ledgerPanel = <section className="focus-generation-progress" aria-label={title}>
      <div className="focus-generation-stepper" aria-hidden="true">
        {steps.map((stepLabel, idx) => {
          const state = idx < ledgerStep ? "is-done" : idx === ledgerStep ? "is-active" : "is-pending";
          return <div key={stepLabel} className={`focus-stepper-item ${state}`}>
            <span className="focus-stepper-dot">{idx < ledgerStep ? <Check size={11} /> : idx + 1}</span>
            <span className="focus-stepper-label">{stepLabel}</span>
          </div>;
        })}
      </div>
      <div className="focus-generation-heading-row"><strong role="status"><LoaderCircle size={18} aria-hidden="true" />{status}</strong><small>{elapsed}</small></div>
      <div className="focus-generation-meter"><small>{where}</small>{percent != null ? <span>{percent}%</span> : null}</div>
      <progress {...(measured ? { value: done } : {})} max={Math.max(1, measured)} aria-label={zh ? "当前步骤进度" : "Current step progress"} />
      {liveTicker}
      {remaining.length ? <small className="generation-recovery-note">{remaining.join(" · ")}</small> : null}
      <div className="focus-generation-actions"><small className="generation-round">{detail.resumed ? zh ? "从已保存的生成进度继续 · " : "Continuing saved work · " : ""}{zh ? `第 ${ledgerStep + 1}/3 步` : `Step ${ledgerStep + 1} of 3`}</small>{actions}</div>
    </section>;
    return present(ledgerPanel, status, `${zh ? `${ledgerStep + 1}/3 步` : `${ledgerStep + 1}/3`}${percent != null ? ` · ${percent}%` : ""}`);
  }
  const panel = <section className="focus-generation-progress" aria-label={title}>
    <div className="focus-generation-heading-row"><strong role="status"><LoaderCircle size={18} aria-hidden="true" />{retrying ? zh ? "重试中" : "Retrying" : directory ? zh ? "理解与整理来源" : "Read and organize sources" : detail?.stage === "verification" ? zh ? "核对结论与局部纠正" : "Verify claims and local corrections" : detail?.stage === "project" ? zh ? "整理项目方案" : "Consolidate project plan" : labels[step]}</strong><small>{elapsed}</small></div>
    <div className="focus-generation-meter"><small>{scopeKind ? `${zh ? scopeKind === "all" ? "全文整理" : "片段整理" : scopeKind === "all" ? "Whole conversations" : "Selected passages"} · ` : ""}{counts}</small>{total > 0 ? <span>{Math.round(completed / total * 100)}%</span> : null}</div>
    <progress {...(total > 0 ? { value: completed } : {})} max={Math.max(1, total)} aria-label={zh ? "当前阶段进度" : "Current stage progress"} />
    <WikiPlanningStatus progress={detail?.directory} zh={zh}/>
    {liveTicker}
    {recovery ? <small className="generation-recovery-note" role="status">{zh ? `正在分批修复剩余正文 · 已完成 ${completed}/${total} 个步骤` : `Repairing remaining writing in smaller batches · ${completed}/${total} steps complete`}</small> : null}
    <div className="focus-generation-actions">{detail ? <small className="generation-round">{detail.resumed ? zh ? "从已保存的生成进度继续 · " : "Continuing saved work · " : ""}{directory ? detail.directory?.merging ? zh ? "正在合并章节" : "Merging chapters" : zh ? "正在核对主题归属" : "Checking topic ownership" : zh ? `第 ${detail.round} 轮 · ${detail.completed}/${detail.total} 批` : `Round ${detail.round} · ${detail.completed}/${detail.total} batches`}</small> : null}{actions}</div>
  </section>;
  return present(panel, zh ? retrying ? "重试中" : "生成中" : retrying ? "Retrying" : "Generating", total > 0 ? `${Math.round(completed / total * 100)}%` : undefined);
}
