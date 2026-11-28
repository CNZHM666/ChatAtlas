import { Copy, Download, FileText, Image, Paperclip, Pencil, Plus, StickyNote, Trash2, Upload } from "lucide-react";
import { useEffect, useState, type ClipboardEvent, type DragEvent } from "react";
import type { AtlasMessage } from "../shared/messages";
import { PROJECT_FILE_ACCEPT, PROJECT_FILE_DRAG, PROJECT_FILE_LIMIT, projectFileAttachMessage, projectRasterImage, supportedProjectFile } from "../shared/project-files";
import { listProjectFiles, projectDesk, removeProjectFile, saveProjectFile, saveProjectSticky, setAutomaticProjectFiles, type ProjectDesk as Desk, type ProjectFile, type ProjectSticky } from "../storage/project-desk";
import { sendSidecarMessage } from "./host";
import "./project-desk.css";

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

export function ProjectDesk({ projectId, conversationId, canAttach, view, zh }: {
  projectId: string; conversationId: string; canAttach: boolean; view: "files" | "notes"; zh: boolean;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [desk, setDesk] = useState<Desk>();
  const [files, setFiles] = useState<ProjectFile[]>();
  const [draft, setDraft] = useState<ProjectSticky>();
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () => { void Promise.all([projectDesk(projectId), view === "files" ? listProjectFiles(projectId) : undefined]).then(([next, assets]) => {
      if (live) { setDesk(next); setFiles(assets); }
    }).catch(() => { if (live) setStatus(zh ? "未能读取项目资料。" : "Could not load project resources."); }); };
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
    setStatus("");
    try { await operation(); }
    catch { setStatus(t("未能完成操作，请重试。", "Could not complete this action. Try again.")); }
    finally { setBusy(false); }
  };
  const capture = (input: File[]) => void work(async () => {
    const accepted = input.filter(file => supportedProjectFile(file) && file.size <= PROJECT_FILE_LIMIT);
    for (const file of accepted) await saveProjectFile(projectId, { name: file.name, type: file.type, size: file.size }, await file.arrayBuffer(), true);
    setFiles(await listProjectFiles(projectId));
    if (accepted.length < input.length) setStatus(t("已跳过不支持或超过 64 MB 的文件。", "Files with unsupported formats or over 64 MB were skipped."));
    else if (accepted.length) setStatus(t(`已添加 ${accepted.length} 个文件。`, `Added ${accepted.length} ${accepted.length === 1 ? "file" : "files"}.`));
  });
  const handlePaste = (event: ClipboardEvent<HTMLElement>) => {
    if (view !== "files" || busy) return;
    const pasted = Array.from(event.clipboardData?.files ?? []);
    if (!pasted.length) return;
    event.preventDefault();
    capture(pasted);
  };
  const automatic = Boolean(desk?.autoChats.includes(conversationId));
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
  return <section className="project-desk" data-dragging={dragging || undefined} aria-label={view === "files" ? t("项目资料", "Project files") : t("项目便利贴", "Project sticky notes")}
    tabIndex={view === "files" ? -1 : undefined}
    onPaste={handlePaste}
    onDragOver={event => {
      if (view === "files" && event.dataTransfer.types.includes("Files") && !event.dataTransfer.types.includes(PROJECT_FILE_DRAG)) {
        event.preventDefault();
        setDragging(true);
      }
    }}
    onDragLeave={event => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
    }}
    onDrop={event => {
      setDragging(false);
      if (view !== "files" || !event.dataTransfer.files.length || event.dataTransfer.types.includes(PROJECT_FILE_DRAG)) return;
      event.preventDefault();
      if (!busy) capture(Array.from(event.dataTransfer.files));
    }}>
    {view === "files" ? <>
      <header className="project-desk-header">
        <h2>{t("项目资料", "Project files")}{files && files.length > 0 && <small className="desk-count">{files.length}</small>}</h2>
        <label className="native-tool desk-heading-action desk-file-picker"><Plus size={14} aria-hidden="true"/>{t("添加", "Add")}
          <input type="file" className="sr-only" aria-label={t("添加文件", "Add files")} accept={PROJECT_FILE_ACCEPT} multiple disabled={busy}
            onChange={event => { capture(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
        </label>
      </header>
      {conversationId && canAttach ? <div className="desk-auto-card" data-enabled={automatic || undefined}>
        <label className="desk-auto-files" title={t("大于 20 MB 时会先询问。", "Uploads over 20 MB still require confirmation.")}>
          <span>{t("自动收录本页上传", "Auto-save uploads in this chat")}</span>
          <input type="checkbox" checked={automatic} disabled={busy || !desk} onChange={event => {
            const enabled = event.target.checked;
            void work(async () => {
              await setAutomaticProjectFiles(projectId, conversationId, enabled);
              setDesk(await projectDesk(projectId));
              setStatus(enabled
                ? t("已开启自动收录：在本页上传、拖入或粘贴文件将自动保存。", "Auto-save on: uploads, drops, and pasted files in this chat will be saved.")
                : t("已关闭自动收录，上传时可按提示手动收纳。", "Auto-save off. Save manually from the upload prompt."));
            });
          }}/>
        </label>
        <small className="desk-auto-hint">{automatic
          ? t("在当前 AI 输入区上传、拖拽或粘贴文件时自动同步到这里（≤ 20 MB）。", "Files uploaded, dropped, or pasted in this chat sync here automatically (≤ 20 MB).")
          : t("开启后，在当前对话上传文件无需二次确认即可自动收录。", "Turn on to save files uploaded in this chat automatically.")}</small>
      </div> : canAttach ? <p className="desk-auto-note">{t("进入已保存的对话页后可开启自动收录；也可以直接拖入或 Ctrl+V 粘贴文件。", "Open a chat thread to enable auto-save, or drop / paste files below.")}</p> : null}
      {files?.length ? <>
        <ul className="desk-files">{files.map(file => <SavedFile key={file.id} file={file} zh={zh} disabled={busy}
          onDrag={(event, url) => drag(file, event, url)}
          onRemove={() => { if (window.confirm(t(`移除「${file.name}」？`, `Remove “${file.name}”?`))) void work(async () => {
            await removeProjectFile(projectId, file.id); setFiles(await listProjectFiles(projectId));
          }); }}
          reuse={canAttach ? () => void work(async () => {
            const result = await reuse(file);
            setStatus(result?.ok ? t("文件已交给当前输入区。", "File passed to the current composer.")
              : projectFileAttachMessage(result?.reason, zh));
          }) : undefined}/>)}</ul>
        <p className="desk-drop-hint">{canAttach
          ? t("支持拖入或粘贴文件到此收录，也可拖拽条目直接发给 AI 输入区。", "Drop or paste files here to save, or drag saved items into the AI composer.")
          : t("支持直接拖入或 Ctrl+V 粘贴文件到此处收录。", "Drop or paste files here to save them.")}</p>
      </> : <label className="desk-dropzone">
        <Upload size={18} aria-hidden="true"/>
        <strong>{files ? t("拖入、粘贴或点击添加资料", "Drop, paste, or click to add files") : t("正在读取资料…", "Loading files…")}</strong>
        {files && <small>{t("支持图片、PDF、Office 文档、Markdown、代码等（单文件 ≤ 64 MB）", "Images, PDF, Office docs, Markdown, code, and more (≤ 64 MB)")}</small>}
        <input type="file" className="sr-only" accept={PROJECT_FILE_ACCEPT} multiple disabled={busy}
          onChange={event => { capture(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }}/>
      </label>}
    </> : <>
      <header className="project-desk-header">
        <h2>{t("便利贴", "Sticky notes")}</h2>
        {!draft && <button type="button" className="native-tool desk-heading-action" disabled={busy || !desk} onClick={() => setDraft({ id: crypto.randomUUID(), text: "", updatedAt: 0 })}>
          <Plus size={14} aria-hidden="true"/>{t("新建", "New")}
        </button>}
      </header>
      {draft && <form className="desk-sticky-edit" onSubmit={event => { event.preventDefault(); writeNote(draft); }}>
        <textarea autoFocus rows={3} maxLength={2000} value={draft.text} aria-label={t("便利贴内容", "Sticky note text")}
          placeholder={t("写一张便利贴…", "Write a note…")}
          onChange={event => setDraft({ ...draft, text: event.target.value })}/>
        <div className="desk-row-actions"><button type="button" className="native-tool" onClick={() => setDraft(undefined)} disabled={busy}>{t("取消", "Cancel")}</button>
          <button type="submit" className="native-primary" disabled={busy || !draft.text.trim()}>{t("保存", "Save")}</button></div>
      </form>}
      {desk?.notes.length ? <ul className="desk-sticky-list" aria-label={t("已保存的便利贴", "Saved sticky notes")}>{desk.notes.map(note => <li key={note.id}>
        <p>{note.text}</p>
        <div className="desk-row-actions"><button type="button" className="native-tool" disabled={busy || Boolean(draft)}
          onClick={() => setDraft(note)} aria-label={t("编辑便利贴", "Edit sticky note")} title={t("编辑便利贴", "Edit sticky note")}><Pencil size={14} aria-hidden="true"/></button>
          <button type="button" className="native-tool" aria-label={t("复制便利贴", "Copy sticky note")} title={t("复制便利贴", "Copy sticky note")} onClick={async () => {
            setStatus("");
            try {
              await navigator.clipboard.writeText(note.text);
              setStatus(t("已复制便利贴。", "Sticky note copied."));
            } catch {
              setStatus(t("未能复制便利贴，请重试。", "Could not copy the sticky note. Try again."));
            }
          }}><Copy size={14} aria-hidden="true"/></button>
          <button type="button" className="native-tool" disabled={busy || Boolean(draft)} onClick={() => {
            if (window.confirm(t("删除这张便利贴？", "Delete this sticky note?"))) writeNote(note, true);
          }} aria-label={t("删除便利贴", "Delete sticky note")} title={t("删除便利贴", "Delete sticky note")}><Trash2 size={14} aria-hidden="true"/></button></div>
      </li>)}</ul> : !draft && <p className="desk-empty"><StickyNote size={17} aria-hidden="true"/>
        {desk ? t("暂无便利贴", "No notes yet") : t("正在读取便利贴…", "Loading sticky notes…")}</p>}
    </>}
    <p className="native-muted desk-status" role="status" hidden={!status}>{status}</p>
  </section>;
}
