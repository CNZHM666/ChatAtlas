import { useState } from "react";
import type { ImportJob } from "../../shared/types";
import { usePreferences } from "../preferences";

export function BackgroundSyncStatus({ job, source, onPause, onResume, onConnect }: {
  job: ImportJob | null; source: "web" | "zip";
  onPause: () => void; onResume: () => void; onConnect: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [expanded, setExpanded] = useState(false);
  if (!job) return null;
  const needsConnection = source === "web" && (job.status === "auth_required" || job.status === "unavailable" || job.status === "connecting" && job.diagnostic?.success === false);
  const paused = job.status === "paused";
  const active = ["connecting", "discovering", "syncing", "reconciling"].includes(job.status) && !needsConnection;
  if (!active && !paused && !needsConnection) return null;
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
  return <div className="background-sync">
    <button type="button" className="background-sync-trigger" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className={`sync-state-dot ${active ? "is-active" : ""}`} aria-hidden="true" /><span role="status">{label}{detail ? <small>{detail}</small> : null}</span></button>
    {expanded ? <div className="background-sync-popover">
      <p>{needsConnection ? zh ? "打开并登录来源 AI 后重试。" : "Open the source AI, sign in and retry." : source === "zip" ? zh ? "可以继续使用 ChatAtlas；文件导入完成前请保留此页面。" : "Keep using ChatAtlas, but leave this page open until the file import finishes." : zh ? "可以继续阅读或处理项目，同步会在后台进行。" : "Keep reading or working while sync continues in the background."}</p>
      {source === "web" ? <button type="button" onClick={() => { if (needsConnection) onConnect(); else if (paused) onResume(); else onPause(); setExpanded(false); }}>{needsConnection ? zh ? "重新连接" : "Reconnect" : paused ? zh ? "继续同步" : "Resume sync" : zh ? "暂停同步" : "Pause sync"}</button> : null}
    </div> : null}
  </div>;
}
