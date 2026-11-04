import { useEffect, useRef, useState } from "react";
import { LoaderCircle } from "lucide-react";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import type { FocusMode, FocusScope } from "../../shared/focus-session";
import {WikiPlanningStatus} from "./WikiPlanningStatus";
import { wikiProgressStep, wikiStageCount, wikiStageName, wikiStepTitle } from "../../shared/wiki-progress-labels";

export function FocusGenerationProgress({ zh, detail, sourceCount, retrying, mode = "review", scopeKind, onCancel, compact = false }: { zh: boolean; detail?: FocusAnalysisProgress; sourceCount: number; retrying: boolean; mode?: FocusMode; scopeKind?: FocusScope["kind"]; onCancel: () => void; compact?: boolean }) {
  const clockStart = useRef(Date.now() - (detail?.elapsedMs ?? 0));
  const [seconds, setSeconds] = useState(() => Math.floor((detail?.elapsedMs ?? 0) / 1000));
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => { const timer = setInterval(() => setSeconds(Math.floor((Date.now() - clockStart.current) / 1000)), 1000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!compact) return;
    const closeOutside = (event: PointerEvent) => { if (menu.current && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false; };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && menu.current?.open) { menu.current.open = false; menu.current.querySelector("summary")?.focus(); } };
    document.addEventListener("pointerdown", closeOutside); document.addEventListener("keydown", closeOnEscape);
    return () => { document.removeEventListener("pointerdown", closeOutside); document.removeEventListener("keydown", closeOnEscape); };
  }, [compact]);
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
    const where = ledgerStep === 0 ? zh ? `${wikiStageCount(ledger, zh)} · ${sourceCount} 条对话` : `${wikiStageCount(ledger, zh)} · ${sourceCount} sources` : ledgerStep === 1 ? `${wikiStageName(ledger.stage, zh, true)}${measured ? ` · ${wikiStageCount(ledger, zh)}` : ""}` : zh ? `已写 ${wikiStageCount(ledger, zh)}` : `${wikiStageCount(ledger, zh)} written`;
    const percent = measured ? Math.round(done / measured * 100) : undefined;
    const ledgerPanel = <section className="focus-generation-progress" aria-label={zh ? "生成进度" : "Generation progress"}>
      <div className="focus-generation-heading-row"><strong role="status"><LoaderCircle size={18} aria-hidden="true" />{retrying ? zh ? "重试中" : "Retrying" : wikiStepTitle(ledgerStep, zh)}</strong><small>{zh ? seconds < 60 ? `已用 ${seconds} 秒` : `已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds}s elapsed`}</small></div>
      <div className="focus-generation-meter"><small>{where}</small>{percent != null ? <span>{percent}%</span> : null}</div>
      <progress {...(measured ? { value: done } : {})} max={Math.max(1, measured)} aria-label={zh ? "当前步骤进度" : "Current step progress"} />
      <div className="focus-generation-actions"><small className="generation-round">{detail.resumed ? zh ? "从已保存的生成进度继续 · " : "Continuing saved work · " : ""}{zh ? `第 ${ledgerStep + 1}/3 步` : `Step ${ledgerStep + 1} of 3`}</small><button type="button" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button></div>
    </section>;
    return compact ? <details ref={menu} className="focus-header-progress"><summary aria-label={zh ? "查看生成进度" : "View generation progress"}><LoaderCircle size={15} aria-hidden="true" /><span>{zh ? retrying ? "重试中" : "生成中" : retrying ? "Retrying" : "Generating"}</span><small>{zh ? `${ledgerStep + 1}/3 步` : `${ledgerStep + 1}/3`}{percent != null ? ` · ${percent}%` : ""}</small></summary><div className="focus-header-progress-popover">{ledgerPanel}</div></details> : ledgerPanel;
  }
  const panel = <section className="focus-generation-progress" aria-label={zh ? "生成进度" : "Generation progress"}>
    <div className="focus-generation-heading-row"><strong role="status"><LoaderCircle size={18} aria-hidden="true" />{retrying ? zh ? "重试中" : "Retrying" : directory ? zh ? "理解与整理来源" : "Read and organize sources" : detail?.stage === "verification" ? zh ? "核对结论与局部纠正" : "Verify claims and local corrections" : detail?.stage === "project" ? zh ? "整理项目方案" : "Consolidate project plan" : labels[step]}</strong><small>{zh ? seconds < 60 ? `已用 ${seconds} 秒` : `已用 ${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds}s elapsed`}</small></div>
    <div className="focus-generation-meter"><small>{scopeKind ? `${zh ? scopeKind === "all" ? "全文整理" : "片段整理" : scopeKind === "all" ? "Whole conversations" : "Selected passages"} · ` : ""}{counts}</small>{total > 0 ? <span>{Math.round(completed / total * 100)}%</span> : null}</div>
    <progress {...(total > 0 ? { value: completed } : {})} max={Math.max(1, total)} aria-label={zh ? "当前阶段进度" : "Current stage progress"} />
    <WikiPlanningStatus progress={detail?.directory} zh={zh}/>
    {recovery ? <small className="generation-recovery-note" role="status">{zh ? `正在分批修复剩余正文 · 已完成 ${completed}/${total} 个步骤` : `Repairing remaining writing in smaller batches · ${completed}/${total} steps complete`}</small> : null}
    <div className="focus-generation-actions">{detail ? <small className="generation-round">{detail.resumed ? zh ? "从已保存的生成进度继续 · " : "Continuing saved work · " : ""}{directory ? detail.directory?.merging ? zh ? "正在合并章节" : "Merging chapters" : zh ? "正在核对主题归属" : "Checking topic ownership" : zh ? `第 ${detail.round} 轮 · ${detail.completed}/${detail.total} 批` : `Round ${detail.round} · ${detail.completed}/${detail.total} batches`}</small> : null}<button type="button" onClick={onCancel}>{zh ? "取消" : "Cancel"}</button></div>
  </section>;
  return compact ? <details ref={menu} className="focus-header-progress"><summary aria-label={zh ? "查看生成进度" : "View generation progress"}><LoaderCircle size={15} aria-hidden="true" /><span>{zh ? retrying ? "重试中" : "生成中" : retrying ? "Retrying" : "Generating"}</span>{total > 0 ? <small>{Math.round(completed / total * 100)}%</small> : null}</summary><div className="focus-header-progress-popover">{panel}</div></details> : panel;
}
