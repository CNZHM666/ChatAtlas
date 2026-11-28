import { Check, ChevronDown, ChevronUp, Copy, Download, FileText, GripVertical, Image, Paperclip, Pencil, Pin, Plus, SendHorizontal, StickyNote, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from "react";
import type { AtlasMessage } from "../shared/messages";
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_DRAG, PROJECT_FILE_LIMIT, projectFileAttachMessage, projectRasterImage, supportedProjectFile } from "../shared/project-files";
import { extractDroppedStickyText, isExternalStickyTextDrag, listProjectFiles, PROJECT_STICKY_DRAG, projectDesk, removeProjectFile, saveProjectFile, saveProjectSticky, STICKY_MAX_LENGTH, type ProjectDesk as Desk, type ProjectFile, type ProjectSticky } from "../storage/project-desk";
import { sendSidecarMessage } from "./host";
import "./project-desk.css";

function relativeStickyTime(timestamp: number, zh: boolean): string {
  if (!timestamp) return "";
  const diff = Math.max(0, Date.now() - timestamp);
  const minute = 60_000, hour = 3_600_000, day = 86_400_000;
  if (diff < minute) return zh ? "刚刚" : "Just now";
  if (diff < hour) return zh ? `${Math.floor(diff / minute)} 分钟前` : `${Math.floor(diff / minute)}m ago`;
  if (diff < day) return zh ? `${Math.floor(diff / hour)} 小时前` : `${Math.floor(diff / hour)}h ago`;
  return new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "numeric", day: "numeric" }).format(timestamp);
}

function isLongNote(text: string): boolean {
  return text.length > 160 || text.split("\n").length > 4;
}

