export interface DiagramCell { text: string; column: number; width: number }
export interface TextDiagram { rows: DiagramCell[][]; columns: number }

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const borders = /[─━│┃┌┐└┘├┤┬┴┼]/gu;

/** Display columns, not UTF-16 length: CJK and emoji occupy two cells. */
export function diagramCells(line: string): DiagramCell[] {
  let column = 0;
  return [...segmenter.segment(line)].map(({ segment: text }) => {
    const code = text.codePointAt(0)!;
    const wide = /[\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(text)
      || code >= 0x1100 && (code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf
        || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff
        || code >= 0xfe10 && code <= 0xfe6f || code >= 0xff01 && code <= 0xff60
        || code >= 0xffe0 && code <= 0xffe6 || code >= 0x20000 && code <= 0x3ffff);
    const width = text === "\t" ? 4 - column % 4 : wide ? 2 : 1;
    const cell = { text, column, width }; column += width; return cell;
  });
}

const columns = (line: string) => diagramCells(line).reduce((total, cell) => total + cell.width, 0);

const text = (cells: DiagramCell[]) => cells.map(cell => cell.text).join("");

/** A frame line and the side note written after its right border ("│ 25:00 │  ← big countdown"). Notes hold no borders. */
function withNote(line: string): { frame: string; note: string } {
  const cells = diagramCells(line.trimEnd());
  let end = -1;
  cells.forEach((cell, index) => { if (/[│┤┐┘]/u.test(cell.text)) end = index; });
  return end < 0 ? { frame: line.trimEnd(), note: "" } : { frame: text(cells.slice(0, end + 1)), note: text(cells.slice(end + 1)).trim() };
}

/** Moves the bar nearest a column onto it by padding the space before it; never deletes content. */
function padBarTo(line: string, column: number, skipLast: boolean): string {
  const cells = diagramCells(line);
  const candidates = cells.flatMap((cell, index) => cell.text === "│" && index > 0 && (!skipLast || index < cells.length - 1) && Math.abs(cell.column - column) <= 4 ? [index] : []);
  if (candidates.length !== 1) return line;
  const left = text(cells.slice(0, candidates[0])).trimEnd(), padding = column - columns(left);
  return padding >= 0 ? left + " ".repeat(padding) + text(cells.slice(candidates[0])) : line;
}

/** Only normalize unambiguous whitespace next to a complete outer frame.
 * Never delete content, guess missing borders or alter the stored/copyable source.
 * Writers often count Chinese or emoji as one column, so bars drift; side notes after the frame are kept and lined up. */
function framedRows(lines: string[]): string[] {
  const parts = lines.map(withNote);
  // The frame may sit below lines of its own (a greeting over a card): its top corner starts it, the bottom corner
  // in the same column ends it.
  // A top border may carry a title ("┌ 不导 · 今日守护      今晚风险：中 ┐"), drawn as wide as the writer guessed.
  const first = parts.findIndex(part => /^\s*┌[─┬]+┐$/u.test(part.frame) || /^\s*┌[^┐│└┘]*[\p{L}\p{N}][^┐│└┘]*┐$/u.test(part.frame));
  if (first < 0) return lines;
  const indent = parts[first].frame.length - parts[first].frame.trimStart().length;
  const last = parts.findIndex((part, index) => index > first && /^\s*└[─┴]+┘$/u.test(part.frame) && part.frame.length - part.frame.trimStart().length === indent);
  if (last < 0) return lines;
  let width = columns(parts[first].frame);
  const titled = !/^\s*┌[─┬]+┐$/u.test(parts[first].frame);
  if (!titled && columns(parts[last].frame) !== width) return lines;
  const inner = parts.slice(first + 1, last).map(part => part.frame);
  if (!inner.every(line => /^\s*[│├].*[│┤]$/u.test(line))) return lines;
  // Text wider than a plain frame widens it: a writer counting each Chinese character as one column drew the top
  // border half the width of the card's lines, and every right bar stood somewhere else.
  const plain = (titled || /^\s*┌─+┐$/u.test(parts[first].frame)) && /^\s*└─+┘$/u.test(parts[last].frame) && inner.every(line => !/[├┤┬┴┼┌┐└┘]/u.test(line));
  if (titled && !plain) return lines;
  const needed = (line: string) => { const cells = diagramCells(line); return columns(text(cells.slice(0, -1)).trimEnd()) + 2; };
  // A titled top is drawn as a line with its words set into it ("┌─ 不导 · 今日守护 ───── 今晚风险：中 ─┐"): written with
  // spaces, it showed only its two corners, and the box had no top.
  const pad = " ".repeat(indent);
  const words = titled ? parts[first].frame.trim().slice(1, -1).split(/\s*─+\s*|\s{2,}/u).map(word => word.trim()).filter(Boolean) : [];
  const head = `${pad}┌─ ${words[0] ?? ""}`, tail = words.length > 1 ? ` ${words.slice(1).join(" ─ ")} ─┐` : "┐";
  const titledTop = (size: number) => `${head} ${"─".repeat(Math.max(1, size - columns(head) - 1 - columns(tail)))}${tail}`;
  const widest = Math.max(...inner.map(needed), titled ? columns(titledTop(0)) : 0);
  if (plain && (widest > width || titled) && widest - width <= 80) {
    width = Math.max(width, widest);
    const top = titled ? titledTop(width) : `${pad}┌${"─".repeat(width - indent - 2)}┐`;
    parts[first] = { ...parts[first], frame: top };
    parts[last] = { ...parts[last], frame: `${pad}└${"─".repeat(width - indent - 2)}┘` };
  }
  // Boxes nested inside the frame (a button, a card): their right bars follow their own top corner.
  for (let row = 0; row < inner.length; row++) {
    const cells = diagramCells(inner[row]);
    const open = cells.find((cell, index) => index > 0 && cell.text === "┌"), close = open && cells.find(cell => cell.column > open.column && cell.text === "┐");
    if (!open || !close) continue;
    const end = inner.findIndex((line, index) => index > row && diagramCells(line).some(cell => cell.text === "└" && cell.column === open.column));
    if (end < 0 || !diagramCells(inner[end]).some(cell => cell.text === "┘" && cell.column === close.column)) continue;
    for (let between = row + 1; between < end; between++) {
      if (diagramCells(inner[between]).some(cell => cell.text === "│" && cell.column === open.column)) inner[between] = padBarTo(inner[between], close.column, true);
    }
  }
  const dividers=[parts[first].frame,...inner,parts[last].frame].filter(line=>/^\s*[┌├└][─┬┴┼]+[┐┤┘]$/u.test(line));
  const divider=dividers.find(line=>/[┬┼]/u.test(line));
  const lowerJunctions=dividers.flatMap(line=>diagramCells(line).filter(cell=>/[┴┼]/u.test(cell.text)).map(cell=>cell.column));
  const junctions=divider?diagramCells(divider).filter(cell=>/[┬┼]/u.test(cell.text)&&lowerJunctions.includes(cell.column)):[];
  // A matching header/footer defines the main column boundary. Nearby vertical
  // bars can be aligned by padding; nested boxes and overflowing labels stay intact.
  const normalized = inner.map(line => {
    let current = line;
    if (junctions.length && current.trimStart().startsWith("│")) {
      for(const junction of junctions){
        const cells=diagramCells(current);
        const matches=cells.flatMap((cell,index)=>index>0&&index<cells.length-1&&cell.text==="│"&&Math.abs(cell.column-junction.column)<=3?[index]:[]);
        // A nested box with two nearby candidates is ambiguous; leave it alone.
        const position=matches.length===1?matches[0]:-1;
        if(position>0){
        const left = text(cells.slice(0, position)).trimEnd();
        const padding = junction.column - columns(left);
        if (padding >= 0) current = left + " ".repeat(padding) + "│" + text(cells.slice(position + 1));
        }
      }
    }
    const cells = diagramCells(current), right = cells.at(-1)!.text, body = text(cells.slice(0, -1)).trimEnd();
    const padding = width - 1 - columns(body);
    return padding >= 0 && padding <= 120 ? body + " ".repeat(padding) + right : undefined;
  });
  // Long content cannot be squeezed into a smaller frame.
  if (normalized.some(line => line === undefined)) return lines;
  const frames = [parts[first].frame, ...normalized as string[], parts[last].frame];
  const noted = frames.map((frame, index) => parts[first + index].note ? `${frame}  ${parts[first + index].note}` : frame);
  return [...lines.slice(0, first), ...noted, ...lines.slice(last + 1)];
}

export function textDiagram(text: string, language = ""): TextDiagram | undefined {
  if (!/^(?:text|plaintext|plain|ascii|diagram)?$/iu.test(language) || text.length > 8000) return;
  const lines = text.replace(/\r\n?/gu, "\n").replace(/\n$/u, "").split("\n");
  if (lines.length < 3 || lines.length > 100 || (text.match(borders)?.length ?? 0) < 6
    || lines.filter(line => /[│┃┌┐└┘├┤┬┴┼]/u.test(line)).length < 3) return;
  const rows = framedRows(lines).map(diagramCells);
  const width = Math.max(...rows.map(row => row.reduce((total, cell) => total + cell.width, 0)));
  if (width > 200) return;
  return { rows, columns: width };
}
