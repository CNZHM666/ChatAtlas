import type { WikiUnitStatus } from "./wiki-knowledge";
import { wikiQuoteRange } from "./wiki-claims";

/** Who holds a sentence of the document and how settled it is: the user's decision, a point still open, an earlier
 * version since replaced, the user's own view or report, material the user pasted, or the assistant. Status has one
 * expression, a short mark at the end of a run of text: the prose never says it. The assistant's text, most of a
 * document, carries no mark; a mark is text, so copying and export keep it. */
export type WikiHolder = "decided" | "open" | "earlier" | "user" | "material" | "ai";

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

const LABELS: Record<WikiHolder, [string, string]> = { decided: ["已定", "Decided"], open: ["未定", "Open"], earlier: ["此前", "Earlier"], user: ["你", "You"], material: ["资料", "Material"], ai: ["建议／分析", "Suggestion / analysis"] };
const TITLES: Record<WikiHolder, [string, string]> = {
  decided: ["你确认的决定", "Your confirmed decision"],
  open: ["仍在讨论，尚未决定", "Still open, not decided"],
  earlier: ["此前的方案，已被后来的取代", "An earlier version, since replaced"],
  user: ["你的看法或报告", "Your own view or report"],
  material: ["你提供的资料，未见你确认", "Material you provided, not confirmed by you"],
  ai: ["AI 的建议或分析，所选来源未见采纳记录", "AI suggestion or analysis; no adoption record in selected sources"],
};
export const wikiHolderLabel = (holder: WikiHolder, zh: boolean) => LABELS[holder][zh ? 0 : 1];
/** Pasted material changes how a sentence is read when it states a choice or a rule ("决定", "必须", "只做") or what
 * the code does now ("已安装", "正在建设", "尚未接入"): then it must not pass for the assistant's suggestion or the
 * user's own. A description from it reads like the rest. */
const MATERIAL_MATTERS = /决定|确定|确认|采用|必须|不得|禁止|严禁|只(?:做|支持|保留|用)|仅|不再|取消|已(?:经)?(?:实现|安装|接入|完成|上线|支持|使用)|正在(?:建设|开发|实现|接入|迁移)|尚未(?:实现|接入|完成|支持)|(?:当前|现有|目前)的?(?:代码|实现|仓库|版本)|代码(?:中|里)|\b(?:decid|must|only|never|implemented|installed|currently)/iu;
/** The holder a sentence is shown with: material stating no choice or rule is shown as the default. */
export const wikiShownHolder = (holder: WikiHolder, text: string): WikiHolder => holder === "material" && !MATERIAL_MATTERS.test(text) ? "ai" : holder;
/** The default holder carries no mark: unmarked text is the assistant's suggestion or analysis. */
export const wikiUnmarkedHolder = (holder: WikiHolder) => holder === "ai";
export const wikiHolderTitle = (holder: WikiHolder, zh: boolean) => TITLES[holder][zh ? 0 : 1];

/** The legend an exported document opens with when it carries holder marks. */
export function wikiHolderLegend(zh: boolean): string {
  const holders: WikiHolder[] = ["decided", "open", "earlier", "user", "material"];
  return zh ? `句末标记说明：${holders.map(holder => `〔${wikiHolderLabel(holder, true)}〕${wikiHolderTitle(holder, true)}`).join("；")}；没有标记的是 AI 的建议或分析。`
    : `Sentence marks: ${holders.map(holder => `[${wikiHolderLabel(holder, false)}] ${wikiHolderTitle(holder, false).toLocaleLowerCase()}`).join("; ")}; unmarked text is the AI's suggestion or analysis.`;
}

const SENTENCE_END = /[。！？!?；;]/u;
/** Marks inserted as text after the sentences that end each holder run: for an exported document, which has no
 * buttons. A sentence not found in the text gets no mark; nothing is invented. */
export function withHolderMarks(text: string, marks: Array<{ text: string; holder: WikiHolder }>, zh: boolean): string {
  const at: Array<{ offset: number; mark: string }> = [];
  let from = 0;
  for (const item of marks) {
    const holder = wikiShownHolder(item.holder, item.text);
    if (wikiUnmarkedHolder(holder)) continue;
    const range = wikiQuoteRange(text.slice(from), item.text.trim());
    if (!range) continue;
    const end = from + range.end, stop = text.slice(end - 1).search(SENTENCE_END);
    // A claim ending on a clause ("……三项功能介绍" before "，并认可……") is marked there: the rest of the sentence holds
    // otherwise, and a mark at the sentence end would claim it too.
    let offset = /^[，,；;]/u.test(text.slice(end)) ? end : stop < 0 ? end : end - 1 + stop + 1;
    // A sentence closed inside emphasis keeps its closing marks before the label; the "**" opening the next
    // sentence's emphasis is not one of them (the mark then landed inside that sentence's bold).
    if ((text.slice(0, offset).match(/\*\*/gu) ?? []).length % 2) while (/[*_]/u.test(text[offset] ?? "")) offset++;
    // Never inside a quotation: a claim ending on the quoted title's "？" put the mark in it ("你今天想做什么硬件？〔你〕”").
    const before = text.slice(0, offset), open = (before.match(/[“「『]/gu) ?? []).length - (before.match(/[”」』]/gu) ?? []).length;
    if (open > 0) { const close = text.slice(offset).search(/[”」』]/u); if (close >= 0) offset += close + 1; }
    at.push({ offset, mark: zh ? `〔${wikiHolderLabel(holder, true)}〕` : ` [${wikiHolderLabel(holder, false)}]` });
    from = offset;
  }
  let result = text;
  for (const { offset, mark } of at.reverse()) result = result.slice(0, offset) + mark + result.slice(offset);
  return result;
}
