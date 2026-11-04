import type { FocusVersionGroup } from "../focus-versions";
import { useState } from "react";
import { History } from "lucide-react";

export function FocusVersions({ group, zh, onOpen, compact = false }: { group: FocusVersionGroup; zh: boolean; onOpen: (id: string) => void; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (group.versions.length < 2) return null;
  const label = zh ? `历史版本 ${group.versions.length - 1}` : `${group.versions.length - 1} earlier versions`;
  return <details className={`focus-versions${compact ? " focus-versions-compact" : ""}`} open={open}><summary aria-label={label} title={compact ? label : undefined} onClick={(event) => { event.preventDefault(); setOpen(!open); }}>{compact ? <><History size={14} aria-hidden="true" /><span aria-hidden="true">{group.versions.length - 1}</span></> : label}</summary>{open ? <div className="focus-versions-list">{group.versions.slice(1).map((session, index) => <button key={session.id} type="button" onClick={() => onOpen(session.id)}><span>{session.title}</span><small>{zh ? `版本 ${group.versions.length - index - 1}` : `Version ${group.versions.length - index - 1}`} · {new Date(session.createdAt).toLocaleString(zh ? "zh-CN" : "en", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })}{session.sections.length ? zh ? ` · ${session.sections.length} 章` : ` · ${session.sections.length} chapters` : ""}</small></button>)}</div> : null}</details>;
}
