import { useDeferredValue, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MutableRefObject } from "react";
import { Bold, Code2, Heading2, ImagePlus, Italic, Link2, List, ListChecks, ListOrdered, Minus, Quote, Redo2, RotateCcw, Search, SquareCode, Strikethrough, Table2, Undo2 } from "lucide-react";
import { locateInMarkdown } from "../markdown-locate";
import { formatMarkdown, type MarkdownFormat } from "../markdown-format";
import { ReaderGuide } from "./ReaderGuide";

const formatting = [
  [
    ["heading", Heading2, "二级标题", "Heading level 2"], ["bold", Bold, "粗体", "Bold"],
    ["italic", Italic, "斜体", "Italic"], ["strike", Strikethrough, "删除线", "Strikethrough"],
  ],
  [
    ["bullet", List, "无序列表", "Bulleted list"], ["ordered", ListOrdered, "有序列表", "Numbered list"],
    ["task", ListChecks, "任务清单", "Task list"], ["quote", Quote, "引用", "Quote"],
  ],
  [
    ["link", Link2, "链接", "Link"], ["image", ImagePlus, "图片", "Image"],
    ["code", Code2, "行内代码", "Inline code"], ["fence", SquareCode, "代码块", "Code block"],
    ["table", Table2, "表格", "Table"], ["rule", Minus, "分隔线", "Divider"],
  ],
] as const;
const views = [["edit", "编辑", "Edit"], ["preview", "预览", "Preview"], ["split", "分栏", "Split"]] as const;

/** How far down a textarea's content a character sits, measured by a copy of it laid out the same way. */
function offsetOf(textarea: HTMLTextAreaElement, index: number): number {
  const style = getComputedStyle(textarea), mirror = document.createElement("div");
  for (const name of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "boxSizing", "tabSize"] as const) mirror.style[name] = style[name];
  Object.assign(mirror.style, { position: "absolute", visibility: "hidden", top: "0", left: "-9999px", whiteSpace: "pre-wrap", overflowWrap: "break-word", width: `${textarea.offsetWidth}px` });
  mirror.textContent = textarea.value.slice(0, index);
  const mark = document.createElement("span"); mark.textContent = "​"; mirror.append(mark);
  document.body.append(mirror);
  const top = mark.offsetTop;
  mirror.remove();
  return top;
}

/** Selects a range and brings it to the upper third of the box, with the box itself in view. */
function reveal(textarea: HTMLTextAreaElement, [start, end]: [number, number]) {
  textarea.focus({ preventScroll: true });
  textarea.setSelectionRange(start, end);
  textarea.scrollTop = Math.max(0, offsetOf(textarea, start) - textarea.clientHeight / 3);
  textarea.scrollIntoView?.({ block: "nearest" });
}

interface Draft { title: string; body: string; cursor: number }
/** Typing within this long of the last change is one step to undo, as editors group a run of typing. */
const GROUP_MS = 800, HISTORY = 200;

/** A chapter's title and Markdown, opened where the reader was: the sentence they chose to rewrite, or the paragraph they
 * were reading, is selected and scrolled to, so a small change does not start with a search through the whole chapter.
 * A find box jumps between the places a word appears.
 * Edits stay a draft until saved: they can be undone step by step, reverted to the chapter as opened, or dropped by
 * leaving without saving. The chapter becomes the reader's own text only when a save changes it. */
