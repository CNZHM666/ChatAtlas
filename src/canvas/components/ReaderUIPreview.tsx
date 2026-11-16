import { useMemo, useState, type ReactNode } from "react";
import { uiPreviewDocument } from "../ui-preview";
import { interactivePreviewDocument } from "../interactive-preview";
import { sourceMessageSignature } from "../../shared/source-signature";

export function ReaderUIPreview({ source, language, height, zh, children, copy = true, sourceUrl, interactive = false }: { source: string; language: string; height?: number; zh: boolean; children?: ReactNode; copy?: boolean; sourceUrl?: string; interactive?: boolean }) {
  const document = useMemo(() => uiPreviewDocument(source, language), [source, language]);
  const runtime = useMemo(() => interactive ? interactivePreviewDocument(source, language) : undefined, [source, language, interactive]);
  const revision = useMemo(() => sourceMessageSignature(runtime ?? document ?? ""), [runtime, document]);
  const [showSource, setShowSource] = useState(false), [expanded, setExpanded] = useState(false);
  if (!document && !runtime) return <pre>{children ?? source}</pre>;
  const sandboxUrl = typeof chrome !== "undefined" && chrome.runtime?.getURL ? chrome.runtime.getURL("reader-preview.html") : "/reader-preview.html";
  return <section className={`reader-ui-preview${expanded ? " is-expanded" : ""}`}>
    <header><div role="group" aria-label={zh ? "展示方式" : "Display mode"}><button type="button" aria-pressed={!showSource} onClick={() => setShowSource(false)}>{zh ? "预览" : "Preview"}</button><button type="button" aria-pressed={showSource} onClick={() => setShowSource(true)}>{zh ? "代码" : "Code"}</button></div><div>{!showSource ? <button type="button" onClick={() => setExpanded(value => !value)}>{expanded ? zh ? "缩小" : "Shrink" : zh ? "展开" : "Expand"}</button> : null}{copy ? <button type="button" onClick={() => void navigator.clipboard?.writeText(source)}>{zh ? "复制原文" : "Copy source"}</button> : null}</div></header>
    {showSource ? <pre>{children ?? source}</pre> : <iframe key={revision} title={zh ? "原文界面预览" : "Source UI preview"} sandbox={runtime ? "allow-scripts" : ""} referrerPolicy="no-referrer" src={runtime ? sandboxUrl : undefined} srcDoc={runtime ? undefined : document} onLoad={runtime ? event => event.currentTarget.contentWindow?.postMessage({ type: "atlas-reader-preview", document: runtime }, "*") : undefined} style={!expanded && height ? { height: `${Math.max(160, Math.min(640, height + 44))}px` } : undefined} />}
    <footer><small>{runtime ? zh ? "本地交互 · 不连接原平台，操作不会写回对话" : "Local interaction · Offline; changes are not sent to the original" : zh ? "界面快照 · 在线交互请回原文" : "Visual snapshot · Use the original for live interaction"}</small>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{zh ? "回到原文" : "Open original"}</a> : null}</footer>
  </section>;
}
