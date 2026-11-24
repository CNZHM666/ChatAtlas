/** Local checks that a claim keeps what its quoted words mean: a "not" the quote has and the claim lost, or a
 * tentative quote ("可以考虑", "maybe") turned into a firm claim. These are local reading hints, not model verdicts. */
// These are grammatical operators. The predicate after one is unrestricted.
const OPERATORS = /暂时不|暂不|先不|尚未|并不|不应(?:该)?|不要|不再|不得|不能|不会|不用|不必|没有|无法|无须|无需|严禁|(?:严格|明令)?禁止|避免|排除|放弃|\b(?:do not|does not|did not|not|don['’]t|doesn['’]t|won['’]t|can['’]t|cannot|never|no longer|without|excluded)\b/giu;
const PREFIX = /^[不未没]$/u;
const WORD_NEGATION = /[不未没]/u;
const MAY_NEGATE = new RegExp(`${WORD_NEGATION.source}|${OPERATORS.source}`, "iu");
const words = new Intl.Segmenter("zh", { granularity: "word" });
const LITERAL_OPERATOR = /^(?:暂时不|尚未|暂不|先不|不应|不得|不|未|没|not)$/iu;
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
  subject?: string;
  /** The assertion in the visible prose that should be compared with the original. */
  claimExcerpt?: string }

