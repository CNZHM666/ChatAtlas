import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";
import { removeParagraph, replaceParagraph } from "./wiki-body-text";
import { knowledgeTerms } from "./knowledge-subject";
import { wikiSaidLater } from "./wiki-sources";
import { wikiDocumentBlocks } from "./wiki-document-blocks";

/** A block of a message shown as written: a fenced block with its language, or a Markdown table (language "table"). */
export interface WikiSourceCode { language: string; text: string }

const FENCE = /^([ \t]*)(`{3,}|~{3,})[ \t]*([\w+#.-]*)[^\n]*\n([\s\S]*?)\n[ \t]*\2[ \t]*$/gmu;
/** Longer blocks are left in the source: a whole file pasted in is not a Wiki's to repeat. */
const MAX_LINES = 100, MAX_CHARS = 5000, MAX_TABLE_ROWS = 40;
export const TABLE = "table";
const SUMMARY_TABLE = /\b(?:decisions?|status|progress)\b|决定|决策|状态|进度/iu;

/** A fence holding a reply rather than code: one left open or opened by mistake took in the answer after it, its
 * headings, bold lines, a fence of its own and the citation marks ChatGPT leaves ("citeturn…"). */
export function readsAsProse(code: WikiSourceCode): boolean {
  if (code.language === TABLE) return false;
  const text = code.text;
  if (/[-]/u.test(text) || /^[ \t]*(?:`{3,}|~{3,})/mu.test(text)) return true;
  return /^#{1,6}\s/mu.test(text) && /\*\*[^*\n]+\*\*/u.test(text);
}

/** Where a quote starts in a message: as given, else by its first characters with whitespace ignored. */
function quoteAt(content: string, quote: string): number {
  const direct = content.indexOf(quote.trim().slice(0, 80));
  if (direct >= 0) return direct;
  const head = quote.replace(/\s+/gu, "").slice(0, 30);
  if (head.length < 6) return -1;
  const positions: number[] = [];
  let bare = "";
  for (let index = 0; index < content.length; index++) if (!/\s/u.test(content[index])) { bare += content[index]; positions.push(index); }
  const at = bare.indexOf(head);
  return at < 0 ? -1 : positions[at];
}

/** The Markdown tables of a message: a header row, a separator row, then its rows, each line opening with a bar. */
function tables(content: string): Array<{ from: number; to: number; text: string }> {
  const found: Array<{ from: number; to: number; text: string }> = [];
  const lines = content.split("\n");
  let offset = 0, run: string[] = [], runFrom = 0;
  const close = () => {
    if (run.length >= 3 && /^\s*\|?\s*:?-{3,}/u.test(run[1])) found.push({ from: runFrom, to: runFrom + run.join("\n").length, text: run.map(line => line.trim()).join("\n") });
    run = [];
  };
  for (const line of lines) {
    if (/^\s*\|/u.test(line)) { if (!run.length) runFrom = offset; run.push(line); }
    else close();
    offset += line.length + 1;
  }
  close();
  return found;
}

/** The code block or table a quote stands in or runs into, or the one it introduces: right after it, with only blank
 * lines between ("Use integer cents and format values as USD:" over the block). A block further on is another point's:
 * one run gave an analytics rule the currency formatter two lines below it. A block too long to repeat, or empty, is
 * none. Tables matter as much as code: extraction told the dashboard's whole property table as "Define dashboard top
 * bar dimensions and colors", with none of its values. */
export function messageCode(content: string, quote: string): WikiSourceCode | undefined {
  const start = quoteAt(content, quote);
  if (start < 0) return undefined;
  const tail = quote.trim().slice(-40), found = tail.length >= 6 ? content.indexOf(tail, start) : -1;
  const end = found >= 0 ? found + tail.length : start + quote.trim().length;
  const blocks = [
    ...[...content.matchAll(FENCE)].map(match => ({ from: match.index ?? 0, to: (match.index ?? 0) + match[0].length, code: { language: match[3].toLowerCase(), text: match[4].replace(/\s+$/u, "") } })),
    // A table inside a fence is the fence's.
    ...tables(content).map(table => ({ from: table.from, to: table.to, code: { language: TABLE, text: table.text } })),
  ].sort((a, b) => a.from - b.from);
  const fences = blocks.filter(block => block.code.language !== TABLE);
  for (const block of blocks) {
    if (block.code.language === TABLE && fences.some(fence => fence.from <= block.from && fence.to >= block.to)) continue;
    // A register of decisions or statuses ("| Area | Decision |") is what the overview lists from the marks; shown as the
    // reply wrote it, its rows read as all confirmed.
    if (block.code.language === TABLE && SUMMARY_TABLE.test(block.code.text.split("\n")[0])) continue;
    const spans = block.from < end && block.to > start;
    const introduces = block.from >= end && !content.slice(end, block.from).trim();
    if (!spans && !introduces) continue;
    const { text } = block.code, lines = text.split("\n").length;
    if (!text.trim() || lines > (block.code.language === TABLE ? MAX_TABLE_ROWS + 2 : MAX_LINES) || text.length > MAX_CHARS || readsAsProse(block.code)) return undefined;
    return block.code;
  }
  return undefined;
}

/** A paragraph that is a source block placed by placedSourceCode: its caption line, then the fence or the table; a
 * fence the writer wrote is one too. Never rewritten. A table the writer made has no caption and is not one. */
