import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { locateInMarkdown } from "../markdown-locate";

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

/** A chapter's title and Markdown, opened where the reader was: the sentence they chose to rewrite, or the paragraph they
 * were reading, is selected and scrolled to, so a small change does not start with a search through the whole chapter.
 * A find box jumps between the places a word appears. */
export function ChapterTextEditor({ title, body, target, zh, onTitle, onBody }: {
  title: string; body: string;
  /** Rendered text to open at; looked for in the Markdown. */
  target?: string;
  zh: boolean; onTitle: (value: string) => void; onBody: (value: string) => void;
}) {
  const area = useRef<HTMLTextAreaElement>(null);
  const [query, setQuery] = useState(""), [missing, setMissing] = useState(false);
  const opened = useRef<string | undefined>();
  // Once per target: typing afterwards keeps the cursor where the user put it.
  useLayoutEffect(() => {
    const textarea = area.current;
    if (!textarea || opened.current === (target ?? "")) return;
    opened.current = target ?? "";
    const range = target ? locateInMarkdown(body, target) : undefined;
    if (range) reveal(textarea, range); else textarea.focus({ preventScroll: true });
  }, [target, body]);
  useEffect(() => setMissing(false), [query]);
  const find = (backwards = false) => {
    const textarea = area.current;
    if (!textarea || !query.trim()) return;
    let range: [number, number] | undefined;
    if (backwards) {
      // The last match before the selection, else the last one in the chapter.
      let last: [number, number] | undefined;
      for (let next = locateInMarkdown(body, query, 0, false); next; next = locateInMarkdown(body, query, next[0] + 1, false)) { last = next; if (next[0] < textarea.selectionStart) range = next; }
      range ??= last;
    } else range = locateInMarkdown(body, query, textarea.selectionEnd);
    if (range) reveal(textarea, range); else setMissing(true);
  };
  return <div className="focus-editor chapter-text-editor">
    <input aria-label={zh ? "章节标题" : "Section title"} value={title} onChange={event => onTitle(event.target.value)} />
    <div className="chapter-text-editor-find">
      <label><Search size={14} aria-hidden="true" /><input type="search" value={query} aria-label={zh ? "在本章查找" : "Find in this chapter"} placeholder={zh ? "在本章查找，回车跳到下一处" : "Find in this chapter; Enter for the next"} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); find(event.shiftKey); } }} /></label>
      {missing ? <small role="status">{zh ? "没有找到" : "Not found"}</small> : null}
    </div>
    <textarea ref={area} aria-label={zh ? "章节内容" : "Section content"} value={body} spellCheck={false} onChange={event => onBody(event.target.value)} />
  </div>;
}
