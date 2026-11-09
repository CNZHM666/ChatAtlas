import type { WikiDraftChapter, WikiKnowledgeUnit } from "./wiki-knowledge";
import { replaceParagraph } from "./wiki-body-text";
import { knowledgeTerms } from "./knowledge-subject";

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

/** What a block is, for its caption: a table, a flow drawn with arrows, a list of names, commands or code. */
function blockKind(code: WikiSourceCode, zh: boolean): string {
  if (code.language === TABLE) return zh ? "对照表" : "table";
  if (/^(?:bash|sh|shell|zsh|powershell|ps1|cmd|console)$/iu.test(code.language)) return zh ? "命令" : "commands";
  if (code.language && code.language !== "text" && code.language !== "plaintext") return zh ? "代码示例" : "code example";
  const lines = code.text.split("\n").filter(line => line.trim());
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

/** One short line: a call, a path or an output on its own, which shows nothing without the lesson around it. */
const fragment = (code: WikiSourceCode) => code.language !== TABLE && !code.text.trim().includes("\n") && code.text.trim().length < 40;

const LIST_ITEM = /^\s*(?:[-*+]|\d+\.)\s/u;
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
function fenced(code: WikiSourceCode): string {
  if (code.language === TABLE) return code.text;
  const longest = Math.max(2, ...(code.text.match(/`+/gu) ?? []).map(run => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${code.language}\n${code.text}\n${fence}`;
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

/** Each code block or table the cited units carry, shown once in the whole document, as written, after the first
 * paragraph that cites it, under a line saying whose it is: a file tree, schema or property table retold in prose loses
 * what it shows. After every pass over sentences, which would split, punctuate or drop its lines. */
export function placedSourceCode(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined, statusOf: (id: string) => string | undefined, zh: boolean, carriers: WikiKnowledgeUnit[] = [], learning = false): number {
  const shown = new Set<string>();
  let placed = 0;
  if (learning) for (const chapter of chapters) splitExampleLists(chapter, unitOf);
  /** The line over a block: whose it is, and a later decision of the user's that holds over it. */
  const captionOf = (key: string, code: WikiSourceCode, unitIds: string[], topic = "") => {
    const units = unitIds.flatMap(id => unitOf(id) ?? []);
    // An earlier version, since replaced: the radius scale of 12/16/24px read as a current suggestion beside the
    // confirmed 8px.
    // Every unit carrying the block counts, cited here or not: one run cited the scale only through "a restrained radius
    // scale defined by tokens", while the unit giving its 16px cards and 24px dialogs had been replaced.
    const sharing = carriers.filter(unit => unit.evidence.code && `${unit.evidence.code.language}\n${unit.evidence.code.text}` === key);
    const replaced = unitIds.every(id => statusOf(id) === "history")
      || sharing.some(unit => statusOf(unit.id) === "history") && ![...sharing.map(unit => unit.id), ...unitIds].some(id => statusOf(id) === "confirmed");
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
        if (!code || readsAsProse(code) || learning && (fragment(code) || !showsItsPoint(code, [unitOf(id)!], carriers))) continue;
        const key = `${code.language}\n${code.text}`;
        // Shown already, or written into the text by the writer itself.
        if (shown.has(key) || chapters.some(other => other.body.includes(code.text))) continue;
        blocks.set(key, { code, unitIds: [...blocks.get(key)?.unitIds ?? [], id] });
      }
      let after = paragraph.text;
      for (const [key, block] of blocks) {
        shown.add(key);
        const table = block.code.language === TABLE;
        // In a learning record, a block under a sentence (not a labelled list item) is named for its own point: a dozen
        // blocks under one subtopic were all "「路线与节奏」的清单".
        const point = learning && !LABELLED.test(paragraph.text) ? unitOf(block.unitIds[0])?.subject.trim() : undefined;
        const text = `*${captionOf(key, block.code, block.unitIds, point || topicOf(paragraph, chapter.title))}*\n\n${fenced(block.code)}`;
        chapter.paragraphs.splice(index + 1, 0, { subtopic: paragraph.subtopic, text, unitIds: block.unitIds, claims: [] });
        // A table the writer made of this block's units alone tells the same rows again, fewer and in its words ("| Budget
        // Type | Characteristics |" above the source's comparison): the source's stands.
        if (table) for (let at = chapter.paragraphs.length - 1; at >= 0; at--) {
          const other = chapter.paragraphs[at];
          if (at === index || at === index + 1 || !/^\s*\|/u.test(other.text) || !other.unitIds.length || !other.unitIds.every(id => { const own = unitOf(id)?.evidence.code; return own?.language === block.code.language && own.text === block.code.text; })) continue;
          chapter.body = chapter.body.includes(`\n\n${other.text}`) ? chapter.body.replace(`\n\n${other.text}`, () => "") : replaceParagraph(chapter.body, other.text, () => "");
          chapter.paragraphs.splice(at, 1);
          if (at < index) index--;
        }
        const previous = after;
        chapter.body = replaceParagraph(chapter.body, previous, () => `${previous}\n\n${text}`);
        after = text;
        index++;
        placed++;
      }
    }
  }
  return placed;
}
