import type { WikiKnowledgeUnit } from "./wiki-knowledge";
import { wikiSaidInQuote } from "./wiki-said-in-quote";

/** A value a reader may take for a spec: a size, a duration, a share or a colour. */
const FIGURE = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b|\d+(?:\.\d+)?\s*(?:px|ms|%|rem|em|pt)\b/giu;
const MIN_OTHER_LINES = 3, MAX_NAMED = 4;

/** A subtopic giving many values of which only a few are the user's: a line under its heading names those, so the rest
 * read as what they are. "Only the 48px top bar and 8px global radius are confirmed. All other numbers remain draft."
 * was the clearest line of a summary another AI wrote; the Wiki marked each value and left the reader to add them up. */
export function decidedValuesNotes(body: string, holders: Array<{ text: string; holder: string }>, zh: boolean): string {
  const decided = holders.filter(mark => mark.holder === "decided").map(mark => mark.text.trim()).filter(Boolean);
  if (!decided.length) return body;
  const blocks = body.split(/(?=^### )/mu);
  return blocks.map(block => {
    if (!block.startsWith("### ")) return block;
    const own = decided.filter(text => block.includes(text));
    const figures = [...new Set(own.flatMap(text => text.match(FIGURE) ?? []).map(figure => figure.replace(/\s+/gu, "")))];
    if (!figures.length) return block;
    // A code block shown as written is the source's, not a suggested value: its lines are not counted.
    const prose = block.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[ \t]*$/gmu, "");
    const lines = prose.split("\n").slice(1).filter(line => line.trim() && !line.startsWith(">"));
    const others = lines.filter(line => (line.match(FIGURE) ?? []).some(figure => !figures.includes(figure.replace(/\s+/gu, ""))) && !own.some(text => line.includes(text)));
    if (others.length < MIN_OTHER_LINES) return block;
    const named = figures.slice(0, MAX_NAMED);
    const note = zh
      ? `> 本节只有 ${named.join("、")} 是你确认的取值，其余数值是建议。`
      : `> Only ${named.join(", ")} here ${named.length > 1 ? "are" : "is"} your decision${named.length > 1 ? "s" : ""}; the other values are suggestions.`;
    const end = block.indexOf("\n");
    return `${block.slice(0, end)}\n\n${note}${block.slice(end)}`;
  }).join("");
}

/** Words telling a point is not decided yet: "remains undecided", "leave it open", 还没决定. */
export { UNDECIDED } from "./open-words";

/** Not working yet, in a report: "CSV export doesn't work yet", 还没做完. */
const NOT_YET = /\b(?:not (?:yet )?(?:work|working|built|done|implemented|finished|ready)|doesn't work|does not work|isn't working|is broken|missing|unfinished|incomplete)\b|\byet\b|未完成|还没|尚未|不能用|没有实现|失败/iu;

/** Built, in a report: "are built", 已完成. */
const BUILT = /\b(?:built|implemented|done|finished|working|works|shipped)\b|已完成|已实现|做好了|可以用/iu;
const NOT_YET_ALL = new RegExp(NOT_YET.source, "giu");
export type ReportedStatus = "built" | "partial" | "not_yet" | "measured";
/** A measure, not a piece of work: "小程序目前每天稳定在22人" read 已完成 in the status table. */
const MEASURE = /日活|DAU|MAU|留存|活跃|用户数|付费率|转化率|收入|流水|\d+\s*(?:人|个用户|名用户|位用户)|\b(?:daily active|users|retention|revenue|conversion)\b/iu;
/** A measure of the project's own state: a fact or report giving a number of users, a retention or a revenue
 * ("日活约30人（近期降至22人）"). Said on different days, two of them are a series, not a conflict to settle. */
export const wikiMeasure = (unit: Pick<WikiKnowledgeUnit, "kind" | "statement">) => ["fact", "report", "history"].includes(unit.kind) && /\d/u.test(unit.statement) && MEASURE.test(unit.statement);
/** When a point was said: the day of its conversation, or the days it ran over ("6月14日—7月7日"). */
export function wikiSaidWhen(unit: WikiKnowledgeUnit, zh: boolean): string {
  const span = unit.evidence.conversationSpan;
  if (!span?.start) return "";
  const day = (at: number) => { const date = new Date(at); return zh ? `${date.getMonth() + 1}月${date.getDate()}日` : date.toLocaleDateString("en", { month: "short", day: "numeric" }); };
  const from = day(span.start), to = span.end ? day(span.end) : from;
  return from === to ? from : zh ? `${from}—${to}` : `${from}–${to}`;
}
/** What the user reported of this project's own state, as rows of a status table: each report once, built, partly
 * built or not yet. */
export function reportedStatusRows(units: WikiKnowledgeUnit[], cited: Set<string>, zh = true): Array<{ text: string; done: boolean; status: ReportedStatus; when?: string; at?: number }> {
  const seen = new Set<string>();
  // The user's figures, whatever kind the reading gave them: 「日活有32，累计用户1100」 and 「DAU 约40，活跃留存略高于40%」
  // were facts, and the table showed only the one report of 22 users, weeks older than the last figure. Oldest first.
  const at = (unit: WikiKnowledgeUnit) => unit.evidence.conversationSpan?.start ?? 0;
  const own = units.filter(unit => cited.has(unit.id) && unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about && (unit.kind === "report" || unit.kind === "fact" && wikiMeasure(unit)));
  // Figures go in the order they were said, in the places figures held; other reports keep theirs.
  const figures = own.filter(wikiMeasure).map((unit, index) => ({ unit, index })).sort((a, b) => at(a.unit) - at(b.unit) || a.index - b.index).map(item => item.unit);
  let next = 0;
  const rows = own.map(unit => wikiMeasure(unit) ? figures[next++] : unit).filter(unit =>
    // Said in the message it stands under: "Three core features are implemented, CSV export is unfinished, …", placed
    // under "Give me a roadmap with 4 milestones …", is the AI's summary, listed beside the two reports it repeats.
    wikiSaidInQuote(unit)).flatMap((unit): Array<{ text: string; done: boolean; status: ReportedStatus; when?: string; at?: number }> => {
    // 「用户反馈日活停留在32人左右」: the row is the user's own; who said it is the table's title.
    const text = unit.statement.trim().replace(/^用户(?:反馈|提到|报告|表示|称)称?/u, ""), key = text.toLowerCase().replace(/\W+/gu, "");
    if (seen.has(key)) return [];
    seen.add(key);
    // "Three core features are implemented, CSV export is unfinished": built and not, one row read Built for both.
    const notYet = NOT_YET.test(text), built = BUILT.test(text.replace(NOT_YET_ALL, " "));
    // A measure is data as of when it was said, never work done.
    if (!built && !notYet && MEASURE.test(text)) { const when = wikiSaidWhen(unit, zh); return [{ text: when ? text.replace(/^(?:当前|目前|现在)(?=\S{4})/u, "") : text, done: false, status: "measured" as const, ...(when ? { when } : {}), ...(at(unit) ? { at: at(unit) } : {}) }]; }
    if (unit.kind !== "report") return [];
    const status: ReportedStatus = !notYet ? "built" : built ? "partial" : "not_yet";
    return [{ text, done: status === "built", status }];
  });
  return rows.filter((row, index) => row.status !== "measured" || !rows.some((other, at) => at !== index && other.status === "measured"
    && other.when === row.when && figuresGivenBy(row.text, other.text) && (!figuresGivenBy(other.text, row.text) || at < index)));
}

/** Each figure of a report with the word it measures: 「留存率仅为26.92%」 gives 26.92% for 留存. */
function labelledFigures(text: string): Array<{ figure: string; label: string; before: string }> {
  return [...text.matchAll(/\d+(?:\.\d+)?%?/gu)].map(match => {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 8), match.index);
    const words = before.replace(/[^\p{Script=Han}]+$/u, "").replace(/(?:仅为|约为|达到|只有|仅有|已经|大约|大概|将近|不到|超过|仅|只|约|为|是|达|在|有|了|已|近)+$/u, "").match(/\p{Script=Han}+$/u)?.[0] ?? "";
    return { figure: match[0], label: words.slice(-2), before };
  });
}
/** Another report of the same day says every figure of this one, each after the same word: 「留存率仅为26.92%，新增用户留存为
 * 19%。」 under 「小程序日活约22-30人，整体留存率26.92%，新增用户次日留存率19%。」 was one report listed twice. 「累计用户32」 is no
 * part of 「日活32人」: the word before the figure differs. */
function figuresGivenBy(text: string, other: string): boolean {
  const own = labelledFigures(text), theirs = labelledFigures(other);
  return own.length > 0 && own.every(item => item.label.length === 2 && theirs.some(their => their.figure === item.figure && their.before.includes(item.label)));
}
