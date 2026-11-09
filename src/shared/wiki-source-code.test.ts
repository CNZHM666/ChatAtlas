import { describe, expect, it } from "vitest";
import { isSourceCodeParagraph, messageCode, placedSourceCode, readableSourceCaptions, readsAsProse } from "./wiki-source-code";
import { decidedValuesNotes } from "./wiki-section-status";
import { withWikiSections } from "./wiki-sections";
import { wikiReadingCleanup } from "./wiki-reading-cleanup";
import { wikiReadingFormat } from "./wiki-reading-format";
import type { FocusSection } from "./focus-session";
import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";

const TREE = "src/\n├── components/\n├── db/\n│   └── database.ts\n└── App.tsx";
const MESSAGE = `### 4.4 Suggested folder organization (draft)\n\nA layout that keeps features apart:\n\n\`\`\`text\n${TREE}\n\`\`\`\n\n### 5. Data model\n\nMoney is stored in cents.\n\n\`\`\`ts\nexport interface Budget {\n  amountMinor: number; // $ cents\n}\n\`\`\``;

const unit = (id: string, quote: string, code?: { language: string; text: string }, role: "user" | "assistant" = "assistant"): WikiKnowledgeUnit => ({
  id, subject: "s", statement: quote, kind: "fact", details: [],
  evidence: { evidenceId: id, conversationId: "c", messageId: "m", messageIndex: 0, role, pasted: false, quote, ...(code ? { code } : {}) },
}) as unknown as WikiKnowledgeUnit;

