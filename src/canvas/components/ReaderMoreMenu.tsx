import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, SlidersHorizontal, FolderSearch, Trash2, Ellipsis } from "lucide-react";

export function ReaderMoreMenu({ zh, onSources, edits, maintenance = [], danger = [], editStatus, sourcesLabel, flat=false, iconOnly=false }: {
  zh: boolean; sourcesLabel?: string; onSources?: () => void; flat?:boolean; iconOnly?:boolean;
  /** Destructive actions, kept last and apart from editing. */
  danger?: Array<{ label: string; disabled?: boolean; run: () => void }>;
  editStatus?: string;
  maintenance?: Array<{ label: string; disabled?: boolean; run: () => void; title?: string }>;
  edits: Array<{ label: string; disabled?: boolean; run: () => void; title?: string }>;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [page, setPage] = useState<"main" | "edit">("main");
  const close = () => { if (ref.current) { ref.current.open = false; ref.current.querySelector("summary")?.focus(); } setPage("main"); };
  const act = (run: () => void) => { close(); run(); };
  const openPage = (next: "main" | "edit") => { setPage(next); };
  useEffect(() => {
    const outside = (event: PointerEvent) => { if (ref.current?.open && event.target instanceof Node && !ref.current.contains(event.target)) { ref.current.open = false; setPage("main"); } };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  useEffect(() => { if (page !== "main") ref.current?.querySelector<HTMLButtonElement>("button")?.focus(); }, [page]);
  const submenuTitle = page === "edit" ? zh ? "调整内容" : "Edit content" : zh ? "导出文档" : "Export document";
  return <details ref={ref} className="reader-more" onToggle={event => { if (event.target === event.currentTarget && !event.currentTarget.open) setPage("main"); }} onKeyDown={event => {
    if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (page !== "main") { setPage("main"); ref.current?.querySelector("summary")?.focus(); } else close(); }
  }}>
    <summary role="button" aria-label={zh ? "更多" : "More"} title={zh ? "更多操作" : "More actions"} className={iconOnly ? "reader-more-icon" : undefined}>{iconOnly ? <><Ellipsis size={19} aria-hidden="true" /><span className="sr-only">{zh ? "更多" : "More"}</span></> : zh ? "更多" : "More"}</summary>
    <div aria-label={page === "main" ? zh ? "项目操作" : "Project actions" : submenuTitle}>
      {page === "main" ? <>
        {flat?edits.map(item=><button type="button" key={item.label} title={item.title} disabled={item.disabled} onClick={()=>act(item.run)}>{item.label}</button>):edits.length?<button type="button" aria-label={zh ? "调整内容" : "Edit content"} onClick={() => openPage("edit")}><SlidersHorizontal aria-hidden="true" size={15} /><span>{zh ? "调整内容" : "Edit content"}</span><ChevronRight aria-hidden="true" className="reader-menu-chevron" size={14} /></button>:null}
        {onSources?<button type="button" aria-label={sourcesLabel ?? (zh ? "来源对话" : "Source conversations")} onClick={() => act(onSources)}><FolderSearch aria-hidden="true" size={15} /><span>{sourcesLabel ?? (zh ? "来源对话" : "Source conversations")}</span></button>:null}
        {flat&&maintenance.length?<section className="reader-menu-maintenance"><small>{zh?"检查与更新":"Check and update"}</small>{maintenance.map(item=><button type="button" key={item.label} title={item.title} disabled={item.disabled} onClick={()=>act(item.run)}>{item.label}</button>)}</section>:null}
        {flat&&editStatus?<p className="reader-menu-status" role="alert">{editStatus}</p>:null}
        {danger.length?<section className="reader-menu-danger"><small>{zh?"删除（可在回收站恢复）":"Delete (restorable from Trash)"}</small>{danger.map(item=><button type="button" key={item.label} disabled={item.disabled} onClick={()=>act(item.run)}><Trash2 aria-hidden="true" size={15} /><span>{item.label}</span></button>)}</section>:null}
      </> : <>
        <button type="button" className="reader-menu-back" onClick={() => openPage("main")}><ArrowLeft size={14} />{zh ? "返回" : "Back"}<span>{submenuTitle}</span></button>
        {edits.map(item => <button type="button" key={item.label} title={item.title} disabled={item.disabled} onClick={() => act(item.run)}>{item.label}</button>)}
        {maintenance.length ? <section className="reader-menu-maintenance"><small>{zh ? "检查与更新" : "Check and update"}</small>{maintenance.map(item => <button type="button" key={item.label} title={item.title} disabled={item.disabled} onClick={() => act(item.run)}>{item.label}</button>)}</section> : null}
        {editStatus ? <p className="reader-menu-status" role="alert">{editStatus}</p> : null}
      </>}
    </div>
  </details>;
}
