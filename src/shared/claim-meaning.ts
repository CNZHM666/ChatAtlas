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
export interface EvidenceAttention { kind: "missing" | "settled" | "negation" | "tentative" | "approximate" | "partial" | "unsupported"; reason?: string;
  /** The words of the original that raised the flag ("先不做", "可以考虑用 Orama"), shown and marked so the reader need not hunt. */
  cue?: string;
  /** For a scope claim: the item the original puts out of scope. */
  subject?: string }

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

/** Character pairs that say nothing about what a clause is about: a shared "第一版" or "功能" ties a "第一版不需要后端"
 * to every claim about the first version. */
const GENERIC_PAIRS = new Set(["第一", "一版", "版本", "功能", "用户", "可以", "需要", "我们", "这个", "一个", "进行", "使用", "支持", "目前", "现在", "时候", "以及", "还是", "或者", "如果", "就是", "所以", "因为", "但是", "然后", "项目", "产品", "方案", "页面", "一下", "这些", "那些", "什么", "怎么"]);
function topicPairs(text: string): Set<string> {
  const chars = Array.from(text.normalize("NFKC").toLowerCase().replace(NEGATION_ALL, " ").replace(/[\s\p{P}\p{S}]/gu, " "));
  const pairs = new Set<string>();
  for (let index = 1; index < chars.length; index++) { const pair = chars[index - 1] + chars[index]; if (!/\s/u.test(pair) && !GENERIC_PAIRS.has(pair)) pairs.add(pair); }
  return pairs;
}
const NEGATION_ALL = new RegExp(NEGATION.source, "giu");
/** The clause of the quote a cue word sits in, cut at commas, semicolons and line ends. */
function clauses(quote: string): string[] { return quote.split(/[，,；;。！？!?\n|]+/u).map(item => item.trim()).filter(Boolean); }
/** A clause is about the claim when it shares a topic pair with it, the cue word and generic words left out. */
function aboutClaim(clause: string, claim: string): boolean { const own = topicPairs(claim); for (const pair of topicPairs(clause)) if (own.has(pair)) return true; return false; }
/** "涵盖计时控制、后台运行、到点提醒…" names a scope; its items are checked one by one. */
const LIST_LEAD = /(?:涵盖|包括|包含|包含了|支持|提供|有|：|:)(?=[^：:]*[、，,])/u;
export function listItems(claim: string): string[] {
  const lead = claim.match(LIST_LEAD);
  if (!lead || lead.index === undefined) return [];
  const tail = claim.slice(lead.index + lead[0].length).replace(/[。！？!?.；;]+$/u, "");
  const items = tail.split(/[、，,]|(?:以及|及|和|与)(?=\S)/u).map(item => item.replace(/^(?:以及|及|和|与)/u, "").replace(/(?:等|等等)$/u, "").trim()).filter(item => Array.from(item).length >= 2 && Array.from(item).length <= 16);
  return items.length >= 3 ? items : [];
}
/** A line of the original that puts an item out of this version: a later version, a deferral, a "不做". */
const DEFERRED = /\bV\s*[2-9]\b|\bv\s*[2-9]\b|以后|后续|下一版|第二版|暂不|先不|不做|不需要|\bP2\b|不在.{0,6}范围/u;

/** The first item of a scope claim its original puts out of scope, with the words saying so. */
function deferredItem(claim: string, quote: string): EvidenceAttention | undefined {
  const lines = quote.split(/\n+/u);
  for (const item of listItems(claim)) {
    const line = lines.find(text => text.includes(item));
    const said = line?.match(DEFERRED)?.[0];
    if (line && said) return { kind: "negation", subject: item, cue: said.trim() };
  }
  return undefined;
}

export function localMeaningProblem(claim: string, fullQuote: string | undefined): EvidenceAttention | undefined {
  if (!fullQuote || !statesSomething(claim)) return undefined;
  // A list of what a version covers is checked item by item: the "不需要后端" next to it says nothing about its items.
  if (listItems(claim).length) return deferredItem(claim, fullQuote);
  const quote = claimSentences(claim, fullQuote);
  if (!NEGATION.test(claim)) {
    const negated = clauses(quote).find(clause => NEGATION.test(clause) && aboutClaim(clause, claim));
    if (negated) return { kind: "negation", cue: negated };
  }
  if (!FIRM.test(quote) && FIRM.test(claim) && !TENTATIVE.test(claim)) {
    const tentative = clauses(quote).find(clause => TENTATIVE.test(clause) && aboutClaim(clause, claim));
    if (tentative) return { kind: "tentative", cue: tentative };
  }
  return undefined;
}

/** Legacy model verdict retained for backup compatibility; no longer used to schedule checks. */
export interface ClaimMeaningCheck { verdict: "supported" | "partial" | "unsupported"; reason?: string; text: string; checkedAt: number }