export function evidenceAttentionText(attention: EvidenceAttention, zh: boolean): string {
  const text: Record<EvidenceAttention["kind"], [string, string]> = {
    missing: ["引用的原话没有在原文里找到，请确认这句结论的来源", "The quoted words were not found in the original; check where this claim comes from"],
    settled: ["这句写成了已决定，但依据是 AI 建议，原文里没有你的确认", "This reads as decided, but its source is an AI proposal with no confirmation of yours"],
    negation: ["请对照原话与正文，核对同一项操作的限制和适用范围", "Compare the source and the Wiki wording for restrictions on the same action"],
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
  const chars = Array.from(text);
  const pairs = new Set<string>();
  for (let index = 1; index < chars.length; index++) { const pair = chars[index - 1] + chars[index]; if (/^\p{Script=Han}{2}$/u.test(pair) && !GENERIC_PAIRS.has(pair)) pairs.add(pair); }
  return pairs;
}
/** The clause of the quote a cue word sits in, cut at commas, semicolons and line ends. */
const clauses = (text: string) => text.split(/[，,；;。！？!?\n|]+|\.(?=\s|$)|\s+(?=(?:but|whereas)\s)|(?=但是|但(?=不要|不|只|仍|要|应|会|支持|允许))/iu).map(part => part.trim()).filter(Boolean);
const CONDITION_PREFIX = /^(?:(?:在|当|如果|若)\s*)?(?:未|没(?:有)?|无|不(?![要应得能会必用再在]))[^，,。；;！？!?\n]{1,36}?(?:的情况下|情况下|条件下|时(?=\s|$|[，,也仍便就只则可不无须能够必须]))\s*/u;
const REJECTED_QUOTE_LEAD = /(?:不要|不应[该]?|避免|别)(?:把[^。！？\n]{1,48}(?:锁死|写成|设成|当成|限制为)|写成|说成|理解为|误以为|认为|当成)[：:]\s*$/u;
export const isRejectedQuoteLead = (line: string) => REJECTED_QUOTE_LEAD.test(line.replace(/\*\*|__/gu, ""));

/** A quoted example introduced as a wording to avoid is not a source assertion. */
function withoutRejectedQuotes(quote: string): string {
  let previous = "", rejecting = false;
  return quote.split("\n").map(line => {
    if (!line.trim()) return line;
    if (/^\s*>/u.test(line)) {
      rejecting ||= isRejectedQuoteLead(previous);
      if (rejecting) return "";
    } else {
      rejecting = false;
    }
    previous = line;
    return line;
  }).join("\n");
}
const NOT_A_RESTRICTION = /是否|([\p{Script=Han}]{1,2})[不没]\1|\bnot only\b|不(?:只是|仅|但)|^(?:should|could|can|do|would|will)\s+(?:we|i|they|you)\b/iu;

type Cue = { start: number; end: number; text: string };
function restrictionCues(text: string): Cue[] {
  if (NOT_A_RESTRICTION.test(text)) return [];
  const cues = [...text.matchAll(OPERATORS)].map(match => ({ start: match.index, end: match.index + match[0].length, text: match[0] }));
  if (WORD_NEGATION.test(text)) {
    for (const { index, segment } of words.segment(text)) {
      // A standalone 不 modifies what follows. In “不锈钢” it is part of the noun.
      if (PREFIX.test(segment) && /^\s*[\p{Script=Han}\p{Script=Latin}]/u.test(text.slice(index + segment.length))
        && !cues.some(cue => cue.start <= index && index < cue.end)) {
        cues.push({ start: index, end: index + segment.length, text: segment });
      }
    }
  }
  return cues.sort((a, b) => b.start - a.start);
}
const unmarked = (text: string, cues: Cue[]) => cues.reduce((value, cue) => value.slice(0, cue.start) + value.slice(cue.end), text);
const topicText = (text: string, cues = restrictionCues(text)) => unmarked(text, cues).normalize("NFKC").toLowerCase().replace(/[*_`~]/gu, "");
/** A clause is about the claim when it shares a topic pair with it, the cue word and generic words left out. */
function aboutClaim(clause: string, claim: string): boolean {
  const own = topicPairs(topicText(claim));
  return [...topicPairs(topicText(clause))].some(pair => own.has(pair));
}
const version = (text: string) => text.match(/\b(?:v\s*\d+(?:\.\d+)*|phase\s+[\da-z]+)\b|首版|第一版|第二版/iu)?.[0].toLowerCase().replace(/\s+/gu, "").replace(/^(?:首版|第一版)$/u, "v1").replace(/^第二版$/u, "v2");
const compatibleScopes = (left: string, right: string) => {
  const a = version(left), b = version(right);
  // Only compare explicit labels in the same scheme.
  return !a || !b || a === b || a[0] !== b[0];
};
const TOPIC_STOP = new Set("the for first release version currently should must will does did only this that these those your with from into need can but use excluded support without automatically manually an to is it or of in we as by be no do on so at if he me us my".split(" "));
const topicWords = (text: string) => new Set((text.match(/[a-z][a-z0-9-]+/gu) ?? []).filter(word => !TOPIC_STOP.has(word)));
const negative = (text: string) => restrictionCues(text).length > 0;
const REUSED_ACTION_WORDS = new Set(["自动", "手动", "同步", "首版", "允许"]);
const trigger = (text: string) => text.match(/自动|手动|\b(?:automatically|manually)\b/iu)?.[0].replace("automatically", "自动").replace("manually", "手动");

/** Anchor the comparison after the negation, so sharing the same object is
 * insufficient when the two clauses describe different things done to it. */
function governedWord(text: string, cue: Cue | undefined): string | undefined {
  if (!cue) return undefined;
  const predicate = text.slice(cue.end).normalize("NFKC").toLowerCase()
    .replace(/^\s*(?:自动|手动|\b(?:automatically|manually)\b)\s*/u, "");
  for (const word of words.segment(predicate)) if (word.isWordLike) return word.segment;
}

function actionMatch(own: string, other: string, predicate?: string): number {
  const compact = (text: string) => text.replace(/[\s\p{P}]/gu, "");
  if (compact(own) && compact(own) === compact(other)) return Infinity;
  const ownTrigger = trigger(own), sourceTrigger = trigger(other);
  if (ownTrigger && sourceTrigger && ownTrigger !== sourceTrigger) return 0;
  const sourcePairs = topicPairs(other), sharedPairs = [...topicPairs(own)].filter(pair => sourcePairs.has(pair));
  const sourceWords = topicWords(other), sharedWords = [...topicWords(own)].filter(word => sourceWords.has(word)).length;
  // A short, named restriction (“书签先不做”) can match by its whole subject.
  const shortSubject = other.trim().match(/^\p{Script=Han}{2}(?=做?$)/u)?.[0];
  if (sharedPairs.length === 1 && shortSubject && own.includes(shortSubject)) return sharedPairs.length + sharedWords;
  if (predicate && ![...words.segment(own)].some(word => word.segment === predicate)) return 0;
  const topicOnly = sharedPairs.filter(pair => !REUSED_ACTION_WORDS.has(pair)).length;
  if (topicOnly + sharedWords >= 2) return sharedPairs.length + sharedWords;
  return 0;
}
/** "涵盖计时控制、后台运行、到点提醒…" names a scope; its items are checked one by one. */
const LIST_LEAD = /(?:涵盖|包括|包含了?|支持|提供|使用|有|：|:)(?=[^：:]*[、，,])/u;
export function listItems(claim: string): string[] {
  // A conditional lead-in and the clause after “仅…” describe the list, not another item.
  const enumeration = claim.split(/[，,；;。！？!?\n]/u).find(part => part.includes("、") && LIST_LEAD.test(part));
  const text = enumeration ?? claim;
  const lead = text.match(LIST_LEAD);
  if (!lead || lead.index === undefined) return [];
  const tail = text.slice(lead.index + lead[0].length).replace(/[。！？!?.；;]+$/u, "");
  const items = tail.split(/[、，,]|(?:以及|及|和|与)(?=\S)/u).map(item => item.replace(/^(?:以及|及|和|与)/u, "").replace(/(?:等|等等)$/u, "").trim()).filter(item => Array.from(item).length >= 2 && Array.from(item).length <= 16);
  return items.length >= 3 ? items : [];
}
/** A line of the original that puts an item out of this version: a later version, a deferral, a "不做". */
const DEFERRED = /\bV\s*[2-9]\d*(?:\.\d+)*\b|以后|后续|下一版|第二版|暂不|先不|不做|不需要|不在.{0,6}范围/iu;

/** The first item of a scope claim its original puts out of scope, with the words saying so. */
function deferredItem(claim: string, quote: string): EvidenceAttention | undefined {
  const items = listItems(claim);
  if (!items.length || !DEFERRED.test(quote)) return undefined;
  const lines = quote.split(/\n+/u).flatMap(line => line.trimStart().startsWith("|") ? [line] : clauses(line));
  for (const item of items) {
    const line = lines.find(text => text.includes(item) && DEFERRED.test(text) && !NOT_A_RESTRICTION.test(text)
      && (negative(text) ? compatibleScopes(claim, text) : !version(text) || version(text) !== version(claim)));
    if (!line) continue;
    const cue = line.match(DEFERRED)![0];
    if (!negative(line) && lines.some(text => text !== line && text.includes(item) && !DEFERRED.test(text) && version(claim) && version(claim) === version(text))) continue;
    return { kind: "negation", subject: item, cue, claimExcerpt: claim };
  }
  return undefined;
}

export function localMeaningProblem(claim: string, fullQuote: string | undefined): EvidenceAttention | undefined {
  if (!fullQuote || !statesSomething(claim)) return undefined;
  const sourceText = withoutRejectedQuotes(fullQuote);
  const restrictable = (text: string) => text.replace(CONDITION_PREFIX, "");
  // A list of what a version covers is checked item by item: the "不需要后端" next to it says nothing about its items.
  const scopeIssue = !negative(claim) && deferredItem(claim, sourceText);
  if (scopeIssue) return scopeIssue;
  const sourceClauses = (MAY_NEGATE.test(sourceText) ? clauses(sourceText) : []).flatMap(text => {
    const action = restrictable(text);
    if (!action || NOT_A_RESTRICTION.test(action)) return [];
    const cues = restrictionCues(action);
    return [{ text, restrictive: cues.length > 0, topic: topicText(action, cues), predicate: governedWord(action, cues.at(-1)) }];
  });
  for (const assertion of sourceClauses.some(source => source.restrictive) ? clauses(claim) : []) {
    const action = restrictable(assertion);
    if (!action || negative(action) || NOT_A_RESTRICTION.test(action)) continue;
    const topic = topicText(action, []);
    let conflict = 0, support = 0, cue = "";
    for (const source of sourceClauses) {
      if (!compatibleScopes(assertion, source.text)) continue;
      const score = actionMatch(topic, source.topic, source.predicate);
      if (source.restrictive) {
        if (score > conflict) { conflict = score; cue = source.text; }
      } else {
        support = Math.max(support, score);
      }
    }
    if (conflict > support) return { kind: "negation", cue, claimExcerpt: assertion };
  }
  if (FIRM.test(claim) && !TENTATIVE.test(claim) && TENTATIVE.test(sourceText)) {
    const quote = claimSentences(claim, sourceText);
    if (FIRM.test(quote)) return undefined;
    const tentative = clauses(quote).find(clause => TENTATIVE.test(clause) && aboutClaim(clause, claim));
    if (tentative) return { kind: "tentative", cue: tentative };
  }
  return undefined;
}

const literalForm = (value: string) => value.normalize("NFKC").toLowerCase().trim().replace(/[。！？!?.]$/u, "").replace(/\s/gu, "");
/** An exact sentence pair that differs only by one explicit negative cue. */
export function literalNegationCorrection(claim: string, quote: string): string | undefined {
  if (!statesSomething(claim) || negative(claim)) return;
  const wanted = literalForm(claim), corrections = new Set<string>();
  for (const sentence of withoutRejectedQuotes(quote).split(/(?<=[。！？!?\n])|\.(?=\s|$)/u)) {
    const text = sentence.trim().replace(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/u, "$1");
    if (literalForm(text) === wanted) return;
    for (const cue of restrictionCues(text).filter(cue => LITERAL_OPERATOR.test(cue.text))) {
      if (literalForm(unmarked(text, [cue])) === wanted) {
        const ending = claim.match(/[。！？!?．.]$/u)?.[0] ?? "";
        corrections.add(text.replace(/[。！？!?．.]$/u, "") + ending);
      }
    }
  }
  return corrections.size === 1 ? corrections.values().next().value : undefined;
}

/** Legacy model verdict retained for backup compatibility; no longer used to schedule checks. */
export interface ClaimMeaningCheck { verdict: "supported" | "partial" | "unsupported"; reason?: string; text: string; checkedAt: number }