describe("source code blocks", () => {
  it("finds the block a quote introduces or stands in, and none past a heading", () => {
    expect(messageCode(MESSAGE, "A layout that keeps features apart:")).toEqual({ language: "text", text: TREE });
    expect(messageCode(MESSAGE, "amountMinor: number; // $ cents")?.language).toBe("ts");
    // The tree comes before this heading's text; the schema follows it.
    expect(messageCode(MESSAGE, "Money is stored in cents.")?.language).toBe("ts");
    expect(messageCode("Use cents.\n\n## Colors\n\n```css\n:root{}\n```", "Use cents.")).toBeUndefined();
    // A quote running into a block has it; a block after another line of text belongs to that line.
    expect(messageCode("### Structure\n\n```text\nsrc/\n└── db/\n```", "### Structure\n\n```text\nsrc/")?.text).toBe("src/\n└── db/");
    expect(messageCode("Use static route names for analytics.\n\n**Currency handling stays simple.**\n\nFormat as USD:\n\n```ts\nformat();\n```", "Use static route names for analytics.")).toBeUndefined();
    expect(messageCode(`Whole file:\n\n\`\`\`ts\n${"x\n".repeat(120)}\`\`\``, "Whole file:")).toBeUndefined();
  });

  it("shows each block once, as written, after the first paragraph citing it, saying whose it is", () => {
    const code = { language: "ts", text: "const price = `$${cents / 100}`;" };
    const units = new Map([["a", unit("a", "q", code)], ["b", unit("b", "q", code)]]);
    const chapters: WikiDraftChapter[] = [
      { id: "x", title: "X", question: "", group: "", body: "Opening.\n\n### Data\n\nPrices are shown in dollars.\n\nPrices are rounded.", paragraphs: [{ subtopic: "Data", text: "Prices are shown in dollars.", unitIds: ["a"] }, { subtopic: "Data", text: "Prices are rounded.", unitIds: ["b"] }] } as WikiDraftChapter,
    ];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, false)).toBe(1);
    const block = "*Code from the discussion · AI suggestion, not confirmed*\n\n```ts\nconst price = `$${cents / 100}`;\n```";
    expect(chapters[0].body).toBe(`Opening.\n\n### Data\n\nPrices are shown in dollars.\n\n${block}\n\nPrices are rounded.`);
    expect(chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["Prices are shown in dollars.", block, "Prices are rounded."]);
    expect(isSourceCodeParagraph(block)).toBe(true);
    expect(isSourceCodeParagraph("Prices are rounded.")).toBe(false);
  });

  it("finds the property table a quote stands in, but not a register of decisions", () => {
    const table = "| Property | Desktop | Mobile |\n|---|---:|---:|\n| Height | 72px | 64px |\n| Horizontal padding | 28px | 16px |";
    const message = `## Dashboard top bar\n\nThe top bar holds the title and one action.\n\n${table}\n\n## Decisions\n\n| Area | Decision |\n|---|---|\n| Platform | Web only |`;
    expect(messageCode(message, "The top bar holds the title and one action.")).toEqual({ language: "table", text: table });
    expect(messageCode(message, "| Height | 72px | 64px |")).toEqual({ language: "table", text: table });
    expect(messageCode(message, "| Platform | Web only |")).toBeUndefined();
    const units = new Map([["a", unit("a", "q", { language: "table", text: table })]]);
    const chapters = [{ id: "x", title: "X", question: "", group: "", body: "### Top bar\n\nThe top bar holds the title.", paragraphs: [{ subtopic: "Top bar", text: "The top bar holds the title.", unitIds: ["a"] }], problems: [] }] as unknown as WikiDraftChapter[];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, false)).toBe(1);
    expect(chapters[0].body).toBe(`### Top bar\n\nThe top bar holds the title.\n\n*Table from the discussion · AI suggestion, not confirmed*\n\n${table}`);
    expect(isSourceCodeParagraph(chapters[0].paragraphs[1].text)).toBe(true);
    expect(isSourceCodeParagraph(table)).toBe(false);
  });

  it("says an earlier table is replaced, and drops the writer's own table of the same units", () => {
    const table = "| Dimension | Monthly | Pay period |\n|---|---|---|\n| Reset | 1st of month | Payday |\n| Logic | Simpler | More dates |";
    const units = new Map([["a", unit("a", "q", { language: "table", text: table })], ["b", unit("b", "q", { language: "table", text: table })], ["c", unit("c", "q")]]);
    const mine = "| Budget Type | Characteristics |\n| --- | --- |\n| Monthly | Simpler |\n| Pay period | Harder |";
    const chapters = [{ id: "x", title: "X", question: "", group: "", body: `### Budgets\n\nBudgets reset by period.\n\n${mine}\n\nThe choice is open.`, paragraphs: [{ subtopic: "Budgets", text: "Budgets reset by period.", unitIds: ["a", "c"] }, { subtopic: "Budgets", text: mine, unitIds: ["b"] }, { subtopic: "Budgets", text: "The choice is open.", unitIds: ["c"] }], problems: [] }] as unknown as WikiDraftChapter[];
    expect(placedSourceCode(chapters, id => units.get(id), id => id === "a" ? "history" : "proposal", false)).toBe(1);
    expect(chapters[0].body).toBe(`### Budgets\n\nBudgets reset by period.\n\n*Table from the discussion · earlier version, since replaced*\n\n${table}\n\nThe choice is open.`);
    expect(chapters[0].paragraphs.map(paragraph => paragraph.text)).toEqual(["Budgets reset by period.", `*Table from the discussion · earlier version, since replaced*\n\n${table}`, "The choice is open."]);
  });

  it("keeps every caption of a chapter through the reading steps that drop repeated paragraphs", () => {
    const caption = "*Table from the discussion · AI suggestion, not confirmed*", code = "*Code from the discussion · AI suggestion, not confirmed*";
    const body = `### A\n\nFirst point here.\n\n${caption}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSecond point here.\n\n${caption}\n\n| c | d |\n|---|---|\n| 3 | 4 |\n\nThird.\n\n${code}\n\n\`\`\`ts\nx\n\`\`\`\n\nMore.\n\n${code}\n\n\`\`\`ts\ny\n\`\`\``;
    const section = { id: "s", title: "T", body, evidenceIds: ["e"], kind: "finding", transition: "", claims: [] } as unknown as FocusSection;
    const read = wikiReadingFormat(wikiReadingCleanup(body, section), section);
    expect(read.match(/^\*AI-suggested (?:table|code)\*$/gmu)).toHaveLength(4);
  });

  it("gives a unit the block of its stored message", () => {
    const ledger = { batches: [{ units: [unit("a", "A layout that keeps features apart:")] }] } as unknown as Parameters<typeof withWikiSections>[0];
    const next = withWikiSections(ledger, [{ id: "m", conversationId: "c", messageIndex: 0, content: MESSAGE }]);
    expect(next.batches[0].units[0].evidence.code).toEqual({ language: "text", text: TREE });
  });

  it("does not count a code block's values against the decided ones", () => {
    const body = "### Top bar\n\nThe top bar is 48px tall.\n\n```css\n:root {\n  --pad: 28px;\n  --title: 24px;\n  --icon: 20px;\n}\n```";
    expect(decidedValuesNotes(body, [{ text: "The top bar is 48px tall.", holder: "decided" }], false)).toBe(body);
  });
});

describe("tables carried by a replaced unit", () => {
  it("says a table is replaced when a unit carrying it was, though the paragraph cites it only through another", () => {
    const table = "| Token | Radius |\n|---|---|\n| `radius-lg` | 16px |\n| `radius-xl` | 24px |";
    const units = new Map([["scale", unit("scale", "q", { language: "table", text: table })], ["old", unit("old", "q", { language: "table", text: table })]]);
    const chapters = [{ id: "x", title: "X", question: "", group: "", body: "### Radius\n\nThe interface uses a radius scale.", paragraphs: [{ subtopic: "Radius", text: "The interface uses a radius scale.", unitIds: ["scale"] }], problems: [] }] as WikiDraftChapter[];
    expect(placedSourceCode(chapters, id => units.get(id), id => id === "old" ? "history" : "analysis", false, [...units.values()])).toBe(1);
    expect(chapters[0].body).toContain("*Table from the discussion · earlier version, since replaced*");
  });
});

describe("a fence holding a reply", () => {
  it("is not shown as code", () => {
    const content = "筛项目建议：\n\n````\n\n**B 的价值高得多。**\n\n# AI 应该怎么参与？\n\n不要：\n\n```text\nIssue\n ↓\nPR\n````\n";
    expect(messageCode(content, "筛项目建议：")).toBeUndefined();
    expect(readsAsProse({ language: "", text: "看这里。citeturn1search1" })).toBe(true);
    expect(readsAsProse({ language: "python", text: "def ss(A, B, C, D):\n    ..." })).toBe(false);
  });
});