export const isSourceCodeParagraph = (text: string) => /^(?:\*[^*\n]+\*\n\n)?(?:`{3,}|~{3,})|^\*[^*\n]+\*\n\n\|/u.test(text.trimStart());

/** The caption line over a source block, a one-line emphasis read with the node after it (a fence, or a table, which
 * a parser without tables reads as a paragraph opening with a bar). Every block of a chapter has the same caption:
 * steps dropping a paragraph that repeats another dropped all but the first, and the tables after them read as the
 * writer's. */
export const isSourceCaption = (text: string, next: { type: string; text: string } | undefined) => /^\*[^*\n]+\*$/u.test(text.trim()) && !!next && (next.type === "code" || next.type === "table" || /^\s*\|/u.test(next.text));

/** A saved caption over a block, as the reader sees it: "讨论中的原文表格 · AI 建议，未确认" read like a system label
 * over every table, and forty "AI 建议的代码" in one document told none of them apart. Shown as what the block is (a UI
 * sketch, a data structure, rules), and whose it is only when that is not AI's; a later decision that holds over it
 * stays. Read from the block itself, so documents saved before get it too. */
const ZH_WHOSE: Record<string, string> = { "你确认的": "你确认", "你提供的": "你提供", "AI 建议，未确认": "AI 建议", "早期版本，已被替换": "早期方案，已被替换" };
const EN_WHOSE: Record<string, string> = { "confirmed by you": "confirmed by you", "provided by you": "provided by you", "AI suggestion, not confirmed": "AI suggestion", "earlier version, since replaced": "earlier version, since replaced" };
const ZH_CAPTION = /^\*讨论中的原文(表格|代码) · (你确认的|你提供的|AI\s*建议，未确认|早期版本，已被替换)(?:；你随后的决定优先：([^*\n]+))?\*$/u;
const EN_CAPTION = /^\*(Table|Code) from the discussion · (confirmed by you|provided by you|AI suggestion, not confirmed|earlier version, since replaced)(?:; your later decision takes precedence: ([^*\n]+))?\*$/u;
/** A caption as an earlier version showed it: what the block is, the section, whose it is, and a later decision. */
const SHOWN_CAPTION = /^\*(对照表|命令|数据结构|代码示例|代码|界面草图|规则逻辑|事件清单|目录结构|提示词|计算规则|示例数据|界面文案|流程|对照|清单|Table|Commands|Data structure|Code example|Code|UI sketch|Rules|Event list|File layout|Prompt|Scoring|Sample data|UI copy|Flow|Mapping|List)(?: · ([^*·\n]+))? · (AI\s*建议|AI suggestion|你确认|你提供|confirmed by you|provided by you|早期方案，已被替换|earlier version, since replaced)((?: · (?:以你后来的决定为准：|your later decision holds: )[^*\n]+)?)\*$/u;
/** The block after a caption line: a fence with its language, or a table. */
function blockAfter(lines: string[], at: number): WikiSourceCode | undefined {
  let index = at + 1;
  while (index < lines.length && !lines[index].trim()) index++;
  const first = lines[index] ?? "", fence = first.match(/^\s*(`{3,}|~{3,})\s*([\w+#-]*)/u);
  if (fence) {
    const body: string[] = [];
    for (let line = index + 1; line < lines.length && !lines[line].trimStart().startsWith(fence[1]); line++) body.push(lines[line]);
    return { language: fence[2] ?? "", text: body.join("\n") };
  }
  if (!/^\s*\|/u.test(first)) return undefined;
  const rows: string[] = [];
  for (let line = index; line < lines.length && /^\s*\|/u.test(lines[line]); line++) rows.push(lines[line]);
  return { language: TABLE, text: rows.join("\n") };
}
const OPENING_FENCE = /^[ \t]*(`{3,}|~{3,})[ \t]*([^\n]*)$/u;
/** The writer is shown a block as a summary of it ("code": "text, 2 lines"); the block itself goes under the paragraph
 * citing it. One run copied the summary as a fence of its own, "```text, 2 lines" over nothing, an empty block in the
 * export. A fence with nothing in it goes, and a summary in its info string gives way to the language. */
export function withoutPlaceholderFences(text: string): string {
  if (!/`{3,}|~{3,}/u.test(text)) return text;
  const lines = text.split("\n"), kept: string[] = [];
  for (let at = 0; at < lines.length; at++) {
    const open = lines[at].match(OPENING_FENCE);
    if (!open) { kept.push(lines[at]); continue; }
    const [, fence, info] = open, closing = new RegExp(`^[ \\t]*${fence[0] === "`" ? "`" : "~"}{${fence.length},}[ \\t]*$`, "u");
    let end = at + 1;
    while (end < lines.length && !closing.test(lines[end])) end++;
    // Left open: the rest is the block's, as written.
    if (end >= lines.length) { kept.push(...lines.slice(at)); break; }
    const body = lines.slice(at + 1, end), summary = info.trim().match(/^([\w+#.-]*)\s*,\s*\d+\s+(?:lines?|rows?)$/iu);
    if (!body.some(line => line.trim())) {
      // A blank line on both sides of the removed fence would leave two.
      if (kept.length && !kept[kept.length - 1].trim() && !lines[end + 1]?.trim()) end++;
    } else kept.push(summary ? lines[at].replace(info, summary[1] === "table" ? "" : summary[1]).trimEnd() : lines[at], ...body, lines[end]);
    at = end;
  }
  return kept.join("\n");
}

export function readableSourceCaptions(body: string): string {
  const lines = body.split("\n");
  return lines.map((line, index) => {
    const zh = line.match(ZH_CAPTION), match = zh ?? line.match(EN_CAPTION);
    if (!match) {
      // A chapter edited by hand keeps the caption as it was shown then ("*流程 · 战略方向 · AI 建议*"): shown the same
      // way as the rest, with the section and the AI holder dropped.
      const shown = line.match(SHOWN_CAPTION);
      if (!shown || !blockAfter(lines, index)) return line;
      const [, what, , whose, later] = shown, kept = /^AI(?:\s|$)/u.test(whose ?? "") ? "" : whose;
      return `*${[what, kept].filter(Boolean).join(" · ")}${later ?? ""}*`;
    }
    const [, kind, whose, later] = match, block = blockAfter(lines, index);
    const what = block ? blockKind(block, Boolean(zh)) : zh ? kind === "表格" ? "对照表" : "代码" : kind.toLowerCase();
    const label = zh ? ZH_WHOSE[whose.replace(/^AI\s*/u, "AI ")] : EN_WHOSE[whose];
    // Only what the block is: its section is the heading right above, and a block with no holder is AI's, as the
    // document's legend says of every unmarked line. Who holds it is named only when that is news (you, or replaced).
    const parts = [zh ? what : what[0].toUpperCase() + what.slice(1), /^AI(?:\s|$)/u.test(label) ? "" : label].filter(Boolean);
    return `*${parts.join(" · ")}${later ? zh ? ` · 以你后来的决定为准：${later.trim()}` : ` · your later decision holds: ${later.trim()}` : ""}*`;
  }).join("\n");
}

/** Text UI sketches often align their frame with spaces that are a different
 * width in the reader's CJK fallback font. Show single-column cards with
 * horizontal rules. The original excerpt and any multi-column drawings stay intact. */
export function readableUiSketches(body: string): string {
  if (!/[┌╭]/u.test(body)) return body;
  return body.replace(/^(\*(?:界面草图|UI sketch)(?: · [^*\n]+)?\*\n\n)(`{3,}|~{3,})[ \t]*(?:text|plaintext|plain|txt)?[ \t]*\n([\s\S]*?)^\2[ \t]*$/gmu,
    (block, caption: string, fence: string, sketch: string) => {
      const lines = sketch.trimEnd().split("\n");
      const top = lines.findIndex(line => /^\s*[┌╭][─━]{3,}[┐╮]\s*$/u.test(line));
      const bottom = lines.findIndex((line, index) => index > top && /^\s*[└╰][─━]{3,}[┘╯]\s*$/u.test(line));
      if (top < 0 || bottom <= top + 1) return block;
      const rows = lines.slice(top + 1, bottom);
      if (!rows.every(line => /^\s*[│┃][^│┃┬┴├┤┼┌┐└┘]*[│┃]\s*$/u.test(line))) return block;
      const card = rows.map(line => line.trim().slice(1, -1).trim().replace(/ {4,}/gu, "  "));
      const rule = "────────────────────────────";
      const content = [...lines.slice(0, top), rule, ...card, rule, ...lines.slice(bottom + 1)].join("\n");
      return `${caption}${fence}text\n${content}\n${fence}`;
    });
}

/** What a block is, for its caption: a table, a flow drawn with arrows, a list of names, commands or code. */
function blockKind(code: WikiSourceCode, zh: boolean): string {
  if (code.language === TABLE) return zh ? "对照表" : "table";
  if (/^(?:bash|sh|shell|zsh|powershell|ps1|cmd|console)$/iu.test(code.language)) return zh ? "命令" : "commands";
  const lines = code.text.split("\n").filter(line => line.trim()), han = (line: string) => /\p{Script=Han}/u.test(line);
  if (/^\s*(?:export\s+)?(?:interface|type|class|enum|struct)\s+\w+/mu.test(code.text) || /^\s*CREATE\s+TABLE/imu.test(code.text)) return zh ? "数据结构" : "data structure";
  if (code.language && !/^(?:text|plaintext|plain|txt|markdown|md)$/iu.test(code.language)) return zh ? "代码示例" : "code example";
  // A screen drawn in text: a frame, or buttons in brackets among short lines.
  if (/[┌└╭╰]/u.test(code.text) || lines.some(line => /\[[^\]\n]{1,20}\]/u.test(line)) && lines.length >= 2 && lines.every(line => line.trim().length <= 48)) return zh ? "界面草图" : "UI sketch";
  // Ticks and circles a screen shows ("✓   ✓   ✓   今天" over a week, "○ 21:00 手机移出卧室" in a plan card) draw it: two such
  // blocks read 「清单」, one of them a calendar.
  if ((code.text.match(/[✓✔☑○●☐◯]/gu) ?? []).length >= 2 && lines.every(line => line.trim().length <= 60)) return zh ? "界面草图" : "UI sketch";
  if (lines.filter(line => /^\s*(?:如果|若|当|否则|则|if\b|else\b|when\b|then\b)/iu.test(line)).length >= 2) return zh ? "规则逻辑" : "rules";
  if (numericSourceMapping(code)) return zh ? "规则逻辑" : "rules";
  if (lines.length >= 3 && lines.every(line => /^\s*[a-z][a-z0-9]*(?:[_.:][a-z0-9]+)+\s*,?\s*$/u.test(line))) return zh ? "事件清单" : "event list";
  if (lines.some(line => /^\s*[\w.-]+\/\s*$/u.test(line)) && lines.some(line => /^\s{2,}\S|[├└]──/u.test(line))) return zh ? "目录结构" : "file layout";
  if (code.text.length >= 120 && /^(?:请|你是|帮我|根据|please\b|you are\b|act as\b)/iu.test(lines[0]?.trim() ?? "")) return zh ? "提示词" : "prompt";
  // Figures with nothing worked out (「高危时间 23:00—01:00 ████」, 「运动干预成功率 76%」) are an example of what a report
  // shows, not a rule: one read 「计算规则」 above a user's sample results.
  const worked = lines.filter(line => /[×÷=]|[+-]\s*\d+\s*$/u.test(line)).length;
  if (!worked && lines.filter(line => /\d+\s*%|█/u.test(line)).length >= 2) return zh ? "示例数据" : "sample data";
  if (lines.filter(line => /[×÷]|\d+\s*%|[+-]\s*\d+\s*$/u.test(line)).length >= 2) return zh ? "计算规则" : "scoring";
  // Short lines of interface words with figures ("今日任务 0/1", "第26期 · 7天守护组") are copy for a screen.
  if (lines.length >= 2 && lines.length <= 8 && lines.every(line => han(line) && line.trim().length <= 40) && lines.some(line => /\d/u.test(line)) && !lines.some(line => /[→↓]|->/u.test(line))) return zh ? "界面文案" : "UI copy";
  if (lines.some(line => /^\s*(?:↓|→|->|=>|⬇)\s*$/u.test(line))) return zh ? "流程" : "flow";
  // "10 → int" line by line pairs one thing with another.
  if (lines.filter(line => /\S\s*(?:→|->|=)\s*\S/u.test(line)).length * 2 > lines.length) return zh ? "对照" : "mapping";
  if (lines.filter(line => /[↓→]|->/u.test(line)).length >= 2) return zh ? "流程" : "flow";
  return zh ? "清单" : "list";
}

