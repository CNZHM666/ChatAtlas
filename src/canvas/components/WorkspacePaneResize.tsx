import { useLayoutEffect, useRef, useState } from "react";
import "../workspace-pane-resize.css";

const WIDTH_KEY = "atlas-workspace-pane-width";
const constrain = (width: number, maximum: number) => Math.round(Math.max(320, Math.min(maximum, width)));

/** UI preference only: both record details and original evidence use the same split width. */
export function WorkspacePaneResize({ enabled, zh }: { enabled: boolean; zh: boolean }) {
  const anchor = useRef<HTMLSpanElement>(null), workspace = useRef<HTMLElement | null>(null);
  const preferred = useRef<number | null>(null), drag = useRef<{ x: number; width: number } | null>(null);
  const bounds = useRef({ maximum: 720, fallback: 460 });
  const [width, setWidth] = useState(0), [maximum, setMaximum] = useState(720), [dragging, setDragging] = useState(false);
  const apply = (value: number) => {
    const next = constrain(value, bounds.current.maximum);
    workspace.current?.style.setProperty("--workspace-pane-width", `${next}px`);
    setWidth(next);
    return next;
  };
  const remember = (value: number | null) => {
    preferred.current = value;
    try { if (value === null) localStorage.removeItem(WIDTH_KEY); else localStorage.setItem(WIDTH_KEY, String(value)); } catch { /* A blocked preference store does not prevent resizing. */ }
  };
  useLayoutEffect(() => {
    setDragging(false);
    if (!enabled) return;
    const root = anchor.current?.closest<HTMLElement>(".focus-workspace, .focus-preview");
    if (!root) return;
    workspace.current = root;
    try { const saved = Number(localStorage.getItem(WIDTH_KEY)); preferred.current = Number.isFinite(saved) && saved >= 320 ? Math.min(720, saved) : null; } catch { preferred.current = null; }
    const previous = root.style.getPropertyValue("--workspace-pane-width");
    const update = () => {
      const available = root.getBoundingClientRect().width;
      bounds.current = { maximum: Math.max(320, Math.min(720, available - 560)), fallback: Math.max(360, Math.min(540, available * .38)) };
      setMaximum(bounds.current.maximum);
      const next = constrain(preferred.current ?? bounds.current.fallback, bounds.current.maximum);
      root.style.setProperty("--workspace-pane-width", `${next}px`); setWidth(next);
    };
    update();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : undefined;
    observer?.observe(root);
    return () => {
      observer?.disconnect(); drag.current = null; workspace.current = null;
      if (previous) root.style.setProperty("--workspace-pane-width", previous); else root.style.removeProperty("--workspace-pane-width");
    };
  }, [enabled]);
  useLayoutEffect(() => {
    if (!dragging || !enabled) return;
    const { cursor, userSelect } = document.body.style;
    document.body.style.cursor = "col-resize"; document.body.style.userSelect = "none";
    return () => { document.body.style.cursor = cursor; document.body.style.userSelect = userSelect; };
  }, [dragging, enabled]);
  const finish = () => {
    if (!drag.current) return;
    drag.current = null; setDragging(false);
    remember(Number.parseFloat(workspace.current?.style.getPropertyValue("--workspace-pane-width") ?? "") || width);
  };
  const label = zh ? "调整详情面板宽度" : "Resize detail panel";
  return enabled ? <><span hidden ref={anchor}/>{width ? <div className={`workspace-pane-resize${dragging ? " is-dragging" : ""}`} role="separator" aria-label={label} aria-orientation="vertical" aria-valuemin={320} aria-valuemax={maximum} aria-valuenow={width} tabIndex={0} title={zh ? "拖动调整宽度，双击重置" : "Drag to resize, double-click to reset"}
    onPointerDown={event => { if (event.button !== 0) return; event.preventDefault(); event.stopPropagation(); event.currentTarget.focus({ preventScroll: true }); drag.current = { x: event.clientX, width }; setDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={event => { if (drag.current) apply(drag.current.width + drag.current.x - event.clientX); }}
    onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}
    onDoubleClick={() => { remember(null); apply(bounds.current.fallback); }}
    onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? 320 : event.key === "End" ? maximum : width + (event.key === "ArrowLeft" ? 1 : -1) * (event.shiftKey ? 40 : 16); remember(apply(next)); }}
  /> : null}</> : null;
}
