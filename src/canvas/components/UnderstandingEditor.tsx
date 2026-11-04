import { useState, type ReactNode } from "react";
import { ChevronDown, X } from "lucide-react";
import { MapDetailPortal } from "./MapDetailPortal";
import "../understanding-editor.css";

/** One compact editor for chapter notes and project concepts. Optional metadata stays out of the reading flow. */
export function UnderstandingEditor({ zh, title, description, onTitle, onDescription, onSave, onClose, busy, error, options, onDelete, titleLabel, descriptionLabel, label, onDismiss, requireDescription = false, titleMaxLength = 120, descriptionMaxLength = 20000 }: {
  zh: boolean; title: string; description: string; onTitle: (value: string) => void; onDescription: (value: string) => void;
  onSave: () => void; onClose: () => void; busy: boolean; error: boolean; options?: ReactNode; onDelete?: () => void;
  titleLabel?: string; descriptionLabel?: string; label?: string; onDismiss?: () => void; requireDescription?: boolean; titleMaxLength?: number; descriptionMaxLength?: number;
}) {
  const canSave = requireDescription ? Boolean(description.trim()) : Boolean(title.trim() || description.trim());
  const [optionsOpen, setOptionsOpen] = useState(false);
  const dismiss = onDismiss ?? onClose;
  return <MapDetailPortal onClose={() => { if (!busy) dismiss(); }}><form className="understanding-editor" role="dialog" aria-modal="true" aria-label={label ?? (zh ? "编辑理解" : "Edit understanding")}
    onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); if (!busy) dismiss(); }
      if (event.key !== "Tab") return;
      const items = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary')].filter(item => item.getClientRects().length);
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
    }} onSubmit={event => { event.preventDefault(); if (!busy && canSave) onSave(); }}>
    <header><strong>{zh ? "编辑理解" : "Edit understanding"}</strong><button type="button" disabled={busy} aria-label={zh ? "关闭理解编辑" : "Close understanding editor"} onClick={dismiss}><X size={16} /></button></header>
    <div className="understanding-editor-body"><label>{zh ? "名称" : "Name"}<input aria-label={titleLabel ?? (zh ? "名称" : "Name")} maxLength={titleMaxLength} value={title} disabled={busy} placeholder={zh ? "可选，留空使用说明首句" : "Optional; use the first sentence"} onChange={event => onTitle(event.target.value)} /></label>
      <label>{zh ? "说明" : "Explanation"}<textarea autoFocus aria-label={descriptionLabel ?? (zh ? "说明" : "Explanation")} rows={5} maxLength={descriptionMaxLength} value={description} disabled={busy} placeholder={zh ? "写下你的理解或疑问" : "Write your understanding or question"} onChange={event => onDescription(event.target.value)} /></label>
      {options ? <details className="understanding-editor-options" open={optionsOpen}><summary className="workspace-disclosure-title" onClick={event => { event.preventDefault(); setOptionsOpen(!optionsOpen); }}>{zh ? "更多设置" : "More options"}<ChevronDown size={15} aria-hidden="true"/></summary>{optionsOpen ? options : null}</details> : null}
      {error ? <p role="alert">{zh ? "未能保存，修改已保留，请重试。" : "Could not save. Your edits are preserved; try again."}</p> : null}
    </div><footer>{onDelete ? <button type="button" className="understanding-delete" disabled={busy} onClick={onDelete}>{zh ? "删除卡片" : "Delete card"}</button> : null}<button type="button" disabled={busy} onClick={onClose}>{zh ? "取消" : "Cancel"}</button><button type="submit" className="primary" disabled={busy || !canSave}>{busy ? zh ? "保存中…" : "Saving…" : zh ? "保存" : "Save"}</button></footer>
  </form></MapDetailPortal>;
}
