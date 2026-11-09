import type { WikiUnitStatus } from "./wiki-knowledge";
import { wikiQuoteRange } from "./wiki-claims";

/** Who holds a sentence of the document and how settled it is: the user's decision, a point still open, an earlier
 * version since replaced, the user's own view or report, material the user pasted, or the assistant. Status has one
 * expression, a short mark at the end of a run of text: the prose never says it. The assistant's text, most of a
 * document, carries no mark; a mark is text, so copying and export keep it. */
export type WikiHolder = "decided" | "open" | "earlier" | "user" | "material" | "ai" | "corrected";

/** The holder of a sentence from the statuses of the units it states: decided only when every one is the user's
 * decision; the weakest holder otherwise, so a mixed sentence is never shown as more settled than its sources. */
export function wikiHolderOf(statuses: WikiUnitStatus[]): WikiHolder | undefined {
  if (!statuses.length) return undefined;
  if (statuses.every(status => status === "confirmed")) return "decided";
  // A replaced or unsettled point retains that status, whoever proposed it.
  if (statuses.some(status => status === "history")) return "earlier";
  if (statuses.some(status => status === "open" || status === "contested")) return "open";
  if (statuses.some(status => status === "proposal" || status === "analysis")) return "ai";
  if (statuses.some(status => status === "relayed")) return "material";
  return "user";
}

const LABELS: Record<WikiHolder, [string, string]> = { decided: ["已定", "Decided"], open: ["未定", "Open"], earlier: ["此前", "Earlier"], user: ["你", "You"], material: ["资料", "Material"], ai: ["建议／分析", "Suggestion / analysis"], corrected: ["已纠正", "Corrected"] };
const TITLES: Record<WikiHolder, [string, string]> = {
  decided: ["你确认的决定", "Your confirmed decision"],
  open: ["仍在讨论，尚未决定", "Still open, not decided"],
  earlier: ["此前的方案，已被后来的取代", "An earlier version, since replaced"],
  user: ["你的看法或报告", "Your own view or report"],
  material: ["你提供的资料，未见你确认", "Material you provided, not confirmed by you"],
  ai: ["AI 的建议或分析，所选来源未见采纳记录", "AI suggestion or analysis; no adoption record in selected sources"],
  corrected: ["学习中出过的错，附改法", "A mistake made while learning, with its fix"],
};
/** The marks of a learning record: the user's own work, mistakes with their fix, and earlier versions. */
export const LEARNING_HOLDERS: WikiHolder[] = ["user", "corrected", "earlier"];
export const wikiHolderLabel = (holder: WikiHolder, zh: boolean) => LABELS[holder][zh ? 0 : 1];
/** Pasted material changes how a sentence is read when it states a choice or a rule ("决定", "必须", "只做") or what
 * the code does now ("已安装", "正在建设", "尚未接入"), or asks for something ("External feedback suggests supporting
 * multiple currencies from day one."): then it must not pass for the assistant's suggestion or the user's own. A
 * description from it reads like the rest. */
const MATERIAL_MATTERS = /决定|确定|确认|采用|必须|不得|禁止|严禁|只(?:做|支持|保留|用)|仅|不再|取消|已(?:经)?(?:实现|安装|接入|完成|上线|支持|使用)|正在(?:建设|开发|实现|接入|迁移)|尚未(?:实现|接入|完成|支持)|(?:当前|现有|目前)的?(?:代码|实现|仓库|版本)|代码(?:中|里)|应(?:该|当)?支持|\b(?:decid|must|only|never|implemented|installed|currently|should|suggests?)/iu;
/** The holder a sentence is shown with: material stating no choice or rule is shown as the default. */
export const wikiShownHolder = (holder: WikiHolder, text: string): WikiHolder => holder === "material" && !MATERIAL_MATTERS.test(text) ? "ai" : holder;
/** The default holder carries no mark: unmarked text is the assistant's suggestion or analysis. */
export const wikiUnmarkedHolder = (holder: WikiHolder) => holder === "ai";
export const wikiHolderTitle = (holder: WikiHolder, zh: boolean) => TITLES[holder][zh ? 0 : 1];
/** In a learning record the user's mark is their own work: code, answers, what they reported. */
export const learningTitle = (holder: WikiHolder, zh: boolean, learning: boolean) => learning && holder === "user" ? zh ? "你写的代码、回答或报告" : "Your own code, answer or report" : wikiHolderTitle(holder, zh);

