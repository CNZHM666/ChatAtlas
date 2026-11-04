import { ArrowRight, ChevronDown } from "lucide-react";
import type { WikiHistoryEntry } from "../../shared/wiki-history";
import { WikiClaimMarker } from "./WikiClaimMarker";

const STATUS = { confirmed: ["用户决定", "User decision"], proposal: ["提议，未确认", "Proposal, unconfirmed"], documented: ["讨论中的变化", "Change in discussion"] } as const;

/** A chapter's evolution as compact rows: before → after, then status, reason and
 * date in small text. Each row carries the same evidence marker as the prose. */
export function WikiHistoryCard({ entries, markers = {}, zh }: { entries: WikiHistoryEntry[]; markers?: Record<string, string>; zh: boolean }) {
  if (!entries.length) return null;
  const marker = (id: string) => markers[id] ? <WikiClaimMarker pointKey={markers[id]} /> : null;
  return <details className="wiki-history-card">
    <summary><span>{zh ? "演变记录" : "History"}</span><small>{zh ? `${entries.length} 条` : `${entries.length}`}</small><ChevronDown size={15} aria-hidden="true" /></summary>
    <ol>{entries.map(entry => entry.kind === "record" ? <li key={entry.id}>
      <p className="wiki-history-change"><span className="wiki-history-before"><small>{zh ? "此前" : "Before"}</small>{entry.before}</span><ArrowRight size={14} aria-label={zh ? "改为" : "changed to"} /><span className="wiki-history-after"><small>{zh ? "现在" : "Now"}</small>{entry.after}</span>{marker(entry.id)}</p>
      <p className="wiki-history-meta"><span className={`is-${entry.status}`}>{STATUS[entry.status][zh ? 0 : 1]}</span>{entry.reason ? <span>{zh ? "原因：" : "Reason: "}{entry.reason}</span> : null}{entry.date ? <time dateTime={new Date(entry.date).toISOString()}>{new Date(entry.date).toLocaleDateString(zh ? "zh-CN" : "en")}</time> : null}</p>
    </li> : <li key={entry.id}>
      <p className="wiki-history-note">{entry.text}{marker(entry.id)}</p>
      <p className="wiki-history-meta"><span>{zh ? "讨论记录，未整理成结构化变化" : "Discussion note, not a structured change"}</span>{entry.heading ? <span>{zh ? `「${entry.heading}」` : entry.heading}</span> : null}</p>
    </li>)}</ol>
  </details>;
}
