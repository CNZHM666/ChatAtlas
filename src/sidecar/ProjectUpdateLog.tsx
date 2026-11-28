import { useState } from "react";
import { Copy } from "lucide-react";
import type { ProjectUpdateLogEntry } from "./project-update-log";
import { wikiStageLabel } from "./first-wiki-client";

const stageLabel = {
  reading: ["读取对话", "Read chat"], importing: ["导入正文", "Import messages"],
  analyzing: ["提取更新", "Extract changes"], organizing: ["规划章节目录", "Plan chapters"],
  confirming: ["写作前确认", "Confirm before writing"], writing: ["按章写作", "Write chapters"], saving: ["写入文档", "Save changes"],
} as const;
const stateLabel = {
  started: ["开始", "Started"], waiting: ["等待导入确认", "Waiting for import"],
  finished: ["完成", "Complete"], partial: ["部分通过", "Partially verified"], failed: ["失败", "Failed"],
} as const;
const writingReasons: Record<string, [string, string]> = {
  condition: ["遗漏条件、例外或否定限制", "Missing condition, exception, or negation"],
  detail: ["数字、技术标识或约束细节未对齐", "Numbers, identifiers, or exact details did not match"],
  status: ["决定状态或确认范围有误", "Decision status or scope did not match"],
  evidence: ["表述与来源依据未对齐", "Claim did not match its evidence"],
  placement: ["章节范围或内容归属有误", "Incorrect chapter placement or scope"],
  incomplete: ["正文不完整", "Incomplete text"],
  "content-check": ["正文未通过内容校验", "Text did not pass content checks"],
  "model-output": ["模型响应未通过格式校验或请求失败", "Model response failed validation or the request failed"],
  "cached-review": ["复核缓存章节时发现问题", "A cached chapter failed revalidation"],
  invariants: ["整章校核未通过", "Chapter consistency checks failed"],
  coverage: ["关键知识覆盖不足", "Missing knowledge coverage"], missing: ["遗漏需保留的结论", "Required conclusion missing"],
  earlier_as_current: ["把早期方案写成当前方案", "Earlier plan represented as current"],
  user_as_ai: ["用户内容归给了 AI", "User statement attributed to AI"], ai_as_user: ["AI 建议归给了用户", "AI proposal attributed to the user"],
  rejected_as_current: ["把已否决方案写成当前方案", "Rejected plan represented as current"],
  declined_overstated: ["扩大了否决范围", "Overstated the rejection scope"], repeat: ["重复写入同一结论", "Repeated conclusion"],
};

export function ProjectUpdateLog({ entries, zh, id }: { entries: ProjectUpdateLogEntry[]; zh: boolean; id: string }) {
  const [copyState, setCopyState] = useState<"copied" | "failed">();
  const t = (cn: string, en: string) => zh ? cn : en;
  const time = new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const copy = async () => {
    try {
      const extensionVersion = chrome.runtime.getManifest?.().version;
      await navigator.clipboard.writeText(JSON.stringify({ extensionVersion, entries }, null, 2));
      setCopyState("copied");
    } catch { setCopyState("failed"); }
  };
  return <section id={id} className="native-update-log" aria-label={t("更新日志", "Update log")}>
    <div className="native-update-log-heading">
      <strong>{t("更新日志", "Update log")}</strong>
      {entries.length > 0 && <button type="button" className="native-tool" onClick={() => void copy()}>
        <Copy size={13} aria-hidden="true" />{t("复制日志", "Copy log")}
      </button>}
    </div>
    {copyState && <p role="status">{copyState === "copied" ? t("日志已复制。", "Log copied.") : t("无法访问剪贴板，可手动选取日志。", "Clipboard unavailable. Select the log text to copy it.")}</p>}
    {entries.length ? <ul>
    {[...entries].reverse().map((entry, index) => <li key={`${entry.at}:${index}`} data-failed={entry.state === "failed" || entry.state === "partial" || undefined}>
        <div><time dateTime={new Date(entry.at).toISOString()}>{time.format(entry.at)}</time> <strong>{entry.writingEvent ? `${entry.writingEvent.chapter} · ${entry.writingEvent.kind === "chapter" ? t("已写完", "Written") : entry.writingEvent.scope === "chapter" ? t("重写整章", "Rewrite chapter") : entry.writingEvent.scope === "paragraph" ? t("重写段落", "Rewrite paragraph") : t("重写部分内容", "Rewrite part")}`
          : `${(entry.wikiStage ? wikiStageLabel[entry.wikiStage] : stageLabel[entry.stage])[zh ? 0 : 1]} · ${stateLabel[entry.state][zh ? 0 : 1]}`}</strong>
          {entry.total ? <small>{entry.completed ?? 0} / {entry.total}</small> : null}
          {entry.smallerBatches && <small>{t("小批次", "Small batches")}</small>}
        </div>
        {entry.reason && <p>{entry.reason}</p>}
        {entry.writingEvent?.reasons?.length ? <p>{entry.writingEvent.reasons.map(reason => (writingReasons[reason] ?? writingReasons["content-check"])[zh ? 0 : 1]).join(" · ")}</p> : null}
        {entry.writingEvent?.code && /^[\w:-]{1,90}$/u.test(entry.writingEvent.code) && <code>{entry.writingEvent.code}</code>}
        {entry.code && <code>{entry.code}{entry.error ? ` · ${entry.error}` : ""}</code>}
        {Array.isArray(entry.fields) && entry.fields.length > 0 && <p>{t("未通过的字段", "Invalid fields")} <code>{entry.fields.join(", ")}</code></p>}
      </li>)}
    </ul> : <p>{t("还没有更新记录。", "No update entries yet.")}</p>}
  </section>;
}