/** The legend an exported document opens with when it carries holder marks. */
export function wikiHolderLegend(zh: boolean, learning = false): string {
  const holders: WikiHolder[] = learning ? LEARNING_HOLDERS : ["decided", "open", "earlier", "user", "material"];
  const unmarked = learning ? zh ? "没有标记的是 AI 的讲解。" : "unmarked text is the AI's explanation." : zh ? "没有标记的是 AI 的建议或分析。" : "unmarked text is the AI's suggestion or analysis.";
  return zh ? `句末标记说明：${holders.map(holder => `〔${wikiHolderLabel(holder, true)}〕${learningTitle(holder, true, learning)}`).join("；")}；${unmarked}`
    : `Sentence marks: ${holders.map(holder => `[${wikiHolderLabel(holder, false)}] ${learningTitle(holder, false, learning).toLocaleLowerCase()}`).join("; ")}; ${unmarked}`;
}

const SENTENCE_END = /[。！？!?；;]/u;
/** The clause of an earlier point telling what came after it: "；后续确认……", ", later changed to …". */
const LATER_SETTLED = /[，,；;]\s*(?:后续|后来|随后|最终|之后|最后)(?:又|已)?(?:确认|确定|决定|改为|定为|改用|采用)|[,;]\s*(?:later|then|eventually|finally)\s+(?:confirmed|decided|changed|replaced|switched)\b/iu;
/** Marks inserted as text after the sentences that end each holder run: for an exported document, which has no
 * buttons. A sentence not found in the text gets no mark; nothing is invented. */
/** A mark may name the conversations its claim comes from ("〔已定 · C2〕"), in a document of several. */
/** Whether a position falls inside a fenced code block: a fence opens on a line of three or more backticks or tildes
 * and closes on a line of the same mark at least as long. */