function SavedFile({ file, zh, reuse, onRemove, onDrag, disabled }: {
  file: ProjectFile; zh: boolean; reuse?: () => void; onRemove: () => void;
  onDrag?: (event: DragEvent<HTMLLIElement>, url: string) => void; disabled?: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const next = URL.createObjectURL(file.blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file.blob]);
  const size = file.size < 1024 * 1024 ? `${Math.max(1, Math.round(file.size / 1024))} KB` : `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
  const remove = zh ? "移除文件" : "Remove file";
  const download = zh ? "下载文件" : "Download file";
  const attach = zh ? "加入当前对话" : "Attach to this chat";
  return <li className="desk-file" draggable={Boolean(onDrag && url)} onDragStart={event => onDrag?.(event, url)} title={file.name}>
    <div className="desk-file-icon">{url && projectRasterImage(file.type) ? <a href={url} target="_blank" rel="noopener noreferrer" draggable={false}
      aria-label={zh ? `查看图片 ${file.name}` : `View image ${file.name}`}><img src={url} alt="" draggable={false}/></a>
      : file.type.startsWith("image/") ? <Image size={18} aria-hidden="true"/> : <FileText size={18} aria-hidden="true"/>}</div>
    <div className="desk-file-description"><strong>{file.name}</strong><small>{size}</small></div>
    <div className="desk-row-actions">
      {reuse && <button type="button" className="native-tool" disabled={disabled} title={attach} aria-label={`${attach} · ${file.name}`} onClick={reuse}><Paperclip size={15} aria-hidden="true"/></button>}
      {url && <a href={url} download={file.name} draggable={false} className="native-tool" title={download} aria-label={`${download} · ${file.name}`}><Download size={15} aria-hidden="true"/></a>}
      <button type="button" className="native-tool" disabled={disabled} title={remove} aria-label={`${remove} · ${file.name}`} onClick={onRemove}><Trash2 size={15} aria-hidden="true"/></button>
    </div>
  </li>;
}

export function ProjectDesk({ projectId, conversationId, canAttach, view, zh, externalNoteSignal }: {
  projectId: string; conversationId: string; canAttach: boolean; view: "files" | "notes"; zh: boolean;
  externalNoteSignal?: { id: number; message: string };
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [desk, setDesk] = useState<Desk>();
  const [files, setFiles] = useState<ProjectFile[]>();
  const [draft, setDraft] = useState<ProjectSticky>();
  const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
  const [copiedId, setCopiedId] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const statusTimer = useRef<number>();
  const copiedTimer = useRef<number>();
  const lastExternalSignal = useRef<number>();

  const flashStatus = (message: string, persist = false) => {
    window.clearTimeout(statusTimer.current);
    setStatus(message);
    if (message && !persist) {
      statusTimer.current = window.setTimeout(() => setStatus(""), 2800);
    }
  };

  useEffect(() => () => {
    window.clearTimeout(statusTimer.current);
    window.clearTimeout(copiedTimer.current);
  }, []);

  useEffect(() => {
    if (!externalNoteSignal || externalNoteSignal.id === lastExternalSignal.current) return;
    lastExternalSignal.current = externalNoteSignal.id;
    if (Date.now() - externalNoteSignal.id < 5000) flashStatus(externalNoteSignal.message);
    void projectDesk(projectId).then(setDesk).catch(() => undefined);
  }, [externalNoteSignal, projectId]);

  useEffect(() => {
    let live = true;
    const refresh = () => { void Promise.all([projectDesk(projectId), view === "files" ? listProjectFiles(projectId) : undefined]).then(([next, assets]) => {
      if (live) { setDesk(next); setFiles(assets); }
    }).catch(() => { if (live) flashStatus(zh ? "未能读取项目资料。" : "Could not load project resources.", true); }); };
    refresh();
    const changed = (event: AtlasMessage) => { if (event.type === "ATLAS_PROJECT_FILES_CHANGED" && event.projectId === projectId && view === "files") refresh(); };
    chrome.runtime.onMessage?.addListener(changed);
    window.addEventListener("focus", refresh);
    return () => {
      live = false;
      chrome.runtime.onMessage?.removeListener(changed);
      window.removeEventListener("focus", refresh);
    };
  }, [projectId, view, zh]);

  const work = async (operation: () => Promise<void>) => {
    setBusy(true);
    window.clearTimeout(statusTimer.current);
    setStatus("");
    try { await operation(); }
    catch { flashStatus(t("未能完成操作，请重试。", "Could not complete this action. Try again."), true); }
    finally { setBusy(false); }
  };

  const capture = (input: File[]) => void work(async () => {
    const accepted = input.filter(file => supportedProjectFile(file) && file.size <= PROJECT_FILE_LIMIT);
    for (const file of accepted) await saveProjectFile(projectId, { name: file.name, type: file.type, size: file.size }, await file.arrayBuffer(), true);
    setFiles(await listProjectFiles(projectId));
    if (accepted.length < input.length) flashStatus(t("已跳过不支持或超过 64 MB 的文件。", "Skipped unsupported files or files over 64 MB."), true);
    else if (accepted.length) flashStatus(t(`已添加 ${accepted.length} 个文件`, `Added ${accepted.length} ${accepted.length === 1 ? "file" : "files"}`));
  });

  const captureStickyText = (text: string, truncated: boolean, source: "drop" | "paste") => {
    if (!text) return;
    void work(async () => {
      await saveProjectSticky(projectId, { id: crypto.randomUUID(), text, updatedAt: Date.now() });
      setDesk(await projectDesk(projectId));
      flashStatus(truncated
        ? t(`已保存前 ${STICKY_MAX_LENGTH} 字为新便利贴`, `Saved first ${STICKY_MAX_LENGTH} characters as a sticky note`)
        : source === "paste"
          ? t("已粘贴为新便利贴", "Pasted as a sticky note")
          : t("已拖入为新便利贴", "Saved dropped text as a sticky note"));
    });
  };

  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    if (busy) return;
    if (view === "files") {
      const pasted = Array.from(event.clipboardData?.files ?? []);
      if (!pasted.length) return;
      event.preventDefault();
      capture(pasted);
      return;
    }
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest("textarea, input")) return;
    const { text, truncated } = extractDroppedStickyText(event.clipboardData);
    if (!text) return;
    event.preventDefault();
    captureStickyText(text, truncated, "paste");
  };

  const reuse = (file: ProjectFile, token?: string) => sendSidecarMessage({
    type: "ATLAS_PROJECT_FILE_REUSE", conversationId, projectId, fileId: file.id, token,
  });

  const drag = (file: ProjectFile, event: DragEvent<HTMLLIElement>, url: string) => {
    const token = crypto.randomUUID();
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("DownloadURL", `${file.type || "application/octet-stream"}:${file.name}:${url}`);
    event.dataTransfer.items?.add(new File([file.blob], file.name, { type: file.type }));
    if (!canAttach) return;
    event.dataTransfer.setData(PROJECT_FILE_DRAG, token);
    void reuse(file, token).catch(() => undefined);
  };

  const writeNote = (note: ProjectSticky, remove = false) => void work(async () => {
    await saveProjectSticky(projectId, note, remove);
    setDesk(await projectDesk(projectId));
    setDraft(undefined);
  });

  const togglePin = (note: ProjectSticky) => void work(async () => {
    await saveProjectSticky(projectId, { ...note, pinned: !note.pinned });
    setDesk(await projectDesk(projectId));
  });

  const insertSticky = (note: ProjectSticky) => void work(async () => {
    const reply = await sendSidecarMessage({
      type: "ATLAS_SIDECAR_HANDOFF",
      conversationId,
      text: note.text,
    }) as { ok?: boolean; reason?: string } | undefined;
    if (reply?.ok) {
      flashStatus(t("已填入当前输入区", "Inserted into the composer"));
    } else if (reply?.reason === "draft") {
      flashStatus(t("输入区已有草稿，可直接拖入光标处或点复制。", "Composer already has a draft—drag the note in or copy it."), true);
    } else if (reply?.reason === "changed") {
      flashStatus(t("当前对话已切换，请重新打开侧栏。", "Chat changed—reopen the sidebar."), true);
    } else {
      flashStatus(t("当前页面不支持直接填入，可拖拽到输入区或复制。", "Direct insert unavailable—drag into the composer or copy."), true);
    }
  });

  const dragSticky = (note: ProjectSticky, event: DragEvent<HTMLLIElement>) => {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", note.text);
    event.dataTransfer.setData(PROJECT_STICKY_DRAG, note.id);
  };

  const handleNoteKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!draft) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(undefined);
    } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing && draft.text.trim() && !busy) {
      event.preventDefault();
      writeNote(draft);
    }
  };

  const isCreatingNew = Boolean(draft && !desk?.notes.some(item => item.id === draft.id));
  const sortedNotes = desk ? [...desk.notes].sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) || b.updatedAt - a.updatedAt) : [];

  const renderNoteEditor = (target: ProjectSticky) => (
    <form className="desk-sticky-edit" onSubmit={event => { event.preventDefault(); writeNote(target); }}>
      <textarea autoFocus rows={3} maxLength={STICKY_MAX_LENGTH} value={target.text} aria-label={t("便利贴内容", "Sticky note text")}
        placeholder={t("记下临时想法、常用提示词或约束…（Ctrl/⌘ + Enter 保存）", "Jot an idea, prompt snippet, or constraint… (Ctrl/⌘ + Enter to save)")}
        onKeyDown={handleNoteKeyDown}
        onChange={event => setDraft({ ...target, text: event.target.value })}/>
      <div className="desk-sticky-edit-footer">
        <small className="desk-char-count">{target.text.length > 1600 ? `${target.text.length} / ${STICKY_MAX_LENGTH}` : t("Ctrl/⌘ + Enter 保存", "Ctrl/⌘ + Enter to save")}</small>
        <div className="desk-row-actions">
          <button type="button" className="native-tool" onClick={() => setDraft(undefined)} disabled={busy}>{t("取消", "Cancel")}</button>
          <button type="submit" className="native-primary" disabled={busy || !target.text.trim()}>{t("保存", "Save")}</button>
        </div>
      </div>
    </form>
  );

  return <section className="project-desk" data-view={view} data-dragging={dragging || undefined} aria-label={view === "files" ? t("项目资料", "Project files") : t("项目便利贴", "Project sticky notes")}
    tabIndex={-1}
    onPaste={handlePaste}
    onDragOver={event => {
      if (view === "files") {
        if (event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(PROJECT_FILE_DRAG)) {
          event.preventDefault();
          setDragging(true);
        }
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("textarea, input")) return;
      if (isExternalStickyTextDrag(event.dataTransfer)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDragging(true);
      }
    }}
    onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    }}
    onDrop={event => {
      setDragging(false);
      if (view === "files") {
        if (!event.dataTransfer.files.length || event.dataTransfer.types.includes(PROJECT_FILE_DRAG)) return;
        event.preventDefault();
        if (!busy) capture(Array.from(event.dataTransfer.files));
        return;
      }
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest("textarea, input")) return;
      if (busy || !isExternalStickyTextDrag(event.dataTransfer)) return;
      const { text, truncated } = extractDroppedStickyText(event.dataTransfer);
      if (!text) return;
      event.preventDefault();
      captureStickyText(text, truncated, "drop");
    }}>
    {view === "files" ? <>
      <header className="project-desk-header">
        <h2>{t("项目资料", "Project files")}{files && files.length > 0 && <small className="desk-count">{files.length}</small>}</h2>
        <label className="native-tool desk-heading-action desk-file-picker"><Plus size={14} aria-hidden="true"/>{t("添加", "Add")}
          <input type="file" className="sr-only" aria-label={t("添加文件", "Add files")} accept={PROJECT_FILE_ACCEPT} multiple disabled={busy}
            onChange={event => { capture(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
        </label>
      </header>
      {files?.length ? <>
        <ul className="desk-files">{files.map(file => <SavedFile key={file.id} file={file} zh={zh} disabled={busy}
          onDrag={(event, url) => drag(file, event, url)}
          onRemove={() => { if (window.confirm(t(`移除「${file.name}」？`, `Remove “${file.name}”?`))) void work(async () => {
            await removeProjectFile(projectId, file.id); setFiles(await listProjectFiles(projectId));
          }); }}
          reuse={canAttach ? () => void work(async () => {
            const result = await reuse(file);
            flashStatus(result?.ok ? t("文件已加入当前输入区", "File attached to the composer")
              : projectFileAttachMessage(result?.reason, zh), !result?.ok);
          }) : undefined}/>)}</ul>
        {status
          ? <p className="desk-status-pill" role="status">{status}</p>
          : <p className="desk-footer-hint">{canAttach
            ? t("拖入或粘贴文件添加 · 拖拽条目直接发给 AI", "Drop/paste to add · Drag items into the AI composer")
            : t("拖入或 Ctrl+V 粘贴文件即可添加", "Drop or paste files here to save")}</p>}
      </> : <>
        <label className="desk-dropzone">
          <Upload size={18} aria-hidden="true"/>
          <strong>{files ? t("拖入、粘贴或点击添加资料", "Drop, paste, or click to add files") : t("正在读取资料…", "Loading files…")}</strong>
          {files && <small>{t("支持图片、PDF、文档、代码（≤ 64 MB）", "Images, PDF, docs, code (≤ 64 MB)")}</small>}
          <input type="file" className="sr-only" accept={PROJECT_FILE_ACCEPT} multiple disabled={busy}
            onChange={event => { capture(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
        </label>
        {status && <p className="desk-status-pill" role="status">{status}</p>}
      </>}
    </> : <>
      <header className="project-desk-header">
        <h2>{t("便利贴", "Sticky notes")}{sortedNotes.length > 0 && <small className="desk-count">{sortedNotes.length}</small>}</h2>
        {!draft && <button type="button" className="native-tool desk-heading-action" disabled={busy || !desk} onClick={() => setDraft({ id: crypto.randomUUID(), text: "", updatedAt: 0 })}>
          <Plus size={14} aria-hidden="true"/>{t("新建", "New")}
        </button>}
      </header>
      {dragging && <p className="desk-drop-banner" aria-live="polite">{t("松开鼠标，直接存为便利贴", "Release to save as a sticky note")}</p>}
      {isCreatingNew && draft && renderNoteEditor(draft)}
      {sortedNotes.length ? <>
        <ul className="desk-sticky-list" aria-label={t("已保存的便利贴", "Saved sticky notes")}>
          {sortedNotes.map(note => {
            const editingThis = draft?.id === note.id;
            if (editingThis && draft) {
              return <li key={note.id} className="desk-sticky-item is-editing">{renderNoteEditor(draft)}</li>;
            }
            const long = isLongNote(note.text);
            const expanded = Boolean(expandedNotes[note.id]);
            const copied = copiedId === note.id;
            return <li key={note.id} className={`desk-sticky-item${note.pinned ? " is-pinned" : ""}`}
              draggable={!draft && !busy}
              onDragStart={event => dragSticky(note, event)}>
              <div className="desk-sticky-body">
                <span className="desk-sticky-grip" title={t("拖拽直接插入 AI 输入区", "Drag directly into the AI composer")} aria-hidden="true"><GripVertical size={13}/></span>
                <div className="desk-sticky-text-wrap">
                  <p className={long && !expanded ? "is-clamped" : undefined}>{note.text}</p>
                  {long && <button type="button" className="desk-sticky-expand" onClick={() => setExpandedNotes(prev => ({ ...prev, [note.id]: !expanded }))}>
                    {expanded ? <><ChevronUp size={12} aria-hidden="true"/>{t("收起", "Collapse")}</> : <><ChevronDown size={12} aria-hidden="true"/>{t("展开全文", "Show more")}</>}
                  </button>}
                </div>
              </div>
              <div className="desk-sticky-footer">
                <span className="desk-sticky-meta">
                  {note.pinned && <span className="desk-sticky-pin-tag">{t("置顶", "Pinned")}</span>}
                  {note.updatedAt > 0 && <small>{relativeStickyTime(note.updatedAt, zh)}</small>}
                </span>
                <div className="desk-row-actions">
                  {canAttach && <button type="button" className="native-tool is-accent" disabled={busy || Boolean(draft)}
                    aria-label={t("填入当前输入区", "Insert into composer")} title={t("直接填入 AI 输入区（也可拖拽卡片）", "Insert into AI composer (or drag card)")}
                    onClick={() => insertSticky(note)}><SendHorizontal size={13} aria-hidden="true"/></button>}
                  <button type="button" className="native-tool" aria-label={t("复制便利贴", "Copy sticky note")} title={t("复制便利贴", "Copy sticky note")} onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(note.text);
                      setCopiedId(note.id);
                      window.clearTimeout(copiedTimer.current);
                      copiedTimer.current = window.setTimeout(() => setCopiedId(undefined), 1600);
                      flashStatus(t("已复制便利贴", "Sticky note copied"));
                    } catch {
                      flashStatus(t("未能复制便利贴，请重试。", "Could not copy the sticky note. Try again."), true);
                    }
                  }}>{copied ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}</button>
                  <button type="button" className={`native-tool${note.pinned ? " is-pinned" : ""}`} disabled={busy || Boolean(draft)}
                    aria-pressed={Boolean(note.pinned)}
                    aria-label={note.pinned ? t("取消置顶", "Unpin note") : t("置顶便利贴", "Pin note")}
                    title={note.pinned ? t("取消置顶", "Unpin note") : t("置顶便利贴", "Pin note")}
                    onClick={() => togglePin(note)}><Pin size={13} aria-hidden="true"/></button>
                  <button type="button" className="native-tool" disabled={busy || Boolean(draft)}
                    onClick={() => setDraft(note)} aria-label={t("编辑便利贴", "Edit sticky note")} title={t("编辑便利贴", "Edit sticky note")}><Pencil size={13} aria-hidden="true"/></button>
                  <button type="button" className="native-tool" disabled={busy || Boolean(draft)} onClick={() => {
                    if (window.confirm(t("删除这张便利贴？", "Delete this sticky note?"))) writeNote(note, true);
                  }} aria-label={t("删除便利贴", "Delete sticky note")} title={t("删除便利贴", "Delete sticky note")}><Trash2 size={13} aria-hidden="true"/></button>
                </div>
              </div>
            </li>;
          })}
        </ul>
        {status
          ? <p className="desk-status-pill" role="status">{status}</p>
          : <p className="desk-footer-hint">{canAttach
            ? t("选字拖入新建 · 拖拽卡片直接送进 AI 输入区", "Drop selected text to save · Drag cards into the AI composer")
            : t("支持从网页选字拖入新建，也可拖拽卡片到任意输入框", "Drop selected text to save · Drag cards into any input")}</p>}
      </> : !draft && <>
        <button type="button" className="desk-empty-card" disabled={busy || !desk} onClick={() => setDraft({ id: crypto.randomUUID(), text: "", updatedAt: 0 })}>
          <StickyNote size={18} aria-hidden="true"/>
          <strong>{desk ? t("拖入对话文字，或点击记一张便利贴", "Drop chat text, or click to add a sticky note") : t("正在读取便利贴…", "Loading sticky notes…")}</strong>
          {desk && <small>{t("左键选中 AI 对话文字直接拖进来；便利贴也可拖回输入区", "Highlight text in any AI chat and drop it here—or drag notes back to the composer")}</small>}
        </button>
        {status && <p className="desk-status-pill" role="status">{status}</p>}
      </>}
    </>}
  </section>;
}
