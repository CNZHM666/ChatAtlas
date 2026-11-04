import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, FolderGit2, Search } from "lucide-react";
import type { FocusSession } from "../shared/focus-session";

export function SidecarProjectLinker({ projects, linkedIds, selectedId, disabled, zh, onChoose }: {
  projects: FocusSession[]; linkedIds: string[]; selectedId?: string; disabled: boolean; zh: boolean;
  onChoose: (project: FocusSession) => Promise<boolean>;
}) {
  const [open, setOpen] = useState(false), [query, setQuery] = useState(""), [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
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
  return <div ref={root} className="sidecar-project-linker" onKeyDown={event => { if (event.key === "Escape" && open) { event.stopPropagation(); setOpen(false); trigger.current?.focus(); } }}>
    <button ref={trigger} className="sidecar-text-button sidecar-linked-project" aria-label={l("关联项目", "Link project")} aria-expanded={open} disabled={disabled || pending} title={active?.title ?? l("将当前对话关联到项目", "Link this conversation to a project")} onClick={() => { setQuery(""); setOpen(value => !value); }}><FolderGit2 size={12}/><span>{active?.title ?? l("关联项目", "Link project")}{linkedIds.length > 1 ? ` +${linkedIds.length - 1}` : ""}</span><ChevronDown size={12}/></button>
    {open ? <section className="sidecar-link-picker" aria-label={l("选择关联项目", "Choose linked project")}>
      <label><Search size={14}/><input ref={input} type="search" aria-label={l("搜索项目", "Search projects")} placeholder={l("搜索项目…", "Search projects…")} value={query} disabled={pending} onChange={event => setQuery(event.target.value)}/></label>
      <div className="sidecar-link-picker-list">{rows.map(project => <button key={project.id} disabled={disabled || pending} aria-label={l(`${linkedIds.includes(project.id) ? "使用已关联项目" : "关联到"}：${project.title}`, `${linkedIds.includes(project.id) ? "Use linked project" : "Link to"}: ${project.title}`)} onClick={() => void choose(project)}><FolderGit2 size={15}/><span>{project.title}</span><small>{linkedIds.includes(project.id) ? <><Check size={13}/>{l("已关联", "Linked")}</> : l("关联", "Link")}</small></button>)}</div>
      {!rows.length ? <p>{projects.length ? l("没有匹配的项目", "No matching projects") : l("暂无项目", "No projects yet.")}</p> : null}
      {error ? <p role="alert">{l("关联未完成，请重试。", "Could not link. Try again.")}</p> : null}
    </section> : null}
  </div>;
}
