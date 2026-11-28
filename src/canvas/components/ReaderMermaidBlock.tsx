import { Check, Copy, Maximize2, X } from "lucide-react";
import { memo, useMemo, useState } from "react";
import { parseMermaidDiagram, type MermaidFlowNode, type ParsedErDiagram, type ParsedFlowchart } from "../mermaid-parse";
import { ReaderCodeBlock } from "./ReaderCodeBlock";

const visualWidth = (text: string) =>
  [...text].reduce((sum, ch) => sum + (/[\u2E80-\u9FFF\uF900-\uFAFF\uFE30-\uFE4F]/u.test(ch) ? 12.5 : 7.4), 0);

function wrapText(text: string, maxWidth: number, maxLines = 2): string[] {
  if (visualWidth(text) <= maxWidth) return [text];
  const lines: string[] = [];
  let current = "";
  for (const ch of text) {
    if (visualWidth(current + ch) > maxWidth && current) {
      lines.push(current.trim());
      current = ch;
      if (lines.length === maxLines - 1) break;
    } else {
      current += ch;
    }
  }
  const consumed = lines.join("").length;
  const rest = text.slice(consumed).trim();
  if (rest) {
    let tail = "";
    for (const ch of rest) {
      if (visualWidth(tail + ch) > maxWidth - 10) { tail += "…"; break; }
      tail += ch;
    }
    lines.push(tail);
  }
  return lines.filter(Boolean);
}

