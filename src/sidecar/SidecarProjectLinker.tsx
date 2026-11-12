import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderGit2, Search, X } from "lucide-react";
import type { FocusSession } from "../shared/focus-session";

export function SidecarProjectLinker({ projects, linkedIds, organizedIds = [], selectedId, disabled, zh, onChoose, onUnlink }: {
  projects: FocusSession[]; linkedIds: string[]; selectedId?: string; disabled: boolean; zh: boolean;
  /** Linked projects whose knowledge already includes this conversation: their link is undone in the project. */
  organizedIds?: string[];
  onChoose: (project: FocusSession) => Promise<boolean>;
  /** Undo a link made by mistake, before the project organized the conversation. */
  onUnlink?: (project: FocusSession) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [pending, setPending] = useState(false);
  const [error, setError] = useState(false), [hint, setHint] = useState("");
  const root = useRef<HTMLDivElement>(null), trigger = useRef<HTMLButtonElement>(null), input = useRef<HTMLInputElement>(null);
  const choosing = useRef(false);
  const l = (cn: string, en: string) => zh ? cn : en;
  const active = projects.find(item => item.id === selectedId && linkedIds.includes(item.id)) ?? projects.find(item => linkedIds.includes(item.id));
  const rows = projects.filter(item => `${item.title} ${item.goal}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    .sort((a, b) => Number(linkedIds.includes(b.id)) - Number(linkedIds.includes(a.id)));
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !choosing.current) setOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  const choose = async (project: FocusSession) => {
    if (disabled || choosing.current) return;
    choosing.current = true; setPending(true); setError(false);
    try { if (await onChoose(project)) { setOpen(false); trigger.current?.focus(); } }
    catch { setError(true); }
    finally { choosing.current = false; setPending(false); }
  };
  const unlink = async (project: FocusSession) => {
    if (disabled || choosing.current || !onUnlink) return;
    choosing.current = true; setPending(true); setError(false);
    try { if (!await onUnlink(project)) setError(true); }
    catch { setError(true); }
    finally { choosing.current = false; setPending(false); }
  };
  return <div ref={root} className="sidecar-project-linker" onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="sidecar-text-button sidecar-linked-project" aria-label={l("关联项目", "Link project")} aria-expanded={open} disabled={disabled || pending} title={active?.title ?? l("将当前对话关联到项目", "Link this conversation to a project")} onClick={() => { setQuery(""); setHint(""); setOpen(value => !value); }}><FolderGit2 size={12}/><span>{active?.title ?? l("关联项目", "Link project")}{linkedIds.length > 1 ? ` +${linkedIds.length - 1}` : ""}</span><ChevronDown size={12}/></button>
    {open ? <section className="sidecar-link-picker" aria-label={l("选择关联项目", "Choose linked project")}>
      <label><Search size={14}/><input ref={input} type="search" aria-label={l("搜索项目", "Search projects")} placeholder={l("搜索项目…", "Search projects…")} value={query} disabled={pending} onChange={event => setQuery(event.target.value)}/></label>
      <div className="sidecar-link-picker-list">{rows.map(project => { const linked = linkedIds.includes(project.id), organized = organizedIds.includes(project.id); return <div key={project.id} className="sidecar-link-row">
        <button className="sidecar-link-choose" disabled={disabled || pending} aria-label={l(`${linked ? "使用已关联项目" : "关联到"}：${project.title}`, `${linked ? "Use linked project" : "Link to"}: ${project.title}`)} onClick={() => void choose(project)}><FolderGit2 size={15}/><span>{project.title}</span><small>{linked ? <><Check size={13}/>{l("已关联", "Linked")}</> : l("关联", "Link")}</small></button>
        {linked && onUnlink ? <button className="sidecar-link-undo" disabled={disabled || pending} aria-disabled={organized || undefined} aria-label={l(`取消关联：${project.title}`, `Unlink: ${project.title}`)} title={organized ? l("已整理进项目知识，请在项目的「调整项目材料」中移除", "Already organized into the project; remove it under Change project materials") : l("取消关联", "Unlink")} onClick={() => organized ? setHint(l("这段对话已整理进项目知识，请在项目里用「调整项目材料」移除。", "This conversation is already in the project knowledge; remove it under Change project materials in the project.")) : void unlink(project)}><X size={13}/></button> : null}
      </div>; })}</div>
      {!rows.length ? <p>{projects.length ? l("没有匹配的项目", "No matching projects") : l("暂无项目", "No projects yet.")}</p> : null}
      {hint ? <p role="status">{hint}</p> : null}
      {error ? <p role="alert">{l("操作未完成，请重试。", "Could not update the link. Try again.")}</p> : null}
    </section> : null}
  </div>;
}
