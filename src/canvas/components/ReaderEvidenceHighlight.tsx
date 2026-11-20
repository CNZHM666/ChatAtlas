import { useEffect, useState, type RefObject } from "react";

/** Paint only the actual text range, without wrapping React-owned Markdown. */
export function ReaderEvidenceHighlight({ range, matches, host }: { range: Range | null; matches?: Range[]; host: RefObject<HTMLDivElement> }) {
  const [rects, setRects] = useState<Array<{ top: number; left: number; width: number; height: number }>>([]);
  useEffect(() => {
    setRects([]);
    const ranges = matches?.length ? matches : range ? [range] : [];
    if (!ranges.length || !host.current) return;
    if (typeof Highlight !== "undefined" && globalThis.CSS?.highlights) {
      const highlight = new Highlight(...ranges); CSS.highlights.set("atlas-reader-proof", highlight);
      return () => { if (CSS.highlights.get("atlas-reader-proof") === highlight) CSS.highlights.delete("atlas-reader-proof"); };
    }
    const element = host.current;
    const position = () => { const bounds = element.getBoundingClientRect(); setRects(ranges.flatMap(range => Array.from(range.getClientRects?.() ?? [])).filter(rect => rect.width && rect.height).map(rect => ({ top: rect.top - bounds.top, left: rect.left - bounds.left, width: rect.width, height: rect.height }))); };
    position(); const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(position) : undefined; observer?.observe(element);
    window.addEventListener("resize", position);
    return () => { observer?.disconnect(); window.removeEventListener("resize", position); };
  }, [range, matches, host]);
  return <>{rects.map((rect, index) => <span key={index} className="reader-proof-highlight" aria-hidden="true" style={rect}/>)}</>;
}
