import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, Expand, ChevronDown } from "lucide-react";
import { DiagramWorkspaceContext, DiagramHeaderContext } from "../diagram-workspace-context";

/** Keep parent-owned drafts intact while giving diagrams a dedicated reading surface. */
export function DiagramWorkspace({ children, title, heading, zh, onExpandedChange, expanded: controlledExpanded, regionLabel, collapseLabel, allowExpand = true, allowCollapse = true, settingsActions }: { children: ReactNode; title: string; heading?: ReactNode; zh: boolean; onExpandedChange?: (expanded: boolean) => void; expanded?: boolean; regionLabel?: string; collapseLabel?: string; allowExpand?: boolean; allowCollapse?: boolean; settingsActions?: ReactNode }) {
  const [opened, setExpanded] = useState(false), [placeholderHeight, setPlaceholderHeight] = useState(0);
  const expanded = controlledExpanded ?? opened;
  const [collapsed, setCollapsed] = useState(false);
  const [headingTarget, setHeadingTarget] = useState<HTMLDivElement | null>(null), [toolbarTarget, setToolbarTarget] = useState<HTMLDivElement | null>(null);
  const [fullHeadingTarget, setFullHeadingTarget] = useState<HTMLDivElement | null>(null), [fullToolbarTarget, setFullToolbarTarget] = useState<HTMLDivElement | null>(null);
  const preview = useRef<HTMLDivElement>(null), frame = useRef<HTMLDivElement>(null), opener = useRef<HTMLButtonElement>(null);
  const close = () => { setExpanded(false); onExpandedChange?.(false); };
  useEffect(() => {
    if (!expanded) return;
    const returnTarget = opener.current;
    const openedFrame = frame.current;
    const roots = [...document.body.children].filter(element => element instanceof HTMLElement && !element.contains(frame.current) && !element.classList.contains("map-detail-overlay")) as HTMLElement[];
    const states = roots.map(element => element.inert);
    roots.forEach(element => { element.inert = true; });
    frame.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    return () => { roots.forEach((element, index) => { element.inert = states[index]; }); queueMicrotask(() => { if (!openedFrame?.isConnected) returnTarget?.focus({ preventScroll: true }); }); };
  }, [expanded]);
  const content = <DiagramWorkspaceContext.Provider value={expanded}>{children}</DiagramWorkspaceContext.Provider>;
  return <DiagramHeaderContext.Provider value={{ heading: expanded ? fullHeadingTarget : headingTarget, toolbar: expanded ? fullToolbarTarget : toolbarTarget, settingsActions }}><div ref={preview} role={regionLabel ? "region" : undefined} aria-label={regionLabel} className="diagram-workspace-preview" style={expanded ? { minHeight: placeholderHeight } : undefined}>
    <div className="diagram-preview-heading" onClickCapture={event => { if ((event.target as Element).closest("button:not(.diagram-collapse)")) setCollapsed(false); }}><div ref={setHeadingTarget} className="diagram-preview-title">{heading}</div><div className="diagram-preview-actions"><div ref={setToolbarTarget} />{allowExpand ? <button ref={opener} type="button" className="diagram-open-full" aria-label={zh ? "打开完整图" : "Open full diagram"} title={zh ? "打开完整图" : "Open full diagram"} onClick={() => { setCollapsed(false); setPlaceholderHeight(preview.current?.offsetHeight ?? 0); setExpanded(true); onExpandedChange?.(true); }}><Expand size={17} /></button> : null}{allowCollapse ? <button type="button" className="diagram-collapse" aria-expanded={!collapsed} aria-label={`${collapsed ? zh ? "展开" : "Expand" : zh ? "收起" : "Collapse"}${collapseLabel ?? regionLabel ?? (zh ? "结构" : " structure")}`} onClick={() => setCollapsed(!collapsed)}><ChevronDown size={16} /></button> : null}</div></div>
    {expanded ? createPortal(<div ref={frame} className="diagram-workspace focus-workspace" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key !== "Tab") return;
      const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex="0"]')].filter(element => element.getClientRects().length);
      const first = targets[0], last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}><header className="diagram-workspace-heading"><button type="button" onClick={close}><ArrowLeft size={18} />{zh ? "返回阅读" : "Back to reading"}</button><h1>{title}</h1><div className="diagram-workspace-actions"><div ref={setFullHeadingTarget} className="diagram-workspace-edit-actions" /><div ref={setFullToolbarTarget} className="diagram-preview-actions" /></div></header><div className="diagram-workspace-content">{content}</div></div>, document.body) : <div className="diagram-preview-body" hidden={collapsed}>{content}</div>}
  </div></DiagramHeaderContext.Provider>;
}
