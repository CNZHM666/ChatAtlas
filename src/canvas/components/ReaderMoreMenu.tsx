import { useEffect, useId, useRef, useState } from "react";
import { ArrowLeft, ChevronDown, ChevronRight, SlidersHorizontal, FolderSearch, Trash2, Ellipsis, type LucideIcon } from "lucide-react";

type Action = { label: string; disabled?: boolean; run: () => void; title?: string; icon?: LucideIcon };
type Page = "main" | "edit";

export function ReaderMoreMenu({ zh, onSources, edits, checks = [], maintenance = [], danger = [], editStatus, sourcesLabel, flat=false, iconOnly=false }: {
  zh: boolean; sourcesLabel?: string; onSources?: () => void; flat?:boolean; iconOnly?:boolean;
  /** Destructive actions, kept last and apart from editing. */
  danger?: Action[];
  editStatus?: string;
  checks?: Action[];
  maintenance?: Action[];
  edits: Action[];
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [page, setPage] = useState<Page>("main");
  const [deleteOpen, setDeleteOpen] = useState(false);
  const deleteTrigger = useRef<HTMLButtonElement>(null);
  const deleteId = useId();
  const close = () => { if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } setPage("main"); setDeleteOpen(false); };
  const act = (run: () => void) => { close(); run(); };
  const backToMain = () => {
    setPage("main");
    ref.current?.querySelector("summary")?.focus();
  };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) { ref.current.open = false; setPage("main"); setDeleteOpen(false); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => {
    if (page !== "main") ref.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [page]);
  useEffect(() => {
    if (deleteOpen) ref.current?.querySelector(".reader-menu-danger > button:last-child")?.scrollIntoView?.({ block: "nearest" });
  }, [deleteOpen]);
  const deleteLabel = zh ? "删除选项" : "Delete options";
  const submenuTitle = zh ? "调整内容" : "Edit content";
  const renderAction = (item: Action, fallbackIcon?: LucideIcon) => {
    const Icon = fallbackIcon ?? (flat ? item.icon : undefined);
    return <button type="button" key={item.label} title={item.title} disabled={item.disabled} onClick={() => act(item.run)}>
      {Icon && <Icon size={15} aria-hidden="true" />}<span>{item.label}</span>
    </button>;
  };
  const removeSection = <section className="reader-menu-danger" id={deleteId} hidden={flat && !deleteOpen}>
    <small>{zh ? "可在回收站恢复" : "Restorable from Trash"}</small>
    {danger.map(item => renderAction(item, Trash2))}
  </section>;
  return <details ref={ref} className={flat ? "reader-more is-project-menu" : "reader-more"} onToggle={event => {
    if (event.target === event.currentTarget && !event.currentTarget.open) { setPage("main"); setDeleteOpen(false); }
  }} onKeyDown={event => {
    if (event.key !== "Escape") return;
    event.stopPropagation();
    event.preventDefault();
    if (page !== "main") backToMain();
    else if (deleteOpen) { setDeleteOpen(false); deleteTrigger.current?.focus(); }
    else close();
  }}>
    <summary role="button" aria-label={zh ? "更多" : "More"} title={zh ? "更多操作" : "More actions"} className={iconOnly ? "reader-more-icon" : undefined}>{iconOnly ? <><Ellipsis size={19} aria-hidden="true" /><span className="sr-only">{zh ? "更多" : "More"}</span></> : zh ? "更多" : "More"}</summary>
    <div aria-label={page === "main" ? zh ? "项目操作" : "Project actions" : submenuTitle}>
      {page === "main" ? <>
        {flat ? edits.length > 0 && <section className="reader-menu-group">{edits.map(item => renderAction(item))}</section> : edits.length > 0 &&
          <button type="button" onClick={() => setPage("edit")}><SlidersHorizontal aria-hidden="true" size={15} /><span>{zh ? "调整内容" : "Edit content"}</span><ChevronRight aria-hidden="true" className="reader-menu-chevron" size={14} /></button>}
        {onSources?<button type="button" aria-label={sourcesLabel ?? (zh ? "来源对话" : "Source conversations")} onClick={() => act(onSources)}><FolderSearch aria-hidden="true" size={15} /><span>{sourcesLabel ?? (zh ? "来源对话" : "Source conversations")}</span></button>:null}
        {flat && checks.length > 0 && <section className="reader-menu-group"><small>{zh ? "版本与日志" : "Versions and logs"}</small>{checks.map(item => renderAction(item))}</section>}
        {flat && maintenance.length > 0 && <section className="reader-menu-group"><small>{zh ? "写作" : "Writing"}</small>{maintenance.map(item => renderAction(item))}</section>}
        {flat&&editStatus?<p className="reader-menu-status" role="alert">{editStatus}</p>:null}
        {danger.length > 0 && (flat ? <section className="reader-menu-group reader-menu-delete">
          <button type="button" ref={deleteTrigger} aria-expanded={deleteOpen} aria-controls={deleteId} onClick={() => setDeleteOpen(!deleteOpen)}>
            <Trash2 size={15} aria-hidden="true" /><span>{deleteLabel}</span><ChevronDown size={14} className="reader-menu-chevron" aria-hidden="true" />
          </button>
          {removeSection}
        </section> : removeSection)}
      </> : <>
        <button type="button" className="reader-menu-back" onClick={backToMain}><ArrowLeft size={14} aria-hidden="true" />{zh ? "返回" : "Back"}<span>{submenuTitle}</span></button>
        {edits.map(item => renderAction(item))}
        {maintenance.length > 0 && <section className="reader-menu-maintenance"><small>{zh ? "检查与更新" : "Check and update"}</small>{maintenance.map(item => renderAction(item))}</section>}
        {editStatus && <p className="reader-menu-status" role="alert">{editStatus}</p>}
      </>}
    </div>
  </details>;
}
