import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ReaderToolbarContext } from "../hooks/useReaderToolbar";

/** One toolbar follows the visible discussion; hidden project readers never own it. */
export function ReaderToolbarProvider({ children }: { children: ReactNode }) {
  const readers = useRef(new Map<string, HTMLElement>());
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [active, setActive] = useState("");
  const choose = useCallback(() => {
    const visible = [...readers.current].filter(([, element]) => !element.closest("[hidden]") && element.getClientRects().length);
    const selected = visible.find(([, element]) => {
      const box = element.getBoundingClientRect();
      let boundary = 58;
      for (let parent = element.parentElement; parent; parent = parent.parentElement) {
        if (/(auto|scroll)/u.test(getComputedStyle(parent).overflowY)) { boundary = parent.getBoundingClientRect().top + 12; break; }
      }
      return box.top <= boundary && box.bottom > boundary;
    }) ?? visible.find(([, element]) => { const box = element.getBoundingClientRect(); return box.bottom > 58 && box.top < innerHeight; });
    setActive(selected?.[0] ?? "");
  }, []);
  const register = useCallback((id: string, element: HTMLElement) => {
    readers.current.set(id, element); if (!element.closest("[hidden]")) setActive(id);
    return () => { readers.current.delete(id); choose(); };
  }, [choose]);
  useEffect(() => {
    let frame = 0;
    const scroll = () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; choose(); }); };
    const select = (event: Event) => {
      const node = event.target;
      if (!(node instanceof Node)) return;
      const reader = [...readers.current].find(([, element]) => element.contains(node));
      if (reader) setActive(reader[0]);
    };
    window.addEventListener("scroll", scroll, true); window.addEventListener("resize", scroll);
    window.addEventListener("pointerdown", select, true); window.addEventListener("focusin", select, true);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", scroll, true); window.removeEventListener("resize", scroll); window.removeEventListener("pointerdown", select, true); window.removeEventListener("focusin", select, true); };
  }, [choose]);
  const value = useMemo(() => ({ host, active, setHost, register }), [host, active, register]);
  return <ReaderToolbarContext.Provider value={value}>{children}</ReaderToolbarContext.Provider>;
}

export function ReaderToolbarSlot() {
  const context = useContext(ReaderToolbarContext);
  return context ? <div className="reader-toolbar-slot" ref={context.setHost} /> : null;
}