const LABELLED = /^\s*(?:[-*+]|\d+\.)\s*\*\*[^*\n]{1,24}\*\*/u;
/** The point a block shows: the bold label of the list item it follows, else the subtopic, else the chapter. */
const topicOf = (paragraph: { text: string; subtopic: string }, chapter: string) =>
  (paragraph.text.match(/^\s*(?:[-*+]|\d+\.)\s*\*\*([^*\n]{1,24})\*\*/u)?.[1] ?? paragraph.subtopic ?? chapter).replace(/[：:]\s*$/u, "").trim() || chapter;

/** The share of a block's words another point says, past which the block is that point's. */
const RESTATED = .6;
/** The words of a block or a point: its names (print, voltage, git) and its terms. */
const blockWords = (text: string) => new Set([...(text.toLowerCase().match(/[a-z_][a-z0-9_+#]{1,}/gu) ?? []), ...knowledgeTerms(text)]);
const sharedWords = (words: Set<string>, text: string) => { let shared = 0; for (const word of blockWords(text)) if (words.has(word)) shared++; return shared; };
/** In a learning record, whether a block shows the point it would sit under. A reply's blocks were each read with
 * whichever point the reply gave: the list of Git topics not to learn yet sat under "让 Git 不再成为障碍", a function
 * signature over "..." under "明天先复习". Code sharing no word with its point is not its example; a list sharing at
 * most one word with it, most of whose words another point of the record says, is that point's. The learner's code
 * stays. */
function showsItsPoint(code: WikiSourceCode, owners: WikiKnowledgeUnit[], carriers: WikiKnowledgeUnit[]): boolean {
  if (owners.some(unit => unit.evidence.learnerCode)) return true;
  const words = blockWords(code.text), own = Math.max(0, ...owners.map(unit => sharedWords(words, `${unit.subject} ${unit.statement}`)));
  const program = code.language !== TABLE && !/^(?:text|plaintext|markdown|md|)$/iu.test(code.language);
  if (program && !own) return false;
  if (own > 1 || /^(?:markdown|md)$/iu.test(code.language)) return true;
  // A list another point already says (the Git topics left for later, in the learning map) is that point's; one only
  // touching other points (the control course path, the minimal set for an Issue) still shows its own.
  const elsewhere = Math.max(0, ...carriers.filter(unit => !owners.includes(unit)).map(unit => sharedWords(words, unit.statement)));
  return elsewhere < RESTATED * words.size;
}

/** The share of a sketch's words a later sketch says, past which they draw one screen. */
const SAME_SCREEN = .5;
/** The text pieces a sketch shows, frames and buttons left out: each line cut at wide gaps and bars. Two versions of one
 * screen keep some ("晚上好，卡夫卡", "不导 · 今日守护", "主要诱因：独处、熬夜、短视频") however much else changed: four
 * versions of one home page, sharing too few words, all stood in one record. */
const sketchPieces = (text: string) => new Set(text.split("\n").flatMap(line => line.replace(/[┌┐└┘│─├┤┬┴┼╭╮╰╯━┃]/gu, " ").split(/\s{2,}|[｜|]/u)).map(piece => piece.trim().replace(/\s+/gu, " ")).filter(piece => piece.length >= 4 && !/^\[[^\]]*\]$/u.test(piece) && /\p{L}/u.test(piece)));
const sameScreen = (a: string, b: string) => {
  const pieces = sketchPieces(b);
  if ([...sketchPieces(a)].filter(piece => pieces.has(piece)).length >= 2) return true;
  const words = blockWords(a), theirs = blockWords(b);
  return words.size >= 4 && theirs.size >= 4 && sharedWords(words, b) >= SAME_SCREEN * Math.min(words.size, theirs.size);
};
/** A table row naming at least FIELD_ROW_MIN identifiers, FIELD_ROW_SAID of them the structure's own, lists its fields. */
const FIELD_ROW_MIN = 5, FIELD_ROW_SAID = .7, IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]+/gu;
/** A line naming at least FIELD_ROW_MIN identifiers, FIELD_ROW_SAID of them the structure's own. */
function listsFields(line: string, code: WikiSourceCode): boolean {
  const names = new Set((code.text.match(IDENTIFIER) ?? []).map(name => name.toLowerCase()));
  const own = [...new Set((line.match(IDENTIFIER) ?? []).map(name => name.toLowerCase()))];
  return own.length >= FIELD_ROW_MIN && own.filter(name => names.has(name)).length >= FIELD_ROW_SAID * own.length;
}
/** A table without the rows listing a structure's fields; the head and at least one row stay. */
function withoutFieldRows(text: string, code: WikiSourceCode): string {
  const lines = text.split("\n");
  const fields = (line: string) => listsFields(line, code);
  const kept = lines.filter((line, index) => index < 2 || !/^\s*\|/u.test(line) || !fields(line));
  return kept.length === lines.length || kept.filter(line => /^\s*\|/u.test(line)).length < 3 ? text : kept.join("\n");
}

/** Words a better owner of a block shares with it beyond this one's, and how many times as many. */
const BETTER_BY = 3, BETTER_TIMES = 2;
/** Whether another cited unit carrying the same block shows it far better than this one: shares at least BETTER_BY
 * more of its words, and BETTER_TIMES as many. The block then sits with that point. */
function shownBetterElsewhere(code: WikiSourceCode, owner: WikiKnowledgeUnit, carriers: WikiKnowledgeUnit[], cited: Set<string>): boolean {
  const words = blockWords(code.text), said = (unit: WikiKnowledgeUnit) => sharedWords(words, `${unit.subject} ${unit.facet ?? ""} ${unit.statement}`);
  const own = said(owner);
  return carriers.some(unit => unit.id !== owner.id && cited.has(unit.id) && unit.evidence.code?.language === code.language && unit.evidence.code.text === code.text && said(unit) >= Math.max(own + BETTER_BY, own * BETTER_TIMES));
}

/** A list or flow in text whose words the paragraph it follows says nearly all of. Never code, a table or a drawing. */
function restates(code: WikiSourceCode, paragraph: string): boolean {
  // Keep structured originals even when the summary already lists some rows.
  if (literalSourceRows(code)) return false;
  if (!["清单", "流程", "对照", "界面文案"].includes(blockKind(code, true))) return false;
  const words = blockWords(code.text);
  return words.size >= 3 && sharedWords(blockWords(paragraph), code.text) >= .8 * words.size;
}

/** One short line: a call, a path or an output on its own, which shows nothing without the lesson around it. */
const fragment = (code: WikiSourceCode) => code.language !== TABLE && !code.text.trim().includes("\n") && code.text.trim().length < 40;

/** A condition or a value on its own ("urgeLevel === 'severe'"): no declaration, assignment, call ending a statement or
 * keyword, so it states nothing the sentence beside it does not. "const price = …;" is a rule and stays. */
const loneExpression = (text: string) => !/;\s*$|(?<![=!<>])=(?![=>])|^\s*(?:const|let|var|function|def|class|import|export|return|from|select|create|insert|update|delete)\b/iu.test(text.trim());
const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/u;
const PLAIN_BLOCK = /^(?:text|plaintext|plain|txt|markdown|md)?$/iu;
const TABLE_ROW = /^\s*\|.*\|\s*$/u;
const TABLE_DIVIDER = /^\s*\|(?:\s*:?-{3,}:?\s*\|)+\s*$/u;
const MAPPING_VALUE = /^(?:[<>≤≥=~≈]\s*)?[+-]?\d+(?:\.\d+)?(?:-[+-]?\d+(?:\.\d+)?)?(?:\s*(?:[%°]|[\p{L}]{1,8}))?$/u;

const rowCell = (value: string) => value.trim().replace(/^(\*\*|__|`)(.*?)\1$/u, "$2").normalize("NFKC")
  .trim().replace(/\s+/gu, " ").replace(/(?<=\d)\s*[-~–—至到]\s*(?=[+-]?\d)/gu, "-").replace(/。$/u, "");
const cellsOf = (row: string) => row.trim().slice(1, -1).split(/(?<!\\)\|/u).map(rowCell);
const literalKey = (cells: string[]) => JSON.stringify(cells);

function mappingRow(line: string): string | undefined {
  const parts = line.replace(LIST_ITEM, "").split(/[:：]/u).map(rowCell);
  // A labelled list often repeats the source label around its value.
  if (parts.length === 3 && parts[0] === parts[2]) parts.pop();
  if (parts.length !== 2 || parts.some(part => !part)) return;
  const numeric = parts.map(part => MAPPING_VALUE.test(part));
  return literalKey(numeric[0] && !numeric[1] ? [parts[1], parts[0]] : parts);
}

function literalSourceRows(code: WikiSourceCode): { header?: string; rows: Set<string> } | undefined {
  const lines = code.text.trim().split("\n").filter(line => line.trim());
  if (code.language === TABLE && lines.length >= 3 && lines.every(line => TABLE_ROW.test(line)) && TABLE_DIVIDER.test(lines[1])) {
    return { header: literalKey(cellsOf(lines[0])), rows: new Set(lines.slice(2).map(row => literalKey(cellsOf(row)))) };
  }
  if (!PLAIN_BLOCK.test(code.language) || lines.length < 2) return;
  const rows = lines.map(mappingRow);
  if (rows.every((row): row is string => row !== undefined)) return { rows: new Set(rows) };
}

function numericSourceMapping(code: WikiSourceCode): boolean {
  return PLAIN_BLOCK.test(code.language) && /\d/u.test(code.text) && Boolean(literalSourceRows(code));
}

/** Structured rules whose usable details live in the original, rather than in
 * the unit's summary. Examples, drawings, and general snippets are optional. */
export function isRequiredWikiSourceBlock(unit: WikiKnowledgeUnit): boolean {
  const code = unit.evidence.code;
  if (!code || unit.about || unit.kind === "question" || unit.kind === "history" || code.text.length > MAX_CHARS || readsAsProse(code)
    || /示例|示意|演示|\b(?:example|sample|demo)\b/iu.test(`${unit.subject} ${unit.facet ?? ""} ${unit.evidence.section ?? ""}`)) return false;
  if (code.language === TABLE) {
    const rows = literalSourceRows(code);
    return Boolean(rows && /版本|范围|限制|适用|兼容|阈值|\b(?:version|scope|limits?|compatibility|thresholds?)\b/iu.test(`${code.text.split("\n")[0]} ${unit.subject}`));
  }
  if (numericSourceMapping(code)) return true;
  if (PLAIN_BLOCK.test(code.language) && blockKind(code, false) === "rules" && ["constraint", "decision", "mechanism", "plan"].includes(unit.kind)) return true;
  return /^\s*(?:(?:export\s+)?(?:interface\s+\w+|type\s+\w+\s*=\s*\{|struct\s+\w+)|CREATE\s+TABLE\b)/imu.test(code.text) && code.text.trim().split("\n").length >= 3;
}

/** Literal mappings are proof only for the exact label/value pair. Table rows
 * additionally require the same column headers and order. */
export function sourceBlockSupportsRows(text: string, code: WikiSourceCode, listOnly = false): boolean {
  const source = literalSourceRows(code);
  if (!source) return false;
  const lines = text.trim().split("\n").filter(line => line.trim());
  if (source.header !== undefined) return lines.length >= 3 && lines.every(line => TABLE_ROW.test(line)) && TABLE_DIVIDER.test(lines[1])
    && literalKey(cellsOf(lines[0])) === source.header && lines.slice(2).every(line => source.rows.has(literalKey(cellsOf(line))));
  return lines.length > 0 && lines.every(line => (!listOnly || LIST_ITEM.test(line)) && source.rows.has(mappingRow(line) ?? ""));
}

const flat = (text: string) => rowCell(text).replace(/\*\*/gu, "").replace(/\s+/gu, "");
/** A label saying when or for which version an item holds ("离线时", "V2 上限") scopes it: the block's rows do not. */
const SCOPING_LABEL = /时|当|如果|若|仅|除|之前|之后|以前|以后|期间|模式|版本|阶段|第.版|\b(?:v\d|when|if|only|unless|before|after|during|mode|version|stage|phase)\b/iu;

/** One list item telling again what a block shown in its subtopic shows, line for line: 「- **风险等级**：0～29：低风险；
 * 30～59：需要注意；60～79：高风险」 three rows under the block of four, beside items of its own (基础风险, 计算特征). The
 * item goes when every part of it is a row or line of the block its claims cite, and its label scopes nothing; the
 * list's other items stay. */
function withoutRepeatedItems<T extends Pick<WikiDraftChapter, "body" | "paragraphs">>(chapter: T, unitOf: (id: string) => WikiKnowledgeUnit | undefined) {
  const removed: WikiDraftChapter["paragraphs"] = [];
  const shown = new Map<string, WikiSourceCode>();
  const blocks = wikiDocumentBlocks(chapter.body);
  for (const paragraph of chapter.paragraphs) {
    if (!isSourceCodeParagraph(paragraph.text)) continue;
    for (const id of paragraph.unitIds) {
      const code = unitOf(id)?.evidence.code;
      if (!code || code.language === TABLE || readsAsProse(code)) continue;
      const markdown = wikiSourceBlockMarkdown(code);
      if (paragraph.text.trimEnd().endsWith(markdown) && blocks.some(block => block.kind === "code" && block.text === markdown)) shown.set(JSON.stringify([paragraph.subtopic, id]), code);
    }
  }
  if (!shown.size) return { body: chapter.body, paragraphs: chapter.paragraphs, removed };
  const repeats = (line: string, code: WikiSourceCode) => {
    const item = line.replace(LIST_ITEM, "").trim(), label = item.match(/^\*\*([^*\n]+)\*\*\s*[：:]\s*/u);
    if (label && SCOPING_LABEL.test(label[1])) return false;
    const parts = (label ? item.slice(label[0].length) : item).split(/[；;]/u).map(part => part.trim().replace(/[。.]$/u, "")).filter(Boolean);
    const rows = literalSourceRows(code)?.rows, lines = new Set(code.text.split("\n").map(flat).filter(Boolean));
    return parts.length > 0 && parts.every(part => rows?.has(mappingRow(part) ?? "") || flat(part).length >= 6 && lines.has(flat(part)));
  };
  let body = chapter.body;
  const paragraphs = chapter.paragraphs.flatMap(paragraph => {
    const lines = paragraph.text.split("\n");
    if (isSourceCodeParagraph(paragraph.text) || !lines.some(line => LIST_ITEM.test(line))) return [paragraph];
    const claims = paragraph.claims ?? [];
    const folded = lines.filter(line => {
      if (!LIST_ITEM.test(line)) return false;
      const own = claims.filter(claim => flat(line).includes(flat(claim.text)));
      const codes = own.flatMap(claim => claim.unitIds).map(id => shown.get(JSON.stringify([paragraph.subtopic, id])));
      const first = codes[0];
      return own.length > 0 && first !== undefined && codes.every(code => code?.text === first.text) && repeats(line, first);
    });
    if (!folded.length) return [paragraph];
    // The body may close an item with a full stop the paragraph lacks: its line is found by what it says.
    const bodyLines = body.split("\n");
    for (const line of folded) {
      const at = bodyLines.findIndex(row => LIST_ITEM.test(row) && flat(row.replace(LIST_ITEM, "")) === flat(line.replace(LIST_ITEM, "")));
      if (at >= 0) bodyLines.splice(at, 1);
    }
    body = bodyLines.join("\n").replace(/\n{3,}/gu, "\n\n");
    const gone = claims.filter(claim => folded.some(line => flat(line).includes(flat(claim.text))));
    removed.push({ ...paragraph, text: folded.join("\n"), claims: gone });
    const text = lines.filter(line => !folded.includes(line)).join("\n").trim();
    return text ? [{ ...paragraph, text, claims: claims.filter(claim => !gone.includes(claim)) }] : [];
  });
  return { body, paragraphs, removed };
}

/** Keep a bound, displayed original as the single expansion. Each removed
 * paragraph must be entirely covered by one original in the same subtopic. */
export function withoutSourceBlockRepeats<T extends Pick<WikiDraftChapter, "body" | "paragraphs">>(chapter: T, unitOf: (id: string) => WikiKnowledgeUnit | undefined) {
  const originals = new Map<string, WikiSourceCode>();
  const removed: WikiDraftChapter["paragraphs"] = [];
  for (const paragraph of chapter.paragraphs) {
    if (!isSourceCodeParagraph(paragraph.text) || !chapter.body.includes(paragraph.text)) continue;
    for (const id of paragraph.unitIds) {
      const code = unitOf(id)?.evidence.code;
      if (code && literalSourceRows(code) && paragraph.text.trimEnd().endsWith(wikiSourceBlockMarkdown(code))) originals.set(JSON.stringify([paragraph.subtopic, id]), code);
    }
  }
  const items = withoutRepeatedItems(chapter, unitOf);
  if (!originals.size) return items;
  chapter = { ...chapter, body: items.body, paragraphs: items.paragraphs };
  removed.push(...items.removed);
  const blocks = wikiDocumentBlocks(chapter.body), cuts = new Map<number, number>();
  const paragraphs = chapter.paragraphs.filter(paragraph => {
    if (!paragraph.unitIds.length || isSourceCodeParagraph(paragraph.text)) return true;
    const bindings = [...new Set([...paragraph.unitIds, ...(paragraph.claims ?? []).flatMap(claim => claim.unitIds)])];
    const codes = bindings.map(id => originals.get(JSON.stringify([paragraph.subtopic, id])));
    const first = codes[0];
    if (!first || !codes.every(code => code?.language === first.language && code.text === first.text) || !sourceBlockSupportsRows(paragraph.text, first, true)) return true;
    const original = wikiSourceBlockMarkdown(first);
    if (!blocks.some(block => block.kind === (first.language === TABLE ? "table" : "code") && block.text === original)) return true;
    const block = blocks.find(block => (block.kind === "list" || block.kind === "table") && block.text === paragraph.text.trim() && !cuts.has(block.start));
    if (!block) return true;
    cuts.set(block.start, block.end);
    removed.push(paragraph);
    return false;
  });
  let body = chapter.body;
  for (const [start, end] of [...cuts].sort(([first], [second]) => second - first)) {
    const from = body.slice(Math.max(0, start - 2), start) === "\n\n" ? start - 2 : start;
    body = body.slice(0, from) + body.slice(end);
  }
  return { body, paragraphs, removed };
}

/** Retire only checks whose quoted text belonged to a removed, proven repeat. */
export function sourceBlockResolvedProblems(problems: string[], removed: WikiDraftChapter["paragraphs"], remaining: WikiDraftChapter["paragraphs"]) {
  const has = (paragraphs: WikiDraftChapter["paragraphs"], head: string) => paragraphs.some(paragraph => paragraph.text.startsWith(head)
    || paragraph.claims?.some(claim => claim.text.startsWith(head)));
  return problems.filter(problem => {
    const head = problem.match(/^(?:claim )?"([\s\S]+?)…" (?:states the range |has numbers its units do not state|has no supported source after final formatting|has no claim naming the units it states)/u)?.[1];
    return head && has(removed, head) && !has(remaining, head);
  });
}
/** A learning record's list of points with examples: each item its own paragraph, so each example sits under the point
 * it shows. Placed after the whole list, fifteen blocks followed eleven points and none could be told apart. Only a list
 * whose examples belong to two items or more. */
function splitExampleLists(chapter: WikiDraftChapter, unitOf: (id: string) => WikiKnowledgeUnit | undefined) {
  for (let index = 0; index < chapter.paragraphs.length; index++) {
    const paragraph = chapter.paragraphs[index];
    if (isSourceCodeParagraph(paragraph.text) || !chapter.body.includes(paragraph.text)) continue;
    const lines = paragraph.text.split("\n"), items: string[] = [];
    if (!LIST_ITEM.test(lines[0] ?? "")) continue;
    for (const line of lines) if (LIST_ITEM.test(line) || !items.length) items.push(line); else items[items.length - 1] += `\n${line}`;
    if (items.length < 2) continue;
    const claims = paragraph.claims ?? [], owner = new Map<string, number>();
    claims.forEach(claim => { const at = items.findIndex(item => item.includes(claim.text.trim())); if (at >= 0) for (const id of claim.unitIds) if (!owner.has(id)) owner.set(id, at); });
    // A point no claim names goes to the item sharing most of its words.
    for (const id of paragraph.unitIds) {
      if (owner.has(id)) continue;
      const own = knowledgeTerms(unitOf(id)?.statement ?? "");
      let best = 0, most = 0;
      items.forEach((item, at) => { let shared = 0; for (const term of knowledgeTerms(item)) if (own.has(term)) shared++; if (shared > most) { most = shared; best = at; } });
      owner.set(id, best);
    }
    const showing = new Set(paragraph.unitIds.filter(id => unitOf(id)?.evidence.code).map(id => owner.get(id)));
    if (showing.size < 2) continue;
    const parts = items.map((item, at) => ({ subtopic: paragraph.subtopic, text: item, unitIds: paragraph.unitIds.filter(id => owner.get(id) === at), claims: claims.filter(claim => item.includes(claim.text.trim())) }));
    chapter.body = replaceParagraph(chapter.body, paragraph.text, () => items.join("\n\n"));
    chapter.paragraphs.splice(index, 1, ...parts);
    index += parts.length - 1;
  }
}

/** The block as Markdown: a table as it is, code in a fence one longer than any run of backticks inside it. */
export function wikiSourceBlockMarkdown(code: WikiSourceCode): string {
  if (code.language === TABLE) return code.text;
  const longest = Math.max(2, ...(code.text.match(/`+/gu) ?? []).map(run => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${code.language}\n${code.text}\n${fence}`;
}

export function wikiSourceBlockCaption(code: WikiSourceCode, role: "user" | "assistant", zh: boolean, status?: string): string {
  const table = code.language === TABLE;
  if (zh) return `讨论中的原文${table ? "表格" : "代码"} · ${status === "confirmed" ? "你确认的" : status === "history" ? "早期版本，已被替换" : role === "user" ? "你提供的" : "AI 建议，未确认"}`;
  return `${table ? "Table" : "Code"} from the discussion · ${status === "confirmed" ? "confirmed by you" : status === "history" ? "earlier version, since replaced" : role === "user" ? "provided by you" : "AI suggestion, not confirmed"}`;
}

/** A limit the user set ("only", "excluded", "no", "never", 不/仅/只/禁止/排除): what it limits is the words of its clause. */
const LIMIT = /\b(?:only|exclud\w*|no|never|not|without|drop(?:ped)?)\b|不|仅|只|禁止|排除/iu;
const LIMIT_WORDS = new Set("only excluded exclude excludes explicitly never without dropped drop supports support functionality feature features must should entirely from into with this that pocket ledger version scope".split(" "));
/** The user's decision in the message right after the block's, limiting something a line of the block names: its
 * clause and the line share a word (by its first six letters: "multi-currency" and "currency", "currencies"). */
function limitingAnswer(text: string, units: WikiKnowledgeUnit[], carriers: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined): WikiKnowledgeUnit | undefined {
  const at = Math.max(...units.map(unit => unit.evidence.messageIndex)), conversation = units[0].evidence.conversationId;
  const lines = text.split("\n").slice(2).map(line => new Set(line.toLowerCase().split(/[^a-z0-9]+/u).filter(word => word.length >= 4).map(word => word.slice(0, 6))));
  return carriers.find(unit => {
    if (unit.evidence.role !== "user" || unit.evidence.conversationId !== conversation || unit.evidence.messageIndex !== at + 1 || statusOf(unit.id) !== "confirmed") return false;
    const limited = unit.statement.split(/[;；,，.。]/u).filter(clause => LIMIT.test(clause)).flatMap(clause => clause.toLowerCase().split(/[^a-z0-9]+/u)).filter(word => word.length >= 4 && !LIMIT_WORDS.has(word)).map(word => word.slice(0, 6));
    return limited.length > 0 && lines.some(line => limited.some(stem => line.has(stem)));
  });
}

/** A replaced point that speaks of the block it stands with: the scoring table of directions stood in the message
 * setting the 18-25 age limit, which the user's answer set aside, and was captioned 「早期方案，已被替换」 though the limit
 * says nothing of the scores. */
export const saysOfBlock = (unit: WikiKnowledgeUnit) => { const block = cellTerms(unit.evidence.code?.text ?? ""); return block.size > 0 && [...knowledgeTerms(unit.statement)].filter(term => block.has(term)).length >= Math.min(BLOCK_SAID, block.size); };
const BLOCK_SAID = 3;
/** A block's words cell by cell: read whole, a table's pipes and backticks ran its cells into one word. */
const cellTerms = (text: string) => knowledgeTerms(text.replace(/[|`\n]/gu, " "));
/** Each code block or table the cited units carry, shown once in the whole document, as written, after the first
 * paragraph that cites it, under a line saying whose it is: a file tree, schema or property table retold in prose loses
 * what it shows. After every pass over sentences, which would split, punctuate or drop its lines. */
export function placedSourceCode(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined, statusOf: (id: string) => string | undefined, zh: boolean, carriers: WikiKnowledgeUnit[] = [], learning = false): number {
  const shown = new Set<string>();
  let placed = 0;
  if (learning) for (const chapter of chapters) splitExampleLists(chapter, unitOf);
  const cited = new Set(chapters.flatMap(chapter => chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)));
  /** The line over a block: whose it is, and a later decision of the user's that holds over it. */
  const captionOf = (key: string, code: WikiSourceCode, unitIds: string[], topic = "") => {
    const units = unitIds.flatMap(id => unitOf(id) ?? []);
    // An earlier version, since replaced: the radius scale of 12/16/24px read as a current suggestion beside the
    // confirmed 8px.
    // Every unit carrying the block counts, cited here or not: one run cited the scale only through "a restrained radius
    // scale defined by tokens", while the unit giving its 16px cards and 24px dialogs had been replaced.
    const sharing = carriers.filter(unit => unit.evidence.code && `${unit.evidence.code.language}\n${unit.evidence.code.text}` === key);
    const replaced = unitIds.every(id => statusOf(id) === "history")
      || sharing.some(unit => statusOf(unit.id) === "history" && saysOfBlock(unit)) && ![...sharing.map(unit => unit.id), ...unitIds].some(id => statusOf(id) === "confirmed")
      // A current point speaking of the block keeps it current: the Codex prompt stood under 「交付给Codex时需明确要求组件化、
      // 数据驱动」 and was captioned replaced for an older plan in the same message.
        && !sharing.some(unit => statusOf(unit.id) !== "history" && saysOfBlock(unit));
    const whose = unitIds.every(id => statusOf(id) === "confirmed") ? (zh ? "你确认的" : "confirmed by you")
      : replaced ? (zh ? "早期版本，已被替换" : "earlier version, since replaced")
      : units.every(unit => unit.evidence.role === "user") ? (zh ? "你提供的" : "provided by you")
      : (zh ? "AI 建议，未确认" : "AI suggestion, not confirmed");
    const table = code.language === TABLE;
    // An AI table the user answered right away with a limit on what it names ("consider configurable currency"
    // before "No multi-currency in v1, USD only"): the caption says the decision holds where they differ.
    const answer = !replaced && units.length && units.every(unit => unit.evidence.role === "assistant") ? limitingAnswer(code.text, units, carriers, statusOf) : undefined;
    const overridden = answer ? zh ? `；你随后的决定优先：${answer.statement.trim()}` : `; your later decision takes precedence: ${answer.statement.trim()}` : "";
    // A learner reads examples, not provenance: a short line saying whose it is.
    // In a learning record a caption says what the block is and which point it shows: "AI 给的示例" over fifteen blocks
    // told none of them apart. Whose it is matters only when it is the learner's own or replaced; unmarked is the AI's.
    if (learning) {
      const mine = units.length > 0 && units.every(unit => unit.evidence.role === "user" && !unit.evidence.pasted);
      const kind = blockKind(code, zh), at = topic.trim();
      const what = at ? zh ? `「${at}」的${kind}` : `${kind[0].toUpperCase()}${kind.slice(1)} for “${at}”` : zh ? kind : kind[0].toUpperCase() + kind.slice(1);
      const whoseNote = mine ? zh ? "（你写的）" : " (yours)" : replaced ? zh ? "（早期写法，已被替换）" : " (earlier version, since replaced)" : "";
      return `${what}${whoseNote}${overridden}`;
    }
    return zh ? `讨论中的原文${table ? "表格" : "代码"} · ${whose}${overridden}` : `${table ? "Table" : "Code"} from the discussion · ${whose}${overridden}`;
  };
  // A screen drawn again later in the discussion shows only its last version: one record repeated the 首页 mockup three
  // times, each a little different, the first one a scheme the user had since dropped. Two sketches are one screen when
  // most of the smaller one's words are the larger one's.
  const sketches = new Map<string, WikiKnowledgeUnit>();
  if (!learning) for (const chapter of chapters) for (const paragraph of chapter.paragraphs) for (const id of paragraph.unitIds) {
    const unit = unitOf(id), code = unit?.evidence.code;
    if (!unit || !code || blockKind(code, true) !== "界面草图") continue;
    const key = `${code.language}\n${code.text}`, known = sketches.get(key);
    if (!known || wikiSaidLater(unit, known)) sketches.set(key, unit);
  }
  const outdated = new Set<string>();
  for (const [key, unit] of sketches) {
    for (const [other, later] of sketches) {
      if (other === key || !wikiSaidLater(later, unit)) continue;
      if (sameScreen(unit.evidence.code!.text, later.evidence.code!.text)) { outdated.add(key); break; }
    }
  }
  // A block the writer copied into the text as it stands gets the same line: one run copied the AI's milestone table
  // naming "configurable currency" without it, and the table read as the plan beside the USD-only decision.
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (isSourceCodeParagraph(paragraph.text) || !/^\s*\|/u.test(paragraph.text)) continue;
    const own = paragraph.text.trim();
    const sharing = carriers.filter(unit => unit.evidence.code?.language === TABLE && unit.evidence.code.text.trim() === own);
    if (!sharing.length || !chapter.body.includes(paragraph.text)) continue;
    const code = sharing[0].evidence.code!, key = `${code.language}\n${code.text}`;
    if (shown.has(key)) continue;
    shown.add(key);
    const text = `*${captionOf(key, code, sharing.map(unit => unit.id), topicOf(paragraph, chapter.title))}*\n\n${paragraph.text}`;
    chapter.body = replaceParagraph(chapter.body, paragraph.text, () => text);
    paragraph.text = text;
    placed++;
  }
  for (const chapter of chapters) {
    for (let index = 0; index < chapter.paragraphs.length; index++) {
      const paragraph = chapter.paragraphs[index];
      if (isSourceCodeParagraph(paragraph.text) || !chapter.body.includes(paragraph.text)) continue;
      const blocks = new Map<string, { code: WikiSourceCode; unitIds: string[] }>();
      for (const id of paragraph.unitIds) {
        const code = unitOf(id)?.evidence.code;
        // Saved before replies were told from code: shown, the whole answer read as a block of source. In a learning
        // record a line too short to show anything ("print(scores)", "tests/", "Normal") is a fragment, not an example.
        // In a project record a lone expression ("urgeLevel === 'severe'") shows nothing either; a one-line command stays.
        if (!code || readsAsProse(code) || learning && (fragment(code) || !showsItsPoint(code, [unitOf(id)!], carriers)) || !learning && fragment(code) && blockKind(code, true) === "代码示例" && loneExpression(code.text)) continue;
        const key = `${code.language}\n${code.text}`;
        // Shown already, or written into the text by the writer itself.
        if (shown.has(key) || outdated.has(key) || chapters.some(other => other.body.includes(code.text))) continue;
        // A plain list the paragraph above already says, item for item, shows nothing new.
        if (!learning && restates(code, paragraph.text)) continue;
        // A block another cited point of its message shows far better is that point's: a quote running through the
        // reply put its direction-scoring table under "目标用户定位为18-25岁……而非青少年", in 隐私与安全合规.
        if (!learning && shownBetterElsewhere(code, unitOf(id)!, carriers, cited)) continue;
        blocks.set(key, { code, unitIds: [...blocks.get(key)?.unitIds ?? [], id] });
      }
      let after = paragraph.text;
      for (const [key, block] of blocks) {
        shown.add(key);
        const table = block.code.language === TABLE;
        // In a learning record, a block under a sentence (not a labelled list item) is named for its own point: a dozen
        // blocks under one subtopic were all "「路线与节奏」的清单".
        const point = learning && !LABELLED.test(paragraph.text) ? unitOf(block.unitIds[0])?.subject.trim() : undefined;
        const text = `*${captionOf(key, block.code, block.unitIds, point || topicOf(paragraph, chapter.title))}*\n\n${wikiSourceBlockMarkdown(block.code)}`;
        chapter.paragraphs.splice(index + 1, 0, { subtopic: paragraph.subtopic, text, unitIds: block.unitIds, claims: [] });
        // A row the writer made of a structure's fields ("| 数据结构 | 包含id、userId、source……")
        // says again what the structure shows, worse: the row goes.
        if (!table && /^(?:数据结构|代码示例)$/u.test(blockKind(block.code, true))) for (const other of chapter.paragraphs) {
          if (other === chapter.paragraphs[index + 1] || isSourceCodeParagraph(other.text) || !/^\s*\|/u.test(other.text)) continue;
          const kept = withoutFieldRows(other.text, block.code);
          if (kept === other.text || !chapter.body.includes(other.text)) continue;
          if (other.text === after) after = kept;
          chapter.body = replaceParagraph(chapter.body, other.text, () => kept);
          other.text = kept;
        }
        const previous = after;
        chapter.body = replaceParagraph(chapter.body, previous, () => `${previous}\n\n${text}`);
        after = text;
        index++;
        placed++;
      }
      // A sentence only naming a structure's fields ("数据结构包含id、userId、source(5种来源)、startedAt/completedAt……"),
      // right above the interface giving them all: the structure says it, and the sentence goes.
      const fieldsOnly = !/\n/u.test(paragraph.text.trim()) && !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|\*)/u.test(paragraph.text)
        && [...blocks.values()].some(block => block.code.language !== TABLE && /^(?:数据结构|代码示例)$/u.test(blockKind(block.code, true)) && listsFields(paragraph.text, block.code));
      const at = chapter.paragraphs.indexOf(paragraph);
      if (fieldsOnly && at >= 0 && chapter.body.includes(paragraph.text)) {
        chapter.body = removeParagraph(chapter.body, paragraph.text);
        chapter.paragraphs.splice(at, 1);
        index--;
      }
    }
  }
  return placed;
}

