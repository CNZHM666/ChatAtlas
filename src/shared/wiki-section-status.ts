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
export type ReportedStatus = "built" | "partial" | "not_yet";
/** What the user reported of this project's own state, as rows of a status table: each report once, built, partly
 * built or not yet. */
export function reportedStatusRows(units: WikiKnowledgeUnit[], cited: Set<string>): Array<{ text: string; done: boolean; status: ReportedStatus }> {
  const seen = new Set<string>();
  return units.filter(unit => cited.has(unit.id) && unit.kind === "report" && unit.evidence.role === "user" && !unit.about
    // Said in the message it stands under: "Three core features are implemented, CSV export is unfinished, …", placed
    // under "Give me a roadmap with 4 milestones …", is the AI's summary, listed beside the two reports it repeats.
    && wikiSaidInQuote(unit)).flatMap(unit => {
    const text = unit.statement.trim(), key = text.toLowerCase().replace(/\W+/gu, "");
    if (seen.has(key)) return [];
    seen.add(key);
    // "Three core features are implemented, CSV export is unfinished": built and not, one row read Built for both.
    const notYet = NOT_YET.test(text), built = BUILT.test(text.replace(NOT_YET_ALL, " "));
    const status: ReportedStatus = !notYet ? "built" : built ? "partial" : "not_yet";
    return [{ text, done: status === "built", status }];
  });
}
