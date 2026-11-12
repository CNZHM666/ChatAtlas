import { describe, expect, it } from "vitest";
import { isSourceCodeParagraph, messageCode, placedSourceCode, readableSourceCaptions, readableUiSketches, readsAsProse, sourceBlockResolvedProblems, sourceBlockSupportsRows, withoutPlaceholderFences, withoutSourceBlockRepeats } from "./wiki-source-code";
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
  it("keeps the full original for a partially transcribed mapping and retains added or changed rows", () => {
    const code = { language: "text", text: "- 200–299: Success\n- 400–499: Client error\n- 500–599: Server error" };
    const source = unit("http", "HTTP responses are grouped by status class.", code);
    const repeat = "- **Success**: 200-299: Success\n- **Client error**: 400–499";
    const conflict = "- **Server error**: 400–499";
    const extension = "- **Success**: 200-299\n- **Client error**: 400–499, retry immediately";
    const other = "- **Client error**: 400–499";
    const paragraph = (text: string, subtopic = "HTTP") => ({ text, subtopic, unitIds: [source.id] });
    const before: WikiDraftChapter = { id: "api", title: "API", question: "", group: "", body: [repeat, `### Conflicting wording\n\n${conflict}`, `### Added action\n\n${extension}`, `### Gateway\n\n${other}`].join("\n\n"),
      paragraphs: [paragraph(repeat), paragraph(conflict), paragraph(extension), paragraph(other, "Gateway")], problems: [] };
    const unitOf = (id: string) => id === source.id ? source : undefined;
    expect(sourceBlockSupportsRows("Success: 200-299", code)).toBe(true);
    expect(sourceBlockSupportsRows(conflict, code)).toBe(false);
    expect(withoutSourceBlockRepeats(before, unitOf).removed).toEqual([]);
    expect(placedSourceCode([before], unitOf, () => "proposal", false)).toBe(1);
    const projection = withoutSourceBlockRepeats(before, unitOf);
    expect(projection.removed.map(paragraph => paragraph.text)).toEqual([repeat]);
    expect(projection.body).toContain(code.text);
    expect(projection.body).toContain(conflict);
    expect(projection.body).toContain(extension);
    expect(projection.body).toContain(other);
    const stale = `"${repeat.slice(0, 45)}…" states the range 200-299 that no cited unit states as a range`;
    const active = `"${conflict}…" has numbers its units do not state: 499`;
    expect(sourceBlockResolvedProblems([stale, active], projection.removed, projection.paragraphs)).toEqual([stale]);
  });

  it("checks ordered table cells and the schema before treating a partial table as a repeat", () => {
    const code = { language: "table", text: "| Item | Reorder at | Order quantity |\n| --- | --- | --- |\n| Screws | 10 | 100 |\n| Nuts | 20 | 200 |" };
    const exact = "| Item | Reorder at | Order quantity |\n| --- | ---: | ---: |\n| Nuts | 20 | 200 |";
    expect(sourceBlockSupportsRows(exact, code)).toBe(true);
    expect(sourceBlockSupportsRows(exact.replace("20 | 200", "200 | 20"), code)).toBe(false);
    expect(sourceBlockSupportsRows(exact.replace("Reorder at", "On hand"), code)).toBe(false);
    expect(sourceBlockSupportsRows("Screws: 100", code)).toBe(false);
  });
  it("captions a week of ticks and a plan card of circles as screens, not lists", () => {
    const week = { language: "text", text: "17  18  19  20  21  22  23\n✓   ✓   ✓   ✓   ✓   ✓   今天\n查看完整日历" };
    const units = new Map([["a", unit("a", "首页展示最近7天。", week)]]);
    const chapters: WikiDraftChapter[] = [{ id: "x", title: "X", question: "", group: "", problems: [], body: "首页展示最近7天。", paragraphs: [{ subtopic: "", text: "首页展示最近7天。", unitIds: ["a"] }] }];
    placedSourceCode(chapters, id => units.get(id), () => undefined, true);
    expect(readableSourceCaptions(chapters[0].body)).toContain("*界面草图*");
  });

  it("shows only the last drawing of one screen, and no list the paragraph above already says", () => {
    const at = (id: string, index: number, code: { language: string; text: string }) => { const own = unit(id, id, code); own.evidence.messageIndex = index; return own; };
    const first = { language: "text", text: "┌────────┐\n│ 恢复精力 戒7天 │\n│ 今日任务 0/1 │\n│ [开始守护] │\n└────────┘" };
    const last = { language: "text", text: "┌────────┐\n│ 今日守护 戒7天 │\n│ 今日任务 0/1 │\n│ [开始守护] │\n└────────┘" };
    const list = { language: "text", text: "打卡记录\n冲动日志\n守护小组" };
    const units = new Map([["a", at("a", 1, first)], ["b", at("b", 5, last)], ["c", at("c", 6, list)]]);
    const chapters: WikiDraftChapter[] = [
      { id: "x", title: "X", question: "", group: "", body: "首页先给出守护入口。\n\n后来首页改成今日守护。\n\n功能包括打卡记录、冲动日志和守护小组。", paragraphs: [{ subtopic: "", text: "首页先给出守护入口。", unitIds: ["a"] }, { subtopic: "", text: "后来首页改成今日守护。", unitIds: ["b"] }, { subtopic: "", text: "功能包括打卡记录、冲动日志和守护小组。", unitIds: ["c"] }] } as WikiDraftChapter,
    ];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, true)).toBe(1);
    expect(chapters[0].body).toContain("今日守护 戒7天");
    expect(chapters[0].body).not.toContain("恢复精力 戒7天");
    expect(chapters[0].body).not.toContain("```text\n打卡记录");
  });

  it("knows one screen drawn again by the pieces both versions keep, and leaves out a lone expression", () => {
    const at = (id: string, index: number, code: { language: string; text: string }) => { const own = unit(id, id, code); own.evidence.messageIndex = index; return own; };
    const card = { language: "text", text: "不导 · 今日守护                     中风险\n\n主要诱因：独处、熬夜、短视频\n\n[开始今晚准备]" };
    const page = { language: "text", text: "晚上好，卡夫卡\n┌ 不导 · 今日守护                  今晚风险：中 ┐\n│ 主要诱因：独处、熬夜、短视频                 │\n│ [完成今晚准备]                               │\n└──────────────────────────┘" };
    const expression = { language: "ts", text: "urgeLevel === 'severe'" };
    const units = new Map([["a", at("a", 1, card)], ["b", at("b", 5, page)], ["c", at("c", 6, expression)]]);
    const chapters: WikiDraftChapter[] = [
      { id: "x", title: "X", question: "", group: "", body: "卡片先这样。\n\n首页后来这样。\n\n重度模式隐藏入口。", paragraphs: [{ subtopic: "", text: "卡片先这样。", unitIds: ["a"] }, { subtopic: "", text: "首页后来这样。", unitIds: ["b"] }, { subtopic: "", text: "重度模式隐藏入口。", unitIds: ["c"] }] } as WikiDraftChapter,
    ];
    expect(placedSourceCode(chapters, id => units.get(id), () => undefined, true)).toBe(1);
    expect(chapters[0].body).toContain("晚上好，卡夫卡");
    expect(chapters[0].body).not.toContain("中风险");
    expect(chapters[0].body).not.toContain("urgeLevel");
  });

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

  it("says an earlier table is replaced and retains a generated table that changes its schema and wording", () => {
    const table = "| Dimension | Monthly | Pay period |\n|---|---|---|\n| Reset | 1st of month | Payday |\n| Logic | Simpler | More dates |";
    const units = new Map([["a", unit("a", "q", { language: "table", text: table })], ["b", unit("b", "q", { language: "table", text: table })], ["c", unit("c", "q")]]);
    const mine = "| Budget Type | Characteristics |\n| --- | --- |\n| Monthly | Simpler |\n| Pay period | Harder |";
    const chapters = [{ id: "x", title: "X", question: "", group: "", body: `### Budgets\n\nBudgets reset by period.\n\n${mine}\n\nThe choice is open.`, paragraphs: [{ subtopic: "Budgets", text: "Budgets reset by period.", unitIds: ["a", "c"] }, { subtopic: "Budgets", text: mine, unitIds: ["b"] }, { subtopic: "Budgets", text: "The choice is open.", unitIds: ["c"] }], problems: [] }] as unknown as WikiDraftChapter[];
    expect(placedSourceCode(chapters, id => units.get(id), id => id === "a" ? "history" : "proposal", false)).toBe(1);
    const projected = withoutSourceBlockRepeats(chapters[0], id => units.get(id));
    expect(projected.body).toBe(`### Budgets\n\nBudgets reset by period.\n\n*Table from the discussion · earlier version, since replaced*\n\n${table}\n\n${mine}\n\nThe choice is open.`);
    expect(projected.removed).toHaveLength(0);
  });

  it("keeps every caption of a chapter through the reading steps that drop repeated paragraphs", () => {
    const caption = "*Table from the discussion · AI suggestion, not confirmed*", code = "*Code from the discussion · AI suggestion, not confirmed*";
    const body = `### A\n\nFirst point here.\n\n${caption}\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nSecond point here.\n\n${caption}\n\n| c | d |\n|---|---|\n| 3 | 4 |\n\nThird.\n\n${code}\n\n\`\`\`ts\nx\n\`\`\`\n\nMore.\n\n${code}\n\n\`\`\`ts\ny\n\`\`\``;
    const section = { id: "s", title: "T", body, evidenceIds: ["e"], kind: "finding", transition: "", claims: [] } as unknown as FocusSection;
    const read = wikiReadingFormat(wikiReadingCleanup(body, section), section);
    expect(read.match(/^\*(?:Table|Code example)\*$/gmu)).toHaveLength(4);
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
    const units = new Map([["scale", unit("scale", "q", { language: "table", text: table })], ["old", unit("old", "Radius tokens: radius-lg is 16px for cards and radius-xl is 24px for dialogs.", { language: "table", text: table })]]);
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
  it("replaces uneven box edges only in a single-column UI sketch", () => {
    const frame = "┌──────┐\n│ 今晚21:30后风险较高。       │\n│ [完成今晚准备]               │\n│ 告诉我你现在的情况……        ↑    │\n└──────┘";
    const wrap = (caption: string, text: string) => ["*" + caption + "*", "", "```text", text, "```"].join("\n");
    const clean = readableUiSketches(wrap("界面草图", frame));
    expect(clean).toContain("今晚21:30后风险较高。\n[完成今晚准备]\n告诉我你现在的情况……  ↑");
    expect(clean).not.toMatch(/[┌│┘]/u);
    expect(readableUiSketches(wrap("代码", frame))).toBe(wrap("代码", frame));
    const columns = frame.replace("今晚21:30后风险较高。", "文字 │ 操作");
    expect(readableUiSketches(wrap("界面草图", columns))).toBe(wrap("界面草图", columns));
  });
  it("shows a saved caption as whose block it is, keeping the later decision", () => {
    expect(readableSourceCaptions("*讨论中的原文表格 · AI建议，未确认*")).toBe("*对照表*");
    expect(readableSourceCaptions("*讨论中的原文代码 · 你确认的；你随后的决定优先：只支持美元*")).toBe("*代码 · 你确认 · 以你后来的决定为准：只支持美元*");
    expect(readableSourceCaptions("*讨论中的原文表格 · 早期版本，已被替换*")).toBe("*对照表 · 早期方案，已被替换*");
    expect(readableSourceCaptions("*Table from the discussion · AI suggestion, not confirmed*")).toBe("*Table*");
  });
  it("names what a block shows and the section it sits in, read from the block", () => {
    const shown = (block: string) => readableSourceCaptions(`### 首页布局引导\n\n*讨论中的原文代码 · AI 建议，未确认*\n\n\`\`\`text\n${block}\n\`\`\``).split("\n")[2];
    expect(shown("晚上好，卡夫卡\n┌────┐\n│ 今日守护 │\n└────┘")).toBe("*界面草图*");
    expect(shown("今日任务  0/1\n睡前30分钟把手机放到客厅\n[我已完成]")).toBe("*界面草图*");
    expect(shown("如果当前时间进入高危时段\n则显示中风险提醒\n如果用户选择有点冲动\n则启动10分钟干预")).toBe("*规则逻辑*");
    expect(shown("rescue_open\nrescue_flow_started\nrescue_completed")).toBe("*事件清单*");
    expect(shown("pages/\n  rescue/\n    result")).toBe("*目录结构*");
    expect(shown("第26期 · 7天守护组\n8名成员｜今天5人已完成")).toBe("*界面文案*");
    expect(readableSourceCaptions("### 数据\n\n*讨论中的原文代码 · AI 建议，未确认*\n\n```ts\ninterface RescueSession {\n  id: string;\n}\n```").split("\n")[2]).toBe("*数据结构*");
    // Prose that only mentions the words stays as written.
    expect(readableSourceCaptions("讨论中的原文表格 · AI 建议，未确认")).toBe("讨论中的原文表格 · AI 建议，未确认");
    // A chapter edited by hand keeps captions as an earlier version showed them: they read like the rest.
    const edited = (caption: string) => readableSourceCaptions(`${caption}\n\n\`\`\`text\n免费评估\n→ 付费\n\`\`\``).split("\n")[0];
    expect(edited("*流程 · 战略方向 · AI 建议*")).toBe("*流程*");
    expect(edited("*界面文案 · 首页 · 你确认 · 以你后来的决定为准：只要一个按钮*")).toBe("*界面文案 · 你确认 · 以你后来的决定为准：只要一个按钮*");
    // Without a block after it, such a line is the writer's own and stays.
    expect(readableSourceCaptions("*流程 · 战略方向 · AI 建议*\n\n正文。")).toBe("*流程 · 战略方向 · AI 建议*\n\n正文。");
  });
});