describe("examples in a learning record", () => {
  it("sits each example under the point it shows, drops one-line fragments and names the point in its caption", () => {
    const loop = { language: "python", text: "for voltage in voltages:\n    print(voltage)" };
    const fn = { language: "python", text: "def check(v):\n    return v > 3" };
    const units = new Map([["a", unit("a", "for 循环遍历列表", loop)], ["b", unit("b", "def 定义函数", fn)], ["c", unit("c", "打印列表", { language: "python", text: "print(scores)" })]]);
    const list = "- **循环遍历**：用 for 循环遍历列表。\n- **函数定义**：用 def 定义函数。\n- **打印**：打印列表。";
    const chapters: WikiDraftChapter[] = [{ id: "x", title: "X", question: "", group: "", body: `### 语法\n\n${list}`, problems: [],
      paragraphs: [{ subtopic: "语法", text: list, unitIds: ["a", "b", "c"], claims: [{ text: "用 for 循环遍历列表。", unitIds: ["a"] }, { text: "用 def 定义函数。", unitIds: ["b"] }, { text: "打印列表。", unitIds: ["c"] }] }] }];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, true, [...units.values()], true)).toBe(2);
    expect(chapters[0].body).toBe("### 语法\n\n- **循环遍历**：用 for 循环遍历列表。\n\n*「循环遍历」的代码示例*\n\n```python\nfor voltage in voltages:\n    print(voltage)\n```\n\n- **函数定义**：用 def 定义函数。\n\n*「函数定义」的代码示例*\n\n```python\ndef check(v):\n    return v > 3\n```\n\n- **打印**：打印列表。");
  });

  it("leaves out a block that shows another point, and names each block under a sentence for its own point", () => {
    const named = (id: string, subject: string, statement: string, code?: { language: string; text: string }) => ({ ...unit(id, statement, code), subject });
    const skipped = "复杂 rebase\ncherry-pick\nbisect\nGit hooks\nsubmodule";
    const units = new Map([
      ["goal", named("goal", "最终目标", "让 Git 不再成为参与 python-control 项目的障碍。", { language: "text", text: skipped })],
      ["skip", named("skip", "暂不学", "暂不学复杂 rebase、cherry-pick、bisect、Git hooks、submodule。")],
      ["next", named("next", "明日学习节奏", "明天先复习 Python 基础，再开始 NumPy 的 array 和 shape。", { language: "python", text: "def some_function(sys, timepts=None):\n    ..." })],
      ["ros", named("ros", "ROS2 入门时机", "具备 Python 熟练度、Linux 命令基础后可开始参与 ROS2。", { language: "text", text: "Python 比较熟\nLinux 命令基本会\nC++ 基础" })],
    ]);
    const text = "让 Git 不再成为障碍。明天先复习 Python 基础，再开始 NumPy。具备 Python 熟练度、Linux 命令基础后可开始参与 ROS2。";
    const chapters: WikiDraftChapter[] = [{ id: "r", title: "路线", question: "", group: "", body: `### 路线与节奏\n\n${text}`, problems: [],
      paragraphs: [{ subtopic: "路线与节奏", text, unitIds: ["goal", "next", "ros"], claims: [] }] }];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, true, [...units.values()], true)).toBe(1);
    expect(chapters[0].body).toBe(`### 路线与节奏\n\n${text}\n\n*「ROS2 入门时机」的清单*\n\n\`\`\`text\nPython 比较熟\nLinux 命令基本会\nC++ 基础\n\`\`\``);
    // A project keeps every block, as before.
    const project: WikiDraftChapter[] = [{ ...chapters[0], body: `### 路线与节奏\n\n${text}`, paragraphs: [{ subtopic: "路线与节奏", text, unitIds: ["goal", "next", "ros"], claims: [] }] }];
    expect(placedSourceCode(project, id => units.get(id), () => undefined, true, [...units.values()], false)).toBe(3);
  });
});

describe("readableSourceCaptions", () => {
  it("shows a saved caption as whose block it is, keeping the later decision", () => {
    expect(readableSourceCaptions("*讨论中的原文表格 · AI建议，未确认*")).toBe("*AI 建议的表格*");
    expect(readableSourceCaptions("*讨论中的原文代码 · 你确认的；你随后的决定优先：只支持美元*")).toBe("*你确认的代码 · 以你后来的决定为准：只支持美元*");
    expect(readableSourceCaptions("*讨论中的原文表格 · 早期版本，已被替换*")).toBe("*早期的表格（已被替换）*");
    expect(readableSourceCaptions("*Table from the discussion · AI suggestion, not confirmed*")).toBe("*AI-suggested table*");
    // Prose that only mentions the words stays as written.
    expect(readableSourceCaptions("讨论中的原文表格 · AI 建议，未确认")).toBe("讨论中的原文表格 · AI 建议，未确认");
  });
});
