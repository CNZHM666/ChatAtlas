import { useEffect, useRef, useState } from "react";
import { ChevronDown, Pause, Play, RefreshCw } from "lucide-react";
import type { ImportJob } from "../../shared/types";
import { usePreferences } from "../preferences";

export function BackgroundSyncStatus({ job, source, onPause, onResume, onConnect }: {
  job: ImportJob | null; source: "web" | "zip";
  onPause: () => void; onResume: () => void; onConnect: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [expanded, setExpanded] = useState(false);
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!expanded) return;
    const onPointerDown = (event: PointerEvent) => {
      if (hostRef.current && !hostRef.current.contains(event.target as Node)) setExpanded(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [expanded]);

  if (!job) return null;
  const needsConnection = source === "web" && (job.status === "auth_required" || job.status === "unavailable" || job.status === "connecting" && job.diagnostic?.success === false);
  const paused = job.status === "paused";
  const active = ["connecting", "discovering", "syncing", "reconciling"].includes(job.status) && !needsConnection;
  if (!active && !paused && !needsConnection) return null;

  const stateTone = needsConnection ? "is-warning" : paused ? "is-paused" : active ? "is-active" : "";
  const label = needsConnection ? zh ? "同步需连接" : "Connect to sync"
    : paused ? zh ? "同步已暂停" : "Sync paused"
      : source === "zip" ? zh ? "正在导入" : "Importing"
        : job.status === "connecting" ? zh ? "正在连接" : "Connecting"
          : job.retryScope === "titles" ? zh ? "扫描标题" : "Scanning titles"
            : zh ? "后台同步" : "Syncing in background";
  const detail = job.status === "connecting" ? "" : job.retryScope === "selected"
    ? zh ? `剩余 ${job.pendingIds.length} 条` : `${job.pendingIds.length} remaining`
    : source === "zip" ? `${job.completed} / ${job.discovered}`
      : zh ? `已发现 ${job.discovered} 条` : `${job.discovered} found`;

  const totalCount = job.retryScope === "selected"
    ? Math.max(1, job.completed + job.pendingIds.length)
    : Math.max(0, job.discovered);
  const completedCount = job.retryScope === "selected"
    ? Math.max(0, totalCount - job.pendingIds.length)
    : Math.max(0, Math.min(job.completed, totalCount));
  const determinate = totalCount > 0 && job.status !== "connecting" && job.retryScope !== "titles";
  const progressPct = determinate ? Math.max(6, Math.min(100, Math.round((completedCount / totalCount) * 100))) : 0;

  const headline = needsConnection
    ? zh ? "需要重新连接来源 AI" : "Reconnect source AI"
    : paused
      ? zh ? "后台同步已暂停" : "Background sync paused"
      : source === "zip"
        ? zh ? "正在导入对话文件" : "Importing conversation file"
        : job.retryScope === "titles"
          ? zh ? "正在扫描对话标题" : "Scanning conversation titles"
          : zh ? "正在后台同步正文" : "Syncing in background";

  const description = needsConnection
    ? zh ? "请打开并登录对应的 AI 网页后点击重试，已同步的内容会保留。" : "Open and sign in to the source AI page, then retry. Synced items stay saved."
    : paused
      ? zh ? "已同步的内容均已保存，随时可继续剩余任务。" : "Synced conversations are saved. Resume whenever you are ready."
      : source === "zip"
        ? zh ? "可继续阅读或整理项目，导入完成前请保留此标签页。" : "You can keep reading; leave this tab open until file import finishes."
        : zh ? "可继续阅读或整理项目，同步会在后台自动完成。" : "Keep reading or working while sync completes in the background.";

  const actionLabel = needsConnection
    ? zh ? "重新连接" : "Reconnect"
    : paused
      ? zh ? "继续同步" : "Resume sync"
      : zh ? "暂停同步" : "Pause sync";

  return (
    <div ref={hostRef} className={`background-sync${expanded ? " is-open" : ""}`}>
      <button
        type="button"
        className={`background-sync-trigger ${stateTone}`}
        aria-expanded={expanded}
        onClick={() => setExpanded(value => !value)}
      >
        <span className={`sync-state-dot ${stateTone}`} aria-hidden="true" />
        <span role="status" className="background-sync-status-text">
          <span className="background-sync-label">{label}</span>
          {detail ? <small className="background-sync-detail">{detail}</small> : null}
        </span>
        <ChevronDown size={13} className="background-sync-chevron" aria-hidden="true" />
      </button>
      {expanded ? (
        <div className="background-sync-popover" role="region" aria-label={headline}>
          <div className="background-sync-popover-head">
            <span className={`sync-state-dot ${stateTone}`} aria-hidden="true" />
            <strong>{headline}</strong>
            {detail ? <span className="background-sync-popover-badge">{detail}</span> : null}
          </div>
          {!needsConnection ? (
            <div className={`background-sync-progress${!determinate && active ? " is-indeterminate" : ""}${paused ? " is-paused" : ""}`} aria-hidden="true">
              <span style={determinate ? { width: `${progressPct}%` } : undefined} />
            </div>
          ) : null}
          <p className="background-sync-popover-desc">{description}</p>
          {source === "web" ? (
            <div className="background-sync-popover-actions">
              <button
                type="button"
                className={needsConnection || paused ? "is-primary" : "is-subtle"}
                onClick={() => {
                  if (needsConnection) onConnect();
                  else if (paused) onResume();
                  else onPause();
                  setExpanded(false);
                }}
              >
                {needsConnection ? <RefreshCw size={13} aria-hidden="true" /> : paused ? <Play size={13} aria-hidden="true" /> : <Pause size={13} aria-hidden="true" />}
                <span>{actionLabel}</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
