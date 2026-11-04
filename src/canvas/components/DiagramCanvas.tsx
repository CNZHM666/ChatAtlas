import { useContext, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Maximize2, Minus, Plus, SlidersHorizontal, X } from "lucide-react";
import type { FocusSection } from "../../shared/focus-session";
import { connectorKey } from "../concept-connectors";
import { layoutDiagram, type DiagramInput, type DiagramLayout } from "../diagram-layout";
import { conceptLevels } from "../understanding-route-layout";
import { understandingRelationText } from "../understanding-model";
import { DiagramHeaderContext, useFullDiagram } from "../diagram-workspace-context";
import { diagramReadingEdges } from "../diagram-reading";
import { roundedOrthogonalPath } from "../edge-geometry";
import { understandingSummary } from "../understanding-summary";
import { DiagramHeaderSlot } from "./DiagramHeaderSlot";
import { diagramSvg } from "../diagram-svg";

const initialLayout = (sections: FocusSection[]): DiagramLayout => ({ width: Math.min(3, sections.length) * 240 + 40, height: Math.ceil(sections.length / 3) * 110 + 40, groups: [], links: [], nodes: sections.map((node, index) => ({ id: node.id, x: 24 + index % 3 * 240, y: 24 + Math.floor(index / 3) * 110, width: 180, height: 68 })) });