const REPLACED_WHOSE = /早期版本，已被替换|早期方案，已被替换|earlier version, since replaced/u;
/** A block captioned as replaced in a draft written when any replaced point carrying it made it so: the caption tells
 * who holds it now, when no replaced point carrying it speaks of it. */
export function currentCaptions(text: string, units: WikiKnowledgeUnit[], statusOf: (id: string) => string | undefined): string {
  if (!REPLACED_WHOSE.test(text)) return text;
  const lines = text.split("\n");
  return lines.map((line, index) => {
    if (!/^\*[^*\n]+\*$/u.test(line.trim()) || !REPLACED_WHOSE.test(line) || !(ZH_CAPTION.test(line) || EN_CAPTION.test(line) || SHOWN_CAPTION.test(line))) return line;
    const block = blockAfter(lines, index);
    if (!block) return line;
    const said = cellTerms(block.text);
    if (!said.size) return line;
    const carriers = units.filter(unit => unit.evidence.code && (() => { const own = cellTerms(unit.evidence.code!.text); return [...said].filter(term => own.has(term)).length / said.size >= BLOCK_CARRIED; })());
    if (!carriers.length || carriers.every(unit => statusOf(unit.id) === "history") || carriers.some(unit => statusOf(unit.id) === "history" && saysOfBlock(unit)) && !carriers.some(unit => statusOf(unit.id) !== "history" && saysOfBlock(unit))) return line;
    const mine = carriers.every(unit => unit.evidence.role === "user"), confirmed = carriers.some(unit => statusOf(unit.id) === "confirmed");
    const zh = !/earlier version/u.test(line), shown = SHOWN_CAPTION.test(line);
    const whose = confirmed ? zh ? shown ? "你确认" : "你确认的" : "confirmed by you" : mine ? zh ? shown ? "你提供" : "你提供的" : "provided by you" : zh ? shown ? "AI 建议" : "AI 建议，未确认" : shown ? "AI suggestion" : "AI suggestion, not confirmed";
    return line.replace(REPLACED_WHOSE, whose);
  }).join("\n");
}
const BLOCK_CARRIED = .8;
