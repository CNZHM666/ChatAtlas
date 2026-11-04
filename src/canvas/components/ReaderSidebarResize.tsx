import { useEffect, useRef } from "react";

export function ReaderSidebarResize({ width, onChange, zh }: { width: number; onChange: (width: number) => void; zh: boolean }) {
  const drag = useRef<{ x: number; width: number }>();
  const frame = useRef(0);
  const pending = useRef(width);
  const constrain = (value: number) => Math.round(Math.max(210, Math.min(480, window.innerWidth * .45, value)));
  const commit = () => { frame.current = 0; onChange(pending.current); };
  useEffect(() => () => window.cancelAnimationFrame(frame.current), []);
  return <div className="source-sidebar-resize" role="separator" aria-label={zh ? "调整侧栏宽度" : "Resize sidebar"} title={zh ? "拖动调整宽度，双击重置" : "Drag to resize, double-click to reset"} aria-orientation="vertical" aria-valuemin={210} aria-valuemax={480} aria-valuenow={width} tabIndex={0} onDoubleClick={() => onChange(250)}
    onKeyDown={(event) => { if (["ArrowLeft", "ArrowRight", "Home"].includes(event.key)) { event.preventDefault(); onChange(event.key === "Home" ? 250 : constrain(width + (event.key === "ArrowRight" ? 20 : -20))); } }}
    onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); const renderedWidth = event.currentTarget.previousElementSibling?.getBoundingClientRect().width || width; pending.current = renderedWidth; drag.current = { x: event.clientX, width: renderedWidth }; event.currentTarget.setPointerCapture?.(event.pointerId); }}
    onPointerMove={(event) => { if (!drag.current) return; pending.current = constrain(drag.current.width + event.clientX - drag.current.x); if (!frame.current) frame.current = window.requestAnimationFrame(commit); }}
    onPointerUp={(event) => { if (!drag.current) return; drag.current = undefined; window.cancelAnimationFrame(frame.current); commit(); event.currentTarget.releasePointerCapture?.(event.pointerId); }}
    onPointerCancel={() => { drag.current = undefined; window.cancelAnimationFrame(frame.current); commit(); }} />;
}
