import { Check, ChevronDown, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FocusSession } from "../../shared/focus-session";
import { projectVersionLabels } from "../../shared/project-versions";

/** Versions are independent rows: deleting one never selects it first. */
export function ProjectVersionPicker({ versions, currentId, zh, disabled, onSelect, onDelete }: {
  versions: FocusSession[]; currentId: string; zh: boolean; disabled: boolean;
  onSelect: (id: string) => Promise<void>; onDelete?: (id: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDetailsElement>(null), panelId = useId();
  const [pending, setPending] = useState(false);
  const labels = projectVersionLabels(versions, zh, true);
  const current = versions.find(item => item.id === currentId);
  const metadata = (item: FocusSession) => (labels.get(item.id) ?? item.title).replace(`${item.title} · `, "");
  // Versions of one project share its title: each row leads with its time and chapters, and names a title only when it differs.
  const sameTitle = versions.every(item => item.title === versions[0]?.title);
  const close = () => { if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (event.target instanceof Node && !ref.current?.contains(event.target) && ref.current) ref.current.open = false; };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  const run = async (action: (id: string) => Promise<void>, id: string, selecting: boolean) => {
    if (disabled || pending) return;
    setPending(true);
    if (selecting) close();
    try { await action(id); } finally { setPending(false); }
  };
  return <details ref={ref} className="project-result-picker" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <summary role="button" aria-label={zh ? "整理版本" : "Result versions"} aria-controls={panelId} aria-disabled={disabled || pending} onClick={event => { if (disabled || pending) event.preventDefault(); }}><span><small className="project-result-picker-label">{zh ? `整理版本 · 共 ${versions.length} 个` : `Versions · ${versions.length}`}</small><strong>{current ? metadata(current) : ""}</strong></span><ChevronDown size={15} aria-hidden="true" /></summary>
    <div id={panelId} className="project-version-options" role="group" aria-label={zh ? "选择或删除版本" : "Choose or delete a version"}>
      {versions.map(item => <div className={`project-version-option${item.id === currentId ? " is-current" : ""}`} key={item.id}>
        <button type="button" className="project-version-open" aria-current={item.id === currentId ? "true" : undefined} aria-label={`${zh ? "切换到" : "Switch to"} ${labels.get(item.id)}`} disabled={disabled || pending} onClick={() => void run(onSelect, item.id, true)}><span><strong>{metadata(item)}</strong>{sameTitle ? null : <small>{item.title}</small>}</span>{item.id === currentId ? <Check size={14} aria-hidden="true" /> : null}</button>
        {onDelete ? <button type="button" className="project-version-delete" title={zh ? "删除此版本" : "Delete this version"} aria-label={`${zh ? "删除版本" : "Delete version"} ${labels.get(item.id)}`} disabled={disabled || pending} onClick={() => void run(onDelete, item.id, false)}><Trash2 size={14} aria-hidden="true" /></button> : null}
      </div>)}
      {onDelete ? <p className="project-version-note">{zh ? "删除的版本可在回收站恢复" : "Deleted versions can be restored from Trash"}</p> : null}
    </div>
  </details>;
}