function FlowchartSvg({ diagram }: { diagram: ParsedFlowchart }) {
  const layout = useMemo(() => {
    const layerOf = new Map<string, number>();
    const outgoing = new Map<string, string[]>();
    const indegree = new Map<string, number>();
    for (const node of diagram.nodes) {
      layerOf.set(node.id, 0);
      outgoing.set(node.id, []);
      indegree.set(node.id, 0);
    }
    for (const edge of diagram.edges) {
      if (edge.from === edge.to) continue;
      outgoing.get(edge.from)?.push(edge.to);
      indegree.set(edge.to, (indegree.get(edge.to) ?? 0) + 1);
    }
    // Longest-path layering with bounded relaxation (handles cycles safely).
    const maxPasses = Math.min(diagram.nodes.length, 16);
    for (let pass = 0; pass < maxPasses; pass++) {
      let changed = false;
      for (const edge of diagram.edges) {
        if (edge.from === edge.to) continue;
        const next = (layerOf.get(edge.from) ?? 0) + 1;
        if (next > (layerOf.get(edge.to) ?? 0) && next < diagram.nodes.length) {
          layerOf.set(edge.to, next);
          changed = true;
        }
      }
      if (!changed) break;
    }

    const layers = new Map<number, MermaidFlowNode[]>();
    for (const node of diagram.nodes) {
      const layer = layerOf.get(node.id) ?? 0;
      layers.set(layer, [...(layers.get(layer) ?? []), node]);
    }
    const orderedLayers = [...layers.entries()].sort((a, b) => a[0] - b[0]).map(([, items]) => items);

    const horizontal = diagram.direction === "LR";
    const padX = 24, padY = 22;
    const gapMain = horizontal ? 62 : 48;
    const gapCross = horizontal ? 24 : 26;
    const nodeMaxW = horizontal ? 168 : 196;

    const sizes = new Map<string, { w: number; h: number; lines: string[] }>();
    for (const node of diagram.nodes) {
      const lines = wrapText(node.label, nodeMaxW - 28, 2);
      const textW = Math.max(...lines.map(visualWidth), 48);
      const w = Math.min(nodeMaxW, Math.max(92, Math.ceil(textW + 30)));
      const h = lines.length > 1 ? 52 : 38;
      sizes.set(node.id, { w, h, lines });
    }

    const pos = new Map<string, { x: number; y: number; w: number; h: number; lines: string[]; shape: MermaidFlowNode["shape"] }>();
    if (!horizontal) {
      const layerWidths = orderedLayers.map(items =>
        items.reduce((sum, node) => sum + sizes.get(node.id)!.w, 0) + Math.max(0, items.length - 1) * gapCross
      );
      const totalW = Math.max(...layerWidths, 240) + padX * 2;
      let y = padY;
      orderedLayers.forEach((items, idx) => {
        const rowH = Math.max(...items.map(node => sizes.get(node.id)!.h));
        let x = (totalW - layerWidths[idx]) / 2;
        for (const node of items) {
          const size = sizes.get(node.id)!;
          pos.set(node.id, { x, y: y + (rowH - size.h) / 2, ...size, shape: node.shape });
          x += size.w + gapCross;
        }
        y += rowH + gapMain;
      });
      return { width: totalW, height: y - gapMain + padY, pos, horizontal };
    }

    const layerHeights = orderedLayers.map(items =>
      items.reduce((sum, node) => sum + sizes.get(node.id)!.h, 0) + Math.max(0, items.length - 1) * gapCross
    );
    const totalH = Math.max(...layerHeights, 110) + padY * 2;
    let x = padX;
    orderedLayers.forEach((items, idx) => {
      const colW = Math.max(...items.map(node => sizes.get(node.id)!.w));
      let y = (totalH - layerHeights[idx]) / 2;
      for (const node of items) {
        const size = sizes.get(node.id)!;
        pos.set(node.id, { x: x + (colW - size.w) / 2, y, ...size, shape: node.shape });
        y += size.h + gapCross;
      }
      x += colW + gapMain;
    });
    return { width: x - gapMain + padX, height: totalH, pos, horizontal };
  }, [diagram]);

  return (
    <svg className="reader-mermaid-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label="Mermaid flowchart">
      <defs>
        <marker id="atlas-mermaid-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse">
          <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" className="reader-mermaid-arrowhead" />
        </marker>
      </defs>
      {diagram.edges.map((edge, idx) => {
        const from = layout.pos.get(edge.from), to = layout.pos.get(edge.to);
        if (!from || !to) return null;
        let x1: number, y1: number, x2: number, y2: number, cx1: number, cy1: number, cx2: number, cy2: number;
        if (!layout.horizontal) {
          const forward = to.y >= from.y;
          x1 = from.x + from.w / 2;
          y1 = forward ? from.y + from.h : from.y;
          x2 = to.x + to.w / 2;
          y2 = forward ? to.y : to.y + to.h;
          const bend = forward ? Math.max(20, Math.abs(y2 - y1) * 0.45) : -Math.max(36, Math.abs(y2 - y1) * 0.45);
          if (!forward) {
            const side = Math.max(from.x + from.w, to.x + to.w) + 28;
            cx1 = side; cy1 = y1; cx2 = side; cy2 = y2;
          } else {
            cx1 = x1; cy1 = y1 + bend; cx2 = x2; cy2 = y2 - bend;
          }
        } else {
          const forward = to.x >= from.x;
          x1 = forward ? from.x + from.w : from.x;
          y1 = from.y + from.h / 2;
          x2 = forward ? to.x : to.x + to.w;
          y2 = to.y + to.h / 2;
          const bend = Math.max(24, Math.abs(x2 - x1) * 0.45);
          cx1 = x1 + (forward ? bend : -bend); cy1 = y1; cx2 = x2 - (forward ? bend : -bend); cy2 = y2;
        }
        const midX = 0.125 * x1 + 0.375 * cx1 + 0.375 * cx2 + 0.125 * x2;
        const midY = 0.125 * y1 + 0.375 * cy1 + 0.375 * cy2 + 0.125 * y2;
        const labelW = edge.label ? Math.min(130, Math.ceil(visualWidth(edge.label) + 14)) : 0;
        return (
          <g key={`${edge.from}-${edge.to}-${idx}`} className="reader-mermaid-edge-group">
            <path d={`M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`} className={`reader-mermaid-edge${edge.dashed ? " is-dashed" : ""}`} markerEnd="url(#atlas-mermaid-arrow)" />
            {edge.label ? (
              <g className="reader-mermaid-edge-label">
                <rect x={midX - labelW / 2} y={midY - 10} width={labelW} height={20} rx={10} />
                <text x={midX} y={midY + 4} textAnchor="middle">{wrapText(edge.label, 118, 1)[0]}</text>
              </g>
            ) : null}
          </g>
        );
      })}
      {diagram.nodes.map(node => {
        const box = layout.pos.get(node.id);
        if (!box) return null;
        const rx = box.shape === "round" ? box.h / 2 : box.shape === "diamond" ? 12 : 9;
        return (
          <g key={node.id} className={`reader-mermaid-node is-${box.shape}`}>
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={rx} />
            {box.lines.map((line, lineIndex) => {
              const offsetY = box.lines.length === 1 ? box.h / 2 + 4.5 : box.h / 2 - 4 + lineIndex * 16;
              return <text key={lineIndex} x={box.x + box.w / 2} y={box.y + offsetY} textAnchor="middle">{line}</text>;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function ErDiagramSvg({ diagram }: { diagram: ParsedErDiagram }) {
  const layout = useMemo(() => {
    const cols = diagram.entities.length <= 2 ? diagram.entities.length : diagram.entities.length <= 4 ? 2 : 3;
    const cardW = 168, gapX = 56, gapY = 44, pad = 22;
    const heights = diagram.entities.map(entity => 36 + entity.fields.length * 20 + (entity.fields.length ? 8 : 0));
    const rowCount = Math.ceil(diagram.entities.length / cols);
    const rowHeights = Array.from({ length: rowCount }, (_, row) =>
      Math.max(...heights.slice(row * cols, (row + 1) * cols), 36)
    );
    const pos = new Map<string, { x: number; y: number; w: number; h: number }>();
    let y = pad;
    for (let row = 0; row < rowCount; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const entity = diagram.entities[index];
        if (!entity) continue;
        pos.set(entity.id, { x: pad + col * (cardW + gapX), y, w: cardW, h: heights[index] });
      }
      y += rowHeights[row] + gapY;
    }
    return { width: pad * 2 + cols * cardW + Math.max(0, cols - 1) * gapX, height: y - gapY + pad, pos };
  }, [diagram]);

  return (
    <svg className="reader-mermaid-svg" viewBox={`0 0 ${layout.width} ${layout.height}`} width={layout.width} height={layout.height} role="img" aria-label="Mermaid entity relationship diagram">
      <defs>
        <marker id="atlas-er-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M 1 1.5 L 8.5 5 L 1 8.5 z" className="reader-mermaid-arrowhead" />
        </marker>
      </defs>
      {diagram.relations.map((rel, idx) => {
        const from = layout.pos.get(rel.from), to = layout.pos.get(rel.to);
        if (!from || !to) return null;
        const x1 = from.x + from.w / 2, y1 = from.y + from.h / 2;
        const x2 = to.x + to.w / 2, y2 = to.y + to.h / 2;
        const midX = (x1 + x2) / 2, midY = (y1 + y2) / 2;
        const label = rel.label || rel.cardinality;
        const labelW = Math.min(120, Math.ceil(visualWidth(label) + 14));
        return (
          <g key={`${rel.from}-${rel.to}-${idx}`}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} className="reader-mermaid-edge" markerEnd="url(#atlas-er-arrow)" />
            {label ? (
              <g className="reader-mermaid-edge-label">
                <rect x={midX - labelW / 2} y={midY - 10} width={labelW} height={20} rx={10} />
                <text x={midX} y={midY + 4} textAnchor="middle">{wrapText(label, 108, 1)[0]}</text>
              </g>
            ) : null}
          </g>
        );
      })}
      {diagram.entities.map(entity => {
        const box = layout.pos.get(entity.id)!;
        return (
          <g key={entity.id} className="reader-mermaid-entity">
            <rect x={box.x} y={box.y} width={box.w} height={box.h} rx={9} className="reader-mermaid-entity-box" />
            <path d={`M ${box.x} ${box.y + 34} L ${box.x + box.w} ${box.y + 34}`} className="reader-mermaid-entity-divider" />
            <text x={box.x + box.w / 2} y={box.y + 22} textAnchor="middle" className="reader-mermaid-entity-title">{entity.id}</text>
            {entity.fields.map((field, index) => (
              <text key={field.name + index} x={box.x + 12} y={box.y + 52 + index * 20} className="reader-mermaid-entity-field">
                {field.name}{field.type ? ` : ${field.type}` : ""}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

export const ReaderMermaidBlock = memo(function ReaderMermaidBlock({ source, zh }: { source: string; zh: boolean }) {
  const parsed = useMemo(() => parseMermaidDiagram(source), [source]);
  const [copied, setCopied] = useState(false);
  const [zoomed, setZoomed] = useState(false);

  if (!parsed) {
    return (
      <ReaderCodeBlock zh={zh}>
        <code className="language-mermaid">{source}</code>
      </ReaderCodeBlock>
    );
  }

  const label = parsed.kind === "erDiagram" ? (zh ? "关系图" : "Entity diagram") : (zh ? "流程图" : "Flowchart");
  const copySource = async () => {
    try {
      await navigator.clipboard.writeText(source.trim());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch { /* clipboard unavailable */ }
  };

  const svg = parsed.kind === "erDiagram" ? <ErDiagramSvg diagram={parsed} /> : <FlowchartSvg diagram={parsed} />;

  return (
    <>
      <figure className="reader-mermaid-card" data-mermaid-kind={parsed.kind}>
        <figcaption className="reader-mermaid-toolbar">
          <span className="reader-mermaid-kind">{label}</span>
          <div className="reader-mermaid-actions">
            <button type="button" onClick={() => setZoomed(true)} title={zh ? "放大查看" : "Expand diagram"} aria-label={zh ? "放大查看" : "Expand diagram"}>
              <Maximize2 size={13} aria-hidden="true" />
              <span>{zh ? "放大" : "Expand"}</span>
            </button>
            <button type="button" onClick={copySource} title={zh ? "复制 Mermaid 源码" : "Copy Mermaid source"} aria-label={zh ? "复制 Mermaid 源码" : "Copy Mermaid source"}>
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              <span>{copied ? (zh ? "已复制" : "Copied") : (zh ? "复制" : "Copy")}</span>
            </button>
          </div>
        </figcaption>
        <div className="reader-mermaid-canvas" role="region" aria-label={label} tabIndex={0}>
          {svg}
        </div>
      </figure>
      {zoomed ? (
        <div className="reader-mermaid-modal" role="dialog" aria-modal="true" aria-label={label} onClick={event => { if (event.target === event.currentTarget) setZoomed(false); }}>
          <div className="reader-mermaid-modal-panel">
            <header>
              <strong>{label}</strong>
              <button type="button" onClick={() => setZoomed(false)} aria-label={zh ? "关闭" : "Close"}>
                <X size={16} aria-hidden="true" />
              </button>
            </header>
            <div className="reader-mermaid-modal-body">{svg}</div>
          </div>
        </div>
      ) : null}
    </>
  );
});
