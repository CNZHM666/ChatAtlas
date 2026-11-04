import { useLayoutEffect, type RefObject } from "react";

/** Local view preference; changing chapters never triggers AI or a project version. */
export function useWikiReadingPosition(ref: RefObject<HTMLElement>, projectId: string | undefined, sectionId: string | undefined, enabled: boolean) {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || !enabled || !projectId || !sectionId) return;
    const storageKey = `atlas-wiki-reading:${projectId}`;
    let positions: Record<string, number> = {};
    try { const value = JSON.parse(localStorage.getItem(storageKey) ?? "{}"); if (value && typeof value === "object" && !Array.isArray(value)) positions = value; } catch { /* Reading still works without storage. */ }
    const target = Number.isFinite(positions[sectionId]) && positions[sectionId] >= 0 ? positions[sectionId] : 0;
    let restoring = true, last = target;
    const restore = () => { if (restoring) { element.scrollTop = target; element.scrollLeft = 0; } };
    restore();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(restore) : undefined;
    if (element.firstElementChild) observer?.observe(element.firstElementChild);
    const interact = () => { restoring = false; observer?.disconnect(); };
    const record = () => { if (!restoring) last = element.scrollTop; };
    const save = () => { positions[sectionId] = last; try { localStorage.setItem(storageKey, JSON.stringify(positions)); } catch { /* Full or unavailable storage does not block reading. */ } };
    element.addEventListener("wheel", interact, { passive: true });
    element.addEventListener("pointerdown", interact);
    element.addEventListener("keydown", interact);
    element.addEventListener("scroll", record, { passive: true });
    window.addEventListener("pagehide", save);
    return () => { save(); observer?.disconnect(); window.removeEventListener("pagehide", save); element.removeEventListener("wheel", interact); element.removeEventListener("pointerdown", interact); element.removeEventListener("keydown", interact); element.removeEventListener("scroll", record); };
  }, [ref, projectId, sectionId, enabled]);
}
