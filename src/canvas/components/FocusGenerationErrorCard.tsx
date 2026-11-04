import { CircleAlert, ChevronDown, CheckCircle2, Settings } from "lucide-react";
import type { ReactNode } from "react";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import { generationFailureReason } from "../generation-notice";
import {WikiPlanningStatus} from "./WikiPlanningStatus";

export function FocusGenerationErrorCard({ zh, message, code, progress, diagnostics, onRetry, onSources, onSettings, onAuthorize, status }: {
  zh: boolean; message: string; code?: string; progress?: FocusAnalysisProgress; diagnostics?: ReactNode;
  onRetry?: () => void; onSources: () => void; onSettings: () => void; onAuthorize?: () => void; status?: string;
}) {
  const directoryError = code !== "PROVIDER_SCHEMA_wiki_directory_missing_owner" && (code?.startsWith("PROVIDER_SCHEMA_wiki_directory") || /Invalid Wiki|Wiki directory must|Wiki subtopic/iu.test(message));
  const routingError = code === "PROVIDER_SCHEMA_wiki_directory_topic_key" || code === "PROVIDER_SCHEMA_wiki_directory_duplicate_topic_key";
  const recoveryPaused=code==="PROVIDER_SCHEMA_wiki_writing_recovery_limit";
  const reason = generationFailureReason(message, code, zh);
  const processed = progress?.processedSegments ?? 0;
  const complete = processed > 0 && processed === progress?.totalSegments;
  const writing=complete&&progress?.final&&progress.stage==="synthesis"&&!directoryError;
  return <section className="focus-error-card focus-generation-error" role="alert">
    <div className="focus-generation-error-heading"><span className="focus-error-icon"><CircleAlert size={20} aria-hidden="true" /></span><h1>{recoveryPaused?zh?"正文补写已暂停":"Writing completion paused":zh ? "生成暂时中断" : "Generation paused"}</h1></div>
    <p className="focus-generation-error-reason">{reason}</p>
    {directoryError?<p>{progress?.phase==="directory"?(zh?"当前停在目录核对，正文尚未开始；重试将继续处理未完成的目录。":"Paused at directory review; writing has not started. Retry continues the unfinished directory."):(zh?"目录核对未通过，已完成的材料分析和合法结果会保留；重试将继续未完成步骤。":"Directory review failed. Completed analysis and valid results are retained; retry continues unfinished steps.")}</p>:null}
    {directoryError?<WikiPlanningStatus progress={progress?.directory} zh={zh} paused/>:null}
    {processed > 0 ? <div className="focus-error-retained"><CheckCircle2 size={17} aria-hidden="true"/><div><strong>{complete ? zh ? `材料分析已完成（${processed} 段）` : `Material analysis complete (${processed} passages)` : zh ? `已分析 ${processed}/${progress?.totalSegments || "…"} 段` : `${processed}/${progress?.totalSegments || "…"} passages analyzed`}</strong>{writing ? <p>{zh ? `正文完成 ${progress.completed}/${progress.total} 个步骤` : `${progress.completed}/${progress.total} writing steps complete`}{progress.recoverySplits ? zh ? "（含分批修复）" : " (including split repairs)" : ""}</p> : null}<p>{zh ? "已完成的批次会复用，重试后继续剩余内容。" : "Completed batches will be reused. Retry continues the remaining work."}</p></div></div> : null}
    <div className="focus-error-actions">{onAuthorize ? <button type="button" className="primary" onClick={onAuthorize}>{zh ? "授权连接" : "Authorize connection"}</button> : null}{onRetry ? <button type="button" className={onAuthorize ? undefined : "primary"} onClick={onRetry}>{recoveryPaused?zh?"继续补写":"Continue writing":routingError && complete ? zh ? "重试目录" : "Retry directory" : zh ? "重试生成" : "Retry"}</button> : null}<button type="button" onClick={onSources}>{zh ? "调整来源" : "Change sources"}</button></div>
    <div className="focus-error-footer"><div className="focus-error-diagnostics">{diagnostics ?? (reason !== message || code ? <details><summary>{zh ? "诊断信息" : "Diagnostic details"}<ChevronDown size={14}/></summary>{code ? <p>{code}</p> : null}<p>{message}</p>{recoveryPaused ? <p>{zh ? "这是自动修复上限，不是账户余额不足。" : "This is a repair limit, not an account-balance error."}</p> : null}</details> : null)}</div><button type="button" className="focus-error-settings" onClick={onSettings}><Settings size={14} aria-hidden="true" />{zh ? "AI 设置" : "AI settings"}</button></div>
    {status ? <small className="focus-error-status" role="status">{generationFailureReason(status,undefined,zh)}</small> : null}
  </section>;
}
