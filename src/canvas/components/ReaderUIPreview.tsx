import { useMemo, useState, type ReactNode } from "react";
import { uiPreviewDocument } from "../ui-preview";

export function ReaderUIPreview({ source, language, height, zh, children, copy = true, sourceUrl }: { source: string; language: string; height?: number; zh: boolean; children?: ReactNode; copy?: boolean; sourceUrl?: string }) {
  const document = useMemo(() => uiPreviewDocument(source, language), [source, language]);
  const [showSource, setShowSource] = useState(false), [expanded, setExpanded] = useState(false);
  if (!document) return <pre>{children ?? source}</pre>;
  return <section className={`reader-ui-preview${expanded ? " is-expanded" : ""}`}>
    <header><div role="group" aria-label={zh ? "展示方式" : "Display mode"}><button type="button" aria-pressed={!showSource} onClick={() => setShowSource(false)}>{zh ? "预览" : "Preview"}</button><button type="button" aria-pressed={showSource} onClick={() => setShowSource(true)}>{zh ? "代码" : "Code"}</button></div><div>{!showSource ? <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? zh ? "缩小" : "Shrink" : zh ? "展开" : "Expand"}</button> : null}{copy ? <button type="button" onClick={() => void navigator.clipboard?.writeText(source)}>{zh ? "复制原文" : "Copy source"}</button> : null}</div></header>
    {showSource ? <pre>{children ?? source}</pre> : <iframe title={zh ? "原文界面预览" : "Source UI preview"} sandbox="" referrerPolicy="no-referrer" srcDoc={document} style={!expanded && height ? { height: `${Math.max(160, Math.min(640, height + 44))}px` } : undefined} />}
    <footer><small>{zh ? "界面快照 · 在线交互请回原文" : "Visual snapshot · Use the original for live interaction"}</small>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{zh ? "回到原文" : "Open original"}</a> : null}</footer>
  </section>;
}