describe("withoutPlaceholderFences", () => {
  it("drops a fence the writer made of a block's summary, and an empty one, keeping the text around them", () => {
    const written = "侧栏菜单按项目分组。\n\n```yaml, 4 lines\n```\n点击分组标题可折叠。";
    expect(withoutPlaceholderFences(written)).toBe("侧栏菜单按项目分组。\n\n点击分组标题可折叠。");
    expect(withoutPlaceholderFences("```\n```")).toBe("");
    expect(withoutPlaceholderFences("前文\n\n~~~\n\n~~~\n\n后文")).toBe("前文\n\n后文");
  });
  it("keeps real blocks, an unlabelled block after a closed one, and a block left open; a summary label gives way to its language", () => {
    const blocks = "```ts\nconst a = 1;\n```\n```\nplain\n```";
    expect(withoutPlaceholderFences(blocks)).toBe(blocks);
    expect(withoutPlaceholderFences("```python, 2 lines\nx = 1\ny = 2\n```")).toBe("```python\nx = 1\ny = 2\n```");
    expect(withoutPlaceholderFences("说明\n```sh\nnpm test")).toBe("说明\n```sh\nnpm test");
    expect(withoutPlaceholderFences("No fences here.")).toBe("No fences here.");
  });
});

describe("list items repeating a shown block", () => {
  const levels = { language: "text", text: "0～49：普通\n50～89：重要\n90～100：紧急" };
  const ticket = unit("levels", "工单按分数分为三个优先级。", levels), reply = unit("reply", "普通工单 3 天内回复。");
  const block = `*讨论中的原文代码 · AI 建议，未确认*\n\n\`\`\`text\n${levels.text}\n\`\`\``;
  const chapterWith = (items: string[], claims: Array<{ text: string; unitIds: string[] }>) => {
    const list = items.join("\n");
    return { body: `### 优先级\n\n${block}\n\n${list}`, paragraphs: [
      { subtopic: "优先级", text: block, unitIds: ["levels"], claims: [] },
      { subtopic: "优先级", text: list, unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], claims },
    ] };
  };
  const unitOf = (id: string) => ({ levels: ticket, reply } as Record<string, WikiKnowledgeUnit>)[id];

  it("folds only the item the block shows, keeping the list's own items and its claims", () => {
    const rows = "0～49：普通；50～89：重要", own = "普通工单 3 天内回复。";
    const projected = withoutSourceBlockRepeats(chapterWith([`- **优先级**：${rows}`, `- **处理时限**：${own}`], [{ text: rows, unitIds: ["levels"] }, { text: own, unitIds: ["reply"] }]), unitOf);
    expect(projected.body).toBe(`### 优先级\n\n${block}\n\n- **处理时限**：${own}`);
    expect(projected.paragraphs[1].claims).toEqual([{ text: own, unitIds: ["reply"] }]);
    expect(projected.removed.map(paragraph => paragraph.text)).toEqual([`- **优先级**：${rows}`]);
  });

  it("keeps an item with a condition or value of its own, and one citing another block", () => {
    for (const [line, said] of [["- **夜间时**：0～49：普通", "0～49：普通"], ["- **优先级**：90～100：紧急并电话通知", "90～100：紧急并电话通知"]]) {
      const kept = withoutSourceBlockRepeats(chapterWith([line], [{ text: said, unitIds: ["levels"] }]), unitOf);
      expect(kept.body).toContain(line);
    }
    // Same values, another version's block: the item's claim cites a unit whose block is not the one shown.
    const v2 = unit("v2", "第二版调整优先级分数。", { language: "text", text: "0～59：普通\n60～100：紧急" });
    const other = withoutSourceBlockRepeats(chapterWith(["- **优先级**：0～49：普通"], [{ text: "0～49：普通", unitIds: ["v2"] }]), id => id === "v2" ? v2 : unitOf(id));
    expect(other.body).toContain("- **优先级**：0～49：普通");
  });
});
