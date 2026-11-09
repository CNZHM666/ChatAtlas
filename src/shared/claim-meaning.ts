/** Local checks that a claim keeps what its quoted words mean: a "not" the quote has and the claim lost, or a
 * tentative quote ("可以考虑", "maybe") turned into a firm claim. These are local reading hints, not model verdicts. */
const NEGATION = /不要|不用|不做|先不|暂不|暂时不|不考虑|不需要|不再|不支持|不采用|不大量|禁止|避免|不得|无需|放弃|\b(?:not|don't|do not|never|no longer)\b/iu;
const TENTATIVE = /可以考虑|考虑|也许|或许|可能|建议|是否|要不要|能不能|可选|备选|\b(?:maybe|might|could|consider|perhaps|optional)\b/iu;
const FIRM = /必须|一定要|已决定|已确定|确定采用|决定采用|已经完成|已完成|已上线|\b(?:must|decided|shipped)\b/iu;

/** The sentences of a quote that state the claim: a long quote (a pasted document) also holds sentences about other
 * things, whose "不要" or "考虑" says nothing about this claim. Matched by shared character pairs. */
function claimSentences(claim: string, quote: string): string {
  const sentences = quote.split(/(?:(?<=[。！？!?；;\n])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))/u).map(item => item.trim()).filter(Boolean);
  if (sentences.length < 2) return quote;
  const pairs = (text: string) => { const chars = Array.from(text.normalize("NFKC").replace(/[\s\p{P}]/gu, "")); return new Set(chars.slice(1).map((char, index) => chars[index] + char)); };
  const own = pairs(claim), score = (text: string) => { const theirs = pairs(text); let shared = 0; for (const pair of own) if (theirs.has(pair)) shared++; return own.size ? shared / own.size : 0; };
  const scored = sentences.map(sentence => ({ sentence, score: score(sentence) })), best = Math.max(...scored.map(item => item.score));
  return best > 0 ? scored.filter(item => item.score >= best * .6 && item.score >= .2).map(item => item.sentence).join("") || quote : quote;
}

/** Why a point needs the reader's look, kept as a kind (and the model's own reason) so it reads in the current language. */
export interface EvidenceAttention { kind: "missing" | "settled" | "negation" | "tentative" | "approximate" | "partial" | "unsupported"; reason?: string }

export function evidenceAttentionText(attention: EvidenceAttention, zh: boolean): string {
  const text: Record<EvidenceAttention["kind"], [string, string]> = {
    missing: ["引用的原话没有在原文里找到，请确认这句结论的来源", "The quoted words were not found in the original; check where this claim comes from"],
    settled: ["这句写成了已决定，但依据是 AI 建议，原文里没有你的确认", "This reads as decided, but its source is an AI proposal with no confirmation of yours"],
    negation: ["原话里有否定（如“先不做”“不需要”），结论里没有体现，请确认意思没有反过来", "The quote says not to (\"not now\", \"no need\"); the claim drops it. Check the meaning was not reversed"],
    tentative: ["原话只是在考虑或建议，结论写得更肯定", "The quote only considers or suggests this; the claim states it firmly"],
    approximate: ["这句是按措辞近似匹配到的原文，请确认它说的是同一件事", "Matched to this original by wording only; check it says the same thing"],
    partial: ["AI 核对：原文只支持一部分", "AI check: the original supports only part of this"],
    unsupported: ["AI 核对：原文没有说这个", "AI check: the original does not say this"],
  };
  const lead = text[attention.kind][zh ? 0 : 1];
  return attention.reason ? `${lead}${zh ? "——" : " — "}${attention.reason}` : lead;
}

/** A claim that states something: it ends a sentence, or is long enough to hold one. A table cell or a list of names
 * ("Threadback, Echoes, LLM Wiki", "历史搜索/聚合工具") states nothing, so it cannot drop the quote's "不" or soften
 * its "考虑": the sentence of its row says those. */
function statesSomething(claim: string): boolean {
  const text = claim.trim(), han = (text.match(/\p{Script=Han}/gu) ?? []).length;
  if (/[。！？!?.；;]$/u.test(text) || han >= LONG_HAN) return true;
  // Short: a few Chinese words with no list separator ("首页加入书签功能"); names alone read as a sentence only when long.
  return han ? han >= SHORT_HAN && !LIST.test(text) : text.split(/\s+/u).length >= STATEMENT_WORDS;
}
const LONG_HAN = 10, SHORT_HAN = 4, STATEMENT_WORDS = 6, LIST = /[/／、，,]/u;

export function localMeaningProblem(claim: string, fullQuote: string | undefined): EvidenceAttention | undefined {
  if (!fullQuote || !statesSomething(claim)) return undefined;
  const quote = claimSentences(claim, fullQuote);
  if (NEGATION.test(quote) && !NEGATION.test(claim)) return { kind: "negation" };
  if (TENTATIVE.test(quote) && !FIRM.test(quote) && FIRM.test(claim) && !TENTATIVE.test(claim)) return { kind: "tentative" };
  return undefined;
}

/** Legacy model verdict retained for backup compatibility; no longer used to schedule checks. */
export interface ClaimMeaningCheck { verdict: "supported" | "partial" | "unsupported"; reason?: string; text: string; checkedAt: number }
