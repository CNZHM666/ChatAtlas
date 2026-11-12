import { describe, expect, it } from "vitest";
import { diagramCells, textDiagram } from "./text-diagram";

describe("text diagrams", () => {
  it("aligns both dividers of a three-column workbench using matching inner junctions",()=>{
    const source="┌────────────────────────────┐\n│ Workbench                  │\n├───────┬─────────┬──────────┤\n│ 元件 │ 画布   │ 助手      │\n│ ESP32 │ □      │ 说明      │\n├───────┴─────────┴──────────┤\n│ 架构 接线 BOM              │\n└────────────────────────────┘";
    const diagram=textDiagram(source)!;expect(diagram.rows[3].filter(cell=>cell.text==="│").map(cell=>cell.column)).toEqual([0,8,18,29]);
    expect(diagram.rows[4].filter(cell=>cell.text==="│").map(cell=>cell.column)).toEqual([0,8,18,29]);expect(source).toContain("│ 元件 │");
  });
  it("keeps Chinese, joined emoji and combining characters on stable columns", () => {
    const cells = diagramCells("A中文👩‍💻e\u0301\t│");
    expect(cells.map(cell => [cell.text, cell.column, cell.width])).toEqual([
      ["A", 0, 1], ["中", 1, 2], ["文", 3, 2], ["👩‍💻", 5, 2], ["e\u0301", 7, 1], ["\t", 8, 4], ["│", 12, 1],
    ]);
  });
  it("aligns a complete frame using only whitespace without changing source", () => {
    const source = "┌──────────┐\n│中文   │\n│ 🟢 AI     │\n└──────────┘\n";
    const diagram = textDiagram(source, "text")!;
    expect(diagram.rows.map(row => row.at(-1)?.column)).toEqual([11, 11, 11, 11]);
    expect(source).toContain("│中文   │");
  });
  it("widens a plain frame its text overflows, finds a frame under other lines, and does not repair incomplete frames", () => {
    // Text wider than a plain frame widens the frame: its borders and bars end in one column.
    expect(textDiagram("┌──┐\n│内容超过宽度│\n└──┘")!.rows.map(row => row.at(-1)?.column)).toEqual([14, 14, 14]);
    // A card under a greeting, drawn half as wide as its Chinese lines, stands as one box.
    const card = textDiagram("晚上好，卡夫卡\n\n┌──────────┐\n│ 不导 · 今日守护      │\n│                    │\n│ 根据你的记录，今晚21:30后风险较高。 │\n└──────────┘")!;
    expect(new Set(card.rows.slice(2).map(row => row.at(-1)?.column)).size).toBe(1);
    expect(textDiagram("┌────┐\n│ A │\n│ B   │")!.rows[1].at(-1)?.column).toBe(4);
  });
  it("lines up a card whose top border carries its title, keeping the title's words", () => {
    const source = "晚上好，卡夫卡\n┌ 不导 · 今日守护                  今晚风险：中 ┐\n│ 你今晚21:30后风险可能升高                    │\n│ [完成今晚准备]                               │\n│ 告诉不导你现在的情况……                 ↑    │\n└──────────────────────────┘\n\n今日计划";
    const diagram = textDiagram(source)!;
    expect(new Set(diagram.rows.slice(1, 6).map(row => row.at(-1)?.column)).size).toBe(1);
    expect(diagram.rows[1].map(cell => cell.text).join("")).toContain("不导 · 今日守护");
    // The top is a drawn line with the words set into it, not two corners with spaces between.
    expect(diagram.rows[1].map(cell => cell.text).join("")).toMatch(/^┌─ 不导 · 今日守护 ─+ 今晚风险：中 ─┐$/u);
  });
  it("aligns the main divider only when matching header and footer junctions identify it", () => {
    const diagram = textDiagram("┌────────────────┐\n├───────┬────────┤\n│中文 │内容    │\n│🟢 AI  │说明  │\n└───────┴────────┘")!;
    expect(diagram.rows[2].filter(cell => cell.text === "│").map(cell => cell.column)).toEqual([0, 8, 17]);
    expect(diagram.rows[3].filter(cell => cell.text === "│").map(cell => cell.column)).toEqual([0, 8, 17]);
  });
  it("lines up a frame, its nested button and the notes beside it when Chinese was counted as one column", () => {
    const source = [
      "┌──────────────────────┐",
      "│ 25:00                │  ← 大号倒计时",
      "│ 准备开始专注            │   ← 状态文字",
      "│  ┌──────────────┐    │",
      "│  │ 开始专注        │    │ ← 主按钮",
      "│  └──────────────┘    │",
      "└──────────────────────┘",
    ].join("\n");
    const diagram = textDiagram(source)!;
    const bars = (row: number) => diagram.rows[row].filter(cell => cell.text === "│").map(cell => cell.column);
    expect(bars(2)).toEqual([0, 23]);
    expect(bars(4)).toEqual([0, 3, 18, 23]);
    expect([1, 2, 4].map(row => diagram.rows[row].find(cell => cell.text === "←")?.column)).toEqual([26, 26, 26]);
    expect(source).toContain("│ 准备开始专注            │   ← 状态文字");
  });
  it("keeps type definitions and actual program examples as code", () => {
    expect(textDiagram('interface Message {\n  role: "user";\n}', "typescript")).toBeUndefined();
    expect(textDiagram('const box = `┌──┐\n│ A│\n└──┘`;', "javascript")).toBeUndefined();
    expect(textDiagram('name | value\nA | B\nC | D')).toBeUndefined();
  });
  it("does not render unbounded diagrams", () => {
    expect(textDiagram(("│中文│\n").repeat(101))).toBeUndefined();
  });
});
