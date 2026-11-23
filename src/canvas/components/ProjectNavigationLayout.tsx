import { useEffect, useRef, useState, type CSSProperties } from "react";
import { ReaderSidebarToggle } from "./ReaderSidebarToggle";

const layoutKey = "atlas-project-navigation-layout";
const minimum = 190, maximum = 340, defaultWidth = 250;
const clamp = (width: number) => Math.min(maximum, Math.max(minimum, Math.round(width)));

function initialLayout(): { side: "left" | "right"; width?: number; collapsed: boolean } {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey) ?? "null");
    return { side: saved?.side === "right" ? "right" : "left", width: Number.isFinite(saved?.width) ? clamp(saved.width) : undefined, collapsed: saved?.collapsed === true };
  } catch { return { side: "left", collapsed: false }; }
}

// eslint-disable-next-line react-refresh/only-export-components
export function useProjectNavigationLayout() {
  const [layout, setLayout] = useState(initialLayout);
  const update = (changes: Partial<typeof layout>) => {
    const next = { ...layout, ...changes };
    setLayout(next);
    try { localStorage.setItem(layoutKey, JSON.stringify(next)); } catch { /* The current layout remains usable. */ }
  };
  return {
    ...layout,
    style: layout.width ? { "--project-navigation-width": `${layout.width}px` } as CSSProperties : undefined,
    update,
    moveAction(zh: boolean) {
      const side = layout.side === "left" ? "right" : "left";
      const label = side === "right" ? (zh ? "将项目侧栏移到右侧" : "Move project sidebar right") : (zh ? "将项目侧栏移到左侧" : "Move project sidebar left");
      return { label, run: () => update({ side }) };
    },
  };
}

type NavigationProps = { layout: ReturnType<typeof useProjectNavigationLayout>; zh: boolean; navigationId: string };
const focusNavigation = (id: string) => window.requestAnimationFrame(() => document.getElementById(id)?.focus());

export function ProjectNavigationOpen({ layout, zh, navigationId, mobile, onOpenMobile }: NavigationProps & {
  mobile?: boolean; onOpenMobile?: () => void;
}) {
  const open = () => {
    if (mobile) onOpenMobile?.();
    else layout.update({ collapsed: false });
    focusNavigation(navigationId + "-close");
  };
  return mobile
    ? <ReaderSidebarToggle id={navigationId + "-open"} controls={navigationId} zh={zh} side={layout.side} collapsed
        className="project-navigation-mobile" onToggle={open} />
    : layout.collapsed ? <div className="project-navigation-rail">
        <ReaderSidebarToggle id={navigationId + "-expand"} controls={navigationId} zh={zh} side={layout.side} collapsed onToggle={open} />
      </div> : null;
}

export function ProjectNavigationLayout({ layout, zh, navigationId, onCloseMobile, children }: NavigationProps & { onCloseMobile: () => void; children: React.ReactNode }) {
  const stopDrag = useRef<() => void>();
  useEffect(() => () => stopDrag.current?.(), []);
  const navActions = useRef<HTMLDivElement>(null);
  const right = layout.side === "right";
  const currentWidth = () => navActions.current?.closest("nav")?.offsetWidth || layout.width || defaultWidth;
  const resizeLabel = zh ? "调整项目侧栏宽度" : "Resize project sidebar";
  const close = () => {
    const narrow = window.innerWidth <= 760;
    onCloseMobile();
    if (!narrow) layout.update({ collapsed: true });
    focusNavigation(navigationId + (narrow ? "-open" : "-expand"));
  };
  return <div className="project-navigation-actions" ref={navActions}>
    {children}
    <ReaderSidebarToggle id={navigationId + "-close"} controls={navigationId} zh={zh} side={layout.side} onToggle={close} />
    <div className="project-navigation-resize" role="separator" tabIndex={0} aria-label={resizeLabel} aria-orientation="vertical"
      aria-valuemin={minimum} aria-valuemax={maximum} aria-valuenow={layout.width ?? defaultWidth}
      title={zh ? "拖动调整宽度，双击恢复默认" : "Drag to resize, double-click to reset"}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const root = event.currentTarget.closest<HTMLElement>(".focus-workspace");
        if (!root) return;
        event.preventDefault();
        stopDrag.current?.();
        event.currentTarget.focus({ preventScroll: true });
        const { pointerId, clientX } = event, width = currentWidth();
        let next: number | undefined;
        const move = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return;
          next = clamp(width + (pointer.clientX - clientX) * (right ? -1 : 1));
          root.style.setProperty("--project-navigation-width", `${next}px`);
        };
        const finish = (pointer: PointerEvent) => {
          if (pointer.pointerId !== pointerId) return;
          cleanup();
          if (next !== undefined) layout.update({ width: next });
        };
        const cleanup = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", finish);
          window.removeEventListener("pointercancel", finish);
          stopDrag.current = undefined;
        };
        stopDrag.current = cleanup;
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", finish);
        window.addEventListener("pointercancel", finish);
      }}
      onDoubleClick={() => layout.update({ width: undefined })}
      onKeyDown={event => {
        if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const width = event.key === "Home" ? minimum : event.key === "End" ? maximum
          : clamp(currentWidth() + (event.key === "ArrowRight" ? 16 : -16) * (right ? -1 : 1));
        layout.update({ width });
      }} />
  </div>;
}