/** Native layered canvas. Selection never participates in layout or viewport fitting. */
export function DiagramCanvas({ sections, edges, groups, zh, review, showDetails, context, renderCard, focusId, selectedRelation, onRelation, onNode, completeArchitecture = false, compactControls = false }: DiagramInput & {
  context?: ReactNode; completeArchitecture?: boolean; compactControls?: boolean;
  renderCard: (section: FocusSection, placement?: CSSProperties) => ReactNode;
  focusId?: string; selectedRelation?: string; onRelation: (key: string) => void; onNode: () => void;
}) {
  const fullDiagram = useFullDiagram();
  const {settingsActions}=useContext(DiagramHeaderContext);
  const [result, setResult] = useState<{ key: string; layout: DiagramLayout }>();
  const [failed, setFailed] = useState(false), [width, setWidth] = useState(900);
  const [availableHeight, setAvailableHeight] = useState(window.innerHeight);
  // Start with the saved forward relationships; all return/dependency details remain available.
  const [allRelations, setAllRelations] = useState(completeArchitecture);
  const [showGroups, setShowGroups] = useState(false);
  // Long source sentences on every connector can turn a small study hierarchy
  // into a tall article. Expose labels on demand; the source meaning remains available on selection.
  const [showLabels, setShowLabels] = useState(Boolean(showDetails && (completeArchitecture || edges.length <= 12) && edges.some(edge => edge.label?.trim()))), [orientation, setOrientation] = useState<"auto" | "RIGHT" | "DOWN">("auto");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [reflow,setReflow]=useState(0),layoutEpoch=useRef(0);
  const settings = useRef<HTMLDivElement>(null), settingsButton = useRef<HTMLButtonElement>(null);
  const settingsId = useId();
  const backbone = diagramReadingEdges(edges);
  const extraCount = edges.length - backbone.length;
  const displayEdges = allRelations ? edges : backbone;
  const displayGroups = showGroups ? groups : undefined;
  const [view, setView] = useState<{ key: string; x: number; y: number; scale: number }>();
  const viewport = useRef<HTMLDivElement>(null), gesture = useRef<{ x: number; y: number; ox: number; oy: number; scale: number }>();
  const markerId = useId().replace(/:/gu, "");
  useEffect(() => {
    if (!settingsOpen) return;
    settings.current?.querySelector<HTMLSelectElement>("select")?.focus({ preventScroll: true });
    const outside = (event: Event) => {
      if (event.target instanceof Node && !settings.current?.contains(event.target)) setSettingsOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("focusin", outside);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("focusin", outside); };
  }, [settingsOpen]);
  const [nodeDetails, setNodeDetails] = useState(Boolean(showDetails && (completeArchitecture || sections.length <= 8)));
  const [nodeIO, setNodeIO] = useState(!completeArchitecture);
  const displayDetails = showDetails && nodeDetails;
  const displaySections = nodeIO ? sections : sections.map(node => ({ ...node, inputs: undefined, outputs: undefined }));
  const direction = orientation === "auto" ? sections.length <= 3 && width >= sections.length * 256 ? "RIGHT" : "DOWN" : orientation;
  const wide = fullDiagram && width > 900;
  const signature = JSON.stringify({ sections: sections.map(node => ({ id: node.id, title: node.title, origin: node.origin, userEdited: node.userEdited, ...(displayDetails ? { summary: understandingSummary(node), inputs: node.inputs, outputs: node.outputs } : {}) })), edges: displayEdges, groups: displayGroups?.map(group => ({ id: group.id, title: group.title, ids: group.items.map(item => item.id) })), zh, review, showDetails: displayDetails, nodeIO, allRelations, wide, showLabels, direction });
  const layout = result?.key === signature ? result.layout : initialLayout(sections);
  const ready = result?.key === signature;
  useEffect(() => {
    let alive = true;
    const refresh=layoutEpoch.current!==reflow;layoutEpoch.current=reflow;
    layoutDiagram({ sections: displaySections, edges: displayEdges, groups: displayGroups, zh, review, architecture:completeArchitecture, showDetails: displayDetails, simple: !allRelations, wide, labels: showLabels, compactLabels: true, direction },refresh).then(layout => { if (alive) { setResult({ key: signature, layout }); setFailed(false); } }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
    // Selection does not change geometry; visible summaries do.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature,reflow]);
  useEffect(() => {
    const element = viewport.current; if (!element) return;
    const measure = () => { if (element.clientWidth) setWidth(element.clientWidth); setAvailableHeight(window.innerHeight - element.getBoundingClientRect().top - 28); };
    measure(); const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : undefined;
    observer?.observe(element); window.addEventListener("resize", measure);
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure); };
  }, [fullDiagram, extraCount]);
  const height = fullDiagram ? Math.max(240, availableHeight) : showDetails ? Math.min(completeArchitecture ? 1100 : displayDetails ? 620 : 900, Math.max(sections.length <= 3 ? 170 : 240, layout.height * Math.min(1, (width - 24) / Math.max(1, layout.width)) + 76)) : review ? 300 : Math.min(420, Math.max(320, layout.height * Math.min(1, (width - 24) / Math.max(1, layout.width)) + 76));
  const chartHeight = height - 52;
  const fullScale = Math.min(1, (width - 24) / Math.max(1, layout.width), (chartHeight - 24) / Math.max(1, layout.height));
  const fit = { x: (width - layout.width * fullScale) / 2, y: (chartHeight - layout.height * fullScale) / 2, scale: fullScale };
  // Descriptions must remain readable, including in a complete product architecture.
  // The viewport pans internally; Fit diagram remains an explicit topology overview.
  const readableScale = displayDetails ? Math.max(.8, fullScale) : fullScale;
  // Feedback routing may reserve a wide outer lane. A cropped map should
  // start at the actual modules, instead of showing only that empty lane.
  const cropped = readableScale > fullScale;
  const entry = [...layout.nodes].sort((a, b) => direction === "DOWN" ? a.y - b.y || a.x - b.x : a.x - b.x || a.y - b.y)[0];
  const contentX = cropped && entry ? Math.max(0, entry.x - 28) : 0;
  const contentY = cropped && entry ? Math.max(0, entry.y - 48) : 0;
  const readable = { key: signature, x: layout.width * readableScale < width - 24 ? (width - layout.width * readableScale) / 2 : 12 - contentX * readableScale, y: cropped ? 12 - contentY * readableScale : 12, scale: readableScale };
  const current = view && (completeArchitecture || view.key === signature) ? view : readable;
  useEffect(() => {
    const element = viewport.current; if (!element || !ready) return;
    const scroll = (event: WheelEvent) => {
      // Leave browser zoom alone. At diagram boundaries allow the article to scroll.
      if (event.ctrlKey || event.metaKey || event.target instanceof Element && event.target.closest("button, input, select")) return;
      const unit = event.deltaMode === 1 ? 18 : event.deltaMode === 2 ? chartHeight : 1;
      const dx = (event.shiftKey ? event.deltaY : event.deltaX) * unit, dy = (event.shiftKey ? 0 : event.deltaY) * unit;
      const clamp = (position: number, length: number, space: number) => length <= space - 24 ? position : Math.max(space - length - 12, Math.min(12, position));
      const x = clamp(current.x - dx, layout.width * current.scale, width), y = clamp(current.y - dy, layout.height * current.scale, chartHeight);
      if (x === current.x && y === current.y) return;
      event.preventDefault(); setView({ ...current, x, y });
    };
    element.addEventListener("wheel", scroll, { passive: false });
    return () => element.removeEventListener("wheel", scroll);
  }, [ready, current, layout.width, layout.height, width, chartHeight]);
  const zoom = (factor: number) => {
    const scale = Math.min(2.5, Math.max(.2, current.scale * factor)), ratio = scale / current.scale;
    setView({ key: signature, scale, x: width / 2 - (width / 2 - current.x) * ratio, y: chartHeight / 2 - (chartHeight / 2 - current.y) * ratio });
  };
  const resetSize = () => setView({ key: signature, scale: 1, x: layout.width < width - 24 ? (width - layout.width) / 2 : 12, y: layout.height < chartHeight - 24 ? (chartHeight - layout.height) / 2 : 12 });
  const closeSettings = () => { setSettingsOpen(false); settingsButton.current?.focus({ preventScroll: true }); };
  const positions = new Map(layout.nodes.map(node => [node.id, node]));
  const levels = conceptLevels(sections, edges);
  const selectedEdge = edges.find(edge => connectorKey(edge) === selectedRelation);
  const connected = new Set(selectedEdge ? [selectedEdge.from, selectedEdge.to] : focusId ? [focusId, ...edges.filter(edge => edge.from === focusId || edge.to === focusId).flatMap(edge => [edge.from, edge.to])] : []);
  return <div className={`diagram-shell${displayDetails ? " diagram-node-details" : " diagram-compact-nodes"}${nodeIO ? "" : " diagram-summary-nodes"} ${review ? "diagram-review" : "diagram-project"}`}>
    <DiagramHeaderSlot toolbar><div className="diagram-toolbar">
      {!compactControls && extraCount > 0 ? <div className="diagram-reading-options" role="group" aria-label={zh ? "关系显示" : "Relationship display"}><button type="button" aria-pressed={!allRelations} onClick={() => setAllRelations(false)}>{zh ? "主线" : "Main connections"}</button><button type="button" aria-pressed={allRelations} onClick={() => setAllRelations(true)}>{zh ? "全部" : "All connections"}</button></div> : null}
      {failed || !ready ? <span className="diagram-layout-status" role="status">{failed ? zh ? "布局未完成" : "Layout unavailable" : zh ? "布局中…" : "Laying out…"}</span> : null}
      <div ref={settings} className="diagram-settings" onKeyDown={event => { if (event.key === "Escape" && settingsOpen) { event.preventDefault(); event.stopPropagation(); closeSettings(); } }}>
        <button ref={settingsButton} type="button" aria-label={zh ? "图表设置" : "Diagram settings"} title={zh ? "图表设置" : "Diagram settings"} aria-haspopup="dialog" aria-expanded={settingsOpen} aria-controls={settingsOpen ? settingsId : undefined} onClick={() => setSettingsOpen(!settingsOpen)}><SlidersHorizontal size={17} /></button>
        {settingsOpen ? <div id={settingsId} className="diagram-settings-panel" role="dialog" aria-label={zh ? "图表设置" : "Diagram settings"}>
          <header><strong>{zh ? "图表设置" : "Diagram settings"}</strong><button type="button" aria-label={zh ? "关闭图表设置" : "Close diagram settings"} onClick={closeSettings}><X size={16} /></button></header>
          <label className="diagram-direction-field"><span>{zh ? "方向" : "Direction"}</span><select aria-label={zh ? "图表方向" : "Diagram direction"} value={orientation} onChange={event => setOrientation(event.target.value as typeof orientation)}><option value="auto">{zh ? "自动" : "Automatic"}</option><option value="RIGHT">{zh ? "横向" : "Horizontal"}</option><option value="DOWN">{zh ? "纵向" : "Vertical"}</option></select></label>
          <button type="button" onClick={()=>{setView(undefined);setReflow(value=>value+1);closeSettings();}}>{zh?"重新排版":"Rearrange"}</button>
          <button type="button" disabled={!ready} onClick={()=>{const style=getComputedStyle(document.documentElement),theme={background:style.getPropertyValue("--page").trim(),surface:style.getPropertyValue("--surface-solid").trim(),text:style.getPropertyValue("--text").trim(),muted:style.getPropertyValue("--muted").trim(),border:style.getPropertyValue("--border").trim()};const url=URL.createObjectURL(new Blob([diagramSvg(layout,displaySections,theme)],{type:"image/svg+xml;charset=utf-8"})),anchor=document.createElement("a");anchor.href=url;anchor.download="atlas-diagram.svg";anchor.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);closeSettings();}}>{zh?"导出 SVG":"Export SVG"}</button>
          {!compactControls && showDetails ? <label className="diagram-label-field"><span>{zh ? "模块详情" : "Module details"}</span><input type="checkbox" checked={nodeDetails} onChange={event => setNodeDetails(event.target.checked)} /></label> : null}
          {!compactControls && completeArchitecture && displayDetails ? <label className="diagram-label-field"><span>{zh ? "输入输出" : "Inputs and outputs"}</span><input type="checkbox" checked={nodeIO} onChange={event => setNodeIO(event.target.checked)} /></label> : null}
          <label className="diagram-label-field"><span>{zh ? "连线标签" : "Connection labels"}</span><input type="checkbox" checked={showLabels} onChange={event => setShowLabels(event.target.checked)} /></label>
          {!compactControls && extraCount > 0 ? <label><span>{zh ? "全部关系" : "All relationships"}</span><input type="checkbox" checked={allRelations} onChange={event => setAllRelations(event.target.checked)} /></label> : null}
          {groups?.length ? <label><span>{zh ? "分组边框" : "Group frames"}</span><input type="checkbox" checked={showGroups} onChange={event => setShowGroups(event.target.checked)} /></label> : null}
          {!compactControls && context ? <details className="diagram-legend-details"><summary>{zh ? "图例" : "Legend"}</summary>{context}</details> : null}
          {settingsActions?<div className="diagram-settings-actions" onClick={closeSettings}>{settingsActions}</div>:null}
        </div> : null}
      </div>
    </div></DiagramHeaderSlot>
    <div ref={viewport} className="concept-map-canvas diagram-viewport" style={{ height }} tabIndex={0} role="region" aria-label={zh ? "结构图" : "Structure map"} title={cropped ? zh ? "拖动或滚动查看；适配全图可查看整体关系" : "Drag or scroll to explore; Fit diagram shows all connections" : undefined}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; if (["+", "=", "-", "0", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.key)) { event.preventDefault(); if (["+", "="].includes(event.key)) zoom(1.2); else if (event.key === "-") zoom(1 / 1.2); else if (event.key === "0") setView({ ...fit, key: signature }); else setView({ ...current, x: current.x + (event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0), y: current.y + (event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0) }); } }}
      onClickCapture={event => { if (event.target instanceof Element && event.target.closest("[data-route-id]")) onNode(); }}
      onFocusCapture={event => { if (!(event.target instanceof Element)) return; const node = event.target.closest<HTMLElement>(".diagram-node"); if (!node) return; const position = positions.get(node.querySelector<HTMLElement>("[data-route-id]")?.dataset.routeId ?? ""); if (!position) return; const left = position.x * current.scale + current.x, top = position.y * current.scale + current.y; const right = left + position.width * current.scale, bottom = top + position.height * current.scale; const dx = left < 12 ? 12 - left : right > width - 12 ? width - 12 - right : 0, dy = top < 12 ? 12 - top : bottom > height - 12 ? height - 12 - bottom : 0; if (dx || dy) setView({ ...current, x: current.x + dx, y: current.y + dy }); }}
      onPointerDown={event => { if (event.button !== 0 || event.target instanceof Element && event.target.closest("button, [role=button], [data-route-id]")) return; event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); gesture.current = { x: event.clientX, y: event.clientY, ox: current.x, oy: current.y, scale: current.scale }; }}
      onPointerMove={event => { const start = gesture.current; if (start) setView({ key: signature, x: start.ox + event.clientX - start.x, y: start.oy + event.clientY - start.y, scale: start.scale }); }}
      onPointerUp={() => { gesture.current = undefined; }} onPointerCancel={() => { gesture.current = undefined; }}>
      <div className="diagram-stage" hidden={!ready} style={{ width: layout.width, height: layout.height, transform: `translate(${current.x}px, ${current.y}px) scale(${current.scale})` }}>
        <svg className="diagram-lines" width={layout.width} height={layout.height} aria-label={zh ? "要点连接" : "Concept connections"}>
          <defs>{["normal", "feedback", "selected"].map(kind => <marker key={kind} className={`diagram-marker-${kind}`} id={`${markerId}-${kind}`} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto-start-reverse"><path d="M1,1 L6,3.5 L1,6" /></marker>)}</defs>
          {layout.groups.map(group => <g className="diagram-compound" key={group.id}><rect x={group.x} y={group.y} width={group.width} height={group.height} rx="6" /><text x={group.x + group.width / 2} y={group.y + 23} textAnchor="middle">{group.title}</text></g>)}
          {layout.links.map(link => {
            const edge = edges.find(edge => connectorKey(edge) === link.id); if (!edge) return null;
            const focused = selectedRelation ? selectedRelation === link.id : focusId ? edge.from === focusId || edge.to === focusId : false;
            const arrow = `url(#${markerId}-${focused ? "selected" : edge.kind === "feedback" ? "feedback" : "normal"})`;
            return <g key={link.id} role="button" tabIndex={0} aria-label={`${zh ? "查看关系" : "View relation"} ${edges.indexOf(edge) + 1}: ${sections.find(node => node.id === edge.from)?.title} ${edge.kind === "comparison" ? "↔" : edge.kind === "contains" ? "·" : "→"} ${sections.find(node => node.id === edge.to)?.title}`} aria-pressed={selectedRelation === link.id} onClick={() => onRelation(link.id)} onKeyDown={event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); onRelation(link.id); } }} className={`diagram-edge ${edge.kind}${focused ? " is-focused" : focusId || selectedRelation ? " is-muted" : ""}`}>
              <title>{understandingRelationText(edge, zh, false)}</title>
              {link.paths.map((path, index) => <path key={index} d={roundedOrthogonalPath([...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/gu)].map(point => ({ x: Number(point[1]), y: Number(point[2]) })), 5)} markerEnd={edge.kind === "contains" ? undefined : arrow} markerStart={edge.kind === "comparison" ? arrow : undefined} />)}
              {link.paths.map((path, index) => <path className="diagram-edge-hit" key={`hit:${index}`} d={path} />)}
              {link.labels.map(label => <g key={label.id} className="diagram-edge-label">
                <title>{understandingRelationText(edge, zh, false)}</title><rect x={label.x} y={label.y} width={label.width} height={label.height} rx={5} />
                <text x={label.x + label.width / 2} y={label.y + (label.height - label.lines.length * 20) / 2 + 14} textAnchor="middle">{label.lines.map((line, index) => <tspan key={index} x={label.x + label.width / 2} dy={index ? 20 : 0}>{line}</tspan>)}</text>
              </g>)}
            </g>;
          })}
        </svg>
        {levels.map((nodes, index) => <ol className="concept-map-level diagram-level" key={index}>{nodes.map(node => {
          const position = positions.get(node.id); if (!position) return null;
          return <li className={`diagram-node${(focusId || selectedEdge) && !connected.has(node.id) ? " is-muted" : ""}${selectedEdge && connected.has(node.id) ? " is-highlighted" : ""}`} key={node.id} style={{ left: position.x, top: position.y, width: position.width, height: position.height }}>
            <ol>{renderCard(node)}</ol>
          </li>;
        })}</ol>)}
      </div>
      <div className="diagram-zoom-controls" role="group" aria-label={zh ? "图表缩放" : "Diagram zoom"}>
        <button type="button" title={zh ? "缩小" : "Zoom out"} aria-label={zh ? "缩小图表" : "Zoom out"} onClick={() => zoom(1 / 1.2)}><Minus size={16} /></button>
        <button type="button" className="diagram-scale" title={compactControls?zh?"适配全图":"Fit diagram":zh?"恢复原始大小":"Reset to 100%"} aria-label={compactControls?zh?"适配全图":"Fit diagram":zh?"恢复原始大小":"Reset to 100%"} onClick={compactControls?()=>setView({...fit,key:signature}):resetSize}>{Math.round(current.scale * 100)}%</button>
        <button type="button" title={zh ? "放大" : "Zoom in"} aria-label={zh ? "放大图表" : "Zoom in"} onClick={() => zoom(1.2)}><Plus size={16} /></button>
        {!compactControls?<button type="button" title={zh ? "适配全图" : "Fit diagram"} aria-label={zh ? "适配全图" : "Fit diagram"} onClick={() => setView({ ...fit, key: signature })}><Maximize2 size={16} /></button>:null}
      </div>
    </div>
  </div>;
}
