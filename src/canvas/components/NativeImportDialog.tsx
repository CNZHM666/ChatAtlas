import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import type { NativeImportSource } from "../../shared/native-import";
import { WEB_CAPTURE_PLATFORMS } from "../../shared/web-capture";
import "../file-import-guide.css";

export function NativeImportDialog({ sources, zh, onChoose, onClose }: { sources: NativeImportSource[]; zh: boolean; onChoose: (sources: NativeImportSource[]) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<Set<string>>(new Set()), heading = useRef<HTMLHeadingElement>(null), panel = useRef<HTMLDivElement>(null), id = useId();
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null, overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; heading.current?.focus();
    return () => { document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, []);
  return createPortal(<div className="file-import-guide-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={panel} className="file-import-guide native-import-dialog" role="dialog" aria-modal="true" aria-labelledby={id} onKeyDown={event => {
      if (event.key === "Escape") { event.stopPropagation(); onClose(); }
      if (event.key !== "Tab") return;
      const items = [...panel.current!.querySelectorAll<HTMLElement>('button:not(:disabled),input,a[href]')], first = items[0], last = items.at(-1);
      if (!items.includes(document.activeElement as HTMLElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
    }}>
      <header className="file-import-guide-header"><h2 ref={heading} tabIndex={-1} id={id}>{sources.length ? zh ? "选择要导入的 AI" : "Choose AI sources" : zh ? "尚未检测到 AI 网页" : "No AI pages detected"}</h2><button type="button" className="file-import-guide-close" aria-label={zh ? "关闭" : "Close"} onClick={onClose}><X size={20}/></button></header>
      <div className="file-import-guide-body"><p>{sources.length ? zh ? "选择需要导入的平台，自动读取账号历史标题，再勾选对话同步完整正文。" : "Select platforms to read account history, then choose conversations to sync in full." : zh ? "请在当前浏览器打开并登录 AI 网站，再点击导入。" : "Open an AI website and sign in in this browser, then import again."}</p>
        {sources.map(source => <label key={source.id} className="native-import-choice"><input type="checkbox" checked={selected.has(source.id)} onChange={event => { const checked = event.target.checked; setSelected(current => { const next = new Set(current); if (checked) next.add(source.id); else next.delete(source.id); return next; }); }}/><span><strong>{source.label}</strong><small>{new URL(source.origin).hostname}</small></span></label>)}
        {!sources.length ? <div className="native-import-links">{[{ name: "ChatGPT", origin: "https://chatgpt.com" }, ...WEB_CAPTURE_PLATFORMS].map(site => <a key={site.origin} href={site.origin} target="_blank" rel="noopener noreferrer">{site.name}</a>)}</div> : null}
      </div><footer className="file-import-guide-footer"><button type="button" className="file-import-guide-cancel" onClick={onClose}>{zh ? "取消" : "Cancel"}</button>{sources.length ? <button type="button" className="file-import-guide-choose" disabled={!selected.size} onClick={() => onChoose(sources.filter(source => selected.has(source.id)))}>{zh ? `导入所选（${selected.size}）` : `Import selected (${selected.size})`}</button> : null}</footer>
    </div>
  </div>, document.body);
}
