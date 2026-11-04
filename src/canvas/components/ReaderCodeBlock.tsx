import { Children, isValidElement, useMemo, type ReactNode } from "react";
import { textDiagram } from "../text-diagram";
import { uiPreviewDocument } from "../ui-preview";
import { ReaderUIPreview } from "./ReaderUIPreview";

function codeText(children: ReactNode): string {
  return Children.toArray(children).map(child => typeof child === "string" || typeof child === "number"
    ? String(child) : isValidElement<{ children?: ReactNode }>(child) ? codeText(child.props.children) : "").join("");
}

// Draw line glyphs geometrically; fallback fonts must not break their joints.
const directions: Record<string, string> = {
  "─": "lr", "━": "lr", "│": "ud", "┃": "ud", "┌": "rd", "┐": "ld",
  "└": "ru", "┘": "lu", "├": "rud", "┤": "lud", "┬": "lrd", "┴": "lru", "┼": "lrud",
};

export function ReaderCodeBlock({ children, zh, copy = false, literal = false }: { children: ReactNode; zh: boolean; copy?: boolean; literal?: boolean }) {
  const text = codeText(children);
  const code = Children.toArray(children).find(child => isValidElement(child));
  const language = isValidElement<{ className?: string }>(code) ? code.props.className?.match(/language-([\w-]+)/u)?.[1] ?? "" : "";
  const diagram = useMemo(() => literal ? undefined : textDiagram(text, language), [text, language, literal]);
  const preview = useMemo(() => literal ? undefined : uiPreviewDocument(text, language), [text, language, literal]);
  const cellWidth = 10, rowHeight = 24;
  let path = "";
  const glyphs: ReactNode[] = [];
  diagram?.rows.forEach((row, rowIndex) => row.forEach((cell, index) => {
    const x = cell.column * cellWidth + cellWidth / 2, y = rowIndex * rowHeight + rowHeight / 2;
    const edges = directions[cell.text];
    if (edges) {
      for (const direction of edges) {
        const endX = x + (direction === "l" ? -cellWidth / 2 : direction === "r" ? cellWidth / 2 : 0);
        const endY = y + (direction === "u" ? -rowHeight / 2 : direction === "d" ? rowHeight / 2 : 0);
        path += `M${x},${y}L${endX},${endY}`;
      }
    } else if (cell.text.trim()) glyphs.push(<text key={`${rowIndex}:${index}`} x={cell.column * cellWidth + cell.width * cellWidth / 2} y={y} textAnchor="middle" dominantBaseline="central">{cell.text}</text>);
  }));
  if (preview) return <ReaderUIPreview source={text} language={language} zh={zh} copy={copy}>{children}</ReaderUIPreview>;
  return <div className={`reader-code-block${copy ? " has-copy" : ""}`}>
    {copy ? <button type="button" onClick={() => void navigator.clipboard?.writeText(text)}>{diagram ? zh ? "复制原文" : "Copy source" : zh ? "复制代码" : "Copy code"}</button> : null}
    <pre className={diagram ? `reader-text-diagram${copy ? " has-copy" : ""}` : undefined}>
      {diagram ? <svg role="img" aria-label={zh ? "文本示意图" : "Text diagram"} viewBox={`0 0 ${diagram.columns * cellWidth + 2} ${diagram.rows.length * rowHeight + 2}`} style={{ width: `${diagram.columns * .625 + .125}em`, height: `${diagram.rows.length * 1.5 + .125}em` }}>
        <title>{text}</title><path d={path} fill="none" stroke="currentColor" strokeWidth="1" />{glyphs}
      </svg> : children}
    </pre>
  </div>;
}
