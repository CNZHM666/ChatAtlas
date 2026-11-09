import { Check, Circle, CircleDot, Pencil, Sparkles, Trash2, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { AtlasCanvas, OrganizationRun } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import { projectVersionLabels } from "../../shared/project-versions";
import { localizeKnowledgeCanvasTitle } from "../knowledge-labels";
import { usePreferences } from "../preferences";
import { TaskSidebarSection } from "./TaskSidebarSection";
import { BrandMark } from "../../shared/BrandMark";

interface MapSidebarProps {
  canvases: AtlasCanvas[];
  activeId: string;
  onDelete?: (id: string) => void;
  deletedProjects?: AtlasCanvas[];
  onRestore?: (id: string) => void;
  /** Deleted versions of live projects, restorable one by one. */
  deletedVersions?: FocusSession[];
  onRestoreVersion?: (id: string) => void;
  onEmptyTrash?: () => Promise<void>;
  onSelect: (id: string) => void;
  onRename: (id: string, name: string) => void;
  previewIds?: Set<string>;
  tasks?: OrganizationRun[];
  activeTaskId?: string | null;
  onSelectTask?: (id: string) => void;
  onTaskHistory?: () => void;
}

export function MapSidebar({ canvases, activeId, onSelect, onRename, onDelete, deletedProjects = [], onRestore, deletedVersions = [], onRestoreVersion, onEmptyTrash, previewIds = new Set(), tasks = [], activeTaskId = null, onSelectTask }: MapSidebarProps) {
  const { locale, t } = usePreferences();
  const versionLabels = projectVersionLabels(deletedVersions, locale === "zh-CN", true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const trashRef = useRef<HTMLDetailsElement>(null);
  const [trashOpen, setTrashOpen] = useState(false), [confirmEmpty, setConfirmEmpty] = useState(false), [emptying, setEmptying] = useState(false), [trashError, setTrashError] = useState(false);
  const emptyTrash = async () => {
    if (!onEmptyTrash || emptying) return;
    setEmptying(true); setTrashError(false);
    try { await onEmptyTrash(); setConfirmEmpty(false); } catch { setTrashError(true); }
    finally { setEmptying(false); }
  };
  const [width, setWidth] = useState(() => Math.min(380, Math.max(200, Number(localStorage.getItem("atlas-map-sidebar-width")) || 240)));
  const resizeStart = useRef<{ x: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => inputRef.current?.focus(), [editingId]);

  const submit = () => {
    const next = name.trim();
    if (!next || !editingId) return;
    onRename(editingId, next);
    setName("");
    setEditingId(null);
  };

  return (
    <aside className="map-sidebar" aria-label={locale === "zh-CN" ? "工作区导航" : "Workspace navigation"} style={{ "--map-sidebar-width": `${width}px` } as CSSProperties}>
      <div className="map-sidebar-brand" aria-label="ChatAtlas"><BrandMark className="map-sidebar-brand-mark" /><strong>ChatAtlas</strong></div>
      {canvases.filter((canvas) => canvas.type === "overview").map((canvas) => <div key={canvas.id} className={`map-item sidebar-home ${canvas.id === activeId ? "active" : ""}`}><button className="map-select" aria-current={canvas.id === activeId ? "page" : undefined} onClick={() => onSelect(canvas.id)}><CircleDot className="overview-orb-icon" size={13} /><span>{locale === "zh-CN" ? "工作台首页" : "Workbench home"}</span></button></div>)}
      <div className="map-sidebar-heading"><span>{locale === "zh-CN" ? "我的项目" : "My projects"}</span></div>
      <div className="map-list">
        {canvases.filter((canvas) => canvas.type !== "overview").map((canvas, index) => editingId === canvas.id ? (
          <div className="map-inline-form" key={canvas.id}>
            <input ref={inputRef} value={name} aria-label={locale === "zh-CN" ? "项目名称" : "Project name"} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); if (event.key === "Escape") setEditingId(null); }} />
            <button onClick={submit}><Check size={13} /></button>
            <button onClick={() => setEditingId(null)}><X size={13} /></button>
          </div>
        ) : (
          <div
            className={`map-item ${canvas.id === activeId ? "active" : ""} ${previewIds.has(canvas.id) ? "is-preview" : ""}`}
            key={canvas.id}
            style={previewIds.has(canvas.id) ? { animationDelay: `${Math.max(0, index - 1) * 70}ms` } : undefined}
          >
            <button className="map-select" aria-current={canvas.id === activeId ? "page" : undefined} onClick={() => onSelect(canvas.id)}>
              {canvas.type === "overview" ? <CircleDot className="overview-orb-icon" size={13} /> : previewIds.has(canvas.id) ? <Sparkles className="preview-spark" size={12} /> : <Circle className="topic-dot-icon" size={7} />}
              <span>{canvas.type === "overview" ? locale === "zh-CN" ? "首页" : "Home" : localizeKnowledgeCanvasTitle(canvas.title ?? canvas.name, locale)}</span>
            </button>
            <div className="map-item-actions">{canvas.type !== "overview" && !previewIds.has(canvas.id) ? <button type="button" className="map-rename" aria-label={`${t("renameMap")} ${canvas.title ?? canvas.name}`} title={t("renameMap")} onClick={() => { setEditingId(canvas.id); setName(canvas.title ?? canvas.name); }}><Pencil size={12} /></button> : null}
            {onDelete && !previewIds.has(canvas.id) ? <button type="button" className="map-delete" aria-label={`${locale === "zh-CN" ? "删除项目" : "Delete project"} ${canvas.title ?? canvas.name}`} title={locale === "zh-CN" ? "删除项目" : "Delete project"} onClick={() => onDelete(canvas.id)}><Trash2 size={13} /></button> : null}</div>
          </div>
        ))}
      </div>
      {(deletedProjects.length && onRestore) || (deletedVersions.length && onRestoreVersion) ? <details ref={trashRef} className="project-trash" onToggle={event => { setTrashOpen(event.currentTarget.open); if (!event.currentTarget.open && !emptying) { setConfirmEmpty(false); setTrashError(false); } }}><summary><Trash2 size={13} /><span>{locale === "zh-CN" ? "回收站" : "Trash"} · {deletedProjects.length + deletedVersions.length}</span>{onEmptyTrash && trashOpen && !confirmEmpty ? <button type="button" className="project-trash-empty" onClick={event => { event.preventDefault(); event.stopPropagation(); setTrashError(false); setConfirmEmpty(true); }}>{locale === "zh-CN" ? "清空回收站" : "Empty Trash"}</button> : null}</summary>{onEmptyTrash && (confirmEmpty || trashError) ? <section className="project-trash-clear">{confirmEmpty ? <><p>{locale === "zh-CN" ? "永久删除回收站中的项目和版本？来源对话不受影响。" : "Permanently delete trashed projects and versions? Source conversations are retained."}</p><div><button type="button" disabled={emptying} onClick={() => setConfirmEmpty(false)}>{locale === "zh-CN" ? "取消" : "Cancel"}</button><button type="button" disabled={emptying} onClick={() => void emptyTrash()}>{emptying ? locale === "zh-CN" ? "清空中…" : "Emptying…" : locale === "zh-CN" ? "永久清空" : "Empty permanently"}</button></div></> : null}{trashError ? <p role="alert">{locale === "zh-CN" ? "清空失败，请重试。" : "Could not empty Trash. Try again."}</p> : null}</section> : null}{onRestore ? deletedProjects.map(project => <div key={project.id}><span title={project.title ?? project.name}><strong>{project.title ?? project.name}</strong><small>{locale === "zh-CN" ? "项目" : "Project"}</small></span><button type="button" aria-label={`${locale === "zh-CN" ? "恢复项目" : "Restore project"} ${project.title ?? project.name}`} title={locale === "zh-CN" ? "恢复" : "Restore"} disabled={emptying} onClick={() => onRestore(project.id)}><RotateCcw size={13} /></button></div>) : null}{onRestoreVersion ? deletedVersions.map(version => {
        // A deleted version usually shares its project's title; say which one it was.
        const full = versionLabels.get(version.id) ?? version.title, kind = !version.canvasId ? locale === "zh-CN" ? "未保存" : "Unsaved" : locale === "zh-CN" ? "版本" : "Version";
        const label = `${full}${locale === "zh-CN" ? `（${kind}）` : ` (${kind.toLowerCase()})`}`;
        // The title on one line, and the date, chapters and state on a quieter second line.
        const meta = [kind, full.startsWith(`${version.title} · `) ? full.slice(version.title.length + 3) : ""].filter(Boolean).join(" · ");
        return <div key={version.id}><span title={label}><strong>{version.title}</strong><small>{meta}</small></span><button type="button" aria-label={`${locale === "zh-CN" ? "恢复版本" : "Restore version"} ${label}`} title={locale === "zh-CN" ? "恢复" : "Restore"} disabled={emptying} onClick={() => onRestoreVersion(version.id)}><RotateCcw size={13} /></button></div>;
      }) : null}</details> : null}
      {onSelectTask ? <TaskSidebarSection runs={tasks} activeId={activeTaskId} onSelect={onSelectTask} /> : null}
      <div className="map-sidebar-resize" role="separator" aria-label={locale === "zh-CN" ? "调整画布侧边栏宽度" : "Resize canvas sidebar"} aria-orientation="vertical" aria-valuemin={146} aria-valuemax={380} aria-valuenow={width} tabIndex={0} title={locale === "zh-CN" ? "拖动调整宽度，双击重置" : "Drag to resize, double-click to reset"}
        onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); resizeStart.current = { x: event.clientX, width }; event.currentTarget.setPointerCapture(event.pointerId); }}
        onPointerMove={(event) => { if (!resizeStart.current) return; setWidth(Math.min(380, Math.max(146, resizeStart.current.width + event.clientX - resizeStart.current.x))); }}
        onPointerUp={(event) => { const start = resizeStart.current; if (!start) return; const next = Math.min(380, Math.max(146, start.width + event.clientX - start.x)); resizeStart.current = null; setWidth(next); event.currentTarget.releasePointerCapture(event.pointerId); localStorage.setItem("atlas-map-sidebar-width", String(next)); }}
        onPointerCancel={() => { resizeStart.current = null; }}
        onLostPointerCapture={() => { resizeStart.current = null; }}
        onDoubleClick={() => { setWidth(240); localStorage.setItem("atlas-map-sidebar-width", "240"); }}
        onKeyDown={(event) => { if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return; event.preventDefault(); const next = Math.min(380, Math.max(146, width + (event.key === "ArrowRight" ? 16 : -16))); setWidth(next); localStorage.setItem("atlas-map-sidebar-width", String(next)); }} />
    </aside>
  );
}
