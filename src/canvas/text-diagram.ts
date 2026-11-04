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

/** Only normalize unambiguous whitespace next to a complete outer frame.
 * Never delete content, guess missing borders or alter the stored/copyable source. */
function framedRows(lines: string[]): string[] {
  const first = lines.findIndex(line => line.trim());
  const last = lines.length - 1 - [...lines].reverse().findIndex(line => line.trim());
  const top = /^(\s*)┌[─┬]+┐\s*$/u.exec(lines[first] ?? "");
  if (!top || !/^\s*└[─┴]+┘\s*$/u.test(lines[last] ?? "")) return lines;
  const width = columns(lines[first].trimEnd());
  if (columns(lines[last].trimEnd()) !== width) return lines;
  const inner = lines.slice(first + 1, last);
  if (!inner.every(line => /^\s*[│├].*[│┤]\s*$/u.test(line))) return lines;
  const dividers=[lines[first],...inner,lines[last]].filter(line=>/^\s*[┌├└][─┬┴┼]+[┐┤┘]\s*$/u.test(line));
  const divider=dividers.find(line=>/[┬┼]/u.test(line));
  const lowerJunctions=dividers.flatMap(line=>diagramCells(line).filter(cell=>/[┴┼]/u.test(cell.text)).map(cell=>cell.column));
  const junctions=divider?diagramCells(divider).filter(cell=>/[┬┼]/u.test(cell.text)&&lowerJunctions.includes(cell.column)):[];
  // A matching header/footer defines the main column boundary. Nearby vertical
  // bars can be aligned by padding; nested boxes and overflowing labels stay intact.
  const normalized = inner.map(line => {
    let text = line.trimEnd();
    if (junctions.length && text.trimStart().startsWith("│")) {
      for(const junction of junctions){
        const cells=diagramCells(text);
        const matches=cells.flatMap((cell,index)=>index>0&&index<cells.length-1&&cell.text==="│"&&Math.abs(cell.column-junction.column)<=3?[index]:[]);
        // A nested box with two nearby candidates is ambiguous; leave it alone.
        const position=matches.length===1?matches[0]:-1;
        if(position>0){
        const left = cells.slice(0, position).map(cell => cell.text).join("").trimEnd();
        const padding = junction.column - columns(left);
        if (padding >= 0) text = left + " ".repeat(padding) + "│" + cells.slice(position + 1).map(cell => cell.text).join("");
        }
      }
    }
    const right = text.slice(-1), body = text.slice(0, -1).trimEnd();
    const padding = width - 1 - columns(body);
    return padding >= 0 && padding <= 120 ? body + " ".repeat(padding) + right : undefined;
  });
  // Long content cannot be squeezed into a smaller frame.
  if (normalized.some(line => line === undefined)) return lines;
  return [...lines.slice(0, first + 1), ...normalized as string[], ...lines.slice(last)];
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
