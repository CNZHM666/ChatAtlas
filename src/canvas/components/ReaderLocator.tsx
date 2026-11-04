import { useEffect, useState, type RefObject } from "react";
import { usePreferences } from "../preferences";

export interface ReaderAnchor { id: string; title: string }

export function ReaderLocator({ anchors, scrollRef }: { anchors: ReaderAnchor[]; scrollRef: RefObject<HTMLElement | null> }) {
  const { locale } = usePreferences();
  const [active, setActive] = useState(anchors[0]?.id ?? "");
  const [scrollable, setScrollable] = useState(false);
  const key = anchors.map((anchor) => anchor.id).join("|");

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      setScrollable(root.scrollHeight > root.clientHeight + 80);
      const boundary = root.getBoundingClientRect().top + Math.min(160, root.clientHeight * .28);
      let current = anchors[0]?.id ?? "";
      for (const anchor of anchors) {
        const element = document.getElementById(anchor.id);
        if (element && root.contains(element) && element.getBoundingClientRect().top <= boundary) current = anchor.id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    root.addEventListener("scroll", schedule, { passive: true });
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(schedule);
    resize?.observe(root);
    for (const anchor of anchors) {
      const element = document.getElementById(anchor.id);
      if (element && root.contains(element)) resize?.observe(element);
    }
    update();
    return () => { root.removeEventListener("scroll", schedule); resize?.disconnect(); if (frame) cancelAnimationFrame(frame); };
  }, [key, anchors, scrollRef]);

  if (!scrollable || anchors.length < 2) return null;
  return <nav className="reader-locator" aria-label={locale === "zh-CN" ? "对话位置" : "Conversation locator"}>
    {anchors.map((anchor) => <button key={anchor.id} type="button" className={active === anchor.id ? "is-active" : ""} title={anchor.title} aria-label={anchor.title} aria-current={active === anchor.id ? "location" : undefined} onClick={() => {
      const element = document.getElementById(anchor.id);
      if (element && scrollRef.current?.contains(element)) element.scrollIntoView({ behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ? "instant" : "smooth", block: "start" });
    }}><span /></button>)}
  </nav>;
}
