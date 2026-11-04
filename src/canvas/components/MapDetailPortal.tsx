import { createPortal } from "react-dom";
import type { ReactNode } from "react";
import { useEffect, useRef } from "react";

/** Overlay details must not participate in the reader's scrollable overflow or anchoring. */
export function MapDetailPortal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector<HTMLElement>("button[aria-label]")?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<div ref={ref} className="map-detail-overlay focus-workspace reader-understanding-map" onKeyDown={event => { if (event.key === "Escape" && onClose) { event.preventDefault(); event.stopPropagation(); onClose(); } }}>{children}</div>, document.body);
}