export function ChapterTextEditor({ title, body, target, zh, compact, onSave, onCancel, onDirty, saveRef }: {
  title: string; body: string;
  /** Rendered text to open at; looked for in the Markdown. */
  target?: string;
  zh: boolean;
  compact?: boolean;
  /** Called with the draft when it differs from what was opened; the editor is closed by the caller when it resolves. */
  onSave: (title: string, body: string) => Promise<void> | void;
  onCancel: () => void;
  onDirty?: (dirty: boolean) => void;
  /** Lets a control outside the editor (a menu's 完成编辑) save the draft. */
  saveRef?: MutableRefObject<(() => Promise<void>) | undefined>;
}) {
  const heading = useRef<HTMLInputElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const findInput = useRef<HTMLInputElement>(null);
  const [view, setView] = useState<(typeof views)[number][0]>("edit");
  const [query, setQuery] = useState(""), [missing, setMissing] = useState(false);
  const [draft, setDraft] = useState<Draft>({ title, body, cursor: 0 });
  const [past, setPast] = useState<Draft[]>([]), [future, setFuture] = useState<Draft[]>([]);
  const [confirming, setConfirming] = useState(false), [saving, setSaving] = useState(false), [failed, setFailed] = useState("");
  const lastChange = useRef(0), pendingSelection = useRef<[number, number]>();
  const opened = useRef<string | undefined>(undefined);
  const dirty = draft.title !== title || draft.body !== body;
  const previewBody = useDeferredValue(draft.body);
  useEffect(() => { onDirty?.(dirty); }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  // Closing the tab with a draft asks first, as leaving the editor does.
  useEffect(() => {
    if (!dirty) return;
    const hold = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", hold);
    return () => window.removeEventListener("beforeunload", hold);
  }, [dirty]);
  // Once per target: typing afterwards keeps the cursor where the user put it.
  useLayoutEffect(() => {
    const textarea = area.current;
    if (!textarea || opened.current === (target ?? "")) return;
    opened.current = target ?? "";
    const range = target ? locateInMarkdown(body, target) : undefined;
    if (range) reveal(textarea, range);
    else if (!title && !body) heading.current?.focus({ preventScroll: true });
    else textarea.focus({ preventScroll: true });
  }, [target, body, title]);
  // After an undo the cursor goes back to where that change was made.
  useLayoutEffect(() => {
    const textarea = area.current, range = pendingSelection.current;
    if (!textarea || !range || view === "preview") return;
    pendingSelection.current = undefined;
    textarea.focus({ preventScroll: true });
    textarea.setSelectionRange(...range);
  });
  useEffect(() => setMissing(false), [query]);
  const change = (next: Partial<Draft>, separate = false) => {
    const now = Date.now(), grouped = !separate && now - lastChange.current < GROUP_MS && past.length > 0;
    lastChange.current = separate ? 0 : now;
    if (!grouped) setPast(list => [...list.slice(-HISTORY + 1), draft]);
    setFuture([]); setConfirming(false); setFailed("");
    setDraft(current => ({ ...current, ...next }));
  };
  const step = (from: Draft[], to: Draft[], setFrom: (list: Draft[]) => void, setTo: (list: Draft[]) => void) => {
    const previous = from.at(-1);
    if (!previous) return;
    setFrom(from.slice(0, -1)); setTo([...to, draft]); setDraft(previous);
    lastChange.current = 0; pendingSelection.current = [previous.cursor, previous.cursor];
  };
  const undo = () => step(past, future, setPast, setFuture);
  const redo = () => step(future, past, setFuture, setPast);
  const revert = () => { if (!dirty) return; setPast(list => [...list, draft]); setFuture([]); setDraft({ title, body, cursor: 0 }); lastChange.current = 0; };
  const save = async () => {
    if (saving) return;
    if (!dirty) { onCancel(); return; }
    if (!title && !draft.title.trim()) {
      setFailed(zh ? "请输入章节标题。" : "Enter a section title.");
      heading.current?.focus();
      return;
    }
    setSaving(true); setFailed("");
    try { await onSave(draft.title, draft.body); }
    catch (error) {
      setFailed(compact && error instanceof Error ? error.message : zh ? "保存失败，修改仍在这里，请重试。" : "Could not save. Your changes are still here; retry.");
    }
    finally { setSaving(false); }
  };
  const cancel = () => { if (saving) return; if (dirty && !confirming) { setConfirming(true); return; } onCancel(); };
  if (saveRef) saveRef.current = save;
  const format = (kind: MarkdownFormat) => {
    const textarea = area.current;
    if (!textarea || saving) return;
    const result = formatMarkdown(draft.body, textarea.selectionStart, textarea.selectionEnd, kind, zh);
    if (result.body === draft.body) return;
    pendingSelection.current = result.selection;
    change({ body: result.body, cursor: result.selection[0] }, true);
  };
  const keys = (event: KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing) return;
    const mod = event.ctrlKey || event.metaKey, key = event.key.toLowerCase();
    if (mod && key === "s") { event.preventDefault(); void save(); }
    else if (saving) return;
    else if (mod && key === "f" && view !== "preview") { event.preventDefault(); findInput.current?.focus(); findInput.current?.select(); }
    else if (mod && key === "z" && !event.shiftKey && event.target !== findInput.current) { event.preventDefault(); undo(); }
    else if (mod && (key === "y" || key === "z" && event.shiftKey) && event.target !== findInput.current) { event.preventDefault(); redo(); }
    else if (mod && event.target === area.current && (key === "b" || key === "i" || key === "k")) {
      event.preventDefault(); format(key === "b" ? "bold" : key === "i" ? "italic" : "link");
    }
    else if (event.key === "Escape") { event.preventDefault(); cancel(); }
  };
  const find = (backwards = false) => {
    const textarea = area.current;
    if (!textarea || !query.trim()) return;
    let range: [number, number] | undefined;
    if (backwards) {
      // The last match before the selection, else the last one in the chapter.
      let last: [number, number] | undefined;
      for (let next = locateInMarkdown(draft.body, query, 0, false); next; next = locateInMarkdown(draft.body, query, next[0] + 1, false)) { last = next; if (next[0] < textarea.selectionStart) range = next; }
      range ??= last;
    } else range = locateInMarkdown(draft.body, query, textarea.selectionEnd);
    if (range) reveal(textarea, range); else setMissing(true);
  };
  return <div className="focus-editor chapter-text-editor" data-compact={compact || undefined} onKeyDown={keys}>
    <div className="chapter-text-editor-bar" role="toolbar" aria-label={zh ? "编辑操作" : "Editing"}>
      <button type="button" onClick={undo} disabled={saving || !past.length} aria-label={zh ? "撤销" : "Undo"} title={zh ? "撤销（Ctrl+Z）" : "Undo (Ctrl+Z)"}><Undo2 size={15} aria-hidden="true" /></button>
      <button type="button" onClick={redo} disabled={saving || !future.length} aria-label={zh ? "重做" : "Redo"} title={zh ? "重做（Ctrl+Y）" : "Redo (Ctrl+Y)"}><Redo2 size={15} aria-hidden="true" /></button>
      <button type="button" onClick={revert} disabled={saving || !dirty} aria-label={zh ? "还原" : "Revert"} title={zh ? "还原为打开时的内容" : "Revert to the text as opened"}><RotateCcw size={14} aria-hidden="true" />{!compact && (zh ? "还原" : "Revert")}</button>
      {!compact ? <span className={`chapter-text-editor-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? zh ? "有未保存的修改" : "Unsaved changes" : zh ? "没有修改" : "No changes"}</span> : <span className="chapter-text-editor-spacer" aria-hidden="true" />}
      {confirming ? <span className="chapter-text-editor-confirm" role="alert">{zh ? "放弃这些修改？" : "Discard these changes?"}
        <button type="button" className="is-danger" onClick={onCancel}>{zh ? "放弃修改" : "Discard"}</button>
        <button type="button" onClick={() => { setConfirming(false); area.current?.focus(); }}>{zh ? "继续编辑" : "Keep editing"}</button></span>
        : <>
          <button type="button" onClick={cancel} disabled={saving} title={zh ? "不保存，退出编辑（Esc）" : "Leave without saving (Esc)"}>{zh ? "取消" : "Cancel"}</button>
          <button type="button" className="primary" onClick={() => void save()} disabled={saving} title={zh ? "保存并结束编辑（Ctrl+S）" : "Save and finish (Ctrl+S)"}>{saving ? zh ? "保存中…" : "Saving…" : dirty ? zh ? "保存" : "Save" : zh ? "完成" : "Done"}</button>
        </>}
    </div>
    {failed && <p className="chapter-markdown-error" role="alert">{failed}</p>}
    <input ref={heading} aria-label={zh ? "章节标题" : "Section title"} placeholder={zh ? "章节标题" : "Section title"} value={draft.title} readOnly={saving} onChange={event => change({ title: event.target.value })} />
    <div className="chapter-markdown-controls">
      <div className="chapter-markdown-views" role="group" aria-label={zh ? "编辑器视图" : "Editor view"}>
        {views.filter(([mode]) => mode !== "split" || !compact).map(([mode, cn, en]) =>
          <button key={mode} type="button" aria-pressed={view === mode} onClick={() => setView(mode)}>{zh ? cn : en}</button>)}
      </div>
      {view !== "preview" && <div className="chapter-text-editor-find">
      <label><Search size={14} aria-hidden="true" /><input ref={findInput} type="search" value={query} aria-label={zh ? "在本章查找" : "Find in this chapter"} placeholder={zh ? "在本章查找" : "Find in this chapter"} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); find(event.shiftKey); } }} /></label>
      {missing ? <small role="status">{zh ? "没有找到" : "Not found"}</small> : null}
      </div>}
    </div>
    {view !== "preview" && <div className="chapter-markdown-formats" role="group" aria-label={zh ? "Markdown 格式" : "Markdown formatting"}>
      {formatting.map(group => <div key={group[0][0]} className="chapter-markdown-format-group">
        {group.map(([kind, Icon, cn, en]) => <button key={kind} type="button" disabled={saving}
          aria-label={zh ? cn : en} title={zh ? cn : en} onMouseDown={event => event.preventDefault()} onClick={() => format(kind)}>
          <Icon size={15} aria-hidden="true"/>
        </button>)}
      </div>)}
    </div>}
    <div className="chapter-markdown-panes" data-view={view}>
      <textarea ref={area} hidden={view === "preview"} aria-label={zh ? "章节内容" : "Section content"} value={draft.body}
        placeholder={zh ? "输入 Markdown…" : "Write in Markdown…"} spellCheck={false} readOnly={saving}
        onChange={event => change({ body: event.target.value, cursor: event.target.selectionStart })} />
      {view !== "edit" && <section className="chapter-markdown-preview" aria-label={zh ? "Markdown 预览" : "Markdown preview"}>
        {previewBody.trim() ? <ReaderGuide content={previewBody} complete zh={zh}/> : <p>{zh ? "输入内容后可预览。" : "Write something to preview it."}</p>}
      </section>}
    </div>
    <div className="chapter-text-editor-footer">
      {compact ? <span className={`chapter-text-editor-state${dirty ? " is-dirty" : ""}`} role="status">{dirty ? zh ? "有未保存的修改" : "Unsaved changes" : zh ? "没有修改" : "No changes"}</span> : null}
      <span>{zh ? `${draft.body.trim().length} 字` : `${draft.body.trim().length} chars`}</span>
      {!compact ? <span>{zh ? "Ctrl+S 保存 · Esc 取消" : "Ctrl+S save · Esc cancel"}</span> : null}
    </div>
  </div>;
}
