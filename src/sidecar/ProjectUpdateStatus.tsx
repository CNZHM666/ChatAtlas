import { CircleAlert, CircleCheck, Download, X } from "lucide-react";
import type { UpdatePhase, UpdateIssue } from "./project-update-state";

function DismissNotice({ zh, onDismiss }: { zh: boolean; onDismiss: () => void }) {
  const label = zh ? "关闭提示" : "Dismiss notice";
  return <button type="button" className="native-tool native-update-dismiss" aria-label={label} title={label} onClick={onDismiss}><X size={14} aria-hidden="true"/></button>;
}

export function ProjectNotice({ zh, text, onDismiss, error = false }: { zh: boolean; text: string; onDismiss: () => void; error?: boolean }) {
  return <div className="native-feedback" data-tone={error ? "error" : undefined}>
    <span role={error ? "alert" : "status"}>{text}</span>
    <DismissNotice zh={zh} onDismiss={onDismiss}/>
  </div>;
}

export function ProjectUpdateStatus({ zh, importNeeded, progress, status, issue, onImport, onRetry, onSettings, onDismiss, onCancel, onDismissSaving }: {
  zh: boolean; importNeeded: boolean; progress?: UpdatePhase; status: string; issue?: UpdateIssue;
  onImport: () => void; onRetry: () => void; onSettings: () => void; onDismiss: () => void; onCancel?: () => void; onDismissSaving?: () => void;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  if (progress) {
    const label = progress.label ?? (progress.stage === "importing" ? t("正在导入当前对话…", "Importing this chat…")
      : progress.stage === "reading" ? t("正在读取当前对话…", "Reading this chat…")
        : progress.stage === "saving" ? t("正在写入文档…", "Saving the document…")
          : progress.stage === "organizing" ? t("正在归并主题、规划章节…", "Grouping topics and planning chapters…")
          : progress.stage === "confirming" ? t("等待写作前确认", "Waiting for confirmation")
          : progress.stage === "writing" ? t("正在撰写 Wiki 正文…", "Writing the Wiki…")
          : t("正在整理本轮内容…", "Preparing this update…"));
    const counted = Boolean(progress.total && progress.total > 0);
    return <div className="native-update-feedback native-update-progress" role="status">
      <div className="native-update-progress-row">
        <span>{label}</span>
        {counted && <small>{progress.completed ?? 0} / {progress.total}</small>}
        {onCancel && <button type="button" className="native-tool native-update-action" onClick={onCancel}>
          {progress.stage === "reading" || progress.stage === "importing" ? t("取消", "Cancel") : t("暂停", "Pause")}
        </button>}
        {progress.stage === "saving" && onDismissSaving && <DismissNotice zh={zh} onDismiss={onDismissSaving}/>}
      </div>
      {progress.stage !== "confirming" && <progress aria-label={label} max={counted ? progress.total : undefined} value={counted ? progress.completed : undefined}/>}
    </div>;
  }
  if (!importNeeded && !status && !issue) return null;
  return <div className="native-update-feedback" data-tone={issue ? "error" : importNeeded ? "neutral" : "success"}>
    <div className="native-update-message" role={issue ? "alert" : "status"}>
      {issue ? <CircleAlert size={15} aria-hidden="true"/> : importNeeded ? <Download size={15} aria-hidden="true"/> : <CircleCheck size={15} aria-hidden="true"/>}
      <span>{issue?.message ?? (importNeeded ? t("当前对话尚未导入。", "This chat hasn’t been imported yet.") : status)}</span>
    </div>
    {importNeeded && !issue && <button type="button" className="native-tool native-update-action" onClick={onImport}>{t("导入并更新", "Import and update")}</button>}
    {issue?.action && <button type="button" className="native-tool native-update-action" onClick={issue.action === "settings" ? onSettings : onRetry}>
      {issue.action === "settings" ? t("AI 设置", "AI settings")
        : issue.action === "refresh-preview" ? t("返回文档", "Back to document")
          : issue.action === "retry-smaller" ? t("分小批重试", "Retry in smaller batches") : t("重试", "Retry")}
    </button>}
    <DismissNotice zh={zh} onDismiss={onDismiss}/>
  </div>;
}