function insideFence(text: string, offset: number): boolean {
  let open: string | undefined, at = 0;
  for (const line of text.split("\n")) {
    if (at > offset) break;
    const fence = line.match(/^[ \t]*(`{3,}|~{3,})/u)?.[1];
    if (fence && (!open || fence[0] === open[0] && fence.length >= open.length && !line.trim().slice(fence.length).trim())) open = open ? undefined : fence;
    at += line.length + 1;
  }
  return open !== undefined;
}

export function withHolderMarks(text: string, marks: Array<{ text: string; holder: WikiHolder; source?: string }>, zh: boolean): string {
  const at: Array<{ offset: number; mark: string }> = [];
  let from = 0;
  for (const item of marks) {
    const holder = wikiShownHolder(item.holder, item.text);
    if (wikiUnmarkedHolder(holder)) continue;
    // An earlier point ending on what replaced it ("……两个备选方案均保留；后续确认 Popup 宽度为 380px……") is marked before
    // that clause: marked at the end, 〔此前〕 read as setting the current decision aside too.
    const later = holder === "earlier" ? item.text.trim().search(LATER_SETTLED) : -1;
    const claim = later > 0 ? item.text.trim().slice(0, later) : item.text.trim();
    let range = wikiQuoteRange(text.slice(from), claim);
    if (!range) continue;
    // A claim said again inside another sentence before its own place ("……且严格禁止改变……两个核心原则" in the opening, then
    // the bullet "**核心原则**：禁止改变……"): the mark goes where the claim starts a sentence, line or label, if it does.
    // An English full stop ends a sentence too: without it, "… for both desktop and mobile. Standard UI components use a
    // global corner radius of 8px." in an opening was passed over, its mark went to the list item saying it again, and the
    // 48px item before that one lost its own.
    const starts = (at: number) => at === 0 || /(?:[\n。！？!?；;：:]\s*|\.\s+)(?:\*\*)?$|^\s*(?:[-*+]|\d+\.)\s*$|\*\*$/u.test(text.slice(Math.max(0, at - 12), at));
    for (let next = range; !starts(from + range.start);) {
      const after = from + next.end, again = wikiQuoteRange(text.slice(after), claim);
      if (!again) break;
      next = { start: after - from + again.start, end: after - from + again.end };
      if (starts(from + next.start)) { range = next; break; }
    }
    // The sentence end is looked for on the claim's own line: a list row with no full stop ("- Dark / #0F0F10 / ……") put
    // its 〔此前〕 after the next paragraph's first sentence.
    const end = from + range.end, line = text.slice(end - 1).split("\n")[0], stop = line.search(SENTENCE_END);
    // A claim ending on a clause ("……三项功能介绍" before "，并认可……") is marked there: the rest of the sentence holds
    // otherwise, and a mark at the sentence end would claim it too.
    // Its emphasis closed first: "**Local data persistence uses IndexedDB via Dexie**; localStorage …" is marked after
    // the bold, not after "; " inside the next clause.
    const clauseEnd = text.slice(end).match(/^(?:\*\*)?(?=[，,；;])/u);
    // A claim ending on its own full stop ends there: read from that stop, the sentence end was looked for in the next
    // sentence, and "… remains explicitly undecided. Monthly budgets are simpler …; [Open]" marked the wrong one.
    const closed = /[.!?。！？](?:\*\*)?$/u.test(text.slice(from + range.start, end));
    let offset = clauseEnd ? end + clauseEnd[0].length : closed ? end : stop < 0 ? end : end - 1 + stop + 1;
    // A sentence closed inside emphasis keeps its closing marks before the label; the "**" opening the next
    // sentence's emphasis is not one of them (the mark then landed inside that sentence's bold).
    if ((text.slice(0, offset).match(/\*\*/gu) ?? []).length % 2) while (/[*_]/u.test(text[offset] ?? "")) offset++;
    // Never inside a quotation: a claim ending on the quoted title's "？" put the mark in it ("你今天想做什么硬件？〔你〕”").
    const before = text.slice(0, offset), open = (before.match(/[“「『]/gu) ?? []).length - (before.match(/[”」』]/gu) ?? []).length;
    if (open > 0) { const close = text.slice(offset).search(/[”」』]/u); if (close >= 0) offset += close + 1; }
    // A claim naming a table row's item ("| 数据云同步 | 不做 |") is marked after what the row says of it: marked on the
    // item, 〔已定〕 read as deciding the name, and the rows beside it marked their values. Not when another claim is
    // marked later in that row.
    const rowStart = text.lastIndexOf("\n", offset - 1) + 1, rowStop = text.indexOf("\n", offset), row = text.slice(rowStart, rowStop < 0 ? text.length : rowStop);
    if (/^\s*\|.*\|\s*$/u.test(row) && !row.slice(0, offset - rowStart).replace(/^\s*\|/u, "").includes("|")) {
      const cellsEnd = rowStart + row.slice(0, row.trimEnd().length - 1).trimEnd().length, rest = text.slice(offset, cellsEnd);
      if (cellsEnd > offset && rest.includes("|") && !marks.some(other => other !== item && other.text.trim() && rest.includes(other.text.trim()))) offset = cellsEnd;
    }
    // A table's head names the columns, it holds nothing: "| 方案 | 宽度设定 | 高度目标 |〔此前〕" broke the table. Another
    // whole row is marked inside its last cell.
    if (/^\s*\|.*\|\s*$/u.test(row)) {
      const following = text.slice((rowStop < 0 ? text.length : rowStop) + 1).split("\n")[0];
      if (/^\s*\|\s*:?-{2,}/u.test(following)) continue;
      const last = rowStart + row.trimEnd().length - 1;
      if (offset > last) offset = rowStart + row.slice(0, row.trimEnd().length - 1).trimEnd().length;
    }
    // Never inside a code block, nor after one for a claim found in it: "check_voltage(...)〔已纠正〕" changed the code it
    // shows, and "```〔已纠正〕" broke the fence.
    if (insideFence(text, offset) || insideFence(text, from + range.start)) continue;
    const source = item.source ? ` · ${item.source}` : "";
    at.push({ offset, mark: zh ? `〔${wikiHolderLabel(holder, true)}${source}〕` : ` [${wikiHolderLabel(holder, false)}${source}]` });
    from = offset;
  }
  let result = text;
  for (const { offset, mark } of at.reverse()) result = result.slice(0, offset) + mark + result.slice(offset);
  return result;
}
