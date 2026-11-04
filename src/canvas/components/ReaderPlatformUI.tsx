import { useMemo } from "react";
import { ArrowUpRight, LayoutTemplate } from "lucide-react";
import { widgetMarkup } from "../../shared/message-ui";
import { dilPayload, dilSummary } from "../../shared/dil-source";
import { uiPreviewDocument } from "../ui-preview";
import { ReaderUIPreview } from "./ReaderUIPreview";

/** ChatGPT component source, folded: what it shows and offers, with the source one click away. Never executed. */
function ReaderDILCard({ source, zh, sourceUrl }: { source: string; zh: boolean; sourceUrl?: string }) {
  const summary = useMemo(() => dilSummary(source), [source]);
  const kind = zh ? "ChatGPT 交互组件" : "ChatGPT interactive component";
  return <aside className="reader-dil" aria-label={kind}>
    <header>
      <span className="reader-dil-icon" aria-hidden="true"><LayoutTemplate size={15} /></span>
      <div><small>{kind}</small>{summary.title ? <strong>{summary.title}</strong> : null}</div>
      {sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{zh ? "在 ChatGPT 中查看" : "View in ChatGPT"}<ArrowUpRight size={13} aria-hidden="true" /></a> : null}
    </header>
    {summary.items.length ? <ul>{summary.items.map(item => <li key={item}>{item}</li>)}</ul> : null}
    {summary.actions.length ? <div className="reader-dil-actions">{summary.actions.map(action => <span key={action}>{action}</span>)}</div> : null}
    <details><summary>{zh ? "查看源码" : "View source"}</summary><pre><code>{source}</code></pre></details>
  </aside>;
}

export function ReaderPlatformUI({ raw, fallbackText, truncated, zh, sourceUrl }: { raw: string; fallbackText?: string; truncated?: boolean; zh: boolean; sourceUrl?: string }) {
  const dil = dilPayload(raw);
  if (dil !== undefined) return <ReaderDILCard source={dil} zh={zh} sourceUrl={sourceUrl} />;
  const markup = widgetMarkup(raw);
  if (markup && uiPreviewDocument(markup.source, markup.language)) return <ReaderUIPreview {...markup} zh={zh} sourceUrl={sourceUrl} />;
  return <aside className="reader-platform-ui"><div><strong>{zh ? "原平台交互组件" : "Original interactive component"}</strong><small>{truncated ? zh ? "组件过大，仅保留位置" : "Large component: location retained" : zh ? "需在原对话中使用" : "Use in the original conversation"}</small>{fallbackText ? <p>{fallbackText}</p> : null}</div>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noopener noreferrer">{zh ? "查看原文" : "Open original"}</a> : null}</aside>;
}
