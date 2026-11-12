import { LEAVES_OUT } from "../shared/negation";
import { wikiDecidedTopics } from "../shared/wiki-decided-topics";
import { FIRST_VERSION_ZH, ITERATION_ZH, PHASE } from "../shared/stage-words";
import { claimSourceUnits, claimSupported, unitClaimText } from "./wiki-claim-support";
import { qualifiedDiscussionIdea, qualifyWikiDatedReport, qualifyWikiOpeningOffer, wikiUserIdea } from "./wiki-claim-review";
import type { FocusEvidence, FocusSection } from "../shared/focus-session";
import type { WikiClaim } from "../shared/wiki-claims";
import { DECIDING_KINDS, statesCore, wikiLedgerUnits, type WikiDraftClaim, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiHolderOf } from "../shared/wiki-holder";
import { knowledgeTerms } from "../shared/knowledge-subject";
import { removeParagraph, replaceParagraph, tableCells, withoutTableRows } from "../shared/wiki-body-text";
import { wikiMeasure, wikiSaidWhen } from "../shared/wiki-section-status";
import { restoredEmptyItems, restoredSkippedOrdinals, withoutEmptyHeadings } from "../shared/wiki-empty-items";
import { unsaidPlanClause } from "../shared/wiki-unsaid-plan";
import { rowListAsTable } from "../shared/wiki-row-list";
import { withoutMadeRanges } from "../shared/wiki-made-range";
import { decidedAgainstDeclined, differingPlans, lengthAgainstDecided, outgrownCentralBy } from "../shared/wiki-differing-plans";
import { currentCaptions } from "../shared/wiki-source-code";
import { daysIn, figuresIn } from "../shared/wiki-figures";
import { rowFields } from "../shared/wiki-row-sentence";


/** The flag that keeps new documents on the earlier pipeline, a fallback while the ledger replaces it. */
export const WIKI_LEGACY_PIPELINE_FLAG = "atlas-dev-wiki-legacy-pipeline";
/** New project documents are written from the knowledge-unit ledger unless the fallback flag is set. */
export function ledgerPipelineEnabled(): boolean {
  try { return !(typeof localStorage !== "undefined" && localStorage.getItem(WIKI_LEGACY_PIPELINE_FLAG) === "1"); } catch { return true; }
}

// The ledger counts the points it kept out of the text; the document has no ledger panel to show them in.
const FOLDED_NOTE = /^> (?:相关讨论 \d+ 条|\d+ more related points in the ledger)\s*$/gmu;
/** A sentence says most of a statement: most of the statement's terms (or of the sentence's, if shorter) are in it. */
export const saysMostOf = (sentence: Set<string>, statement: string) => { const own = knowledgeTerms(statement); let shared = 0; for (const term of own) if (sentence.has(term)) shared++; return shared >= SAYS_SHARED && shared / Math.max(1, Math.min(own.size, sentence.size)) >= SAYS_COVER; };
const SAYS_SHARED = 3, SAYS_COVER = .4, OPENING_DECIDED = .5;
/** Whether an opening sentence takes a decision's mark here: it says most of the decision, and most of what it says is
 * a decision of the chapter (confirmed: its confirmed units). The decision coverage asks it too: it took "v1 is web-only
 * …, with bank syncing, receipt OCR, and shared budgets excluded" as telling the bank-sync decision, which no mark then
 * showed, and the key decisions lost it. */
export function openingSentenceMarks(sentence: string, unit: WikiKnowledgeUnit, confirmed: WikiKnowledgeUnit[]): boolean {
  const terms = knowledgeTerms(sentence);
  if (!saysMostOf(terms, unit.statement)) return false;
  const decided = knowledgeTerms([unit, ...confirmed].map(unitClaimText).join(" "));
  let shared = 0;
  for (const term of terms) if (decided.has(term)) shared++;
  return shared / Math.max(1, terms.size) >= OPENING_DECIDED;
}
/** A short clause sharing a few words with a decision ("P2：实现自动维护项目记忆" beside "优先实现复制上下文功能，待项目
 * 知识准确后再逐步加入自动记忆读取") is not that decision: a sentence is the decision only when it says a good part of it. */
const saysEnoughOf = (sentence: Set<string>, statement: string) => { const own = knowledgeTerms(statement); let shared = 0; for (const term of own) if (sentence.has(term)) shared++; return shared / Math.max(1, own.size) >= DECISION_COVER; };
const DECISION_COVER = .35;
/** A sentence giving the reason for what the sentence before decided ("这一转变旨在提升上下文组装的准确性……"): it
 * names the decision only by "这一", so it is no decision of its own and carries no 已定. */
const REASON_ONLY = /^(?:这一|这种|这些|这样|此举|此|该(?:转变|调整|决定|做法|方案|设计|策略))[^。！？!?]{0,30}?(?:旨在|是为了|为了|以便|目的是|意在|有助于|能够|可以)/u;
/** A sentence telling only that something changed, not what it became (「首屏信息密度经过多轮优化。」, 「顶部核心指标定义有所
 * 调整。」, 「中央AI按钮的处理存在不同阶段方案。」): the reader learns nothing to recall, and the versions it means follow. */
const CHANGE_ONLY = /^[^，。！？；]{0,24}?(?:经过|经历了?|历经)(?:了)?(?:多轮|多次|数轮|几轮|反复)(?:的)?(?:优化|调整|迭代|修改|讨论|打磨)|^[^，。！？；]{0,24}?(?:有所|几经|多次|反复)(?:调整|变化|优化|改变|修改|变动)|^[^，。！？；]{0,24}?存在(?:不同|多个|多种|几种|两种|若干)(?:阶段|版本|时期)?(?:的)?(?:方案|版本|做法|设计)/u;
const sentenceOf = (text: string) => text.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])/u).map(sentence => sentence.trim()).find(Boolean) ?? text.trim();
/** A code fence or table, under an optional "*caption*" line, and nothing else. */
const SHOWN_BLOCK = /^(?:\*[^*\n]+\*\s*\n\s*\n)?(?:(`{3,}|~{3,})[^\n]*\n[\s\S]*\n\1|\|[^\n]*\|(?:\n\|[^\n]*\|)+)$/u;
/** What a claim's units hold: a proposal is proposed, a report or relayed material is reported; a decision needs no tag. */
const workStatus = (statuses: WikiUnitStatus[]): WikiClaim["workStatus"] =>
  statuses.some(status => status === "confirmed" || status === "contested") ? undefined
    : statuses.some(status => status === "reported" || status === "relayed") ? "reported"
      : statuses.some(status => status === "proposal") ? "proposed" : undefined;

/** A paragraph's claims in reading order, the last of each run of one holder marked: its mark is labelled and
 * tells whose the text back to the previous mark is. */
function holderMarks(text: string, claims: WikiClaim[], sourcesOf: (claim: WikiClaim) => string = () => ""): WikiClaim[] {
  const at = (claim: WikiClaim) => { const index = text.indexOf(claim.text); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const ordered = [...claims].sort((a, b) => at(a) - at(b));
  // A run of one holder shares one mark, within a line: each list item is read alone. "- **UI specification**: The
  // dashboard top bar height is confirmed as 48px …" showed no mark, the 8px item after it carrying the run's.
  const apart = (claim: WikiClaim, next: WikiClaim | undefined) => Boolean(next) && at(next!) < Number.MAX_SAFE_INTEGER && text.slice(at(claim), at(next!)).includes("\n");
  // Nor across conversations: 「你提到日活停留在32人左右……」 and 「当时日活仅25……」, two reports of two conversations, shared
  // one 〔你 · ChatGPT 1〕, the first read as said in the second.
  const otherSource = (claim: WikiClaim, next: WikiClaim | undefined) => Boolean(next) && sourcesOf(claim) !== sourcesOf(next!);
  return ordered.map((claim, index) => claim.holder && (ordered[index + 1]?.holder !== claim.holder || apart(claim, ordered[index + 1]) || otherSource(claim, ordered[index + 1])) ? { ...claim, holderMark: true } : claim);
}

const LIST_TAIL = /^(?:and|or|nor|as well as)\s/iu;
/** Share of a sentence's content words its decision must give for the sentence to be that decision. */
const DECISION_SAYS = .5;
const FUNCTION_WORD = /^(?:a|an|the|is|are|was|were|be|been|to|of|and|or|for|in|on|at|by|with|as|from|it|its|this|that|\+|&)$/u;
/** Characters each part of a split sentence holds at least, punctuation aside. */
const SPLIT_CHARS = 8;
/** Words of its own a decision's addition needs to be split off: "…, operating as a web-only application" stays part of
 * the decided sentence, it says little else. */
const SPLIT_TAIL_TERMS = 7;
/** A stage limit closing a sentence after a semicolon ("；本阶段不包含比价。"), and the words that make one. */
const STAGE_LIMIT = new RegExp(String.raw`${PHASE.source}|${LEAVES_OUT}|\bnot yet\b`, "iu");
const STAGE_LIMIT_TAIL = new RegExp(String.raw`^(.+?)[；;]\s*((?:${ITERATION_ZH}|${FIRST_VERSION_ZH}|\bMVP\b|V\d+(?:\.\d+)*\s*阶段?)[^；;]*?${LEAVES_OUT}[^；;]*)$`, "u");
/** A user's message asking or requesting, not stating: a question, or asking to be taught, told or given something. */
/** How much of a sentence its answer's point says, and at most how much the answer: then it is the point's. */
const ANCHOR_COVER = .7, ANSWER_COVER = .5, OPENING_TELLS = .5, CLOSER = .1;
/** "用户" as the one who said a point, at a sentence's or clause's start: 用户提议, 用户希望. */
const SPEAKING_USER = /(?:^|[。；;，,！？\s])用户(?:提议|提出|希望|认为|表示|决定|要求|询问|计划|打算|倾向|选择|确认|指出|担心|考虑|反馈|提到|报告)/u;
const SPEAKING_USER_ALL = /(^|[。；;，,！？\s])用户(提议|提出|希望|认为|表示|决定|要求|询问|计划|打算|倾向|选择|确认|指出|担心|考虑|反馈|提到|报告)/gu;
/** An opening's sentence only summing the chapter up: 这些功能通过……共同构建……的完整闭环。 */
const SUMMING_UP = /^(?:这些|这一系列|上述|以上|该体系|整体而言)[^。！？]{0,80}(?:共同构建|共同构成|共同形成|共同打造|形成了?(?:一个)?完整|体现了|确保了|奠定了)/u;
/** Names listed in brackets after a word: （risk, urge, relapse, protecting）. */
const NAMED_LIST = /\s*[（(]([A-Za-z_][\w-]*(?:\s*[,，、]\s*[A-Za-z_][\w-]*){2,})[)）]/u;
/** A point that is only what the user asked about: 探讨……的可行性, 询问…… */
const ASKED_ONLY = /^(?:探讨|询问|咨询|请教|想了解|想知道|了解一下)/u;
/** The user's report told as someone else's: 「另有反馈称日活停留在32人左右」. */
const ANOTHER_REPORT = /另有(?:用户)?(?:反馈|报告)(?:称|指出|显示|表明)?|另据(?:用户)?反馈|有用户反馈(?:称|指出)?/gu;
/** The AI speaking as 我 in a table: a 「我的评价」 column, a 「我最看好」 cell. */
const AI_FIRST_PERSON = /我的(评价|评分|打分|判断|推荐|看法|建议)|我(最|更)?(看好|推荐)/gu;
/** Share of a sentence's terms its paragraph's sources must give for a sentence no claim holds to stay. */
const UNCLAIMED_SAID = .5;
/** An opening sentence counting the chapter's subtopics: 用户主要使用紧急干预、复盘记录、社交互助和成长激励四大功能来达成目标。 */
const SUBTOPICS_COUNTED = 3;
/** A plan told as an earlier proposal: 早期曾提出……, 此前曾有方案…… */
const TOLD_EARLIER = /^(?:\*\*)?(?:早期|此前|之前|最初)?曾(?:提出|提议|有方案|建议|考虑)/u;
/** A labelled item telling the current version under its column's name, then the earlier one: 「- **急救流程**：当前建议：
 * ……；早期版本：……」. */
const VERSIONS_IN_ITEM = /^(\s*[-*+]\s+\*\*[^*\n]+\*\*[：:]\s*)(?:当前|现行|目前|最新)(?:建议|版本|方案|做法)?[：:]\s*(.+?)(?:[；;]\s*(?:早期|此前|之前|原先|旧|最初|早先)(?:版本|方案|建议|做法)?[：:]\s*(.+?))?\s*$/u;
/** A clause that says nothing without the one before it: 其中15个为稳定用户, 占比约68%, 分别为…… */
/** A space after a Chinese full stop, before the next Chinese sentence: 「……AI 守护系统。 项目深耕……」, two sentences joined with one. */
const CJK_STOP_SPACE = /([。！？；])[ \t]+(?=\p{Script=Han})/gu;
/** Rows a table of figures named by the writer needs before its rows are dated instead: two already read as two versions
 * (「另一视角 | 卡在40左右」, 「未统一说法 | 稳定在22人」, said seven weeks apart). */
const FIGURE_ROWS = 2;
/** Words only a turned-down point says that an opening clause naming it shares. */
const DECLINED_NAMED = 3;
const LEANS_ON_BEFORE = /^(?:其中|其余|其他|其|这|该|此|占|分别|对应|相当于|即)/u;
/** The user named as proposing what only the AI said: 「你曾提议将首屏100%设为AI Agent驾驶舱……」. */
const YOU_PROPOSED = /(^(?:\*\*)?|[，,；;]\s*)你(曾|此前|之前|早先|最初)?(提议|提出|建议|主张|设想)/u;
/** A status said in brackets after a point: （此点已被上述定位取代）. The mark says it. */
const STATUS_IN_BRACKETS = /[（(](?:此点|该点|这一点|该方向|此方向|该方案|此方案|该建议|此建议)?(?:已被|已经被)[^（）()]{0,20}?(?:取代|替换|替代|推翻|否定)[）)]/gu;
/** A figure with what it counts: 30人, 26.92%. */
const COUNTED = /\d+(?:\.\d+)?\s*(?:%|人|个用户)/gu;
/** A sentence telling what the product is: its positioning. */
/** An opening sharing this much of its wording with a paragraph of the chapter only tells it again. */
const OPENING_REPEATS = .7;
/** A clause of the opening this long at least is one the paragraph under it can be said to repeat. */
const OPENING_TAIL_TERMS = 8;
/** Told again in other words, a clause shares about half its wording with the paragraph saying it in full. */
const OPENING_TAIL_SAID = .5;
/** 「现行决定是……」: the decision, told as one. */
const DECISION_LEAD = /^(?:现行|当前|目前|最终)的?决定(?:是|为)/u;
const POSITIONING = /定位|核心竞争力|核心本质|打造[^。！？]{0,30}系统/u;
/** Share of a positioning sentence's terms an earlier one gives for it to be the same positioning again. */
const POSITIONING_AGAIN = .4;
/** Share of a list clause's terms a note gives for the clause to be what the note tells. */
const NOTE_TELLS = .6;
/** Two tables compare one thing when this share of the shorter one's rows name the same items (a word in common). */
const SAME_ROWS = .6;
/** The fewest rows a table has for its rows to be compared with another's. */
const BLOCK_ROWS_MIN = 4;
/** Two flows draw one path when this share of the shorter one's words is in the other. */
const SAME_FLOW = .5;
/** The share of a clause after 但 that the user's own words give, below which the clause is the writer's. */
const TURN_SAID = .3;
/** A sentence of figures an earlier one gives, said in one conversation, repeats it when this share of its words is in
 * the earlier one. */
const FIGURES_AGAIN = .3;
/** Within one list, two items sharing every figure of a clause need fewer words in common to give it twice. */
const LIST_FIGURES_AGAIN = .2;
/** How much of a turned-down point an item of the list must say to take what else of it no item says. */
const DECLINED_HOST = .4;
/** A table row's claim of MISCITED_TERMS terms or more sharing under MISCITED_SHARE of them with every point it cites is told on the wrong point. */
const MISCITED_TERMS = 4, MISCITED_SHARE = .2;
/** Where a sentence turns from an earlier version to the one in force: 「……，但现行决定仍……」, 「……，而当前方案改为……」. */
const CURRENT_TURN = /(?<=[，,])\s*(?=(?:但|而|不过)?(?:现行|当前|目前|现在|最终)(?:的)?(?:决定|方案|规划|策略|做法|设计))/u;
/** A clause saying only that a later version exists, nothing of what it is: 「，现行方案明确了具体展示层级」,
 * 「，现行方案聚焦于状态定义的改变」. */
const LATER_EXISTS = /[，,]\s*(?:但|而)?(?:现行|当前|目前|最终)(?:的)?(?:方案|规划|设计|做法)(?:已|则)?(?:明确了|聚焦于|细化了|调整了|进一步|改进了|完善了)[^，,。；;]{0,20}(?=[。；;]|$)/u;
/** A sentence told as an earlier version: 「此前曾提出……」, 「早期曾建议……」. */
const EARLIER_LEAD = /^(?:\*\*)?(?:此前|早期|早先|原先|之前)(?:曾)?(?:提出|建议|规划|计划|设计|提议|考虑)/u;
/** An item of a list of rows: a name, then fields each with its label (「- **日活**：数值/状态：约30人；备注：……」). */
const ROW_FIELDS = /^\s*[-*+]\s+\*\*[^*\n]+\*\*\s*[：:]\s*[^:：;；|]{1,12}[:：]/u;
/** A list item's label names another subtopic when this many of its two-character words are in that subtopic's title,
 * and this share of them. */
const LABEL_PLACE = { shared: 2, cover: .6 };
/** A replaced point's sentence closing on its own status: 「，该方向已被替换。」, 「，该历史约束已被现行决策取代。」 */
const OWN_STATUS_TAIL = /[，,]\s*(?:该|这一?|此)[^，,。；;]{0,8}(?:已被|已经被|已)[^，,。；;]{0,8}(?:替换|取代|替代|推翻)[^。；;]{0,4}[。.]?\s*$/u;
/** A goal in a table cell, not a figure as it stands: 从19%提升至25%, 压缩至30秒内. */
const GOAL_WORDS = /提升|提高|降至|降低到|达到|至|目标|以上|以内|不低于|不少于|≥|\b(?:to|reach|at least|under)\b/iu;
const ASKS = /[？?]|吗|呢|还是|有没有|怎么|如何|什么|为什么|可不可以|能不能|要不要|是否|教我|告诉我|发出来|给我|帮我|列出来|\b(?:how|what|why|should i|can you|could you|tell me|show me)\b/iu;
/** The ledger's draft as a project document: one section per chapter, its paragraphs' sources as evidence and
 * every high-impact sentence as a claim on the units it states. A paragraph without one gets a claim on its
 * first sentence, so every paragraph shows its sources in the Wiki. */
/** Reads the chapters before and after each projection pass; set by the regression checks, never in the product. */
export type LedgerPassProbe = (pass: string, before: WikiUnitDraftChapters, after: WikiUnitDraftChapters) => void;
type WikiUnitDraftChapters = NonNullable<WikiKnowledgeLedger["draft"]>["chapters"];
let ledgerPassProbe: LedgerPassProbe | undefined;
export function setLedgerPassProbe(probe: LedgerPassProbe | undefined): void { ledgerPassProbe = probe; }

export function ledgerDocument(ledger: WikiKnowledgeLedger, conversationTitles: Record<string, string>): { sections: FocusSection[]; evidence: FocusEvidence[] } {
  const { ledger: reading, organization, units: all, statuses } = resolveWikiReading(ledger);
  const draft = reading.draft;
  if (!draft || !organization) return { sections: [], evidence: [] };
  const units = new Map(all.map(unit => [unit.id, unit]));
  const roles = reading.documentType === "learning" ? reading.learningRoles ?? {} : undefined;
  const confirmed = all.filter(unit => statuses.get(unit.id) === "confirmed");
  // An AI suggestion a later reply set aside for the user's idea (outgrownCentralNames) reads as an earlier version: moved under
  // 早先版本, it stood there without 〔此前〕.
  const outgrownBy = outgrownCentralBy(all, id => statuses.get(id)), outgrown = new Set(outgrownBy.keys());
  // What replaced each earlier unit: its value under a label they set again is the earlier version's.
  const newer = new Map<string, WikiKnowledgeUnit[]>();
  for (const relation of organization.relations ?? []) { const unit = units.get(relation.newer); if (unit) newer.set(relation.older, [...newer.get(relation.older) ?? [], unit]); }
  const newerOf = (id: string) => newer.get(id) ?? [];
  const evidence: FocusEvidence[] = [], evidenceOf = new Map<string, string>();
  const cite = (unit: WikiKnowledgeUnit) => {
    const known = evidenceOf.get(unit.id);
    if (known) return known;
    const id = `u${evidence.length + 1}`;
    evidenceOf.set(unit.id, id);
    evidence.push({ id, conversationId: unit.evidence.conversationId, messageId: unit.evidence.messageId, title: conversationTitles[unit.evidence.conversationId] ?? "", excerpt: unit.evidence.quote });
    return id;
  };
  const claimOn = (text: string, unitIds: string[], markOnly = false, candidates: WikiKnowledgeUnit[] = [], label = ""): WikiClaim | undefined => {
    // The unit the sentence says most of comes first: its quote is the one highlighted, its original the one opened.
    const listed = claimSourceUnits(text, unitIds.flatMap(id => units.get(id) ? [units.get(id)!] : []), candidates), terms = knowledgeTerms(text);
    const overlap = (unit: WikiKnowledgeUnit) => { const own = knowledgeTerms(unit.statement); return [...terms].filter(term => own.has(term)).length; };
    let own = [...listed].sort((a, b) => overlap(b) - overlap(a));
    if (!own.length || !text.trim()) return undefined;
    // A claim the current units it cites state on their own is theirs, not the earlier version's: a table row citing
    // both palettes put 〔此前〕 on its Light cells and its "Panel" label, which the current palette gives too.
    const current = own.filter(unit => statuses.get(unit.id) !== "history");
    if (current.length && current.length < own.length && claimSupported(text, current)) own = current;
    // The earlier version's values the claim keeps are ones the current units leave unset ("Panel #151516" from the
    // earlier dark palette, beside the later one setting only its background, surface and border): those still hold, and
    // the row is current, not 〔此前〕 as a whole.
    const earlierHolds = current.length > 0 && current.length < own.length && earlierValuesHold(text, current, own.filter(unit => statuses.get(unit.id) === "history"), newerOf);
    const supported = claimSupported(text, own);
    const status = supported ? workStatus(own.map(unit => statuses.get(unit.id)!)) : "proposed";
    // Every unit the claim states is the user's decision (their own words, or confirmed in the ledger): counted as one.
    const decided = supported && own.every(unit => statuses.get(unit.id) === "confirmed");
    // A sentence saying the user's decision, with material or a suggestion only adding its details, is the decision:
    // "新手首页确立为浅色极简风格基准" with the pasted design spec behind it was shown as 资料. A sentence citing an
    // earlier, open or contested point keeps the weaker mark.
    const listedStatuses = own.map(unit => outgrown.has(unit.id) ? "history" : statuses.get(unit.id)!).filter(status => status && !(earlierHolds && status === "history"));
    // A unit of the chapter only saying a cited decision again, in its own words ("V1 is Web only; no native iOS or Android
    // apps." for "v1 is web only, with no native mobile app."): its words are the decision's too. Read without them, "The
    // platform is strictly Web only; there are no native iOS or Android apps." said more than its decision and lost 〔已定〕.
    const decisionsCited = own.filter(unit => statuses.get(unit.id) === "confirmed");
    const restating = candidates.filter(unit => !own.includes(unit) && !["confirmed", "history", "open", "contested"].includes(statuses.get(unit.id) ?? "")
      && decisionsCited.some(decision => saysMostOf(knowledgeTerms(unit.statement), decision.statement) && saysMostOf(knowledgeTerms(decision.statement), unit.statement)));
    const confirmedTerms = knowledgeTerms([...decisionsCited, ...restating].map(unitClaimText).join(" "));
    // A list item says its label too: "- **Global corner radius**: Global standard is 8px" says the decision on the radius.
    const bare = (term: string) => term.replace(/[.,;:!?)"'’”]+$/u, "").toLowerCase();
    const said = label ? knowledgeTerms(`${label} ${text}`) : terms, decidedBare = new Set([...confirmedTerms].map(bare)), saidBare = [...new Set([...said].map(bare))];
    const decisionCover = saidBare.filter(term => decidedBare.has(term)).length / Math.max(1, saidBare.length);
    const reasonOnly = REASON_ONLY.test(text.trim()), sayingDecision = !reasonOnly && decisionCover >= .7 && claimSupported(text, own.filter(unit => statuses.get(unit.id) === "confirmed")) && !listedStatuses.some(value => value === "history" || value === "open" || value === "contested") && own.some(unit => statuses.get(unit.id) === "confirmed" && saysMostOf(said, unit.statement) && saysEnoughOf(said, unit.statement));
    // A sentence citing only a decision but saying much more is not that decision: "Bank syncing, receipt OCR, AI
    // coaching, native mobile apps, complex reports, and multi-device cloud synchronization are excluded" cited only
    // "Bank syncing and receipt OCR are excluded from v1 scope." and carried 〔已定〕 for all six.
    // Content words only: "The confirmed frontend stack is React + Vite + TypeScript, operating as a web-only
    // application." says its decision, though "is" and "as" kept its share under half.
    const content = [...terms].map(term => term.replace(/[.,;:!?)"'’”]+$/u, "").toLowerCase()).filter(term => term && !FUNCTION_WORD.test(term));
    const confirmedContent = new Set([...confirmedTerms].map(term => term.replace(/[.,;:!?)"'’”]+$/u, "").toLowerCase()));
    const contentCover = content.filter(term => confirmedContent.has(term)).length / Math.max(1, content.length);
    const widened = !sayingDecision && listedStatuses.length > 0 && listedStatuses.every(value => value === "confirmed") && contentCover < DECISION_SAYS;
    // A decision the sentence says on its own, an analysis or suggestion cited beside it only repeating it: "The confirmed
    // frontend stack is React + Vite + TypeScript, operating as a web-only application." cited the stack decision and the
    // AI's summary of it, and lost 〔已定〕. Not when an earlier, open or contested point is cited too.
    const decidedOwn = own.filter(unit => statuses.get(unit.id) === "confirmed");
    const decisionHolds = !sayingDecision && !reasonOnly && decidedOwn.length > 0 && decidedOwn.length < own.length && contentCover >= DECISION_SAYS && claimSupported(text, decidedOwn)
      && !listedStatuses.some(value => value === "history" || value === "open" || value === "contested");
    const weaker = sayingDecision || decisionHolds ? "decided" as const : reasonOnly ? undefined : widened ? "ai" as const : supported ? wikiHolderOf(listedStatuses) : "ai";
    // A sentence marked as replaced that says what a decision of the user's says (the first wording of the design the
    // user then chose) is not the earlier option: 〔此前〕 beside the chapter's 〔已定〕 told one design both ways.
    // A sentence telling the latest point and, in its own words, the one it replaced (「你提到日活约40（8月18日）……；此前曾
    // 报告每天稳定在22人」) is the latest one's: 〔此前〕 at its end set the newest report aside.
    // So is one telling both in its own words with 早期 and 当前 (「早期提供30秒结构化复盘……；当前建议不清零所有记录……」).
    const toldApart = weaker === "earlier" && supported && listedStatuses.some(value => value !== "history") && /此前|早先|早期|之前|原先|曾经|曾报告|曾提出|起初|最初|当前|目前|现在|如今|后来|previously|earlier|initially|currently|\bnow\b/iu.test(text);
    const sorted = toldApart ? wikiHolderOf(listedStatuses.filter(value => value !== "history")) : weaker;
    const settled = sorted === "earlier" && confirmed.some(unit => claimSupported(text, [unit]) && saysMostOf(terms, unit.statement) && saysEnoughOf(terms, unit.statement)) ? undefined : sorted;
    // A learning record marks what the user said or wrote and each mistake with its fix; a decision of theirs is theirs
    // (〔你〕), and open points and pasted material, a project's concerns, carry no mark there.
    // 〔你〕 is what the user wrote or answered, not the AI's answer to a question they asked: "建议在同一个对话中继续" from
    // "我是新开个对话还是在这个对话里面继续" was marked as theirs.
    const wrote = !roles || own.some(unit => unit.evidence.role === "user" && !unit.evidence.pasted && (roles[unit.id] === "exercise" || !ASKS.test(unit.evidence.quote)));
    const holder = !roles ? settled : own.some(unit => roles[unit.id] === "mistake") ? "corrected" as const : (settled === "decided" || settled === "user") && wrote ? "user" as const : settled === "earlier" ? settled : undefined;
    return { text: text.trim(), quote: own[0].evidence.quote, evidenceIds: own.map(cite), ...(status ? { workStatus: status } : {}), ...(decided && !reasonOnly ? { userDecided: true } : {}), ...(holder ? { holder } : {}), unitIds: own.map(unit => unit.id), ...(markOnly ? { markOnly: true } : {}) };
  };
  // A sentence joining the user's decision with a point they never confirmed ("采用浅色极简首页……，并认可推开式分屏",
  // the second half only from a pasted summary) is not decided as a whole: its last clauses, said by an unconfirmed
  // unit and by no confirmed one, are a claim of their own, so each part keeps its own mark.
  const splitMixed = (text: string, unitIds: string[]): Array<{ text: string; unitIds: string[] }> => {
    const listed = unitIds.flatMap(id => units.get(id) ? [units.get(id)!] : []);
    const confirmed = listed.filter(unit => statuses.get(unit.id) === "confirmed"), others = listed.filter(unit => statuses.get(unit.id) !== "confirmed");
    // The current value, then the earlier ones told as replaced ("Global standard is 8px; earlier proposals of 16px/24px
    // were replaced."): one 〔此前〕 after both read the current standard as replaced. Each part keeps its own mark.
    const earlier = listed.filter(unit => statuses.get(unit.id) === "history"), current = listed.filter(unit => statuses.get(unit.id) !== "history");
    const told = earlier.length && current.length ? text.match(EARLIER_AFTER) : null;
    if (told && told[1].replace(/[\s\p{P}\p{S}]/gu, "").length >= SPLIT_CHARS && EARLIER_TOLD.test(told[2])) return [{ text: told[1].trim(), unitIds: current.map(unit => unit.id) }, { text: told[2].trim(), unitIds: earlier.map(unit => unit.id) }];
    // The user's decision with a stage limit after it that the decision does not say ("……提供比价推荐及链接的功能；本阶段
    // 不包含比价。"): the limit is the discussion's, so the claim, and its 〔已定〕, end before it.
    const limited = text.match(STAGE_LIMIT_TAIL);
    if (limited && confirmed.length && !others.length && limited[1].replace(/[\s\p{P}\p{S}]/gu, "").length >= SPLIT_CHARS && !confirmed.some(unit => STAGE_LIMIT.test(unit.statement))) return [{ text: limited[1], unitIds }];
    const clauses = text.split(/(?:(?<=[，,；;。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])/u);
    // A decision, then what the writer adds to it, in one English sentence citing the decision alone: "The frontend stack
    // is React + Vite + TypeScript, designed for a responsive web layout that prioritizes mobile-browser usability …"
    // showed no 〔已定〕, the additions outweighing it. The mark goes after the decision; the rest is the writer's.
    if (confirmed.length && !others.length && /^[^\p{Script=Han}]*$/u.test(text)) {
      const comma = text.search(/,\s/u), head = comma > 0 ? text.slice(0, comma) : "", tail = comma > 0 ? text.slice(comma + 1).trim() : "";
      const tailTerms = knowledgeTerms(tail), decision = knowledgeTerms(confirmed.map(unit => unit.statement).join(" "));
      const tailOwn = [...tailTerms].filter(term => decision.has(term)).length / Math.max(1, tailTerms.size);
      if (head.replace(/[\s\p{P}\p{S}]/gu, "").length >= SPLIT_CHARS && tailTerms.size >= SPLIT_TAIL_TERMS && tailOwn < .3 && !LIST_TAIL.test(tail)
        && confirmed.some(unit => saysMostOf(knowledgeTerms(head), unit.statement) && statesCore(unit.statement, head))) return [{ text: head, unitIds }, { text: tail, unitIds: [] }];
    }
    if (!confirmed.length || !others.length || clauses.length < 2) return [{ text, unitIds }];
    // A full stop first: "采用 BYOK 模式……保护用户隐私。API Key 默认仅存在于内存中，刷新即消失……" split at a comma put
    // 〔已定〕 after "API Key 默认仅存在于内存中", a detail the user never confirmed.
    const order = [...clauses.keys()].slice(1).sort((a, b) => Number(!/[。！？!?]\s*$/u.test(clauses[a - 1])) - Number(!/[。！？!?]\s*$/u.test(clauses[b - 1])) || a - b);
    for (const index of order) {
      const head = clauses.slice(0, index).join("").replace(/[，,；;]\s*$/u, ""), tail = clauses.slice(index).join("").trim();
      const headTerms = knowledgeTerms(head), tailTerms = knowledgeTerms(tail);
      // A part too short to state anything ("针对小白用户") is the sentence's condition, not a claim: marked on its own it
      // carried 〔已定〕 to another sentence opening with the same words.
      if ([head, tail].some(part => part.replace(/[\s\p{P}\p{S}]/gu, "").length < SPLIT_CHARS)) continue;
      // Inside a list, before its last item: "Specifically, Bank syncing, Receipt OCR [Decided], and Shared budgets are
      // confirmed as out of scope." put the mark among the items, the sentence's verb all in the tail.
      if (LIST_TAIL.test(tail)) continue;
      const tailHolders = others.filter(unit => saysMostOf(tailTerms, unit.statement));
      const headOthers = others.filter(unit => saysMostOf(headTerms, unit.statement));
      if (headOthers.length && !confirmed.some(unit => saysMostOf(headTerms, unit.statement)) && confirmed.some(unit => saysMostOf(tailTerms, unit.statement))) {
        return [{ text: head, unitIds: headOthers.map(unit => unit.id) }, { text: tail, unitIds: listed.filter(unit => confirmed.includes(unit) || saysMostOf(tailTerms, unit.statement)).map(unit => unit.id) }];
      }
      if (!tailHolders.length || confirmed.some(unit => saysMostOf(tailTerms, unit.statement)) || !confirmed.some(unit => saysMostOf(headTerms, unit.statement))) continue;
      return [{ text: head, unitIds: listed.filter(unit => confirmed.includes(unit) || saysMostOf(headTerms, unit.statement)).map(unit => unit.id) }, { text: tail, unitIds: tailHolders.map(unit => unit.id) }];
    }
    return [{ text, unitIds }];
  };
  // A sentence joining two of the user's decisions, written citing one ("V0.1 确定不做账号系统，所有数据仅存储在本地……，
  // 明确决定不做数据云同步，后续再根据用户需求评估。" on the cloud-sync decision alone): it said more than its decision
  // and lost 〔已定〕, and the key decisions lost both. The paragraph's other decisions the sentence says are its too.
  const decisionsSaid = (text: string, unitIds: string[], paragraphIds: string[]) => {
    if (!unitIds.length || !unitIds.every(id => statuses.get(id) === "confirmed")) return unitIds;
    const said = knowledgeTerms(text);
    const added = paragraphIds.filter(id => !unitIds.includes(id) && statuses.get(id) === "confirmed" && units.has(id) && saysMostOf(said, units.get(id)!.statement) && saysEnoughOf(said, units.get(id)!.statement));
    return added.length ? [...unitIds, ...added] : unitIds;
  };
  // A paragraph telling only an answer that no longer stands (one to a question that should not have been asked, as
  // "当前日活是25人、30人还是40人？"): its sentence 「当前日活约25-30人（近期降至22）。」 stayed in the chapter, unmarked.
  const withdrawn = (paragraph: (typeof draft.chapters)[number]["paragraphs"][number]) => Boolean(paragraph.claims?.length) && paragraph.claims!.every(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => id.startsWith("answer:") && !units.has(id)));
  // A table left with its header and no row saying anything ("| 阶段 | 首页布局方案 |\n| --- | --- |\n |", its rows moved
  // or trimmed away) tells nothing, and its short row failed the whole reader.
  const empty = (paragraph: (typeof draft.chapters)[number]["paragraphs"][number]) => {
    const lines = paragraph.text.trim().replace(/^\*[^*\n]+\*\s*\n+/u, "").split("\n");
    return /^\s*\|/u.test(lines[0] ?? "") && /^\s*\|?\s*:?-{3,}/u.test(lines[1] ?? "") && !lines.slice(2).some(line => line.replace(/^\s*\||\|\s*$/gu, "").split("|").some(cell => cell.trim()));
  };
  const gone = (paragraph: (typeof draft.chapters)[number]["paragraphs"][number]) => withdrawn(paragraph) || empty(paragraph);
  // A sentence telling the point an answer stands on, cited to the answer: 「主流戒色App多采用买断制……」 under 市场与竞品
  // cited the answer 基础免费+高级AI服务订阅, read 〔已定〕 and stood a second time among the key decisions. It is that
  // point's, when the point says it and the answer does not.
  const anchorOf = new Map(all.filter(unit => unit.id.startsWith("answer:")).flatMap(answer => { const anchor = all.find(unit => !unit.id.startsWith("answer:") && answer.evidence.evidenceId === `${unit.evidence.evidenceId}:${answer.id}`); return anchor ? [[answer.id, anchor] as const] : []; }));
  const answerOwnWords = <T extends { text: string; unitIds: string[] }>(claim: T): T => {
    if (!claim.unitIds.length || !claim.unitIds.every(id => anchorOf.has(id))) return claim;
    const anchors = claim.unitIds.map(id => anchorOf.get(id)!), answers = claim.unitIds.flatMap(id => units.get(id) ?? []);
    // The answer carries its point's quote, so the quote cannot tell them apart: the sentence's words can.
    const said = knowledgeTerms(claim.text), cover = (list: WikiKnowledgeUnit[]) => { const own = knowledgeTerms(list.map(unit => unit.statement).join(" ")); return [...said].filter(term => own.has(term)).length / Math.max(1, said.size); };
    return cover(anchors) >= ANCHOR_COVER && cover(answers) < ANSWER_COVER && claimSupported(claim.text, anchors) ? { ...claim, unitIds: anchors.map(unit => unit.id) } : claim;
  };
  // A table row the writer's check found no source for, in a draft written before such rows were taken out: it stood in
  // the export as the project's figures ("稳定用户数 | 22人……", the 22 daily users).
  const withoutUnsourcedRows = (chapter: (typeof draft.chapters)[number]) => {
    const heads = new Set(chapter.problems.flatMap(problem => problem.match(/^row "(.+)…" has no supported source after final formatting$/u)?.[1] ?? []));
    if (!heads.size) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const text = withoutTableRows(paragraph.text, cells => heads.has(cells.join(" | ").slice(0, 36)));
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: paragraph.claims?.filter(claim => text.includes(claim.text)) };
    });
    return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
  };
  // A clause of the chapter's opening telling only a replaced point: 「……方案，首页为混合模式；技术架构分三版迭代……」 summed up
  // the chapter with the homepage the user's answer set aside, unmarked. The chapter's current points do not say it.
  // A subtopic opening on a joining word: 「此外，作为主要推广活动和新手留存手段，按天解锁……」 added to nothing above it.
  const subtopicJoinedOff = (chapter: (typeof draft.chapters)[number]): (typeof draft.chapters)[number] => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map((paragraph, at) => {
      // The first of its subtopic, or after a heading, a note or a block: the paragraphs list holds no note placed later.
      const before = body.slice(0, Math.max(0, body.indexOf(paragraph.text))).trimEnd().split("\n").pop() ?? "";
      if (at > 0 && chapter.paragraphs[at - 1].subtopic === paragraph.subtopic && !/^(?:#|>|```|~~~)/u.test(before)) return paragraph;
      const joined = paragraph.text.match(/^(?:(?:并且?|而且|同时|此外|另外|以及)[，,]\s*|(?:上述|前述|以上)(?=\p{Script=Han}))(?=\S{6})/u)?.[0];
      if (!joined) return paragraph;
      // What is left opening on 「作为……」 names what it is about: its point's subject (「21天清醒挑战作为主要推广活动……」).
      const lead = paragraph.claims?.find(claim => claim.text.startsWith(joined)), subjects = [...new Set((lead?.unitIds ?? []).flatMap(id => units.get(id)?.subject.trim() ?? []))];
      const rest = paragraph.text.slice(joined.length), named = /^(?:作为|用于|通过)/u.test(rest) && subjects.length === 1 && subjects[0].length <= 12 ? subjects[0] : "";
      const text = `${named}${rest}`;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, ...(paragraph.claims ? { claims: paragraph.claims.map(claim => claim === lead ? { ...claim, text: `${named}${claim.text.slice(joined.length)}` } : claim) } : {}) };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  const openingWithoutEarlier = (chapter: (typeof draft.chapters)[number]): (typeof draft.chapters)[number] => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    if (!opening || /\n/u.test(opening)) return chapter;
    // An opening on a joining word, whatever cut what it joined: 「并严格遵守《个人信息保护法》……」.
    const joined = opening.match(/^(?:并且?|且|而且|同时|此外|另外|以及|从而|进而)[，,]?(?=\S{6})/u)?.[0];
    if (joined) return openingWithoutEarlier({ ...chapter, body: replaceParagraph(chapter.body, opening, () => opening.slice(joined.length)) });
    const cited = [...new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds))].flatMap(id => units.get(id) ?? []);
    const earlier = cited.filter(unit => statuses.get(unit.id) === "history"), current = cited.filter(unit => statuses.get(unit.id) !== "history");
    if (!earlier.length) return chapter;
    const clauses = opening.split(/(?<=[，,；;。！？])/u), kept: string[] = [];
    // A clause naming what only a replaced or turned-down point says, whatever current words it joins to it: 「社群互助体系
    // 则依赖系统自动分配匿名小组及固定轻互动动作」 told the groups the user turned down as the plan.
    const own = knowledgeTerms(current.map(unit => unit.statement).join(" "));
    const distinct = earlier.filter(unit => rejectedByYou(unit.id)).map(unit => [...knowledgeTerms(unit.statement)].filter(term => !own.has(term)));
    // The rest of a sentence whose turned-down clause went says of nothing (「；避免复杂聊天带来的社交压力。」): it goes too.
    let rest = false;
    for (const clause of clauses) {
      const terms = knowledgeTerms(clause.replace(/[，,；;。！？]$/u, ""));
      const declined = distinct.some(words => words.filter(term => terms.has(term)).length >= DECLINED_NAMED);
      const dropped = rest || declined || earlier.some(unit => saysMostOf(terms, unit.statement)) && !current.some(unit => saysMostOf(terms, unit.statement));
      rest = (rest || declined) && /[，,]$/u.test(clause);
      if (dropped) {
        const end = clause.match(/[；;。！？]$/u)?.[0];
        if (end && kept.length && (/[，,]$/u.test(kept[kept.length - 1]) || /[；;]$/u.test(kept[kept.length - 1]) && /[。！？]/u.test(end))) kept[kept.length - 1] = kept[kept.length - 1].replace(/[，,；;]$/u, end);
        if (end && kept.length && /[，,]$/u.test(kept[kept.length - 1])) kept[kept.length - 1] = kept[kept.length - 1].replace(/[，,]$/u, end);
        continue;
      }
      // The clause after one gone opens its sentence now: 「……方案，并严格遵守……」 left the chapter opening on 「并严格遵守」.
      const starts = kept.length < clauses.indexOf(clause) && (!kept.length || /[；;。！？]$/u.test(kept[kept.length - 1]));
      kept.push(starts ? clause.replace(/^(?:并且?|且|而且|同时|此外|另外|以及|从而|进而)[，,]?/u, "") : clause);
    }
    const text = kept.join("").trim();
    if (kept.length === clauses.length) return chapter;
    if (text) return { ...chapter, body: replaceParagraph(chapter.body, opening, () => text) };
    // An opening of the replaced version only (「产品初期采用免费核心功能加一次性“30天AI守护计划”付费模式……」〔此前〕 over the
    // chapter whose section says what is suggested now): the chapter's first sentence of points that hold takes its place.
    const first = chapter.paragraphs.find(paragraph => !/^(?:早先版本|Earlier versions)$/u.test(paragraph.subtopic) && !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`)/u.test(paragraph.text)
      && (paragraph.claims ?? []).length > 0 && (paragraph.claims ?? []).every(claim => claim.unitIds.every(id => statuses.get(id) !== "history")));
    const sentence = first?.text.replace(/\*\*/gu, "").match(/^[^。！？\n]+[。！？]/u)?.[0];
    return sentence ? { ...chapter, body: replaceParagraph(chapter.body, opening, () => sentence) } : chapter;
  };
  // A sentence opening on a replaced point and going on with current ones, cited to both: 「首页采用‘AI Agent指挥台+原数据
  // 与成长功能’的混合模式，将分散模块合并为单一的‘今日任务’卡片……」 kept the homepage the user's answer set aside, unmarked,
  // in a sentence about the task card. The opening clause goes; its subject stays with the rest ("首页将分散模块合并……").
  const leadingEarlierOut = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!paragraph.claims?.length || /\n/u.test(paragraph.text.trim()) || /^\s*(?:[-*+]\s|\d+\.\s|\||>|#|\*|`)/u.test(paragraph.text)) return paragraph;
      let text = paragraph.text;
      const claims = paragraph.claims.map(claim => {
        const listed = claim.unitIds.flatMap(id => units.get(id) ?? []), earlier = listed.filter(unit => statuses.get(unit.id) === "history"), current = listed.filter(unit => statuses.get(unit.id) !== "history");
        const [first, ...rest] = claim.text.split(/(?<=[，,])/u);
        if (!earlier.length || !current.length || !rest.length || !text.includes(claim.text)) return claim;
        // A clause telling itself as before (「此前每天稳定在22人（……），其中15个为稳定用户；当前日活约40」), or one the next
        // clause leans on (其中, 其余, 占……): taken out, 「其中15个为稳定用户」 was left saying of nothing.
        if (/^(?:\*\*)?(?:此前|之前|早先|早期|原先|起初|最初|当时|曾)/u.test(first.trim()) || LEANS_ON_BEFORE.test(rest.join("").trim())) return claim;
        const terms = knowledgeTerms(first.replace(/[，,]$/u, ""));
        if (!earlier.some(unit => saysMostOf(terms, unit.statement)) || current.some(unit => saysMostOf(terms, unit.statement))) return claim;
        const subject = first.match(/^([^，,“”"]{1,8}?)(?:采用|使用|改为|定为|为|是)/u)?.[1] ?? "", shorter = `${subject}${rest.join("").trim()}`;
        text = text.replace(claim.text, () => shorter);
        return { ...claim, text: shorter, unitIds: current.map(unit => unit.id) };
      });
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A plan read into the user's question, written in a draft from before such plans were taken out: the competitor
  // table's 「本项目计划采用基础功能永久免费、高级AI服务订阅的模式。〔你〕」 told a plan the user never stated. A claim on such
  // points that says mostly the plan goes; in a table its cell reads "—".
  const unsaid = new Map(wikiLedgerUnits(ledger).flatMap(unit => { const clause = unsaidPlanClause(unit); return clause ? [[unit.id, knowledgeTerms(clause)] as const] : []; }));
  const withoutUnsaidPlans = (chapter: (typeof draft.chapters)[number]) => {
    if (!unsaid.size) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const out = (paragraph.claims ?? []).filter(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => unsaid.has(id)) && paragraph.text.includes(claim.text) && (() => { const said = [...knowledgeTerms(claim.text)]; return said.length > 0 && said.filter(term => claim.unitIds.some(id => unsaid.get(id)!.has(term))).length / said.length >= .7; })());
      if (!out.length) return paragraph;
      let text = paragraph.text;
      for (const claim of out) text = text.split("\n").map(line => /^\s*\|/u.test(line) ? line.split("|").map(cell => cell.includes(claim.text) ? ` ${cell.replace(claim.text, "").trim() || "—"} ` : cell).join("|") : line.replace(claim.text, "").replace(/\s{2,}/gu, " ")).join("\n");
      if (text === paragraph.text) return paragraph;
      changed = true;
      if (!text.trim()) { body = removeParagraph(body, paragraph.text); return { ...paragraph, text: "", claims: [] }; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: paragraph.claims!.filter(claim => !out.includes(claim)) };
    }).filter(paragraph => paragraph.text.trim());
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A table of 指标 | 目标 giving the project's figures as they stood beside its goals: 「整体留存率 | 26.92% | 截至当前」
  // read as a goal of 26.92%, and 「截至当前」 had no day. The column names both, and 当前 takes the day the figure was said.
  const measuredTable = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.split("\n"), head = lines.findIndex(line => /^\s*\|/u.test(line));
      if (head < 0 || !/^\s*\|?\s*:?-{3,}/u.test(lines[head + 1] ?? "")) return paragraph;
      const heads = tableCells(lines[head]), goal = heads.findIndex(cell => /^(?:目标|目标值|target|goal)$/iu.test(cell));
      if (goal < 0) return paragraph;
      let claims = paragraph.claims ?? [], measured = 0;
      const rows = lines.map((line, at) => {
        if (at <= head + 1 || !/^\s*\|/u.test(line)) return line;
        const cells = tableCells(line), rowClaims = claims.filter(claim => cells.some(cell => cell.includes(claim.text)));
        const figures = [...new Set(rowClaims.flatMap(claim => claim.unitIds))].flatMap(id => units.get(id) ?? []).filter(wikiMeasure);
        if (!figures.length || GOAL_WORDS.test(cells[goal] ?? "") || !/\d/u.test(cells[goal] ?? "")) return line;
        measured++;
        const latest = figures.reduce((last, unit) => (unit.evidence.conversationSpan?.end ?? 0) > (last.evidence.conversationSpan?.end ?? 0) ? unit : last);
        // The conversation's days, not the message's: a figure said in a talk over weeks is dated by its span.
        const when = wikiSaidWhen(latest, true);
        if (!when) return line;
        const dated = line.replace(/截至当前|截至目前|当前/gu, () => `${when}所述`);
        if (dated !== line) claims = claims.map(claim => rowClaims.includes(claim) ? { ...claim, text: claim.text.replace(/截至当前|截至目前|当前/gu, () => `${when}所述`) } : claim);
        return dated;
      });
      if (!measured) return paragraph;
      rows[head] = rows[head].replace(/(\|\s*)(目标|目标值)(\s*\|)/u, (_, open: string, _word: string, close: string) => `${open}数值或目标${close}`).replace(/(\|\s*)(Target|Goal)(\s*\|)/iu, (_, open: string, _word: string, close: string) => `${open}Value or target${close}`);
      const text = rows.join("\n");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A table of the project's figures whose rows are named by the writer (近期报告, 当前统计, 另一视角, 整体分析……): no row
  // said when, the same day's figures stood twice, and the AI's retelling 「约30人（近期降至22人）」, figures its quote never
  // gives, read as a report. Each row is named by the days its figures were said, oldest first; a row giving only part of
  // another of the same days, or only the AI's retelling, goes.
  const figuresByDay = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : (() => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.split("\n"), head = lines.findIndex(line => /^\s*\|/u.test(line));
      if (head < 0 || !/^\s*\|?\s*:?-{3,}/u.test(lines[head + 1] ?? "")) return paragraph;
      const rowLines = lines.slice(head + 2).filter(line => /^\s*\|/u.test(line));
      if (rowLines.length < FIGURE_ROWS || lines.slice(head + 2 + rowLines.length).some(line => line.trim())) return paragraph;
      const claims = paragraph.claims ?? [];
      // Claims in row order, each to the first row from the last one's that holds it: 「22人」 stood in two rows, and the
      // second took the first one's source too.
      let from = 0;
      const owner = new Map<WikiDraftClaim, number>();
      for (const claim of claims) {
        const at = rowLines.findIndex((line, index) => index >= from && tableCells(line).slice(1).some(cell => cell.includes(claim.text)));
        if (at >= 0) { owner.set(claim, at); from = at; }
      }
      const rows = rowLines.map((line, index) => {
        const cells = tableCells(line), cited = [...new Set(claims.filter(claim => owner.get(claim) === index).flatMap(claim => claim.unitIds))].flatMap(id => units.get(id) ?? []);
        const latest = cited.reduce<WikiKnowledgeUnit | undefined>((last, unit) => !last || (unit.evidence.conversationSpan?.end ?? 0) > (last.evidence.conversationSpan?.end ?? 0) ? unit : last, undefined);
        return { line, cells, cited, when: latest ? wikiSaidWhen(latest, true) : "", at: latest?.evidence.conversationSpan?.start ?? 0, figures: new Set(cells.slice(1).join(" ").replace(/[（(][^）)]*\d+月\d+日[^）)]*[）)]/gu, "").match(/\d+(?:\.\d+)?/gu) ?? []) };
      });
      // A table of figures only, each row dated, its first column a name the writer gave (no date of its own).
      if (rows.some(row => !row.cited.length || !row.cited.every(wikiMeasure) || !row.when || /\d/u.test(row.cells[0]))) return paragraph;
      // A first column naming what each row measures (整体留存率, 新增用户次日留存, 累计用户), each name its own row's word:
      // those are the rows' subjects, not labels standing for a time. Turned into dates, the table lost what it measured.
      const measured = rows.filter(row => knowledgeTerms(row.cells[0]).size > 0 && row.cited.some(unit => [...knowledgeTerms(row.cells[0])].some(term => knowledgeTerms(`${unit.statement} ${unit.evidence.quote}`).has(term))));
      if (new Set(rows.map(row => row.cells[0])).size === rows.length && measured.length * 2 > rows.length) return paragraph;
      // A cell of the AI’s retelling beside the user’s own figures in one row (「约30人（近期降至22人）」 beside 26.92%, 19%): the
      // figures the row's other sources never give read "—".
      for (const row of rows) {
        const sources = row.cited.filter(unit => unit.evidence.role === "user" && !unquotedFigures(unit));
        if (sources.length === row.cited.length || !sources.length) continue;
        const known = sources.map(unit => `${unit.statement} ${unit.evidence.quote}`).join(" ").replace(/\s+/gu, "");
        row.cells = row.cells.map((cell, at) => at && (cell.match(/\d+(?:\.\d+)?/gu) ?? []).some(value => !known.includes(value)) ? "—" : cell);
      }
      const kept = rows.filter(row => !row.cited.every(unquotedFigures))
        .filter((row, _, all) => !all.some(other => other !== row && other.when === row.when && other.figures.size > row.figures.size && [...row.figures].every(value => other.figures.has(value))))
        .sort((a, b) => a.at - b.at);
      const header = tableCells(lines[head]);
      const table = [`| ${["时间", ...header.slice(1)].join(" | ")} |`, lines[head + 1], ...kept.map(row => `| ${[row.when, ...row.cells.slice(1)].join(" | ")} |`)];
      const text = [...lines.slice(0, head), ...table].join("\n");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims: claims.filter(claim => kept.some(row => row.cells.slice(1).some(cell => cell.includes(claim.text)))), unitIds: paragraph.unitIds.filter(id => kept.some(row => row.cited.some(unit => unit.id === id))) };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  })();
  // A block captioned 「早期方案，已被替换」 for a replaced point it stood with that says nothing of it (the scoring table of
  // directions, in the message setting the age limit the user's answer set aside).
  const carriers = all.filter(unit => unit.evidence.code);
  const captionsNow = (chapter: (typeof draft.chapters)[number]) => {
    const body = currentCaptions(chapter.body, carriers, id => statuses.get(id));
    if (body === chapter.body) return chapter;
    return { ...chapter, body, paragraphs: chapter.paragraphs.map(paragraph => { const text = currentCaptions(paragraph.text, carriers, id => statuses.get(id)); return text === paragraph.text ? paragraph : { ...paragraph, text }; }) };
  };
  // A point the user made, told of "用户": 「用户提议将首页中间的加号按钮……」〔你〕 read as the app's users proposing it. The
  // reader is that user; the sentence says 你, as the marks do.
  const yourWords = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text;
      const claims = paragraph.claims?.map(claim => {
        const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
        // The AI's proposal told as the user's: 「你曾提议将首屏100%设为AI Agent驾驶舱……，但该方案已被否定。」 was the AI's
        // answer, which the user then turned down. It is told as the AI's.
        const proposed = zhDraft && listed.length > 0 && listed.every(unit => unit.evidence.role !== "user") && text.includes(claim.text) ? claim.text.match(YOU_PROPOSED) : null;
        if (proposed) {
          const said = `${claim.text.slice(0, proposed.index)}${proposed[1] ?? ""}AI ${proposed[2] ?? ""}${proposed[3] === "提出" ? "提出" : "建议"}${claim.text.slice(proposed.index! + proposed[0].length)}`;
          text = text.replace(claim.text, () => said);
          return { ...claim, text: said };
        }
        // The user's own idea told as an advice: 「此前建议将侧重点从戒色限制转向帮助青少年男性找回自信和自律。」 was what the user
        // proposed. It is told as theirs.
        const advised = zhDraft && listed.length > 0 && listed.every(unit => unit.evidence.role === "user" && !unit.evidence.pasted) && text.includes(claim.text) ? claim.text.match(/^(\*\*)?(?:此前|早先|之前)(?:曾)?(?:有)?(?:建议|提议)(?!中)/u) : null;
        if (advised) {
          const said = `${advised[1] ?? ""}你此前曾提出${claim.text.slice(advised[0].length)}`;
          text = text.replace(claim.text, () => said);
          return { ...claim, text: said };
        }
        if (!listed.length || !listed.every(unit => unit.evidence.role === "user" && !unit.evidence.pasted) || !(SPEAKING_USER.test(claim.text) || claim.text.search(ANOTHER_REPORT) >= 0) || !text.includes(claim.text)) return claim;
        // 「另有反馈称……」 after the user's first report read as a second person's: it is the user again.
        const said = claim.text.replace(SPEAKING_USER_ALL, (_, lead: string, verb: string) => `${lead}你${verb === "反馈" ? "提到" : verb}`).replace(ANOTHER_REPORT, "你还提到");
        text = text.replace(claim.text, () => said);
        return { ...claim, text: said };
      });
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // Sentences saying of themselves what their marks say, or less than a sentence says:
  // - a replaced point closing on its own status (「……找回自信和自律，该方向已被替换。」〔此前〕): the mark says it;
  // - the user's own point told as an advice (「此前曾建议……」 for what the user asked): 你此前曾提出;
  // - a point with no subject (「作为主要推广活动和新手留存手段，按天解锁……」): its subject leads (21天清醒挑战作为……);
  // - only what the user asked about (「探讨将戒色行为管理与人工智能技术结合的可行性及有效性。」〔你〕): no point; it goes.
  // The answer to what the user only asked: 「探讨将戒色行为管理与人工智能技术结合的可行性及有效性」 went, and the one conversation
  // asking it showed nothing of what it found (现有研究表明CBT、ACT、正念……有效……). The answer no chapter tells, of that
  // conversation, sharing most words with the question, stands in its place.
  // A unit the user's answer turned down (首屏100%为AI Agent驾驶舱, beside 保留左侧布局，Agent作为卡片).
  const rejectedByYou = (id: string) => reading.decisions?.[id]?.verdict === "rejected";
  /** The answers the user gave choosing an option that turned this point down. */
  const chosenInstead = (id: string) => (reading.userAnswers ?? []).flatMap(answer => {
    const option = reading.writingQuestions?.find(question => question.id === answer.questionId)?.options.find(item => item.id === answer.optionId);
    return option?.actions.some(action => action.do === "reject" && action.units.includes(id)) ? [(answer.answer || option.label).trim()] : [];
  });
  const draftCited = new Set(draft.chapters.flatMap(chapter => [...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)]));
  const answersGiven = new Set<string>();
  const answerOf = (asked: WikiKnowledgeUnit) => {
    const terms = knowledgeTerms(asked.statement);
    let best: WikiKnowledgeUnit | undefined, score = 1;
    for (const unit of all) {
      if (unit.evidence.conversationId !== asked.evidence.conversationId || unit.evidence.role !== "assistant" || unit.about || draftCited.has(unit.id) || answersGiven.has(unit.id) || statuses.get(unit.id) === "history") continue;
      const shared = [...knowledgeTerms(unit.statement)].filter(term => terms.has(term)).length;
      if (shared > score) { best = unit; score = shared; }
    }
    return best;
  };
  const plainerSentences = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (!paragraph.claims?.length) return [paragraph];
      let text = paragraph.text;
      const answered: string[] = [];
      const claims = paragraph.claims.flatMap(claim => {
        const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
        if (!listed.length) return [claim];
        const subjects = [...new Set(listed.map(unit => unit.subject.trim()))], subject = subjects.length === 1 && subjects[0].length <= 12 ? subjects[0] : "";
        // Bold breaks the claim's words in the text ("**作为主要推广活动和新手留存手段**，按天解锁……"): its subject goes in
        // where the paragraph opens on it.
        if (!text.includes(claim.text)) {
          const opens = text.replace(/\*\*/gu, "").startsWith(claim.text.slice(0, 12)) && /^(?:\*\*)?作为/u.test(text);
          if (!subject || !opens || claim.text.includes(subject) || listed.some(unit => unit.statement.includes(subject))) return [claim];
          text = text.replace(/^(\*\*)?作为/u, (_, bold: string | undefined) => `${bold ?? ""}${subject}作为`);
          return [{ ...claim, text: claim.text.replace("作为", () => `${subject}作为`) }];
        }
        const mine = listed.every(unit => unit.evidence.role === "user" && !unit.evidence.pasted);
        if (mine && listed.every(unit => ASKED_ONLY.test(unit.statement.trim())) && ASKED_ONLY.test(claim.text.trim()) && !/\n/u.test(claim.text)) {
          const answer = answerOf(listed[0]);
          if (answer) {
            answersGiven.add(answer.id); answered.push(answer.id);
            const said = answer.statement.trim();
            text = text.replace(claim.text, () => said);
            return [{ text: said, unitIds: [answer.id] }];
          }
          const line = text.split("\n").find(item => item.includes(claim.text)) ?? "";
          const rest = line.replace(claim.text, "").replace(/^\s*[〔[][^〕\]]*[〕\]]/u, "").trim();
          text = rest ? text.replace(claim.text, "") : text.split("\n").filter(item => item !== line).join("\n");
          return [];
        }
        let said = claim.text;
        if (listed.every(unit => statuses.get(unit.id) === "history")) said = said.replace(OWN_STATUS_TAIL, "。");
        if (mine) said = said.replace(/^此前曾(?:建议|提议|提出)/u, "你此前曾提出");
        // 「建议将侧重点……转向帮助青少年男性找回自信和自律」 was the user's own idea, told as an advice: the user proposed it.
        if (mine && listed.every(unit => statuses.get(unit.id) === "history" || rejectedByYou(unit.id))) said = said.replace(/^(?:\*\*)?(?:曾有|早先有|此前有)?建议/u, lead => lead.replace(/(?:曾有|早先有|此前有)?建议/u, "你曾提出"));
        // The user's own point given a turn no unit of theirs takes: 「你曾提出将侧重点……转向帮助青少年男性找回自信和自律，但坚持
        // “产品先变，品牌后变”的原则……」, the 但 clause the writer's. A clause after 但 sharing little with what the user said goes.
        if (mine) {
          const turn = said.match(/^(.+?)[，,]\s*(?:但|但是|不过)(.+?)([。！？]?)$/u), own = knowledgeTerms(listed.map(unit => `${unit.statement} ${unit.evidence.quote}`).join(" "));
          if (turn) { const added = [...knowledgeTerms(turn[2])]; if (added.filter(term => own.has(term)).length / Math.max(1, added.length) < TURN_SAID) said = `${turn[1]}。`; }
        }
        said = said.replace(STATUS_IN_BRACKETS, "");
        if (/^作为/u.test(said) && subject && !said.includes(subject) && listed.every(unit => !unit.statement.includes(subject))) said = said.replace("作为", () => `${subject}作为`);
        if (said === claim.text) return [claim];
        text = text.replace(claim.text, () => said);
        return [{ ...claim, text: said }];
      });
      if (text === paragraph.text) return [paragraph];
      changed = true;
      text = text.replace(/\n{3,}/gu, "\n\n").trim();
      if (!text) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims, unitIds: [...paragraph.unitIds, ...answered] }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A decision of the user's own the chapter no longer tells: 「决定先深耕“戒色”单一垂直领域……」, cited by the opening that
  // did not say it, its sentence in the body gone as the opening's repeat; or the version in force of a point whose replaced
  // version the chapter tells. Its earlier version stood under 早先版本 with nothing saying what replaced it. The opening
  // states it first.
  const ownDecisionTold = (chapter: (typeof draft.chapters)[number]) => {
    const decides = (unit: WikiKnowledgeUnit) => statuses.get(unit.id) === "confirmed" || statuses.get(unit.id) === "stated" && unit.evidence.role === "user" && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind);
    const cited = new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds));
    const replacing = chains.filter(topic => topic.earlier.some(id => cited.has(id))).flatMap(topic => topic.current).filter(id => !draftCited.has(id) || (chapter.openingUnitIds ?? []).includes(id));
    const candidates = [...new Set([...chapter.openingUnitIds ?? [], ...replacing])].flatMap(id => units.get(id) ?? []).filter(decides);
    const sentences = chapter.body.replace(/\*\*/gu, "").split(/[。！？\n]/u).filter(sentence => sentence.trim()).map(sentence => knowledgeTerms(sentence));
    const untold = candidates.filter(unit => !sentences.some(terms => saysMostOf(terms, unit.statement)));
    if (!untold.length) return chapter;
    const lead = untold.map(unit => `${bareStatement(unit)}。`).join("");
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    const body = opening ? replaceParagraph(chapter.body, opening, () => `${lead}${opening}`) : `${lead}\n\n${chapter.body}`;
    return { ...chapter, body, openingUnitIds: [...new Set([...chapter.openingUnitIds ?? [], ...untold.map(unit => unit.id)])] };
  };
  // A paragraph telling again only a decision the chapter's opening states: 「目标用户年龄层侧重帮助青少年找回自信自律，将侧重点
  // 从戒色限制转向此方向。」〔已定〕 stood under the opening that said it. The opening keeps it, with its mark.
  const saidByOpening = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim(), openingIds = new Set(chapter.openingUnitIds ?? []);
    if (!opening || !openingIds.size) return chapter;
    const told = knowledgeTerms(opening);
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (paragraph.text.trim() === opening || !paragraph.claims?.length) return [paragraph];
      // Read without emphasis: 「……，**避免使用大的半圆进度条以突出Agent判断**。」 holds its claim's words around the bold.
      const plain = (value: string) => value.replace(/\*\*/gu, "").trim();
      const lineOf = (claim: { text: string }) => paragraph.text.split("\n").find(item => plain(item).includes(plain(claim.text))) ?? "";
      const partOfLine = new Set<WikiDraftClaim>();
      const again = paragraph.claims.filter(claim => {
        const line = lineOf(claim);
        // Decisions, one at least of the opening's: the opening 「首页……左侧功能布局……」 cited the layout alone, the body's
        // sentence telling it again cited the layout and the hybrid homepage.
        if (!claim.unitIds.length || !claim.unitIds.every(id => statuses.get(id) === "confirmed") || !claim.unitIds.some(id => openingIds.has(id))) return false;
        // A sentence standing as its own line of prose, a list item saying only it under a label (「- **开发顺序**：分三版
        // 迭代……」 under the opening stating the plan), or one sentence of a prose line (「首屏结构已确认为混合模式……」): not a
        // table cell or a caption.
        const item = line.match(/^\s*[-*+]\s+(?:\*\*[^*\n]{1,16}\*\*[：:]\s*)?/u)?.[0], rest = plain((item ? line.slice(item.length) : line).replace(/[〔[][^〕\]]*[〕\]]\s*$/u, ""));
        const whole = rest === plain(claim.text), within = !item && !whole && line.includes(claim.text.trim()) && /[。！？]$/u.test(claim.text.trim());
        if (!whole && !within || /^\s*(?:\d+\.\s|\||>|#|`)/u.test(line) || !item && /^\s*\*[^*]/u.test(line)) return false;
        if (item || within) partOfLine.add(claim);
        const said = [...knowledgeTerms(claim.text)];
        return said.length > 0 && said.filter(term => told.has(term)).length / said.length >= OPENING_TELLS;
      });
      if (!again.length) return [paragraph];
      // Of the two, the one closer to its decisions stays: the opening 「界面与交互设计最终确定采用左侧功能布局结合右侧简洁感与
      // 成就展示的混合模式……」 joined two decisions into one that neither says, against the body's 「首页最终确定保留左侧功能布局，
      // 借用右侧简洁感与成就展示方式……」. The opening's sentence goes then, when the opening has another.
      const faithful = (text: string, ids: string[]) => { const own = knowledgeTerms(ids.flatMap(id => units.get(id)?.statement ?? []).join(" ")), said = [...knowledgeTerms(text)]; return said.filter(term => own.has(term)).length / Math.max(1, said.length); };
      const openingSentences = () => body.split(/\n### /u)[0].split(/(?<=[。！？])/u).map(item => item.trim()).filter(Boolean);
      const closerInBody = again.filter(claim => {
        const sentences = openingSentences(), said = knowledgeTerms(claim.text);
        if (sentences.length < 2 || partOfLine.has(claim)) return false;
        const sentence = sentences.reduce((best, item) => { const share = (value: string) => [...knowledgeTerms(value)].filter(term => said.has(term)).length; return share(item) > share(best) ? item : best; });
        if (faithful(claim.text, claim.unitIds) < faithful(sentence.replace(/[〔[][^〕\]]*[〕\]]/gu, ""), claim.unitIds) + CLOSER) return false;
        body = body.replace(sentence, ""); changed = true;
        return true;
      });
      again.splice(0, again.length, ...again.filter(claim => !closerInBody.includes(claim)));
      if (!again.length) return [paragraph];
      const text = paragraph.text.split("\n").flatMap(line => {
        const told = again.filter(claim => lineOf(claim) === line);
        if (!told.length) return [line];
        // One sentence of a prose line goes, with its mark; the line keeps the rest.
        if (/^\s*[-*+]\s/u.test(line) || told.some(claim => !partOfLine.has(claim))) return [];
        const kept = told.reduce((value, claim) => { const at = value.indexOf(claim.text.trim()); return at < 0 ? value : value.slice(0, at) + value.slice(at + claim.text.trim().length).replace(/^〔[^〕]*〕/u, ""); }, line).trim();
        return kept ? [kept] : [];
      }).join("\n").replace(/^\s*\n+|\n+\s*$/gu, "").replace(/\n{3,}/gu, "\n\n");
      // A subtopic keeps its one paragraph: emptied, the heading would stand over nothing.
      if (!text.trim() && chapter.paragraphs.filter(other => other.subtopic === paragraph.subtopic).length < 2) return [paragraph];
      changed = true;
      if (!text.trim()) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims: paragraph.claims.filter(claim => !again.includes(claim)) }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A comparison the writer could not read as a table, kept as a list of its rows: the table again.
  const rowListsAsTables = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const text = rowListAsTable(paragraph.text, /\p{Script=Han}/u.test(paragraph.text));
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A column named for one version holding other versions' plans: 「事项 | 第一版」 over rows 「下个版本仅执行四项改动」 and
  // 「优先实现」. The column says what each row's plan is.
  const stageHeaders = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.split("\n"), head = lines.findIndex(line => /^\s*\|/u.test(line));
      if (head < 0 || !/^\s*\|?\s*:?-{3,}/u.test(lines[head + 1] ?? "")) return paragraph;
      const heads = tableCells(lines[head]), at = heads.findIndex(cell => /^(?:第一版|首版|V1|v1|第一阶段|当前版本)$/u.test(cell));
      if (at < 0) return paragraph;
      const values = lines.slice(head + 2).filter(line => /^\s*\|/u.test(line)).map(line => tableCells(line)[at] ?? "");
      if (!values.some(value => /下个版本|下一版|下一阶段|后续|以后|V[2-9]|第[二三四]版/u.test(value))) return paragraph;
      lines[head] = lines[head].replace(heads[at], () => /[\p{Script=Han}]/u.test(heads[at]) ? "安排" : "Plan");
      const text = lines.join("\n");
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A range of figures no source gives, in the opening or a sentence (「截至当前，日活稳定在20-30人区间」): the clause goes.
  const sources = wikiLedgerUnits(ledger).flatMap(unit => [unit.statement, unit.evidence.quote, ...unit.details]);
  const madeRanges = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0].trim(), openingNow = opening ? withoutMadeRanges(opening, sources) : opening;
    if (openingNow !== opening) { body = body.replace(opening, () => openingNow); changed = true; }
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const text = withoutMadeRanges(paragraph.text, sources);
      if (text === paragraph.text) return [paragraph];
      changed = true;
      if (!text.trim()) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims: paragraph.claims?.flatMap(claim => { const said = withoutMadeRanges(claim.text, sources); return said.trim() ? [{ ...claim, text: said }] : []; }) }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // Plans the discussion left differing, shown as open after the first paragraph telling one of them.
  const zhDraft = /\p{Script=Han}/u.test(draft.chapters.map(chapter => chapter.title).join(""));
  const differing = [...differingPlans(all, id => statuses.get(id), zhDraft, wikiDecidedTopics(ledger.organization?.topics, ledger.decisions)), ...lengthAgainstDecided(all, id => statuses.get(id), zhDraft)], placedNotes = new Set<string>();
  // A line telling only what a note tells (「- **中央入口**：用户提议……；另有建议称……」 above the note naming both, 「- **任务简化**：
  // 将“今日任务0/7”改为“今日重点0/1”……」 in another chapter) said it a second and third time: the note stands in its place.
  const noted = (claim: { unitIds: string[] }) => claim.unitIds.length > 0 && differing.some(item => claim.unitIds.every(id => item.unitIds.includes(id)));
  const differingNoted = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const plain = (value: string) => value.replace(/\*\*/gu, "");
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      // A table or block the note concerns (两条新手流程 as two rows) stays as it is; the note follows it.
      const shown = /^\s*(?:\||```|\*[^*\n]+\*\s*\n)/u.test(paragraph.text);
      const notes = differing.filter(item => !placedNotes.has(item.note) && item.unitIds.some(id => paragraph.unitIds.includes(id)));
      if (shown && !notes.length) return [paragraph];
      let text = paragraph.text, claims = paragraph.claims ?? [];
      const listLine = (line: string) => /^\s*(?:[-*+]|\d+\.)\s/u.test(line);
      if (!shown && claims.some(noted)) {
        const lines = text.split("\n");
        const told = lines.filter(line => {
          const own = claims.filter(claim => plain(line).includes(plain(claim.text)));
          return own.length > 0 && own.every(noted) && listLine(line);
        });
        if (told.length) {
          text = lines.filter(line => !told.includes(line)).join("\n").replace(/\n{3,}/gu, "\n\n").trim();
          claims = claims.filter(claim => !told.some(line => plain(line).includes(plain(claim.text))));
        }
        // In prose only the sentences the note tells go: 「付费墙在第3天……」 took the soft-paywall and SOS sentences after it
        // in its paragraph with it.
        for (const claim of claims.filter(noted)) {
          if (!text.includes(claim.text) || listLine(text.split("\n").find(line => line.includes(claim.text)) ?? "")) continue;
          // With the mark ending it: 「……还是将新用户首次进入流程压缩至30秒？」 left its 「？」 standing as a paragraph.
          const at = text.indexOf(claim.text), mark = text.slice(at + claim.text.length).match(/^\s*[。！？!?；;，,]?/u)![0].length;
          text = `${text.slice(0, at)}${text.slice(at + claim.text.length + mark)}`.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
        }
        if (/^[\s。！？!?；;，,、：:]*$/u.test(text)) text = "";
        claims = claims.filter(claim => text.includes(claim.text) || !noted(claim));
      }
      // A list item telling a note's point beside one of its own: 「- **中央按钮**：在已有Agent情况下缩小尺寸，高危时段变为橙色
      // “守护”状态；主动报告冲动时切换为橙红色“SOS”。」 The clause the note tells goes; the SOS clause stays.
      const touching = shown ? [] : differing.filter(item => claims.some(claim => claim.unitIds.some(id => item.unitIds.includes(id))));
      if (touching.length) {
        const noteTerms = knowledgeTerms(touching.map(item => item.note).join(" ")), trimmed = new Map<string, string>();
        text = text.split("\n").map(line => {
          const item = line.match(/^(\s*(?:[-*+]|\d+\.)\s+(?:\*\*[^*\n]+\*\*\s*[：:]\s*)?)(.+)$/u);
          if (!item) return line;
          const clauses = item[2].split(/(?<=[；;])/u);
          if (clauses.length < 2) return line;
          const kept = clauses.filter(clause => { const own = [...knowledgeTerms(clause)]; return own.filter(term => noteTerms.has(term)).length / Math.max(1, own.length) < NOTE_TELLS; });
          if (!kept.length || kept.length === clauses.length) return line;
          const rest = kept.join("").replace(/[；;]\s*$/u, "。");
          trimmed.set(line, rest);
          return `${item[1]}${rest}`;
        }).join("\n");
        // A claim over the whole item now holds what is left of it, on the units the note does not tell.
        claims = claims.map(claim => {
          const line = [...trimmed.keys()].find(item => plain(item).includes(plain(claim.text)));
          if (!line || plain(trimmed.get(line)!).includes(plain(claim.text))) return claim;
          const ids = claim.unitIds.filter(id => !touching.some(item => item.unitIds.includes(id)));
          return { ...claim, text: trimmed.get(line)!, unitIds: ids.length ? ids : claim.unitIds };
        });
      }
      if (!notes.length && text === paragraph.text) return [paragraph];
      // A note after the table or block that shows both versions names the point and points up: the two onboarding
      // flows were told as two rows of the table and again in full in the note under it.
      const pointed = (item: (typeof notes)[number]) => {
        const topic = item.note.match(/^([^：:。；]{2,30})[：:]/u)?.[1];
        // A note after the paragraph telling the AI's side in full (中央AI按钮缩小、盾牌橙色、SOS) names that side by pointing
        // up: the note told its first sentence again, word for word.
        if (!shown && zhDraft && paragraph.unitIds.includes(item.unitIds[1]) && !paragraph.unitIds.includes(item.unitIds[0]) && /；AI 建议/u.test(item.note)) return item.note.replace(/；AI 建议.*$/u, "；AI 的建议见上文。");
        if (!shown || !topic || !item.unitIds.every(id => paragraph.unitIds.includes(id))) return item.note;
        const table = /^\s*(?:\*[^*\n]+\*\s*\n\s*)?\|/u.test(paragraph.text);
        return zhDraft ? `${topic}（见上${table ? "表" : "文"}），尚未决定。` : `${topic} (see the ${table ? "table" : "block"} above), not settled.`;
      };
      const added = notes.map(item => { placedNotes.add(item.note); return { subtopic: paragraph.subtopic, text: `> ${zhDraft ? "版本未定" : "Not settled"}：${pointed(item)}`, unitIds: item.unitIds, claims: [] }; });
      const replacement = [text, ...added.map(item => item.text)].filter(Boolean).join("\n\n");
      body = replacement ? replaceParagraph(body, paragraph.text, () => replacement) : removeParagraph(body, paragraph.text); changed = true;
      return [...text ? [{ ...paragraph, text, claims }] : [], ...added];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // An opening telling one side of a point left open as what the chapter does: 界面设计 opened on 「界面设计将每日复盘和任务完全
  // 委托给AI Agent处理，用户点击中间加号即可直接跳转至AI界面。」, the user's idea for the central button, while the 版本未定
  // note under 首页布局 set it beside the AI's suggestion. The note tells both sides; the opening's sentence goes, unless
  // another point the opening cites says it too.
  const openingNotOpen = (chapter: Chapter): Chapter => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    const open = differing.filter(item => placedNotes.has(item.note)), ids = chapter.openingUnitIds ?? [];
    const sides = ids.flatMap(id => open.some(item => item.unitIds.includes(id)) ? units.get(id) ?? [] : []);
    if (!opening || !sides.length || /^\s*(?:>|[-*+]\s|\d+\.\s|\||```)/mu.test(opening)) return chapter;
    const others = ids.flatMap(id => sides.some(unit => unit.id === id) ? [] : units.get(id) ?? []);
    const sentences = opening.split(/(?<=[。！？])/u);
    const kept = sentences.filter(sentence => {
      const terms = knowledgeTerms(sentence);
      return !sides.some(unit => saysMostOf(terms, unit.statement)) || others.some(unit => saysMostOf(terms, unit.statement));
    });
    if (kept.length === sentences.length) return chapter;
    const text = kept.join("").trim();
    const body = text ? chapter.body.replace(opening, () => text) : chapter.body.slice(chapter.body.indexOf(opening) + opening.length).replace(/^\s+/u, "");
    return { ...chapter, body, openingUnitIds: ids.filter(id => !sides.some(unit => unit.id === id)) };
  };
  // What the writer added to a sentence, or left out of it, that its checks named:
  // - a list of names in brackets its units do not give (「定义页面状态机（risk, urge, relapse, protecting）」, one of the five
  //   states of the prompt shown below it left out): the brackets go, the block shows the states;
  // - a condition of its group the check found dropped (「…而非用户主动寻找战友或创建队伍。」 without 「不再提供手动创建或寻找
  //   战友入口」): it follows the sentence;
  // - an opening's sentence only summing up the chapter (「这些功能通过……共同构建……的完整闭环。」): it goes;
  // - a 当前 column of figures said weeks before later ones: it says when they were said.
  const keptToSources = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0].trim();
    if (opening) {
      const kept = opening.split(/(?<=[。！？])/u).filter(sentence => !SUMMING_UP.test(sentence.trim()));
      const text = kept.join("").trim();
      if (text && text !== opening) { body = body.replace(opening, () => text); changed = true; }
    }
    const dropped = chapter.problems.flatMap(problem => { const match = problem.match(/^"(.+)…" drops the condition "(.+)" of k\d+/u); return match ? [{ head: match[1].replace(/\*\*/gu, ""), condition: match[2].trim() }] : []; });
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text, claims = paragraph.claims ?? [];
      claims = claims.map(claim => {
        const names = claim.text.match(NAMED_LIST);
        if (!names || !text.includes(claim.text)) return claim;
        const listed = claim.unitIds.flatMap(id => units.get(id) ?? []), given = listed.map(unit => unit.statement).join(" ");
        if (names[1].split(/\s*[,，、]\s*/u).every(name => given.includes(name))) return claim;
        const said = claim.text.replace(names[0], "");
        text = text.replace(claim.text, () => said);
        return { ...claim, text: said };
      });
      for (const { head, condition } of dropped) {
        const plainText = text.replace(/\*\*/gu, "");
        if (!plainText.startsWith(head) || plainText.includes(condition) || /\n/u.test(text.trim())) continue;
        // Said already in other words: 「而非用户主动寻找战友或创建队伍」 is 「不再提供手动创建或寻找战友入口」.
        const own = [...knowledgeTerms(condition)], present = knowledgeTerms(plainText), shared = own.filter(term => present.has(term)).length;
        if (own.length && shared / own.length >= UNCLAIMED_SAID) continue;
        if (/^(?:不再|不|无需|禁止|取消)/u.test(condition) && /而非|而不是|不再|无需/u.test(plainText) && shared >= SAYS_SHARED) continue;
        const holder = claims.find(claim => claim.text.replace(/\*\*/gu, "").startsWith(head.slice(0, 12))) ?? claims[0];
        const sentence = `${condition.replace(/[。.；;]$/u, "")}。`;
        text = `${text.trimEnd()}${sentence}`;
        if (holder) claims = [...claims, { text: sentence, unitIds: holder.unitIds }];
      }
      const lines = text.split("\n"), head = lines.findIndex(line => /^\s*\|/u.test(line));
      if (head >= 0 && /^\s*\|?\s*:?-{3,}/u.test(lines[head + 1] ?? "")) {
        const heads = tableCells(lines[head]), at = heads.findIndex(cell => /^(?:当前状态|当前值|当前|现状|目前)$/u.test(cell));
        const figures = [...new Set(claims.flatMap(claim => claim.unitIds))].flatMap(id => units.get(id) ?? []).filter(wikiMeasure);
        const days = [...new Set(figures.map(unit => wikiSaidWhen(unit, true)).filter(Boolean))];
        if (at >= 0 && figures.length && days.length === 1) {
          lines[head] = lines[head].replace(heads[at], () => `当时（${days[0]}）`);
          // The user's figures said after them (8月18日: DAU 约40) follow the table, so it is not read as where things stand.
          const since = Math.max(...figures.map(unit => unit.evidence.conversationSpan?.start ?? 0));
          const later = all.filter(unit => unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about && wikiMeasure(unit) && (unit.evidence.conversationSpan?.start ?? 0) > since);
          const last = later.sort((a, b) => (a.evidence.conversationSpan?.start ?? 0) - (b.evidence.conversationSpan?.start ?? 0)).at(-1);
          if (last && wikiSaidWhen(last, true)) {
            const end = lines.length - 1 - [...lines].reverse().findIndex(line => /^\s*\|/u.test(line));
            lines.splice(end + 1, 0, "", `> 之后（${wikiSaidWhen(last, true)}）你提到：${last.statement.trim().replace(/^(?:用户(?:反馈|提到|报告|表示)称?)?(?:当前|目前|现在)?/u, "")}`);          }
          text = lines.join("\n");
        }
      }
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // What the writer said of its own, that no source gives:
  // - a sentence giving a reason for the decision before it (「这种渐进式路径旨在确保基础功能的稳固性……」), with no claim and
  //   few words of the paragraph's sources: it goes;
  // - a sentence telling only that something changed (「首屏信息密度经过多轮优化。」), with no claim: it goes;
  // - an opening sentence counting the chapter's subtopics (「用户主要使用紧急干预、复盘记录、社交互助和成长激励四大功能来达成
  //   目标。」), told as what users do: it goes, when the opening has more.
  const withoutFiller = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0].trim();
    const heads = [...new Set(chapter.paragraphs.map(paragraph => paragraph.subtopic.split(/与|和|及|、|\s/u)[0].trim()).filter(head => head.length >= 2))];
    if (opening && heads.length >= SUBTOPICS_COUNTED) {
      const sentences = opening.split(/(?<=[。！？])/u);
      const kept = sentences.filter(sentence => heads.filter(head => sentence.includes(head)).length < SUBTOPICS_COUNTED);
      const text = kept.join("").trim();
      if (text && text !== opening) { body = body.replace(opening, () => text); changed = true; }
    }
    const plain = (value: string) => value.replace(/\*\*/gu, "");
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const given = knowledgeTerms(paragraph.unitIds.flatMap(id => { const unit = units.get(id); return unit ? [unit.statement, unit.evidence.quote, ...unit.details] : []; }).join(" "));
      const held = (paragraph.claims ?? []).map(claim => plain(claim.text));
      const lines = paragraph.text.split("\n").map(line => {
        if (/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`|\*[^*])/u.test(line)) return line;
        return line.split(/(?<=[。！？])/u).filter(sentence => {
          const bare = plain(sentence).trim();
          if (held.some(claim => claim.includes(bare) || bare.includes(claim))) return true;
          if (CHANGE_ONLY.test(bare) && /^[^，,；;]*[。！？]?$/u.test(bare)) return false;
          if (!REASON_ONLY.test(bare)) return true;
          const own = [...knowledgeTerms(bare)];
          return own.filter(term => given.has(term)).length / Math.max(1, own.length) >= UNCLAIMED_SAID;
        }).join("");
      });
      const text = lines.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
      if (text === paragraph.text.trim()) return [paragraph];
      changed = true;
      if (!text) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // Coins told as money: 「挑战营报名费应设计为可返还的押金机制」, where the source spoke of paying 20 金币 and whether a failure
  // gets them back. A fee and a deposit read as real money, which the payment rules beside it forbid outside official
  // channels. The sentence names the coins.
  const coinsNamed = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text;
      const claims = paragraph.claims?.map(claim => {
        const quotes = claim.unitIds.flatMap(id => units.get(id)?.evidence.quote ?? []).join(" ");
        if (!/报名费|押金/u.test(claim.text) || !/金币/u.test(quotes) || /押金|报名费|[元¥￥]|人民币/u.test(quotes) || !text.includes(claim.text)) return claim;
        const said = claim.text.replace(/报名费/gu, "报名所需金币").replace(/(?<!金币)押金/gu, "金币押金");
        text = text.replace(claim.text, () => said);
        return { ...claim, text: said };
      });
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // The AI's own judgement in a table, told as 我 (「我的评价」, 「我最看好」): in the user's Wiki, 我 reads as the user.
  const aiNamed = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const text = paragraph.text.split("\n").map(line => /^\s*\|/u.test(line) ? line.replace(AI_FIRST_PERSON, (_, what?: string, most?: string, verb?: string) => what ? `AI ${what}` : `AI ${most ?? ""}${verb}`) : line).join("\n");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // The user's own sentence inside a paragraph of the AI's: 「科学戒色属于“窄蓝海”……。该领域缺乏龙头……。现有竞品仅停留在……，
  // 存在蓝海机会。」〔你〕 read as the user's market analysis, though only the last sentence was theirs. The user's sentences
  // stand as a paragraph of their own, so the mark covers only what they said.
  const yours = (claim: { unitIds: string[] }) => { const listed = claim.unitIds.flatMap(id => units.get(id) ?? []); return listed.length > 0 && listed.every(unit => unit.evidence.role === "user" && !unit.evidence.pasted && statuses.get(unit.id) !== "confirmed"); };
  const ownParagraphs = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const text = paragraph.text.trim(), claims = paragraph.claims ?? [];
      if (claims.length < 2 || /\n/u.test(text) || /^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`|\*)/u.test(text)) return [paragraph];
      const placed = claims.map(claim => ({ claim, at: text.indexOf(claim.text) })).sort((a, b) => a.at - b.at);
      if (placed.some(item => item.at < 0) || !placed.some(item => yours(item.claim)) || placed.every(item => yours(item.claim))) return [paragraph];
      const runs: Array<{ mine: boolean; claims: typeof claims; start: number }> = [];
      for (const { claim, at } of placed) {
        const mine = yours(claim), last = runs.at(-1);
        if (last && last.mine === mine) last.claims.push(claim); else runs.push({ mine, claims: [claim], start: runs.length ? at : 0 });
      }
      const pieces = runs.map((run, index) => ({ ...paragraph, text: text.slice(run.start, runs[index + 1]?.start ?? text.length).trim(), claims: run.claims, unitIds: paragraph.unitIds.filter(id => run.claims.some(claim => claim.unitIds.includes(id))) }));
      if (pieces.some(piece => !piece.text)) return [paragraph];
      const loose = paragraph.unitIds.filter(id => !pieces.some(piece => piece.unitIds.includes(id)));
      pieces[0] = { ...pieces[0], unitIds: [...pieces[0].unitIds, ...loose] };
      body = replaceParagraph(body, paragraph.text, () => pieces.map(piece => piece.text).join("\n\n")); changed = true;
      return pieces;
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // Each claim of a chapter told again: the returned text replaces it in its paragraph ("" takes it out), undefined
  // leaves it. A paragraph left empty goes.
  const rewritten = (chapter: (typeof draft.chapters)[number], change: (claim: WikiDraftClaim, paragraph: (typeof chapter.paragraphs)[number]) => { text: string; unitIds?: string[] } | undefined) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      let text = paragraph.text;
      // A claim in a table cell or a source block is no sentence to tell again: 「约30人（近期降至22人）」 in a cell, retold
      // as the user's three reports joined, broke the row, and the next cell's claim was replaced inside the retelling.
      const fenced = /^\s*(?:`{3,}|~{3,})/u.test(text);
      const claims = (paragraph.claims ?? []).flatMap(claim => {
        if (!text.includes(claim.text) || fenced || text.split("\n").some(line => /^\s*\|/u.test(line) && line.includes(claim.text))) return [claim];
        // A list of rows is a table written as items (「- **整体留存率**：数值/状态：26.92%」): its labels and values are
        // cells. Retold, 「19%」 became a sentence inside the sentence that 「整体留存率」 had become, line after line.
        const line = text.split("\n").find(each => each.includes(claim.text));
        if (line && (ROW_FIELDS.test(line) || line.includes(`**${claim.text.trim()}**`))) return [claim];
        const next = change(claim, paragraph);
        if (!next || next.text === claim.text) return [claim];
        text = text.replace(claim.text, () => next.text);
        return next.text ? [{ ...claim, text: next.text, unitIds: next.unitIds ?? claim.unitIds }] : [];
      });
      if (text === paragraph.text) return [paragraph];
      changed = true;
      text = text.replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
      if (!text) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  const bareStatement = (unit: WikiKnowledgeUnit) => unit.statement.trim().replace(/[。.]$/u, "");
  // A figure that lost its magnitude: 「约 2.88 条评价」 for Brainbuddy's 「约2.88万条评价」, in a table the writer joined from
  // two sources. Where every cited unit giving that figure gives it with 万, 千 or 亿, the magnitude goes back after it.
  const MAGNITUDE = /(\d+(?:\.\d+)?)\s*(万|千|亿)/gu;
  const magnitudeKept = (chapter: Chapter): Chapter => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text;
      const claims = (paragraph.claims ?? []).map(claim => {
        const sources = claim.unitIds.flatMap(id => units.get(id)?.statement ?? []);
        let told = claim.text;
        for (const [, figure, magnitude] of sources.flatMap(source => [...source.matchAll(MAGNITUDE)])) {
          const value = figure.replace(".", "\\.");
          const bare = new RegExp(`(?<![\\d.])${value}(?![\\d.]|\\s*(?:万|千|亿|%|‰))`, "u");
          if (!bare.test(told) || sources.some(source => bare.test(source))) continue;
          // Spaced as the text spaces its figures: 「约 2.88 条」 becomes 「约 2.88 万条」, 「约2.88条」 becomes 「约2.88万条」.
          told = told.replace(new RegExp(`(\\s?)(?<![\\d.])${value}(?![\\d.]|\\s*(?:万|千|亿|%|‰))\\s*`, "u"), (_, space: string) => `${space}${figure}${space ? " " : ""}${magnitude}`);
        }
        if (told === claim.text || !text.includes(claim.text)) return claim;
        text = text.replace(claim.text, () => told);
        return { ...claim, text: told };
      });
      if (text === paragraph.text) return paragraph;
      changed = true;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // An item of the writer's telling a point the user turned down by a field name and a bracket: 「- **AI Agent驾驶舱**：负责：
  // 首屏100%为AI Agent驾驶舱……（已否定）。」, a row of 「| 模块 | 负责 |」 moved to the earlier versions. Its 「负责：」 read as
  // part of the point and a lead was put before it (此前建议负责：……). It is told as the user's: 「你否定了「……」的方案。」
  const REJECTED_LABELLED = /^(\s*[-*+]\s+)\*\*[^*\n]+\*\*\s*[：:]\s*(?:[^：:，。\n]{1,6}[：:]\s*)?.+?[（(](?:已|被你?)否定[）)]\s*[。.]?\s*$/u;
  const rejectedLabelTold = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let claims = paragraph.claims ?? [];
      const lines = paragraph.text.split("\n").map(line => {
        const lead = line.match(REJECTED_LABELLED)?.[1];
        const own = claims.filter(claim => claim.text.trim().length >= 4 && line.includes(claim.text.trim()));
        const listed = [...new Set(own.flatMap(claim => claim.unitIds))].flatMap(id => units.get(id) ?? []);
        if (lead === undefined || !listed.length || !listed.every(unit => rejectedByYou(unit.id))) return line;
        const told = `你否定了${listed.map(unit => `「${bareStatement(unit)}」`).join("和")}的方案。`;
        claims = [...claims.filter(claim => !own.includes(claim) && !line.includes(`**${claim.text.trim()}**`)), { ...own[0], text: told, unitIds: listed.map(unit => unit.id) }];
        return `${lead}${told}`;
      });
      const text = lines.join("\n");
      if (text === paragraph.text) return paragraph;
      changed = true;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A sentence of prose only repeating a line of a code block in the chapter: 「基础风险 = 当前时间段历史风险 × 30%。」 above
  // the block of the scoring rules that opens with it. It said nothing more, and cited a source not stating it, which
  // failed the document's key check. It goes.
  const blockLineOut = (chapter: Chapter): Chapter => {
    const blockLines = new Set<string>();
    let fenced = false;
    for (const line of chapter.body.split("\n")) {
      if (/^\s*(?:```|~~~)/u.test(line)) { fenced = !fenced; continue; }
      if (fenced && line.trim().length >= 8) blockLines.add(line.trim().replace(/\s+/gu, " "));
    }
    if (!blockLines.size) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (/^\s*(?:```|~~~|\||>|#|[-*+]\s|\d+\.\s|\*[^*])/u.test(paragraph.text)) return [paragraph];
      const sentences = paragraph.text.split(/(?<=[。！？])/u);
      const gone = sentences.filter(sentence => blockLines.has(sentence.trim().replace(/[。！？]$/u, "").replace(/\s+/gu, " ")));
      if (!gone.length || gone.length === sentences.length && paragraph.claims?.some(claim => !gone.some(sentence => sentence.includes(claim.text.trim())))) return [paragraph];
      const text = sentences.filter(sentence => !gone.includes(sentence)).join("").trim();
      changed = true;
      if (!text) { body = removeParagraph(body, paragraph.text); return []; }
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims: (paragraph.claims ?? []).filter(claim => text.includes(claim.text.trim())) }];
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // Prices in brackets after an earlier version that its own source never gave: 「初期曾提出……一次性“30天AI守护计划”的模式
  // ……（含30天¥19.9、90天¥49.9及前7天免费体验）〔此前〕」 put today's prices on the replaced plan, and the reader took ¥19.9 for
  // replaced too. The bracket goes.
  const earlierPriceAsideOut = (chapter: Chapter): Chapter => !zhDraft ? chapter : rewritten(chapter, (claim, paragraph) => {
    if (!earlierHeading.test(paragraph.subtopic)) return undefined;
    const sources = claim.unitIds.flatMap(id => units.get(id)?.statement ?? []).join(" ").replace(/￥/gu, "¥");
    const text = claim.text.replace(/[（(][^（）()]*?¥\d[^（）()]*[）)]/gu, aside => (aside.match(/¥\d+(?:\.\d+)?/gu) ?? []).every(price => sources.includes(price)) ? aside : "");
    return text === claim.text ? undefined : { text };
  });
  // A clause saying a point was turned down that no cited point says and the user turned none of them down: 「此前曾提出用户开始
  // 计划后自动分配至守护小组……，但这些手动创建或寻找战友的入口及相关展示逻辑已被否定。」 told the opposite of what the user
  // rejected (automatic groups with no manual entry). The clause goes; what the user rejected is told where it is.
  const UNSAID_REJECTION = /[，,；;]\s*(?:但|而|不过|然而)?[^，,；;。]*?(?:已被|已经被|均被|都被|被)(?:否定|否决|拒绝|弃用|放弃)[^，,；;。]*([。]?)$/u;
  const unsaidRejectionOut = (chapter: Chapter): Chapter => rewritten(chapter, claim => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
    if (!listed.length || listed.some(unit => rejectedByYou(unit.id) || /否定|否决|拒绝|弃用|放弃/u.test(unit.statement))) return undefined;
    const cut = claim.text.match(UNSAID_REJECTION);
    if (!cut || claim.text.length - cut[0].length < 10) return undefined;
    return { text: `${claim.text.slice(0, claim.text.length - cut[0].length)}。` };
  });
  // An idea of the user's the writer told in a sentence citing only what the AI made of it later: 「早期曾建议将侧重点从戒色限制
  // 转向帮助青少年男性找回自信和自律，后为避免……明确将目标用户定位为 18-25 岁成年男性。」 cited only the AI's 18-25岁, and the
  // user's own suggestion read as the AI's. The sentence is told as two: the user's idea as theirs, then what came after.
  const IDEA_THEN = /^(\*\*)?(?:早期|此前|早先|最初|之前)?曾?(?:建议|提出|提议)([^。！？]{8,}?)[，,；;]\s*(?:后来|后|随后|之后)([^。！？]{8,}[。！？]?)$/u;
  const userIdeaTold = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text;
      const claims = (paragraph.claims ?? []).flatMap(claim => {
        const match = claim.text.trim().match(IDEA_THEN);
        if (!match || !text.includes(claim.text)) return [claim];
        const idea = match[2].trim(), said = knowledgeTerms(idea);
        const theirs = all.find(unit => unit.evidence.role === "user" && !unit.evidence.pasted && !claim.unitIds.includes(unit.id) && saysMostOf(said, unit.statement) && saysMostOf(knowledgeTerms(unit.statement), idea));
        if (!theirs) return [claim];
        const first = `${match[1] ?? ""}你此前曾提出${idea}。`, second = `后来${match[3].trim().replace(/[。！？]?$/u, "。")}`;
        text = text.replace(claim.text, () => `${first}${second}`);
        return [{ ...claim, text: first, unitIds: [theirs.id] }, { ...claim, text: second }];
      });
      if (text === paragraph.text) return paragraph;
      changed = true;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims, unitIds: [...new Set([...paragraph.unitIds, ...claims.flatMap(claim => claim.unitIds)])] };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  // A plan the user's answer turned down, told as an earlier proposal later replaced: 「早期曾提出首屏100%为AI Agent驾驶舱、
  // 原日历任务下移的方案……，这些已被当前的混合布局取代。」 The user chose 保留左侧布局，Agent作为卡片 over it: it was turned
  // down, not outgrown, and the sentence joining it to another proposal stated neither. Each is told as it was.
  // A replaced point told as now: 「当前策略是弱化“戒色”敏感词……」〔此前〕 said 当前 and was marked earlier. It is told as before.
  // A suggestion nobody decided told as the plan in force: 「关于首页主按钮的状态逻辑，现行方案为：平时显示“守护”……」 for the AI's
  // proposal, beside the open question on the same button; 「当前方案升级为包含10秒冷静弹窗……」 for another. The words
  // saying it holds go; what it is about stays.
  // A point with no subject after a joining word: 「此外，作为主要推广活动和新手留存手段，按天解锁……」 names its point's subject.
  const subjectOf = (claim: WikiDraftClaim) => { const subjects = [...new Set(claim.unitIds.flatMap(id => units.get(id)?.subject.trim() ?? []))]; return subjects.length === 1 && subjects[0].length <= 12 ? subjects[0] : ""; };
  const notInForce = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : rewritten(chapter, (claim, paragraph) => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
    if (!listed.length) return undefined;
    // The writer's word on how two versions relate, told as the point: 「此前曾提出分三版实施……，该方案与当前规划存在差异且未
    // 明确取代关系。」 The clause goes.
    const aside = claim.text.match(/[，,；;](?:该|此|这一?)(?:方案|版本|规划|提议|设计)[^，,。；;]{0,14}(?:未明确|尚未明确|不明确|未说明)[^，,。；;]{0,10}(?:取代|替代|关系)[^，,。；;]{0,6}(?=[。！？]|$)/u);
    if (aside) return { text: claim.text.replace(aside[0], "") };
    // A point opening on its change with no subject: 「升级为包含10秒冷静弹窗……的王牌功能」 names what it upgrades.
    const bare = claim.text.match(/^(\*\*)?(?=(?:升级为|改为|调整为|替换为)\S{4})/u);
    if (bare && subjectOf(claim) && /^\s*(?:\*\*)?$/u.test(paragraph.text.slice(0, paragraph.text.indexOf(claim.text)).split(/[。！？\n]/u).at(-1) ?? "")) return { text: `${bare[1] ?? ""}${subjectOf(claim)}${claim.text.slice(bare[0].length)}` };
    const joined = claim.text.match(/^((?:\*\*)?(?:此外|另外|同时)[，,])(?=(?:作为|用于|通过)\S{6})/u);
    if (joined && subjectOf(claim) && paragraph.text.indexOf(claim.text) > 0) return { text: `${joined[1]}${subjectOf(claim)}${claim.text.slice(joined[1].length)}` };
    // A stage the writer named from another roadmap: 「V4阶段每一步扩展需通过数据验证……」 beside the plan of three versions,
    // where its unit names no stage. The label goes.
    const stage = claim.text.match(/^(\*\*)?((?:V|v)\d+|第[一二三四五六七八九十\d]+)(?:阶段|版本?)[，,：:]?\s*/u);
    if (stage && !listed.some(unit => `${unit.statement} ${unit.evidence.quote}`.includes(stage[0].replace(/[，,：:\s*]+$/u, "").replace(/^\*\*/u, ""))) && claim.text.length - stage[0].length >= 8) return { text: `${stage[1] ?? ""}${claim.text.slice(stage[0].length)}` };
    // The AI's earlier suggestion told as decided: 「早期决定将“我的挑战”更名为“我的计划”」 for a reply nobody confirmed.
    const decided = claim.text.match(/(早期|此前|早先|之前|当时|最初)曾?(?:决定|确定)(?=将|把|采用|在|为)/u);
    if (decided && listed.every(unit => unit.evidence.role !== "user" && statuses.get(unit.id) !== "confirmed")) return { text: claim.text.replace(decided[0], `${decided[1]}曾建议`) };
    // A sentence citing the replaced version beside the one that replaced it, telling the newer as in force: 「现行方案将
    // “今日任务”升级为“今天只做这一件事”……」 for the AI's suggestion over its own earlier task card.
    const undecided = !listed.some(unit => statuses.get(unit.id) === "confirmed") && listed.some(unit => statuses.get(unit.id) !== "history");
    const ahead = undecided && listed.some(unit => statuses.get(unit.id) === "history") ? claim.text.match(/^(\*\*)?(?:现行|当前|目前的?)(?:方案|做法|设计|规划|策略)(?:为|是)?[：:，,]?\s*(?=将|把)/u) : null;
    if (ahead) return { text: `${ahead[1] ?? ""}${claim.text.slice(ahead[0].length)}` };
    if (listed.some(unit => statuses.get(unit.id) === "confirmed" || statuses.get(unit.id) === "history")) return undefined;
    // A suggestion that still holds told as replaced: 「此前曾提议将顶部大卡的核心指标……改为“今日状态”」 outside the earlier versions.
    const past = claim.text.match(/^(\*\*)?(?:此前|之前|早先|早期)曾?(?:提议|建议|提出)(?=将|把|在|对|采用|使用|增加|引入|优先|暂缓|先)/u);
    if (past && !earlierHeading.test(paragraph.subtopic) && listed.every(unit => unit.evidence.role !== "user")) return { text: `${past[1] ?? ""}AI 建议${claim.text.slice(past[0].length)}` };
    // The same with no subject: 「此前曾提出升级为包含10秒冷静弹窗……的王牌功能」 names what it upgrades.
    const pastChange = claim.text.match(/^(\*\*)?(?:此前|之前|早先|早期)曾?(?:提议|建议|提出)(?=升级为|改为|调整为)/u);
    if (pastChange && subjectOf(claim) && !earlierHeading.test(paragraph.subtopic) && listed.every(unit => unit.evidence.role !== "user")) return { text: `${pastChange[1] ?? ""}AI 建议将${subjectOf(claim)}${claim.text.slice(pastChange[0].length)}` };
    // The AI's reply opening on 采纳/确定 (「采纳中间按钮跳转AI……的方向，但禁止AI自由发挥聊天」) read as the user's choice.
    const adopted = claim.text.match(/^(\*\*)?(?=(?:采纳|确定|决定|确认)[^，,。]{4})/u);
    if (adopted && listed.every(unit => unit.evidence.role !== "user")) return { text: `${adopted[1] ?? ""}AI 建议${claim.text.slice(adopted[0].length)}` };
    // 「当前规划首页"守护"按钮应……」, 「当前建议改为强制引导……」: the same, in the writer's other words for it.
    const held = claim.text.match(/^(\*\*)?(?:关于([^，,：:]{2,20})[，,]\s*)?(?:现行|当前|目前的?)(方案|做法|设计|规划|策略|建议)(?:为|是)?[：:，,]?\s*/u);
    if (!held) return undefined;
    let rest = claim.text.slice(held[0].length);
    if (rest.replace(/[\s\p{P}]/gu, "").length < 6) return undefined;
    // 「同样确保……」 after its earlier version moved away leans on nothing.
    rest = rest.replace(/[，,]同样(?=确保|保证|需要|要求|实现|在)/u, "，并");
    const changes = /^(?:升级为|改为|调整为|采用|定为)/u.test(rest);
    const about = held[2] ? `${held[2]}：` : changes && subjectOf(claim) ? subjectOf(claim) : changes && held[3] === "建议" ? "建议" : "";
    if (!about && /^(?:升级为|改为|调整为|定为)/u.test(rest)) return undefined;
    return { text: `${held[1] ?? ""}${about}${rest}` };
  });
  const earlierNotNow = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : rewritten(chapter, claim => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
    const now = claim.text.match(/^(\*\*)?(?:当前|目前|现阶段|现在)(?=[的]?[\p{Script=Han}])/u);
    if (!now || !listed.length || !listed.every(unit => statuses.get(unit.id) === "history" && !rejectedByYou(unit.id) && !wikiMeasure(unit))) return undefined;
    return { text: `${now[1] ?? ""}此前${claim.text.slice(now[0].length)}` };
  });
  // A paragraph opening on 「另有提议……」 with nothing before it to be another to: 「另有提议通过60秒快速复盘……」 stood alone
  // between the evening review and an open question. The AI's suggestion is told as such.
  const anotherAlone = (chapter: Chapter): Chapter => !zhDraft ? chapter : rewritten(chapter, (claim, paragraph) => {
    const lead = claim.text.match(/^(\*\*)?另有(?:提议|建议|方案)(?:称|认为|提出)?[，,：:]?\s*/u);
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
    if (!lead || !paragraph.text.trimStart().startsWith(claim.text.trimStart()) || !listed.length || listed.some(unit => unit.evidence.role === "user")) return undefined;
    return { text: `${lead[1] ?? ""}AI 建议${claim.text.slice(lead[0].length)}` };
  });
  const turnedDown = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : rewritten(chapter, claim => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []), refused = listed.filter(unit => rejectedByYou(unit.id) && unit.evidence.role !== "user");
    // A sentence of turned-down points only is theirs whatever its words: 「此前采用系统自动分配同期小组」 read as adopted once.
    // A sentence telling as turned down a point the user never turned down beside one they did (「……的提议也被否定」 of the
    // group entry nobody declined): each is told as it was.
    const others = listed.filter(unit => !refused.includes(unit)), saysDeclined = /否定|否决|拒绝|不采用|未采纳|没有采纳/u.test(claim.text);
    // Of points the user never turned down, the clause saying they were goes: 「……以增强集体归属感的提议也被否定。」.
    if (!refused.length && saysDeclined && listed.length && listed.every(unit => unit.evidence.role !== "user")) {
      const text = claim.text.trim().replace(/(?:的)?(?:提议|方案|建议|做法)?(?:也|同样)?(?:已)?被(?:你)?(?:否定|否决)(?:了)?(?=[。！]?$)/u, "");
      return text === claim.text.trim() ? undefined : { text: /[。！]$/u.test(text) ? text : `${text}。` };
    }
    // Points all turned down, told as an earlier proposal with a clause of the writer's saying what was turned down: 「此前曾
    // 提出用户开始计划后自动分配至守护小组……，但这些手动创建或寻找战友的入口……已被否定。」 named the opposite of what the user
    // rejected. Told as theirs, in the points' own words.
    const toldAsProposal = !others.length && TOLD_EARLIER.test(claim.text.trim()) && /^(?:\*\*)?(?:此前|早期|早先|之前|最初)曾?(?:提出|建议|提议)/u.test(claim.text.trim());
    if (!refused.length || saysDeclined && !toldAsProposal && !others.some(unit => unit.evidence.role !== "user") || !saysDeclined && refused.length < listed.length && !TOLD_EARLIER.test(claim.text.trim())) return undefined;
    // The answer that turned it down names what holds instead: 「……该方案已被否定」 under the chosen 免费体验+订阅制 read as if
    // the 30-day plan itself were dropped, while only buying it once was.
    const chosen = [...new Set(refused.flatMap(unit => chosenInstead(unit.id)))];
    return { text: `你在回答中否定了${refused.map(unit => `「${bareStatement(unit)}」`).join("和")}的方案${chosen.length ? `，选择了${chosen.map(answer => `「${answer}」`).join("、")}` : ""}${others.length ? `；此前另有建议：${others.map(bareStatement).join("；")}` : ""}。` };
  });
  // A sentence joining the AI's restatement of the user's figures, which its own quote never gives (「日活约30人（近期降至22
  // 人）」, from a reply about the 19% retention), to a figure worked from the user's report (15人，占比约68%, 15 ÷ 22): read
  // together, 68% was 15 of 30. The restatement goes; the sentence is the figures its sources give.
  const unquotedFigures = (unit: WikiKnowledgeUnit) => {
    if (unit.evidence.role === "user" || !wikiMeasure(unit)) return false;
    const quote = unit.evidence.quote.replace(/\s+/gu, ""), figures = [...unit.statement.matchAll(COUNTED)].map(match => match[0].replace(/\s+/gu, ""));
    return figures.length > 0 && figures.filter(figure => !quote.includes(figure)).length * 2 > figures.length;
  };
  const figuresQuoted = (chapter: (typeof draft.chapters)[number]) => rewritten(chapter, claim => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []), restated = listed.filter(unquotedFigures), kept = listed.filter(unit => !restated.includes(unit));
    if (!restated.length || !kept.length || !kept.every(wikiMeasure)) return undefined;
    return { text: `${kept.map(bareStatement).join("；")}。`, unitIds: kept.map(unit => unit.id) };
  });
  // A subtopic opening on 「该路径旨在……」 whose path is told only by the note or block after it: the sentence pointed at
  // nothing. It follows what it points at.
  const pointsAhead = (chapter: (typeof draft.chapters)[number]) => {
    const paragraphs = [...chapter.paragraphs];
    let body = chapter.body;
    for (let at = 0; at < paragraphs.length - 1; at++) {
      const [lead, next] = [paragraphs[at], paragraphs[at + 1]];
      if (at > 0 && paragraphs[at - 1].subtopic === lead.subtopic || next.subtopic !== lead.subtopic) continue;
      if (!/^(?:\*\*)?(?:该|这一?|此|上述)(?:路径|流程|方案|机制|设计|结构|模式)/u.test(lead.text.trim()) || !/^\s*(?:>|\||```|\*[^*\n]+\*\s*\n)/u.test(next.text)) continue;
      const pair = `${lead.text}\n\n${next.text}`;
      if (!body.includes(pair)) continue;
      body = body.replace(pair, () => `${next.text}\n\n${lead.text}`);
      [paragraphs[at], paragraphs[at + 1]] = [next, lead];
      at++;
    }
    return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
  };
  // A figure the user gave, told as today's with no day: 「当前新增用户次日留存率为19%……」〔你〕, said in June beside an August
  // DAU. It says when.
  // The day of the user's latest figure, when they gave figures on two days or more.
  const measureDays = new Set(all.filter(unit => wikiMeasure(unit) && unit.evidence.role === "user" && !unit.evidence.pasted).map(unit => unit.evidence.conversationSpan?.start ?? 0).filter(Boolean));
  const newestMeasure = measureDays.size >= 2 ? Math.max(...measureDays) : Infinity;
  const qualifiedAlternatives = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    const alternatives = new Map<string, WikiKnowledgeUnit[]>();
    for (const paragraph of chapter.paragraphs) for (const id of paragraph.unitIds) {
      const unit = units.get(id);
      if (unit && wikiUserIdea(unit) && ["stated", "open"].includes(statuses.get(id) ?? "")) alternatives.set(paragraph.subtopic, [...alternatives.get(paragraph.subtopic) ?? [], unit]);
    }
    if (!alternatives.size) return chapter;
    return rewritten(chapter, (claim, paragraph) => {
      const unit = claim.unitIds.length === 1 ? units.get(claim.unitIds[0]) : undefined;
      const text = qualifiedDiscussionIdea(claim.text, unit, statuses, alternatives.get(paragraph.subtopic) ?? []);
      return text ? { text } : undefined;
    });
  };
  const nowDated = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : rewritten(chapter, claim => {
    const listed = claim.unitIds.flatMap(id => units.get(id) ?? []);
    if (!listed.length || !listed.every(wikiMeasure) || !/^(?:\*\*)?(?:当前|目前)/u.test(claim.text.trim()) || /\d+月\d+日/u.test(claim.text)) return undefined;
    const days = [...new Set(listed.map(unit => wikiSaidWhen(unit, true)).filter(Boolean))];
    if (days.length !== 1) return undefined;
    // The latest figure the user gave holds today: its 当前 stays, with its day.
    const saidAt = (unit: WikiKnowledgeUnit) => unit.evidence.conversationSpan?.start ?? 0;
    if (listed.every(unit => saidAt(unit) > 0 && saidAt(unit) >= newestMeasure)) return { text: claim.text.trim().replace(/([。.]?)$/u, (_, end: string) => `（${days[0]}）${end || "。"}`) };
    return { text: claim.text.trim().replace(/^(\*\*)?(?:当前|目前)/u, (_, bold?: string) => `${bold ?? ""}当时`).replace(/([。.]?)$/u, (_, end: string) => `（${days[0]}）${end || "。"}`) };
  });
  // The positioning told again in other words: 「产品定位为垂直、科学可信的个人行为恢复系统……」 opened the chapter, and
  // 「……打造隐私优先、科学可信……的个人行为恢复系统」, 「产品定位为……戒色守护Agent」 and 「产品核心应定位为……」 followed it.
  // A positioning sentence mostly saying one before it goes; a decision or the user's own words stay.
  const positioningOnce = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    const said: Set<string>[] = opening.split(/(?<=[。！？])/u).filter(sentence => POSITIONING.test(sentence)).map(sentence => knowledgeTerms(sentence));
    return rewritten(chapter, (claim, paragraph) => {
      if (/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`)/u.test(paragraph.text.trim()) || !POSITIONING.test(claim.text)) return undefined;
      if (claim.unitIds.some(id => statuses.get(id) === "confirmed" || units.get(id)?.evidence.role === "user")) return undefined;
      const own = [...knowledgeTerms(claim.text)];
      const again = said.some(earlier => own.filter(term => earlier.has(term)).length / Math.max(1, own.length) >= POSITIONING_AGAIN);
      said.push(new Set(own));
      return again ? { text: "" } : undefined;
    });
  };
  // When a block was said: its conversation, then its message. A later table or flow is the one that holds.
  const saidAt = (ids: string[]) => Math.max(0, ...ids.map(id => { const unit = units.get(id); return (unit?.evidence.conversationSpan?.start ?? 0) + (unit?.evidence.messageIndex ?? 0); }));
  const decidedIn = (ids: string[]) => ids.some(id => statuses.get(id) === "confirmed");
  // Two tables of one comparison, or two flows of one path, in one chapter (one run put the second under 合规 and the first
  // under 定价): the free and paid features compared twice
  // (「能力 | 免费用户 | 30天守护计划」, then 「功能 | 免费 | 付费」, seven of ten rows the same features), the payment path drawn
  // twice from one answer. The later said stays; of two from one message, the first shown.
  const repeatedBlocks = (chapter: (typeof draft.chapters)[number]) => {
    const fence = (text: string) => text.match(/```[^\n]*\n([\s\S]*?)```/u)?.[1];
    const rows = (text: string) => { const lines = text.split("\n").filter(line => /^\s*\|/u.test(line)); return lines.length >= 3 ? lines.slice(2).map(line => tableCells(line)[0] ?? "") : []; };
    const columns = (text: string) => tableCells(text.split("\n").find(line => /^\s*\|/u.test(line)) ?? "").length;
    const flow = (text: string) => { const code = fence(text); return code && code.split("\n").filter(line => /[→↓]|->/u.test(line)).length >= 2 ? code : undefined; };
    const pairs = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, at) => text.slice(at, at + 2)).filter(pair => /^\p{Script=Han}{2}$/u.test(pair)));
    const alike = (a: string, b: string) => a === b || [...pairs(a)].some(pair => pairs(b).has(pair));
    const same = (first: (typeof chapter.paragraphs)[number], second: (typeof chapter.paragraphs)[number]) => {
      const [a, b] = [rows(first.text), rows(second.text)];
      if (a.length >= BLOCK_ROWS_MIN && b.length >= BLOCK_ROWS_MIN && !fence(first.text) && !fence(second.text)) {
        const [few, many] = a.length <= b.length ? [a, b] : [b, a];
        return columns(first.text) === columns(second.text) && few.filter(label => many.some(other => alike(label, other))).length / few.length >= SAME_ROWS;
      }
      const [x, y] = [flow(first.text), flow(second.text)];
      if (!x || !y) return false;
      const [p, q] = [knowledgeTerms(x), knowledgeTerms(y)];
      return [...p].filter(term => q.has(term)).length / Math.max(1, Math.min(p.size, q.size)) >= SAME_FLOW;
    };
    const dropped = new Set<(typeof chapter.paragraphs)[number]>();
    chapter.paragraphs.forEach((first, at) => chapter.paragraphs.slice(at + 1).forEach(second => {
      if (dropped.has(first) || dropped.has(second) || !same(first, second) || decidedIn(first.unitIds) || decidedIn(second.unitIds)) return;
      dropped.add(saidAt(first.unitIds) < saidAt(second.unitIds) ? first : second);
    }));
    if (!dropped.size) return chapter;
    return { ...chapter, body: [...dropped].reduce((body, paragraph) => removeParagraph(body, paragraph.text), chapter.body), paragraphs: chapter.paragraphs.filter(paragraph => !dropped.has(paragraph)) };
  };
  // 「第一版」 alone, where the document has several (the home redesign's, the rescue flow's, the risk model's): the sentence
  // names whose, from its units' subject.
  const firstVersionNamed = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : rewritten(chapter, (claim, paragraph) => {
    if (/^\s*\|/u.test(paragraph.text) || !/(?:^|[，,；;])\s*(?:\*\*)?第一版/u.test(claim.text.trim())) return undefined;
    const subjects = [...new Set(claim.unitIds.flatMap(id => units.get(id)?.subject.trim() ?? []))];
    const subject = subjects.length === 1 && subjects[0].length <= 12 && !/第一版|版本|项目|产品/u.test(subjects[0]) ? subjects[0] : "";
    if (!subject || claim.text.includes(subject)) return undefined;
    return { text: claim.text.trim().replace(/(^|[，,；;]\s*)(\*\*)?第一版/u, (_, lead: string, bold?: string) => `${lead}${bold ?? ""}${subject}第一版`) };
  });
  // An opening joining a later figure to an earlier goal: 「目标是从当前约40日活突破至稳定50人再到100人」, where the goal
  // said 从40人突破 in June, when 40 was the ceiling and the users were 32. The goal keeps its own words.
  const openingGoals = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    if (!opening) return chapter;
    const text = opening.replace(/从(?:当前|目前)约?(\d+)\s*(?:日活|人)/gu, (whole, value: string) => all.some(unit => unit.statement.includes(`从${value}人`)) ? `从${value}人` : whole);
    return text === opening ? chapter : { ...chapter, body: chapter.body.replace(opening, () => text) };
  };
  // A figure the user reported, told in a chapter's opening with no day: 「整体留存率为26.92%，新增用户次日留存为19%。」 led the
  // growth chapter as today's, beside an August DAU. A sentence whose figures all come from one dated measure says when.
  const openingDated = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    if (!zhDraft || !opening) return chapter;
    // Only the user's own: 「Brainbuddy 在 Google Play 显示下载量超50万次」 took the day of the conversation citing it.
    const measures = (chapter.openingUnitIds ?? []).flatMap(id => units.get(id) ?? []).filter(unit => wikiMeasure(unit) && unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about);
    const figures = (text: string) => figuresIn(text, { percent: true });
    const text = opening.split(/(?<=[。！？])/u).map(sentence => {
      const own = figures(sentence);
      if (!own.length || /\d+月\d+日/u.test(sentence)) return sentence;
      const days = [...new Set(measures.filter(unit => own.every(figure => figures(unit.statement).includes(figure))).map(unit => wikiSaidWhen(unit, true)).filter(Boolean))];
      return days.length === 1 ? sentence.replace(/^(\s*)(?:当前|目前)/u, "$1当时").replace(/([。！？]?)$/u, (_, end: string) => `（${days[0]}）${end || "。"}`) : sentence;
    }).join("");
    return text === opening ? chapter : { ...chapter, body: chapter.body.replace(opening, () => text) };
  };
  // A plan of the user's own no chapter tells: 「计划将戒色行为转化为算法，结合历史破戒时间和诱因计算高危时段并实施提前干预。」,
  // the idea the algorithm conversation started from, was in no chapter. It follows the paragraph sharing most of its words.
  const keptUserPoints = (written: typeof draft.chapters) => {
    const told = new Set(written.flatMap(chapter => [...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)]));
    const prose = (text: string) => !/^\s*(?:\||>|#|`|\*[^*])/u.test(text.trim());
    const untold = all.filter(unit => unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about && ["plan", "decision", "constraint", "mechanism", "question"].includes(unit.kind)
      && !told.has(unit.id) && !draftCited.has(unit.id) && !["history", "rejected", "confirmed"].includes(statuses.get(unit.id) ?? "")
      && !ASKED_ONLY.test(unit.statement.trim()) && !ASKS.test(unit.statement) && !/^(?:用户|需要?)?(?:评估|分析|了解|判断|比较|询问)/u.test(unit.statement.trim()));
    // A question no chapter tells, whose answer none tells either (「AI戒色是否有效」, one conversation): the answer.
    const unanswered = all.filter(unit => unit.evidence.role === "user" && !unit.evidence.pasted && !unit.about && ASKED_ONLY.test(unit.statement.trim()) && !told.has(unit.id) && !draftCited.has(unit.id))
      .flatMap(unit => { const answer = answerOf(unit); if (!answer || told.has(answer.id)) return []; answersGiven.add(answer.id); return [answer]; });
    let chapters = written;
    for (const unit of [...untold, ...unanswered]) {
      const own = knowledgeTerms(unit.statement);
      const share = (text: string) => { const terms = knowledgeTerms(text); return [...own].filter(term => terms.has(term)).length; };
      if (chapters.some(chapter => chapter.paragraphs.some(paragraph => share(paragraph.text) / Math.max(1, own.size) >= UNCLAIMED_SAID))) continue;
      let best: { chapter: number; paragraph: number; shared: number } | undefined;
      chapters.forEach((chapter, at) => chapter.paragraphs.forEach((paragraph, index) => {
        const shared = prose(paragraph.text) ? share(paragraph.text) : 0;
        if (shared >= SAYS_SHARED && (!best || shared > best.shared)) best = { chapter: at, paragraph: index, shared };
      }));
      if (!best) continue;
      const { chapter: at, paragraph: index } = best, chapter = chapters[at], after = chapter.paragraphs[index];
      const said = unit.evidence.role === "user" && /^(?:计划|打算|希望|想|提议|准备|决定|认为)/u.test(unit.statement.trim()) && zhDraft ? `你${unit.statement.trim()}` : unit.statement.trim();
      const added = { subtopic: after.subtopic, text: said, unitIds: [unit.id], claims: [{ text: said, unitIds: [unit.id] }] };
      chapters = chapters.map((item, position) => position !== at ? item : { ...item, body: replaceParagraph(item.body, after.text, () => `${after.text}\n\n${said}`), paragraphs: [...item.paragraphs.slice(0, index + 1), added, ...item.paragraphs.slice(index + 1)] });
    }
    return chapters;
  };
  // A sentence of figures an earlier chapter already gave from the same conversation: 「小程序当时每天稳定在22人，其中15个为
  // 稳定用户」 in the growth chapter, after 「当时日活稳定在22人，其中15人为连续使用的核心用户，占比约68%」 in the retention one.
  // Dates in brackets are not figures of their own.
  // One list giving the same figures in two items: 「- **早期数据**：此前小程序每天稳定在22人……，其中15个为稳定用户；当时日活仅25……」
  // beside 「- **核心构成**：当时日活稳定在22人……，其中15人为连续使用的核心用户，占比约68%。」 The clause another item gives whole,
  // with more, goes; the rest of its item stays.
  const listFiguresOnce = (chapter: (typeof draft.chapters)[number]) => {
    const figuresOf = (text: string) => new Set(figuresIn(text));
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const lines = paragraph.text.split("\n");
      if (lines.length < 2 || !lines.every(line => /^\s*[-*+]\s/u.test(line))) return [paragraph];
      const whole = lines.map(line => ({ figures: figuresOf(line), terms: knowledgeTerms(line) }));
      const cut: string[] = [];
      const kept = lines.flatMap((line, at) => {
        const head = line.match(/^\s*[-*+]\s+(?:\*\*[^*\n]+\*\*[：:]\s*)?/u)![0];
        const clauses = line.slice(head.length).match(/[^；;]+(?:[；;]|$)/gu) ?? [];
        if (clauses.length < 2) return [line];
        const left = clauses.filter(clause => {
          const figures = figuresOf(clause), terms = knowledgeTerms(clause.replace(/[；;。]$/u, ""));
          const given = figures.size >= 2 && whole.some((other, index) => index !== at && other.figures.size > figures.size && [...figures].every(value => other.figures.has(value)) && [...terms].filter(term => other.terms.has(term)).length / Math.max(1, terms.size) >= LIST_FIGURES_AGAIN);
          if (given) cut.push(clause.replace(/[；;。]$/u, ""));
          return !given;
        });
        if (left.length === clauses.length) return [line];
        return left.length ? [`${head}${left.join("").replace(/[；;]$/u, "。")}`] : [];
      });
      if (!cut.length) return [paragraph];
      const text = kept.join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      const claims = (paragraph.claims ?? []).map(claim => ({ ...claim, text: cut.reduce((value, clause) => value.replace(clause, ""), claim.text).replace(/^[；;，,\s]+|[；;，,\s]+$/gu, "") })).filter(claim => claim.text);
      return [{ ...paragraph, text, claims }];
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) && paragraphs.length === chapter.paragraphs.length ? chapter : { ...chapter, body, paragraphs };
  };
  // A report the user gave weeks before, standing as its own paragraph after the one giving the latest figure on the same
  // measure (「**你反馈日活停留在32人左右（6月14日—7月7日）**……」 after 「当前小程序日活（DAU）约40（8月18日）……」): read
  // alone, the older figure stood beside the latest as another current one. It joins that paragraph, told as earlier.
  const DAY = /(\d{1,2})月(\d{1,2})日/u;
  const dayNumber = (text: string) => { const day = text.match(DAY); return day ? Number(day[1]) * 100 + Number(day[2]) : 0; };
  const earlierReportJoined = (chapter: (typeof draft.chapters)[number]) => {
    const plainProse = (text: string) => !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`)/u.test(text.trim()) && !/\n/u.test(text.trim());
    let body = chapter.body, changed = false;
    const paragraphs: typeof chapter.paragraphs = [];
    for (const paragraph of chapter.paragraphs) {
      const before = paragraphs.at(-1);
      const theirs = paragraph.claims ?? [], unbold = paragraph.text.replace(/\*\*/gu, "").trim();
      const lastDays = before ? [...before.text.matchAll(new RegExp(DAY.source, "gu"))].map(match => dayNumber(match[0])) : [];
      const join = before && before.subtopic === paragraph.subtopic && plainProse(before.text) && plainProse(paragraph.text) && theirs.length > 0
        && theirs.every(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => units.get(id)?.evidence.role === "user"))
        && (unbold.match(/[。！？]/gu)?.length ?? 0) <= 1 && dayNumber(unbold) > 0 && lastDays.length > 0 && dayNumber(unbold.match(/[（(][^）)]*[）)]/u)?.[0].split(/[—–-]/u).at(-1) ?? unbold) < Math.max(...lastDays)
        && /^(?:当前|目前|现在)/u.test(before.text.replace(/\*\*/gu, "").trim())
        && [...knowledgeTerms(unbold)].some(term => /^\p{Script=Han}{2}$/u.test(term) && knowledgeTerms(before.text).has(term) && /日活|留存|用户|付费|收入|活跃/u.test(term));
      if (!join || !before) { paragraphs.push(paragraph); continue; }
      const told = (value: string) => { const bare = value.replace(/\*\*/gu, "").trim(); return unbold.startsWith(bare) && !/^(?:此前|当时|早先|之前)/u.test(bare) ? `此前${bare}` : bare; };
      const text = `${before.text.trim()}${told(paragraph.text)}`;
      body = replaceParagraph(removeParagraph(body, paragraph.text), before.text, () => text);
      paragraphs[paragraphs.length - 1] = { ...before, text, unitIds: [...new Set([...before.unitIds, ...paragraph.unitIds])], claims: [...before.claims ?? [], ...theirs.map(claim => ({ ...claim, text: told(claim.text) }))] };
      changed = true;
    }
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  const repeatedFigures = (written: typeof draft.chapters) => {
    const figuresOf = (text: string) => new Set(figuresIn(text));
    const conversations = (ids: string[]) => new Set(ids.flatMap(id => units.get(id)?.evidence.conversationId ?? []));
    const prose = (text: string) => !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`|\*[^*])/u.test(text.trim());
    // Every sentence of figures in the document, in reading order; the one another gives whole goes: the later of two
    // giving the same, or the one giving fewer (「每天稳定在22人，其中15个为稳定用户」 beside 「日活稳定在22人，其中15人……占比约68%」).
    const told = written.flatMap((chapter, at) => chapter.paragraphs.filter(paragraph => prose(paragraph.text)).flatMap(paragraph => (paragraph.claims ?? []).map(claim => ({ at, text: claim.text, figures: figuresOf(claim.text), terms: knowledgeTerms(claim.text), from: conversations(claim.unitIds), decided: decidedIn(claim.unitIds) }))));
    const gives = (whole: (typeof told)[number], part: (typeof told)[number]) => [...part.figures].every(value => whole.figures.has(value)) && [...part.from].some(id => whole.from.has(id)) && [...part.terms].filter(term => whole.terms.has(term)).length / Math.max(1, part.terms.size) >= FIGURES_AGAIN;
    const dropped = new Set<(typeof told)[number]>();
    told.forEach((item, index) => {
      if (item.figures.size < 2 || item.decided) return;
      if (told.some((other, at) => other !== item && !dropped.has(other) && gives(other, item) && (other.figures.size > item.figures.size || at < index))) dropped.add(item);
    });
    // A clause after the current figure telling earlier ones another sentence gives whole (「当前小程序日活约40……；此前报告
    // 每天稳定在22人……，其中15个为稳定用户。」 beside 「当时日活稳定在22人……，其中15人为连续使用的核心用户，占比约68%。」):
    // the clause goes, the sentence stays.
    // Said of the same days, the same figures are the same report, in whatever words.
    const dayOf = (text: string) => text.match(/[（(](\d+月\d+日[^）)]*)[）)]/u)?.[1] ?? "";
    const clauses = told.filter(item => !dropped.has(item)).flatMap(item => (item.text.match(/[^；;]+(?:[；;]|$)/gu) ?? []).slice(1).map(part => ({ ...item, part, figures: figuresOf(part), terms: knowledgeTerms(part) })));
    const cut = clauses.filter(clause => clause.figures.size >= 2 && told.some(other => other.text !== clause.text && !dropped.has(other) && other.figures.size >= clause.figures.size
      && (gives(other, clause) || [...clause.figures].every(value => other.figures.has(value)) && [...clause.from].some(id => other.from.has(id)) && Boolean(dayOf(clause.part)) && dayOf(clause.part) === dayOf(other.text))));
    const withoutCut = (at: number, text: string) => cut.filter(clause => clause.at === at && clause.text === text).reduce((value, clause) => value.replace(clause.part, ""), text).replace(/[；;，,\s]+$/u, "").replace(/([^。！？])$/u, "$1。");
    return written.map((chapter, at) => rewritten(chapter, (claim, paragraph) => !prose(paragraph.text) ? undefined : [...dropped].some(item => item.at === at && item.text === claim.text) ? { text: "" } : cut.some(clause => clause.at === at && clause.text === claim.text) ? { text: withoutCut(at, claim.text) } : undefined));
  };
  // A list item whose label names another chapter's subtopic and nothing of its own: 「- **首页布局**：首页中间区域由连续天数改为
  // 风险值仪表盘……」 under 「AI Agent机制」, while 「首页架构与布局」 is a subtopic of the interface chapter. It moves there, after
  // that subtopic's last paragraph.
  // An item telling only the current version of a point whose every other version is told in one other chapter:
  // 「- **首页逻辑**：将“今日任务”升级为“今天只做这一件事”……」 stood among the development plan's acceptance rules, while
  // the task card it replaced was told under the interface chapter. It follows its versions, to the subtopic there
  // saying most of what it says.
  const chains = wikiDecidedTopics(ledger.organization?.topics, ledger.decisions);
  const earlierHeading = /^(?:早先版本|Earlier versions)$/u;
  // A version in force told among the earlier ones: 「此前曾建议弱化“戒色”敏感词……；现行策略仍坚持深耕“戒色”……」 under 早先版本,
  // and 「……当前规划将“今日任务”升级为“今天只做这一件事”……」 after the task card it replaced, each read as before. A clause
  // saying most of its chain's current version and none of its earlier ones leaves them: gone when the chapter tells that
  // version before them, else its own paragraph closing the part before them.
  type Paragraph = (typeof draft.chapters)[number]["paragraphs"][number];
  const currentOutOfEarlier = (chapter: (typeof draft.chapters)[number]) => {
    const first = chapter.paragraphs.findIndex(paragraph => earlierHeading.test(paragraph.subtopic));
    if (!zhDraft || first < 1 || earlierHeading.test(chapter.paragraphs[first - 1].subtopic)) return chapter;
    // The chapter before its earlier versions, its opening with it (「项目决定先深耕“戒色”单一垂直领域……」).
    const told = (chapter.paragraphs.filter(paragraph => earlierHeading.test(paragraph.subtopic)).reduce((body, paragraph) => body.replace(paragraph.text, ""), chapter.body).match(/[^。！？\n]+/gu) ?? []).map(sentence => knowledgeTerms(sentence));
    let body = chapter.body;
    const moved: Paragraph[] = [];
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (!earlierHeading.test(paragraph.subtopic) || /\n/u.test(paragraph.text.trim()) || /^\s*(?:[-*+]\s|\d+\.\s|\||>|#|\*|`)/u.test(paragraph.text)) return [paragraph];
      const ids = new Set([...paragraph.unitIds, ...(paragraph.claims ?? []).flatMap(claim => claim.unitIds)]);
      const own = chains.filter(topic => topic.earlier.some(id => ids.has(id)));
      const before = own.flatMap(topic => topic.earlier).flatMap(id => units.get(id) ?? []);
      const now = own.flatMap(topic => topic.current).filter(id => statuses.get(id) !== "history").flatMap(id => units.get(id) ?? []);
      // A clause turning to the version in force splits off too: 「早期曾提出弱化“戒色”敏感词……，但现行决定仍深耕“戒色”单一垂直
      // 领域。」 under 早先版本, and the key decisions listed that clause, placed in the earlier versions.
      const parts = (paragraph.text.trim().match(/[^。！？；;]+(?:[。！？；;]|$)/gu) ?? []).flatMap(part => part.split(CURRENT_TURN));
      if (!now.length || parts.length < 2) return [paragraph];
      const out = parts.flatMap(part => {
        const terms = knowledgeTerms(part.replace(/[。！？；;]$/u, ""));
        const unit = now.find(item => saysMostOf(terms, item.statement));
        return unit && !before.some(item => saysMostOf(terms, item.statement)) ? [{ part, unit }] : [];
      });
      if (!out.length || out.length === parts.length) return [paragraph];
      const taken = new Set(out.map(item => item.part)), closed = (value: string) => value.trim().replace(/[，,；;]\s*([。！？]?)$/u, "。");
      const text = closed(parts.filter(part => !taken.has(part)).join(""));
      for (const { part, unit } of out) {
        if (told.some(sentence => saysMostOf(sentence, unit.statement))) continue;
        const said = closed(part.replace(/^\s*(?:\*\*)?(?:现行|当前|目前|现在|现已|后来?|最终)的?(?:方案|做法|设计|规划|策略|建议)?(?:仍|已)?(?:为|是)?[：:，,]?\s*/u, ""));
        moved.push({ subtopic: chapter.paragraphs[first - 1].subtopic, text: said, unitIds: [unit.id], claims: [{ text: said, unitIds: [unit.id] }] } as Paragraph);
      }
      const cores = [...taken].map(part => part.trim().replace(/[。！？；;]$/u, "")), goneIds = new Set(out.map(item => item.unit.id));
      const claims = (paragraph.claims ?? []).map(claim => {
        const rest = cores.reduce((value, core) => value.replace(core, ""), claim.text);
        if (rest === claim.text) return claim;
        const left = claim.unitIds.filter(id => !goneIds.has(id));
        return { ...claim, text: closed(rest), unitIds: left.length ? left : claim.unitIds };
      });
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => !goneIds.has(id) || claims.some(claim => claim.unitIds.includes(id))) }];
    });
    if (paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at])) return chapter;
    if (moved.length) {
      const last = paragraphs[first - 1];
      body = replaceParagraph(body, last.text, () => [last.text, ...moved.map(item => item.text)].join("\n\n"));
      paragraphs.splice(first, 0, ...moved);
    }
    return { ...chapter, body, paragraphs };
  };
  // A list item telling only replaced versions among the current points: 「2. **早期策略**：弱化“戒色”敏感词……〔此前〕」 in
  // 核心定义与目标, 「- **信息密度**：首屏应减少密度……〔此前〕」 among the home screen's current rules. It goes to the earlier
  // versions, a section of its own when the chapter has none. A point turned down is told as such where it stands, and a
  // figure reported earlier stays with the figures.
  const ITEM = /^\s*(?:[-*+]|\d+\.)\s+/u;
  const replacedNow = (unit: WikiKnowledgeUnit) => statuses.get(unit.id) === "history" && !rejectedByYou(unit.id) && !wikiMeasure(unit) || outgrown.has(unit.id);
  const earlierItemsOut = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const plain = (value: string) => value.replace(/\*\*/gu, "");
    const out: Paragraph[] = [];
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const lines = paragraph.text.split("\n");
      // A sentence of prose telling only a suggestion a later reply set aside: 「中央悬浮“+”号含义不明，建议改为盾牌……」 after
      // the AI took up the user's idea for the button.
      if (!earlierHeading.test(paragraph.subtopic) && lines.length === 1 && !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`|\*[^*])/u.test(paragraph.text)) {
        // A paragraph that is one replaced version and nothing else: 「早期曾将“我现在有冲动”和“刚刚失守”设为一级紧急入口……」
        // between the current emergency flow and its buttons, marked 〔此前〕. It goes to the earlier versions whole.
        const only = paragraph.claims?.length === 1 ? paragraph.claims[0] : undefined;
        const onlyUnits = only?.unitIds.flatMap(id => units.get(id) ?? []) ?? [];
        if (only && onlyUnits.length && onlyUnits.length === only.unitIds.length && onlyUnits.every(unit => replacedNow(unit) || outgrown.has(unit.id)) && plain(paragraph.text).replace(/\s/gu, "") === plain(only.text).replace(/\s/gu, "")) {
          out.push({ subtopic: "早先版本", text: `- ${only.text.trim()}`, unitIds: [...only.unitIds], claims: [only] } as Paragraph);
          body = removeParagraph(body, paragraph.text);
          return [];
        }
        const gone = (paragraph.claims ?? []).filter(claim => /[。！？]$/u.test(claim.text.trim()) && claim.unitIds.length > 0 && claim.unitIds.every(id => outgrown.has(id)) && paragraph.text.includes(claim.text));
        const text = gone.reduce((value, claim) => value.replace(claim.text, ""), paragraph.text).trim();
        if (!gone.length || text.replace(/[\s*]/gu, "").length < 8) return [paragraph];
        for (const claim of gone) out.push({ subtopic: "早先版本", text: `- ${claim.text.trim()}`, unitIds: [...claim.unitIds], claims: [claim] } as Paragraph);
        body = replaceParagraph(body, paragraph.text, () => text);
        const claims = (paragraph.claims ?? []).filter(claim => !gone.includes(claim));
        return [{ ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => !outgrown.has(id) || claims.some(claim => claim.unitIds.includes(id))) }];
      }
      // A table row telling only a replaced version among the current rows: 「| 中央悬浮按钮 | 中央悬浮“+”号含义不明，建议改为
      // 盾牌……|」〔此前〕 in the table of the AI's roles. It goes to the earlier versions as an item named by its first cell.
      if (!earlierHeading.test(paragraph.subtopic) && lines.length >= 4 && lines.every(line => /^\s*\|/u.test(line)) && /^\s*\|?\s*:?-{3,}/u.test(lines[1])) {
        const header = tableCells(lines[0]);
        const rowClaims = (line: string) => (paragraph.claims ?? []).filter(claim => claim.text.trim().length >= 2 && line.includes(claim.text.trim()));
        const old = lines.slice(2).filter(line => { const own = rowClaims(line); return own.length > 0 && own.every(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => { const unit = units.get(id); return Boolean(unit) && (replacedNow(unit!) || outgrown.has(id)); })); });
        if (!old.length || old.length === lines.length - 2) return [paragraph];
        for (const line of old) {
          const [name, ...values] = tableCells(line), claims = rowClaims(line).filter(claim => claim.text.trim() !== name.replace(/\*\*/gu, "").trim());
          // Two columns: the value alone after the row's name; 「负责：」 from the header read as a field of the point.
          const told = header.length === 2 ? values[0].trim().replace(/(?<![。！？])$/u, "。") : rowFields(header.slice(1), values, true);
          out.push({ subtopic: "早先版本", text: `- **${name.replace(/\*\*/gu, "").trim()}**：${told}`, unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], claims } as Paragraph);
        }
        const text = lines.filter(line => !old.includes(line)).join("\n"), claims = (paragraph.claims ?? []).filter(claim => text.includes(claim.text.trim()));
        body = replaceParagraph(body, paragraph.text, () => text);
        return [{ ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => claims.some(claim => claim.unitIds.includes(id)) || !out.some(item => item.unitIds.includes(id))) }];
      }
      if (earlierHeading.test(paragraph.subtopic) || lines.length < 2 || !lines.every(line => ITEM.test(line))) return [paragraph];
      const moving = lines.filter(line => {
        const claims = (paragraph.claims ?? []).filter(claim => claim.text.trim() && plain(line).includes(plain(claim.text)));
        const listed = claims.flatMap(claim => claim.unitIds).flatMap(id => units.get(id) ?? []);
        return listed.length > 0 && listed.every(replacedNow);
      });
      if (!moving.length || moving.length === lines.length) return [paragraph];
      for (const line of moving) {
        const claims = (paragraph.claims ?? []).filter(claim => claim.text.trim() && plain(line).includes(plain(claim.text)));
        out.push({ subtopic: "早先版本", text: line.replace(ITEM, "- "), unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))], claims } as Paragraph);
      }
      const gone = new Set(moving), kept = lines.filter(line => !gone.has(line));
      let number = 0;
      // One numbered item left counts nothing: 「1. **扩展路径**……」 alone reads as an item.
      const numbered = kept.filter(line => /^\s*\d+\.\s/u.test(line)).length;
      const text = kept.map(line => /^\s*\d+\.\s/u.test(line) ? line.replace(/^(\s*)\d+\./u, (_, space: string) => numbered === 1 ? `${space}-` : `${space}${++number}.`) : line).join("\n");
      const claims = (paragraph.claims ?? []).filter(claim => !moving.some(line => plain(line).includes(plain(claim.text))) || plain(text).includes(plain(claim.text)));
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => claims.some(claim => claim.unitIds.includes(id)) || !out.some(item => item.unitIds.includes(id))) }];
    });
    if (!out.length) return chapter;
    const last = paragraphs.map((paragraph, at) => ({ paragraph, at })).filter(({ paragraph }) => earlierHeading.test(paragraph.subtopic)).at(-1);
    const added = out.map(item => item.text).join("\n");
    const item = { ...out[0], text: added, unitIds: [...new Set(out.flatMap(each => each.unitIds))], claims: out.flatMap(each => each.claims ?? []) };
    if (last) {
      body = replaceParagraph(body, last.paragraph.text, () => `${last.paragraph.text}\n\n${added}`);
      paragraphs.splice(last.at + 1, 0, item);
    } else {
      body = `${body.trimEnd()}\n\n### 早先版本\n\n${added}`;
      paragraphs.push(item);
    }
    return { ...chapter, body, paragraphs };
  };
  // An item left empty by the writer (「1.」 before 「2. **早期策略**……」): it goes, and the list counts from 1.
  const emptyItemsOut = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const lines = paragraph.text.split("\n");
      if (!lines.some(line => /^\s*(?:[-*+]|\d+\.)\s*$/u.test(line)) || !lines.some(line => ITEM.test(line) && line.replace(ITEM, "").trim())) return [paragraph];
      let number = 0;
      const text = lines.filter(line => !/^\s*(?:[-*+]|\d+\.)\s*$/u.test(line)).map(line => /^\s*\d+\.\s/u.test(line) ? line.replace(/^(\s*)\d+\./u, (_, space: string) => `${space}${++number}.`) : line).join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      return [{ ...paragraph, text }];
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A table row of one cell under a header of several: 「| 第一版优先实现：干预前选强度……|」 under 「| 维度 | 当前版本要求 |
  // 后续改进目标 |」 broke the table. It is a sentence of its own, after the table.
  const strayRowsOut = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body;
    const cells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map(cell => cell.trim());
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      const lines = paragraph.text.split("\n");
      const table = lines.filter(line => /^\s*\|/u.test(line));
      if (table.length < 3 || lines.length !== table.length || !/^\s*\|?\s*:?-{3,}/u.test(table[1])) return [paragraph];
      const width = cells(table[0]).length;
      const stray = table.slice(2).filter(line => width > 1 && cells(line).filter(Boolean).length === 1 && cells(line).length < width);
      if (!stray.length) return [paragraph];
      const text = lines.filter(line => !stray.includes(line)).join("\n"), said = stray.map(line => cells(line).filter(Boolean)[0]);
      const moved = (paragraph.claims ?? []).filter(claim => stray.some(line => line.includes(claim.text.replace(/^\|\s*/u, "")) && said.some(value => value.includes(claim.text.replace(/^\|\s*/u, "")) || claim.text.includes(value))));
      const own = { ...paragraph, text: said.join("\n\n"), unitIds: [...new Set(moved.flatMap(claim => claim.unitIds))], claims: moved.map(claim => ({ ...claim, text: claim.text.replace(/^\|\s*/u, "").replace(/\s*\|$/u, "") })) };
      body = replaceParagraph(body, paragraph.text, () => `${text}\n\n${own.text}`);
      return [{ ...paragraph, text, claims: (paragraph.claims ?? []).filter(claim => !moved.includes(claim)) }, ...(own.unitIds.length ? [own] : [{ ...own, unitIds: paragraph.unitIds }])];
    });
    return paragraphs.length === chapter.paragraphs.length ? chapter : { ...chapter, body, paragraphs };
  };
  // A table row moved to the earlier versions in a draft written before such rows were told by their columns: 「- 此前报告 ·
  // 日活数据: 每天稳定在22人; 留存/其他指标: 其中15个为稳定用户」. The version name goes; each value keeps its column's name.
  const VERSION_ROW = /^(\s*[-*+]\s+)(?:\*\*)?(?:此前|早期|早先|原先|旧版|现行|当前|目前|最新|最终|新版)[^*·\n]{0,6}(?:\*\*)?\s*·\s*([^:：\n]{1,16})[:：]\s*/u;
  const versionRowsTold = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!paragraph.text.split("\n").some(line => VERSION_ROW.test(line))) return paragraph;
      const text = paragraph.text.split("\n").map(line => {
        const row = line.match(VERSION_ROW);
        if (!row) return line;
        const rest = line.slice(row[0].length).replace(/;\s*([^:：;；\n]{1,16})[:：]\s*/gu, "；$1：");
        return `${row[1]}**${row[2].trim()}**：${rest}`;
      }).join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).filter(claim => text.includes(claim.text)) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // The same stage label on a paragraph with no claim of its own: 「V4阶段每一步扩展需通过数据验证……」, its one unit naming no
  // stage, beside the plan of three versions.
  const STAGE_LEAD = /^(\*\*)?((?:V|v)\d+|第[一二三四五六七八九十\d]+)(?:阶段|版本?)[，,：:]?\s*/u;
  const stageLabelOut = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const stage = paragraph.text.match(STAGE_LEAD);
      if (!stage || /\n/u.test(paragraph.text.trim()) || paragraph.text.length - stage[0].length < 8) return paragraph;
      const label = stage[0].replace(/[，,：:\s*]+$/u, "").replace(/^\*\*/u, "");
      const own = paragraph.unitIds.flatMap(id => units.get(id) ?? []);
      if (!own.length || own.some(unit => `${unit.statement} ${unit.evidence.quote}`.includes(label))) return paragraph;
      const text = `${stage[1] ?? ""}${paragraph.text.slice(stage[0].length)}`;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => claim.text.startsWith(stage[0]) ? { ...claim, text: claim.text.slice(stage[0].length) } : claim) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A clause saying only that a later version exists (LATER_EXISTS), nothing of what it is, goes wherever it stands.
  const laterExistsOut = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const cut = (value: string) => value.split("\n").map(line => line.replace(LATER_EXISTS, "")).join("\n");
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!LATER_EXISTS.test(paragraph.text)) return paragraph;
      const text = cut(paragraph.text);
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => ({ ...claim, text: cut(claim.text) })) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A sentence among the current points told as an earlier version (「此前曾提出减少首屏密度仅保留核心要素的方案。」 under the home
  // screen's layout in force): it goes to the earlier versions. Told so of a decision the chapter states as in force
  // (「此前曾提出分三版实施：V1替换首页大月历……」 on the confirmed plan of three versions), it tells that decision a second
  // time, as replaced: it goes. A sentence going on to the version in force (「……，后明确将目标用户定位为……」) stays.
  const TURNS_TO_NOW = /[，,]\s*(?:但|而|后来?|随后|之后)(?:又|再)?(?:明确|改为|改成|调整|决定|转向|确定|现行|当前|目前)/u;
  const earlierToldOut = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const out: Paragraph[] = [];
    let body = chapter.body;
    const plain = (value: string) => value.replace(/\*\*/gu, "").trim();
    // A point a later one replaced: history, set aside by a later reply, or an earlier version of its chain. A suggestion
    // still standing told as 「此前曾提议优先开发……」 is the AI's suggestion, told so by notInForce.
    const replacedVersion = (id: string) => statuses.get(id) === "history" && !rejectedByYou(id) || outgrown.has(id) || chains.some(topic => topic.earlier.includes(id) && !topic.current.includes(id));
    const decides = (id: string) => { const unit = units.get(id); return Boolean(unit) && (statuses.get(id) === "confirmed" || statuses.get(id) === "stated" && unit!.evidence.role === "user" && !unit!.evidence.pasted && DECIDING_KINDS.includes(unit!.kind)); };
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (earlierHeading.test(paragraph.subtopic)) return [paragraph];
      const blocks = paragraph.text.split(/\n{2,}/u);
      const leaving = blocks.filter(block => { const sentence = plain(block); return !/\n/u.test(sentence) && EARLIER_LEAD.test(sentence) && !TURNS_TO_NOW.test(sentence) && (sentence.match(/[。！？]/gu) ?? []).length === 1 && /[。！？]$/u.test(sentence); });
      if (!leaving.length) return [paragraph];
      const gone = new Set<string>();
      for (const block of leaving) {
        const claims = (paragraph.claims ?? []).filter(claim => claim.text.trim() && (plain(block).includes(plain(claim.text)) || plain(claim.text).includes(plain(block)) && plain(claim.text).length <= plain(block).length + 4));
        // Without a claim, the sentence's points are those of its paragraph no other sentence of the chapter tells.
        const others = new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(other => (other.claims ?? []).filter(claim => !claims.includes(claim)).flatMap(claim => claim.unitIds))]);
        const ids = claims.length ? [...new Set(claims.flatMap(claim => claim.unitIds))] : paragraph.unitIds.filter(id => !others.has(id));
        if (ids.length && ids.every(decides)) {
          const rest = (body.replace(paragraph.text, blocks.filter(item => item !== block).join("\n\n")).replace(/\*\*/gu, "").match(/[^。！？\n]+/gu) ?? []).map(sentence => knowledgeTerms(sentence));
          if (!ids.every(id => rest.some(terms => saysMostOf(terms, units.get(id)!.statement)))) continue;
        } else if (ids.length && ids.every(replacedVersion)) {
          // Without a claim of its own, the sentence is one on its points, so it is marked 〔此前〕 like the others there.
          out.push({ subtopic: "早先版本", text: `- ${block.trim()}`, unitIds: ids, claims: claims.length ? claims : [{ text: block.trim(), unitIds: ids }] } as Paragraph);
        } else continue;
        gone.add(block);
      }
      if (!gone.size) return [paragraph];
      const text = blocks.filter(block => !gone.has(block)).join("\n\n").trim();
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      if (!text) return [];
      const claims = (paragraph.claims ?? []).filter(claim => plain(text).includes(plain(claim.text)));
      return [{ ...paragraph, text, claims, unitIds: paragraph.unitIds.filter(id => claims.some(claim => claim.unitIds.includes(id)) || !out.some(item => item.unitIds.includes(id))) }];
    });
    if (paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at])) return chapter;
    if (!out.length) return { ...chapter, body, paragraphs };
    const last = paragraphs.map((paragraph, at) => ({ paragraph, at })).filter(({ paragraph }) => earlierHeading.test(paragraph.subtopic)).at(-1);
    const added = out.map(item => item.text).join("\n");
    const item = { ...out[0], text: added, unitIds: [...new Set(out.flatMap(each => each.unitIds))], claims: out.flatMap(each => each.claims ?? []) };
    // After a list of earlier versions, the sentence is one more item of it: apart, it read as a list of its own.
    if (last && last.paragraph.text.trim().split("\n").every(line => /^\s*[-*+]\s+\S/u.test(line))) {
      const text = `${last.paragraph.text}\n${added}`;
      body = replaceParagraph(body, last.paragraph.text, () => text);
      paragraphs[last.at] = { ...last.paragraph, text, unitIds: [...new Set([...last.paragraph.unitIds, ...item.unitIds])], claims: [...last.paragraph.claims ?? [], ...item.claims] };
    } else if (last) {
      body = replaceParagraph(body, last.paragraph.text, () => `${last.paragraph.text}\n\n${added}`);
      paragraphs.splice(last.at + 1, 0, item);
    } else {
      body = `${body.trimEnd()}\n\n### 早先版本\n\n${added}`;
      paragraphs.push(item);
    }
    return { ...chapter, body, paragraphs };
  };
  // A sentence the writer began after its point's first clause (「生成不含敏感词的打卡海报……」 for 「实施“匿名裂变”，生成不含
  // 敏感词的打卡海报……」): it says what is done with no word of what. The clause comes back.
  const SUBJECTLESS_LEAD = /^(?:此前建议|此前曾|此前|早期曾|早期|早先|之前|曾)(?=在|于|当|将|把|改|缩|增|减|变|调|移|设|做|作为|仅|只|不|让|使)/u;
  /** A subject alone: a few words with no mark, verb of saying or person in them. */
  const SUBJECT_ONLY = /^[^，,。；;：:\s（(]{2,12}$/u;
  // A time word is no subject: a statement opening 「早期曾将……」 gave 「早期曾早期曾将……」.
  const NOT_SUBJECT = /建议|提出|认为|决定|采用|你|我|用户|AI 建|将|把|应|需|可以|此前|早期|早先|之前|曾|随后|当前|目前/u;
  const headRestored = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const plain = (value: string) => value.replace(/[\s*]/gu, "");
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text;
      const claims = (paragraph.claims ?? []).map(claim => {
        const unit = claim.unitIds.length === 1 ? units.get(claim.unitIds[0]) : undefined;
        if (!unit || !text.includes(claim.text)) return claim;
        const statement = unit.statement.trim(), said = plain(claim.text), whole = plain(statement);
        // The point's subject left off after a time lead: 「此前建议在首页已有Agent的情况下缩小尺寸……」 for 「中央AI按钮在首页已有
        // Agent的情况下缩小尺寸……」 shrank nothing the reader could name. The subject goes back after the lead.
        const lead = claim.text.trim().match(SUBJECTLESS_LEAD)?.[0], rest = lead ? claim.text.trim().slice(lead.length) : "";
        const subject = lead && rest.length >= SPLIT_CHARS && whole.endsWith(plain(rest)) ? statement.slice(0, statement.length - rest.length) : "";
        if (subject && statement.endsWith(rest) && SUBJECT_ONLY.test(subject) && !NOT_SUBJECT.test(subject)) {
          const at = text.indexOf(claim.text), before = text.slice(0, at);
          if (!/(?:^|\n)\s*(?:[-*+]\s+)?(?:\*\*[^*\n]+\*\*[：:]\s*)?$/u.test(before)) return claim;
          const told = `${lead}${subject}${rest}`;
          text = text.replace(claim.text, () => told);
          return { ...claim, text: told };
        }
        if (said.length < SPLIT_CHARS || !whole.endsWith(said) || whole === said) return claim;
        const head = statement.slice(0, statement.length - claim.text.trim().length);
        if (!/[，,]$/u.test(head.trim()) || plain(head).length < 4 || plain(head).length > 20) return claim;
        // Only where the sentence starts its line or follows a label: a clause mid-sentence keeps the sentence before it.
        const at = text.indexOf(claim.text), before = text.slice(0, at);
        if (!/(?:^|\n)\s*(?:[-*+]\s+)?(?:\*\*[^*\n]+\*\*[：:]\s*)?$/u.test(before)) return claim;
        text = text.replace(claim.text, () => statement);
        return { ...claim, text: statement };
      });
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A clause of an earlier version giving figures its points never gave, that a current point of the chapter gives: 「……
  // 暂不做强制会员或周订阅，包含前7天免费体验、30天¥19.9及90天¥49.9等档位。」〔此前〕 took the tiers of 「建议推出7天体验……
  // 30天AI守护计划（¥19.9）、90天计划（¥49.9）」, told as current above it, and the same tiers read both as replaced and as
  // the plan. The clause goes; the figures stay with the point giving them.
  const borrowedFiguresOut = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const current = chapter.paragraphs.filter(paragraph => !earlierHeading.test(paragraph.subtopic)).map(paragraph => paragraph.text).join("\n");
    // Days are when a figure was said, not figures: 「（6月14日—7月7日）」 read as figures the point never gave.
    const figures = (text: string): string[] => figuresIn(text);
    // An earlier report a current sentence of the chapter gives whole, of the same days (「此前报告称每天稳定在22人（6月14日—
    // 7月7日），其中15个为稳定用户。」 below 「当时日活稳定在22人（6月14日—7月7日），其中15人为……核心用户」): it is that report
    // told twice, not an earlier version. It goes.
    const days = daysIn;
    const currentSentences = current.replace(/\*\*/gu, "").match(/[^。！？\n]+[。！？]?/gu) ?? [];
    // Undated, it is that report when its words meet the sentence's too (「日活 (DAU)22人，其中15个为稳定用户。」 beside
    // 「当时日活稳定在22人……，其中15人为连续使用的核心用户」).
    const toldNow = (claim: string) => {
      const own = figures(claim), when = days(claim), terms = knowledgeTerms(claim.replace(/\d+/gu, " "));
      return own.length >= 2 && currentSentences.some(sentence => own.every(figure => figures(sentence).includes(figure))
        && (when.length ? when.every(day => sentence.includes(day)) : [...terms].filter(term => /^\p{Script=Han}{2}$/u.test(term) && knowledgeTerms(sentence).has(term)).length >= 2));
    };
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!earlierHeading.test(paragraph.subtopic) || !paragraph.claims?.length) return paragraph;
      let text = paragraph.text;
      // A whole item telling that report, its figures spread over claims of one figure each (「- **日活 (DAU)**：22人；核心用户数
      // 15个；其中15个为稳定用户。」, a table's row): it is read as one.
      const items = text.split("\n").filter(line => /^\s*[-*+]\s/u.test(line) && toldNow(line.replace(/^\s*[-*+]\s+/u, "").replace(/\*\*/gu, "")));
      for (const line of items) text = text.replace(line, "");
      const claims = paragraph.claims.flatMap(claim => {
        if (items.some(line => line.includes(claim.text)) && !text.includes(claim.text)) return [];
        if (text.includes(claim.text) && toldNow(claim.text)) { text = text.replace(claim.text, ""); return []; }
        return [claim];
      }).map(claim => {
        const said = claim.unitIds.flatMap(id => units.get(id) ?? []).map(unit => `${unit.statement} ${unit.evidence.quote}`).join(" ");
        if (!said || !text.includes(claim.text)) return claim;
        const clauses = claim.text.split(/(?<=[，,；;])/u);
        const kept = clauses.filter(clause => { const own = figures(clause); return !own.length || own.every(figure => said.includes(figure)) || !own.every(figure => current.includes(figure)); });
        // Nor when what stays leans on the clause taken out: 「其中15个为稳定用户。」 said of nothing.
        const leaning = clauses.some((clause, at) => at > 0 && kept.includes(clause) && !kept.includes(clauses[at - 1]) && LEANS_ON_BEFORE.test(clause.trim()));
        if (!kept.length || kept.length === clauses.length || leaning) return claim;
        const cut = kept.join("").replace(/[，,；;]\s*$/u, "").replace(/([^。！？])$/u, "$1。").replace(/[，,；;]([。！？])$/u, "$1");
        text = text.replace(claim.text, cut);
        return { ...claim, text: cut };
      });
      if (text === paragraph.text) return paragraph;
      // An item taken out whole leaves its list marker: the line goes with it.
      text = text.split("\n").filter(line => !/^\s*(?:[-*+]|\d+\.)\s*$/u.test(line)).join("\n").trim();
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      return { ...paragraph, text, claims };
    }).filter(paragraph => paragraph.text);
    return paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A clause of the AI's giving again a figure the user reported in the chapter, of the same days (「当时DAU卡在32左右
  // （6月14日—7月7日），主要问题在于……未打通」 beside 「你提到日活停留在32人左右（6月14日—7月7日）……」〔你〕): the figure
  // read twice, once unmarked. The clause goes; the sentence keeps what it adds.
  const reportedFigureClauseOut = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const figures = (text: string): string[] => figuresIn(text);
    const days = daysIn;
    const reported = chapter.paragraphs.flatMap(paragraph => paragraph.claims ?? []).filter(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => units.get(id)?.evidence.role === "user" && !units.get(id)?.evidence.pasted)).map(claim => claim.text);
    if (!reported.length) return chapter;
    return rewritten(chapter, (claim, paragraph) => {
      if (earlierHeading.test(paragraph.subtopic) || !claim.unitIds.length || claim.unitIds.some(id => units.get(id)?.evidence.role === "user")) return undefined;
      const clauses = claim.text.split(/(?<=[，,])/u);
      if (clauses.length < 2) return undefined;
      const [first, ...rest] = clauses, own = figures(first), when = days(first), after = rest.join("").trim();
      if (!own.length || !when.length || after.replace(/[\s\p{P}\p{S}]/gu, "").length < SPLIT_CHARS || LEANS_ON_BEFORE.test(after)) return undefined;
      return reported.some(text => text !== claim.text && own.every(figure => figures(text).includes(figure)) && when.every(day => text.includes(day))) ? { text: after } : undefined;
    });
  };
  // A table row told as fields, in whatever shape the draft gave it (「日活 (DAU)：约40；核心用户数：-；备注：……」, 「- **破戒后处理**
  // · 复盘时长与内容: ……; 数据保留策略: ……」): told again the one way every row is told as text (wiki-row-sentence), an empty
  // field left out and a catch-all column's name left off. One pass for every shape: two passes reading fields each their
  // own way left 「备注：」 behind once the other had taken out 「核心用户数：-」.
  const ROW_LABEL = /^(\s*(?:[-*+]\s+)?)(?:\*\*([^*\n]+)\*\*\s*(?:[：:]|·)\s*)?/u;
  const FIELD = /^([^：:，,。；;|\n*#>`]{1,16})[：:]\s*(.*)$/u;
  const fieldsOfLine = (line: string) => {
    const [lead, indent, label] = line.match(ROW_LABEL)!;
    const parts = line.slice(lead.length).trim().replace(/[。.]$/u, "").split(/\s*[；;]\s*/u);
    if (parts.length < 2) return undefined;
    const fields = parts.map((part, at) => { const named = part.match(FIELD); return named ? { name: named[1].trim() as string | undefined, value: named[2] } : at === 0 && label ? { name: undefined, value: part } : undefined; });
    if (fields.some(field => !field) || !fields.some(field => field!.name)) return undefined;
    return { indent, label: label as string | undefined, fields: fields as Array<{ name: string | undefined; value: string }> };
  };
  const fieldLinesTold = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (/^\s*```/mu.test(paragraph.text)) return paragraph;
      const lines = paragraph.text.split("\n").map(line => {
        const row = fieldsOfLine(line);
        if (!row) return line;
        const told = rowFields(row.fields.map(field => field.name), row.fields.map(field => field.value), zhDraft);
        return told ? `${row.indent}${row.label ? `**${row.label}**${zhDraft ? "：" : ": "}` : ""}${told}` : undefined;
      });
      const text = lines.filter((line): line is string => line !== undefined).join("\n");
      if (text === paragraph.text) return paragraph;
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).filter(claim => /[^\s\-—–]/u.test(claim.text) && text.includes(claim.text)) };
    }).filter(paragraph => paragraph.text);
    return paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // Something the user asked, told as what must be done: 「需评估转向自信自律方向后的市场竞争状况及发展前景。」〔你〕 for 「……这个方向
  // 竞争怎么样前景怎么样」. It is told as theirs to raise.
  // Joined on by the writer to what it followed (「此外，需评估……」): the joining word goes with the sentence it joined.
  const ADDED_ON = /^(?:此外|另外|同时|并且|而且)[，,]\s*/u;
  const ASKED_TO_DO = /^(?:(?:此外|另外|同时|并且|而且)[，,]\s*)?(?:需要?|应当?)(?:评估|考虑|确认|研究|调研|分析|判断|了解)/u;
  const askedRaised = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const asked = (paragraph.claims ?? []).filter(claim => ASKED_TO_DO.test(claim.text.trim()) && paragraph.text.includes(claim.text) && claim.unitIds.length > 0 && claim.unitIds.every(id => { const unit = units.get(id); return Boolean(unit) && unit!.evidence.role === "user" && !unit!.evidence.pasted && ASKS.test(unit!.evidence.quote); }));
      if (!asked.length) return paragraph;
      const told = (value: string) => asked.reduce((text, claim) => text.replace(claim.text, `你提出${claim.text.trim().replace(ADDED_ON, "")}`), value);
      const text = told(paragraph.text);
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => asked.includes(claim) ? { ...claim, text: `你提出${claim.text.trim().replace(ADDED_ON, "")}` } : claim) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A list of what the user turned down (「你否定了此前关于社群互助的以下方案：A；B；C。」) names only what they turned down: two
  // replies they never ruled on were listed with the two they did, and one they did was left out. Each item is the point it
  // says most of; one the user did not turn down follows as an item of its own, and one they did that no item says is added.
  const DECLINED_LIST = /^(你(?:否定|否决|拒绝)了[^：:\n]{0,40})[：:]\s*([^\n]+)$/u;
  const declinedListTrue = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const match = paragraph.text.trim().match(DECLINED_LIST);
      if (!match) return paragraph;
      const own = [...new Set([...paragraph.unitIds, ...(paragraph.claims ?? []).flatMap(claim => claim.unitIds)])].flatMap(id => units.get(id) ?? []);
      const declined = own.filter(unit => rejectedByYou(unit.id));
      if (!declined.length) return paragraph;
      const items = match[2].split(/[；;]/u).map(item => item.trim().replace(/[。.]$/u, "")).filter(Boolean);
      const shared = (item: string, unit: WikiKnowledgeUnit) => { const terms = knowledgeTerms(item), theirs = knowledgeTerms(unit.statement); return [...terms].filter(term => theirs.has(term)).length / Math.max(1, terms.size); };
      const read = items.map(item => ({ item, unit: [...own].sort((a, b) => shared(item, b) - shared(item, a))[0] }));
      const said = read.filter(({ item, unit }) => unit && rejectedByYou(unit.id) && saysMostOf(knowledgeTerms(item), unit.statement));
      const others = read.filter(entry => !said.includes(entry));
      const listed = said.map(entry => ({ item: entry.item, ids: [entry.unit.id] }));
      // A point turned down that no item says: what of it no item says follows the item saying most of it (「……，作为每日回访的
      // 社交理由」 then 「不再提供手动创建或寻找战友入口」), or stands as an item of its own.
      for (const unit of declined.filter(item => !said.some(entry => entry.unit === item))) {
        const unsaid = bareStatement(unit).split(/[，,；;]/u).map(clause => clause.trim()).filter(clause => clause && !listed.some(entry => saysMostOf(knowledgeTerms(clause), entry.item)));
        if (!unsaid.length) continue;
        const host = [...listed].sort((a, b) => shared(b.item, unit) - shared(a.item, unit))[0];
        if (host && shared(host.item, unit) >= DECLINED_HOST) { host.item = `${host.item}，${unsaid.join("，")}`; host.ids.push(unit.id); }
        else listed.push({ item: unsaid.join("，"), ids: [unit.id] });
      }
      if (!listed.length) return paragraph;
      const lead = listed.length === 1 ? match[1].replace(/的?以下/u, "的") : match[1];
      const sentence = `${lead}：${listed.map(entry => entry.item).join("；")}。`;
      const rest = others.map(entry => ({ text: `- ${entry.item}。`, ids: entry.unit ? [entry.unit.id] : [] }));
      const text = [sentence, rest.map(entry => entry.text).join("\n")].filter(Boolean).join("\n\n");
      if (text === paragraph.text.trim()) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      const claims = [{ text: sentence, unitIds: listed.flatMap(entry => entry.ids) }, ...rest.filter(entry => entry.ids.length).map(entry => ({ text: entry.text.slice(2), unitIds: entry.ids }))];
      return { ...paragraph, text, claims, unitIds: [...new Set(claims.flatMap(claim => claim.unitIds))] };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // An earlier version told as what should be, without whose word it was (「此前首页最大绿色按钮不应常驻“进入恢复中心”，
  // 而应……」): read as how the button was. It was a suggestion: 「此前建议首页最大绿色按钮不应常驻……」.
  const EARLIER_OUGHT = /(^|\n)(\s*(?:[-*+]\s+)?(?:\*\*[^*\n]+\*\*[:：]\s*)?)此前(?!曾|建议|提出|提议|认为|计划|规划|决定|采用|的|版本|方案)([^，。；！？\n]{2,30}?(?:不应|不应该|应该|应当|应|需要|须))/gu;
  const earlierSuggested = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const earlier = earlierHeading.test(paragraph.subtopic) || paragraph.unitIds.length > 0 && paragraph.unitIds.every(id => statuses.get(id) === "history");
      if (!earlier) return paragraph;
      const text = paragraph.text.replace(EARLIER_OUGHT, (_, start: string, lead: string, rest: string) => `${start}${lead}此前建议${rest}`);
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      const told = (value: string) => value.replace(/^此前(?!曾|建议|提出|提议|认为|计划|规划|决定|采用|的|版本|方案)(?=[^，。；！？\n]{2,30}?(?:不应|不应该|应该|应当|应|需要|须))/u, "此前建议");
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => text.includes(claim.text) ? claim : { ...claim, text: told(claim.text) }) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // The earlier versions told plainly: what the user turned down was a plan, not a decision (「你否定了采用系统自动分配同期
  // 小组……的决定」); an item labelled 「**早期方案**：」 under 早先版本 says so twice; a label closed by a Latin colon
  // (「**顶部指标**: 」) reads as a slip in Chinese.
  const TURNED_DOWN_DECISION = /(你(?:也|还)?否定了[^。！？]*?)的决定/gu;
  const EARLIER_LABEL = /^(\s*[-*+]\s+)\*\*(?:早期方案|早先方案|此前方案|旧方案|原方案)\*\*[：:]\s*/gmu;
  const LATIN_LABEL_COLON = /(\*\*[^*\n]*\p{Script=Han}[^*\n]*\*\*):\s+/gu;
  // An earlier item told as what to do (「- **任务展示逻辑**：将“今日任务0/7”改为“今日重点0/1”……」, 「- **坚持数据去重**：顶部
  // 坚持数据应避免重复……，建议改为……」): under 早先版本 it read as the plan. It was a suggestion: 「此前建议……」.
  const EARLIER_AS_NOW = /^(?:将|把|改为|采用|增加|保留|去掉|移除|建议)|^(?!此前|之前|早期|早先|曾|你|用户|当时|原先|最初)[^，。；\n]{2,20}(?:应|不应|需要|需)(?!用户)/u;
  const EARLIER_ITEM_AS_NOW = /^(\s*[-*+]\s+(?:\*\*[^*\n]+\*\*[：:]\s*)?)(?!\*\*)([^\n]+)$/gmu;
  // An item of the AI's naming no time at all (「中央AI按钮在首页已有Agent的情况下缩小尺寸……」) reads as the plan now, whatever
  // its verb: under the earlier versions it is told as the suggestion it was. The user's own items keep their words.
  const EARLIER_UNTIMED = /^(?!(?:随后|之后|后来|然后|接着|进而|进一步))(?![^\n]*(?:此前|之前|早期|早先|曾|原先|原来|最初|当时|旧版|过去|你|用户|已被|取代|替换))/u;
  // A suggestion after the problem it answers (「中央悬浮“+”号含义不明，建议改为盾牌……」) is told as earlier where it is
  // suggested: a lead before it read 「此前建议中央悬浮“+”号含义不明」, the problem as the suggestion.
  const toldEarlier = (rest: string, untimed = false) => !/^建议/u.test(rest) && /[，,]建议(?:改为|采用|调整为)/u.test(rest) && (EARLIER_AS_NOW.test(rest) || untimed && EARLIER_UNTIMED.test(rest)) ? rest.replace(/([，,])建议(改为|采用|调整为)/u, "$1此前建议$2") : EARLIER_AS_NOW.test(rest) || untimed && EARLIER_UNTIMED.test(rest) ? `此前建议${rest.replace(/^建议/u, "").replace(/([，,])建议(改为|采用|调整为)/u, "$1$2")}` : rest;
  const earlierTidy = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      let text = paragraph.text.replace(LATIN_LABEL_COLON, "$1：");
      const aiOnly = paragraph.unitIds.length > 0 && paragraph.unitIds.every(id => units.get(id)?.evidence.role !== "user");
      // A block shown among the earlier versions is one of them, whatever its units' status: 「AI 建议，未确认」 over a sketch
      // there read as a current proposal.
      if (earlierHeading.test(paragraph.subtopic)) text = text.replace(TURNED_DOWN_DECISION, "$1的方案").replace(EARLIER_LABEL, "$1").replace(EARLIER_ITEM_AS_NOW, (_, lead: string, rest: string) => `${lead}${toldEarlier(rest, aiOnly && EARLIER_UNTIMED.test(lead))}`)
        .replace(/^(\*讨论中的原文(?:表格|代码) · )AI\s*建议，未确认\*$/mu, "$1早期版本，已被替换*");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      const told = (value: string) => earlierHeading.test(paragraph.subtopic) ? (text.includes(toldEarlier(value, aiOnly)) && toldEarlier(value, aiOnly) !== value ? toldEarlier(value, aiOnly) : value.replace(TURNED_DOWN_DECISION, "$1的方案")) : value;
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => text.includes(claim.text) ? claim : { ...claim, text: told(claim.text) }) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // An opening ending its sentence on what the paragraph right under the first heading says in full (「……，并在日活稳定超过
  // 100、拥有连续使用30天以上用户群等五个状态达成前，暂不开发大型新方向。」 above 「在达到日活稳定超过100、……这五个状态前，
  // 暂时不做大型新方向。」): read twice in a row. The opening's clause goes; the paragraph keeps the whole.
  const openingTailOut = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    const next = chapter.paragraphs.find(paragraph => paragraph.text.trim() !== opening && !earlierHeading.test(paragraph.subtopic));
    if (!zhDraft || !opening || !next || next.subtopic !== chapter.paragraphs.find(paragraph => paragraph.text.trim() !== opening)?.subtopic) return chapter;
    const theirs = knowledgeTerms(next.text.replace(/\*\*/gu, ""));
    const sentences = opening.match(/[^。！？]+[。！？]?/gu) ?? [];
    let changed = false;
    const kept = sentences.map(sentence => {
      const at = sentence.search(/，(?:并|并且|同时)(?=[^，]*，?[^，]*[。！？]?$)/u);
      if (at < 0) return sentence;
      const head = sentence.slice(0, at), tail = sentence.slice(at + 1).replace(/[。！？]$/u, "");
      const said = knowledgeTerms(tail);
      if (said.size < OPENING_TAIL_TERMS || head.replace(/[\s\p{P}\p{S}]/gu, "").length < SPLIT_CHARS) return sentence;
      const share = [...said].filter(term => theirs.has(term)).length / said.size;
      if (share < OPENING_TAIL_SAID) return sentence;
      changed = true;
      return `${head}。`;
    });
    if (!changed) return chapter;
    const text = kept.join("");
    return { ...chapter, body: replaceParagraph(chapter.body, opening, () => text) };
  };
  // An opening only telling again a paragraph of the chapter (「产品定位为垂直、科学可信的个人行为恢复系统……」 above
  // 「项目定位为垂直、科学可信的个人行为恢复系统，核心价值在于……」): the export drops it as a repeat, and the chapter started on
  // a heading, its decision (「现行决定是先深耕“戒色”……」〔已定〕) left at the end of the first subtopic. A decision the user
  // confirmed, told as a paragraph of its own, opens the chapter instead.
  const openingFromDecision = (chapter: (typeof draft.chapters)[number]) => {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0].trim();
    if (!opening) return chapter;
    const said = knowledgeTerms(opening.replace(/\*\*/gu, ""));
    const share = (text: string) => { const theirs = knowledgeTerms(text.replace(/\*\*/gu, "")); return [...said].filter(term => theirs.has(term)).length / Math.max(1, said.size); };
    const repeated = chapter.paragraphs.filter(paragraph => paragraph.text.trim() !== opening && share(paragraph.text) >= OPENING_REPEATS);
    // An opening telling no decision of the user's, a decision of theirs standing at the end of a subtopic (「决定先深耕
    // “戒色”单一垂直领域……」〔已定〕 after the positioning's details): the decision follows the opening, read first.
    const openingDecides = (chapter.openingUnitIds ?? []).some(id => statuses.get(id) === "confirmed" && saysMostOf(said, units.get(id)?.statement ?? ""));
    if (!repeated.length && openingDecides) return chapter;
    const decision = chapter.paragraphs.find(paragraph => !earlierHeading.test(paragraph.subtopic) && !/^\s*(?:[-*+]\s|\d+\.\s|\||>|#|`)/u.test(paragraph.text.trim())
      && (paragraph.text.match(/[。！？]/gu)?.length ?? 0) <= 1 && paragraph.claims?.length === 1 && paragraph.claims[0].unitIds.length > 0
      && paragraph.claims[0].unitIds.every(id => statuses.get(id) === "confirmed") && saysMostOf(knowledgeTerms(paragraph.text), units.get(paragraph.claims[0].unitIds[0])?.statement ?? ""));
    // An opening telling the decision itself already opens on it.
    if (!decision || repeated.includes(decision) || saysMostOf(said, units.get(decision.claims![0].unitIds[0])?.statement ?? "")) return chapter;
    // Its subtopic keeps something to say: a decision alone under its heading is that subtopic.
    if (!chapter.paragraphs.some(paragraph => paragraph !== decision && paragraph.subtopic === decision.subtopic)) return chapter;
    const text = decision.text.trim().replace(DECISION_LEAD, "决定");
    const body = replaceParagraph(removeParagraph(chapter.body, decision.text), opening, () => repeated.length ? text : `${opening}${text}`);
    return { ...chapter, body, paragraphs: chapter.paragraphs.filter(paragraph => paragraph !== decision), openingUnitIds: repeated.length ? [...decision.claims![0].unitIds] : [...new Set([...chapter.openingUnitIds ?? [], ...decision.claims![0].unitIds])] };
  };
  // A chapter starting on a heading, its decision the user confirmed an item of a list below it (「- **版本规划**：分三版
  // 迭代……〔已定〕」 under 路线图优先级): the overview took the chapter's first sentence, a principle, for its conclusion. The
  // decision opens the chapter and leaves the list.
  const openingFromListedDecision = (chapter: Chapter): Chapter => {
    if (!chapter.body.startsWith("### ")) return chapter;
    for (const paragraph of chapter.paragraphs) {
      if (earlierHeading.test(paragraph.subtopic)) continue;
      const lines = paragraph.text.split("\n");
      if (lines.length < 2 || !lines.every(line => /^\s*(?:[-*+]|\d+\.)\s/u.test(line))) continue;
      const claim = (paragraph.claims ?? []).find(item => item.unitIds.length > 0 && item.unitIds.every(id => statuses.get(id) === "confirmed") && saysMostOf(knowledgeTerms(item.text), units.get(item.unitIds[0])?.statement ?? ""));
      const line = claim && lines.find(item => item.includes(claim.text.trim()));
      if (!claim || !line) continue;
      const kept = lines.filter(item => item !== line), text = kept.join("\n");
      const body = `${claim.text.trim()}\n\n${replaceParagraph(chapter.body, paragraph.text, () => text)}`;
      const paragraphs = chapter.paragraphs.map(item => item === paragraph ? { ...item, text, claims: (item.claims ?? []).filter(other => other !== claim), unitIds: item.unitIds.filter(id => !claim.unitIds.includes(id) || (item.claims ?? []).some(other => other !== claim && other.unitIds.includes(id))) } : item);
      return { ...chapter, body, paragraphs, openingUnitIds: [...new Set([...chapter.openingUnitIds ?? [], ...claim.unitIds])] };
    }
    return chapter;
  };
  // An opening sentence telling a target as a finding: 「验证指标采用四周AB测试，超20%用户愿尝试付费。」 joined the test to one
  // of its targets, which the chapter tells as 「……超20%用户愿尝试付费」 after 「算法组目标为」. It read as a result, and the
  // overview took it for the chapter's conclusion. The sentence goes; the chapter opens on its first paragraph.
  const TARGET_FIGURE = /(?:超过?|≥|≤|不低于|至少|达到)\s*\d+(?:\.\d+)?%/gu;
  const openingTargetOut = (chapter: Chapter): Chapter => {
    if (!zhDraft || chapter.body.startsWith("### ")) return chapter;
    const opening = chapter.body.split(/\n### /u)[0].trim();
    const rest = chapter.body.slice(chapter.body.indexOf(opening) + opening.length);
    const kept = opening.split(/(?<=[。！？])/u).filter(sentence => {
      const targets = sentence.match(TARGET_FIGURE) ?? [];
      if (!targets.length || /目标|计划|争取|预期|期望/u.test(sentence)) return true;
      return !rest.split(/(?<=[。！？])/u).some(later => /目标/u.test(later) && targets.every(target => later.includes(target)));
    }).join("").trim();
    if (kept === opening) return chapter;
    const body = kept ? chapter.body.replace(opening, () => kept) : chapter.body.slice(chapter.body.indexOf(opening) + opening.length).replace(/^\s+/u, "");
    return { ...chapter, body, ...(kept ? {} : { openingUnitIds: [] }) };
  };
  // A decision the user confirmed holding what they turned down elsewhere (the plan of three versions, 「第三版加入自动分组」,
  // beside 「采用系统自动分配同期小组」 they rejected): the reader is asked to settle it, after the first place stating it.
  const conflicts = decidedAgainstDeclined(all, id => statuses.get(id), rejectedByYou), placedConflicts = new Set<string>();
  const decidedAgainstDeclinedNoted = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0].trim();
    const paragraphs = [...chapter.paragraphs];
    for (const conflict of conflicts) {
      if (placedConflicts.has(conflict.note)) continue;
      const note = `> 版本未定：${conflict.note}`;
      if (opening && (chapter.openingUnitIds ?? []).includes(conflict.decidedId)) {
        body = replaceParagraph(body, opening, () => `${opening}\n\n${note}`);
      } else {
        const at = paragraphs.findIndex(paragraph => !earlierHeading.test(paragraph.subtopic) && paragraph.unitIds.includes(conflict.decidedId));
        if (at < 0) continue;
        body = replaceParagraph(body, paragraphs[at].text, () => `${paragraphs[at].text}\n\n${note}`);
        paragraphs.splice(at + 1, 0, { subtopic: paragraphs[at].subtopic, text: note, unitIds: [conflict.decidedId, ...conflict.declinedIds], claims: [] } as Paragraph);
      }
      placedConflicts.add(conflict.note);
    }
    return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
  };
  // A sentence the writer broke off (「- **风险分级**：系统根据时间、诱因、保护因…」), its check asking for it in full: told on
  // one point, it is that point's statement, whole.
  const CUT_OFF = /(?:…|\.\.\.)\s*$/u;
  const cutOffRestored = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body;
    const plain = (value: string) => value.replace(/[\s*，,。、；;：:“”"（）()]/gu, "");
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const broken = (paragraph.claims ?? []).filter(claim => CUT_OFF.test(claim.text) && claim.unitIds.length === 1 && paragraph.text.includes(claim.text)
        && plain(units.get(claim.unitIds[0])?.statement ?? "").startsWith(plain(claim.text.replace(CUT_OFF, "")).slice(0, 6)));
      if (!broken.length) return paragraph;
      let text = paragraph.text;
      const claims = (paragraph.claims ?? []).map(claim => {
        if (!broken.includes(claim)) return claim;
        const whole = `${bareStatement(units.get(claim.unitIds[0])!)}。`;
        text = text.replace(claim.text, whole);
        return { ...claim, text: whole };
      });
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A table row told on a point that says none of it (「| 核心任务 | 读取历史失序、高频诱因……展示基于数据的理由 |」 on the
  // central button's suggestion), its words another point's that the chapter tells in its prose: the row says that point
  // a second time, under a label of the writer's, on the wrong source. It goes.
  const misCitedRowsOut = (chapter: (typeof draft.chapters)[number]) => {
    const own = [...new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds))].flatMap(id => units.get(id) ?? []);
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!/^\s*\|/u.test(paragraph.text)) return paragraph;
      const lines = paragraph.text.split("\n");
      const prose = body.replace(paragraph.text, "").replace(/\*\*/gu, "").match(/[^。！？\n|]+/gu)?.map(sentence => knowledgeTerms(sentence)) ?? [];
      const gone = lines.filter((line, at) => {
        if (at < 2 || !/^\s*\|/u.test(line)) return false;
        const claims = (paragraph.claims ?? []).filter(claim => line.includes(claim.text) && knowledgeTerms(claim.text).size >= MISCITED_TERMS);
        if (!claims.length) return false;
        return claims.every(claim => {
          const terms = knowledgeTerms(claim.text), cited = claim.unitIds.flatMap(id => units.get(id) ?? []);
          const shared = Math.max(0, ...cited.map(unit => { const theirs = knowledgeTerms(unit.statement); return [...terms].filter(term => theirs.has(term)).length / terms.size; }));
          if (shared >= MISCITED_SHARE) return false;
          const other = own.find(unit => !claim.unitIds.includes(unit.id) && saysMostOf(terms, unit.statement));
          return Boolean(other) && prose.some(sentence => saysMostOf(sentence, other!.statement));
        });
      });
      if (!gone.length) return paragraph;
      const text = lines.filter(line => !gone.includes(line)).join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).filter(claim => text.includes(claim.text)) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // Words telling a suggestion as decided or as earlier, on points that are neither: 「补充决策指出……」 for a reply nobody
  // confirmed, 「此前推荐的最终结构为……」 for the structure the chapter tells as current. And a sentence saying only that
  // versions differ (「首页最大按钮的状态逻辑存在版本差异。」), no claim of its own and no note saying how.
  const SAID_DECIDED = /(补充|另一|后续)?决策(指出|认为|提出|要求)/gu;
  const SAID_EARLIER_BEST = /^此前推荐的(?:最终)?(方案|结构|设计|做法)(?:为|是)/u;
  const VERSIONS_DIFFER = /(?<=^|[。！？])[^。！？\n]{2,30}(?:存在|有)(?:版本差异|不同版本|两种版本|分歧)。/gu;
  const suggestionWords = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (earlierHeading.test(paragraph.subtopic)) return paragraph;
      const cited = paragraph.unitIds.map(id => statuses.get(id));
      if (cited.some(status => status === "confirmed")) return paragraph;
      const claimed = (sentence: string) => (paragraph.claims ?? []).some(claim => claim.text.includes(sentence.trim()) || sentence.includes(claim.text.trim()));
      let text = paragraph.text.replace(SAID_DECIDED, (_, kind: string | undefined, verb: string) => `${kind ?? ""}建议${verb}`).replace(VERSIONS_DIFFER, sentence => claimed(sentence) ? sentence : "");
      if (!cited.some(status => status === "history")) text = text.replace(SAID_EARLIER_BEST, (_, what: string) => `AI 推荐的${what}为`);
      text = text.trim();
      if (text === paragraph.text) return paragraph;
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      const told = (value: string) => value.replace(SAID_DECIDED, (_, kind: string | undefined, verb: string) => `${kind ?? ""}建议${verb}`).replace(SAID_EARLIER_BEST, (_, what: string) => `AI 推荐的${what}为`);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => text.includes(claim.text) ? claim : { ...claim, text: told(claim.text) }).filter(claim => text.includes(claim.text)) };
    }).filter(paragraph => paragraph.text);
    return paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A sentence with no claim telling a suggestion as the plan in force: 「首页主要按钮应根据用户状态……变化。当前方案为平时显示
  // “守护”……」 for the AI's reply nobody decided.
  const HELD_IN_TEXT = /(?<=[。！？])(?:现行|当前|目前的?)(?:方案|做法|设计|规划)(?:为|是)[：:]?/gu;
  const heldInText = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const listed = paragraph.unitIds.flatMap(id => units.get(id) ?? []);
      if (paragraph.text.search(HELD_IN_TEXT) < 0 || !listed.length || listed.some(unit => statuses.get(unit.id) === "confirmed")) return paragraph;
      const words = listed.every(unit => unit.evidence.role !== "user") ? "AI 建议" : "";
      const text = paragraph.text.replace(HELD_IN_TEXT, words);
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => ({ ...claim, text: claim.text.replace(HELD_IN_TEXT, words) })) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // An item labelled as before telling itself as now: 「- **当时数据**：小程序目前每天稳定在22人……；当前新增用户留存率为19%」.
  const PAST_LABEL = /^\s*[-*+]\s+\*\*(?:当时|早期|此前|原先|过去|之前)[^*\n]*\*\*[：:]/u;
  const pastLabelNow = (chapter: (typeof draft.chapters)[number]) => {
    if (!zhDraft) return chapter;
    const now = /(目前|当前)(?!连续|版本|阶段|时间|状态|的?(?:方案|规划))(?=\p{Script=Han})/gu;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.split("\n");
      if (!lines.some(line => PAST_LABEL.test(line) && line.replace(PAST_LABEL, "").search(now) >= 0)) return paragraph;
      const changed = new Map<string, string>();
      const text = lines.map(line => {
        if (!PAST_LABEL.test(line)) return line;
        const label = line.match(PAST_LABEL)![0], rest = line.slice(label.length).replace(now, "");
        if (rest !== line.slice(label.length)) changed.set(line.slice(label.length), rest);
        return `${label}${rest}`;
      }).join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      // A claim saved without the day the line adds (「当前日活仅25，……」 for 「当前日活仅25（6月6日），……」) is that line's
      // too: left saying 当前, it no longer matched the line, and the user's report lost its 〔你〕.
      const head = (value: string) => value.split(/[，,（(]/u)[0];
      // Told as the line tells it, the day with it: the mark is placed by the claim's words.
      const undated = (value: string) => value.replace(/[（(][^）)]*\d+月\d+日[^）)]*[）)]/gu, "").replace(/\*\*/gu, "").trim();
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => {
        const line = [...changed.keys()].find(item => item.includes(claim.text) || head(claim.text).length >= 4 && item.includes(head(claim.text)));
        if (!line) return claim;
        const told = claim.text.replace(now, ""), rest = changed.get(line)!.trim();
        return { ...claim, text: undated(rest) === undated(told) ? rest.replace(/\*\*/gu, "") : told };
      }) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A sentence saying again that a plan was turned down, after the paragraph said so: 「你在回答中否定了「首屏100%……」的方案。
  // ……此设计已被否定，未采纳。」
  const REFUSED_AGAIN = /(?<=[否][定决][^\n]*?[。！？])(?:此|该|这一?)(?:设计|方案|提议|版本|做法)(?:已|均)?被(?:否定|否决)(?:[，,]\s*(?:并?未(?:被)?采纳|未予采用))?。/u;
  const refusedOnce = (chapter: (typeof draft.chapters)[number]) => {
    if (!chapter.paragraphs.some(paragraph => REFUSED_AGAIN.test(paragraph.text))) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const sentence = paragraph.text.match(REFUSED_AGAIN)?.[0];
      if (!sentence) return paragraph;
      const text = paragraph.text.replace(sentence, "").trim();
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => claim.text.includes(sentence) ? { ...claim, text: claim.text.replace(sentence, "").trim() } : claim) };
    });
    return { ...chapter, body, paragraphs };
  };
  const chainPlace = (written: typeof draft.chapters, at: number, paragraph: (typeof draft.chapters)[number]["paragraphs"][number], line: string) => {
    const plain = (value: string) => value.replace(/\*\*/gu, "");
    const ids = [...new Set((paragraph.claims ?? []).filter(claim => claim.text.trim() && plain(line).includes(plain(claim.text))).flatMap(claim => claim.unitIds))];
    const chain = ids.length ? chains.find(topic => ids.every(id => topic.current.includes(id))) : undefined;
    // A chain with an earlier version, and an item no other paragraph here cites too (a block it captions stays with it).
    if (!chain?.earlier.length || written[at].paragraphs.some(item => item !== paragraph && item.unitIds.some(id => ids.includes(id)))) return undefined;
    const others = [...chain.current, ...chain.earlier].filter(id => !ids.includes(id));
    const holding = new Set(written.flatMap((chapter, index) => chapter.paragraphs.some(item => item.unitIds.some(id => others.includes(id))) ? [index] : []));
    if (holding.size !== 1 || holding.has(at)) return undefined;
    const to = [...holding][0], said = knowledgeTerms(plain(line));
    const scored = [...new Set(written[to].paragraphs.map(item => item.subtopic))].filter(subtopic => !earlierHeading.test(subtopic)).map(subtopic => {
      const own = knowledgeTerms(`${subtopic} ${written[to].paragraphs.filter(item => item.subtopic === subtopic).map(item => item.text).join(" ")}`);
      return { subtopic, shared: [...said].filter(term => own.has(term)).length };
    }).sort((a, b) => b.shared - a.shared);
    return scored[0]?.shared ? { to, subtopic: scored[0].subtopic } : undefined;
  };
  // An earlier version told among the current points of a chapter, or in a chapter telling none of what replaced it (the
  // AI's central "+" button, 「中央悬浮“+”号含义不明，建议改为盾牌……」〔此前〕, under the algorithm chapter's AI roles, while
  // the user's idea replacing it, 「你提议将首页中间的加号按钮点击后直接跳转至AI界面……」, is told under the interface
  // chapter): it goes to the 早先版本 of the chapter telling what replaced it, or of its own.
  const earlierFollowsCurrent = (written: typeof draft.chapters) => {
    const toldNow = written.map(chapter => new Set(chapter.paragraphs.filter(paragraph => !earlierHeading.test(paragraph.subtopic)).flatMap(paragraph => [...paragraph.unitIds, ...(paragraph.claims ?? []).flatMap(claim => claim.unitIds)])));
    const replacedBy = (id: string) => [...outgrownBy.get(id) ?? [], ...chains.filter(topic => topic.earlier.includes(id)).flatMap(topic => topic.current)];
    const moves = new Map<number, Array<(typeof written)[number]["paragraphs"][number]>>(), leaving = new Set<(typeof written)[number]["paragraphs"][number]>();
    written.forEach((chapter, at) => chapter.paragraphs.forEach(paragraph => {
      const cited = (paragraph.claims ?? []).flatMap(claim => claim.unitIds);
      if (!cited.length || !cited.every(id => outgrown.has(id)) || /\n/u.test(paragraph.text.trim()) || /^\s*(?:\||>|#|`)/u.test(paragraph.text)) return;
      const later = [...new Set(cited.flatMap(replacedBy))];
      // The user's own idea first: where it is told, the earlier version goes, though a reply taking it up is told elsewhere.
      const mine = later.filter(id => units.get(id)?.evidence.role === "user"), deciding = mine.some(id => toldNow.some(ids => ids.has(id))) ? mine : later;
      const places = deciding.some(id => toldNow[at].has(id)) ? [at] : [...new Set(deciding.flatMap(id => toldNow.flatMap((ids, to) => ids.has(id) ? [to] : [])))];
      const place = places.length === 1 ? places[0] : at;
      if (place === at && earlierHeading.test(paragraph.subtopic)) return;
      leaving.add(paragraph);
      moves.set(place, [...moves.get(place) ?? [], paragraph]);
    }));
    if (!moves.size) return written;
    return written.map((chapter, at) => {
      let body = chapter.body;
      let paragraphs = chapter.paragraphs.filter(paragraph => { if (!leaving.has(paragraph)) return true; body = removeParagraph(body, paragraph.text); return false; });
      const coming = moves.get(at) ?? [];
      if (!coming.length) return body === chapter.body ? chapter : { ...chapter, body, paragraphs };
      const heading = paragraphs.find(paragraph => earlierHeading.test(paragraph.subtopic))?.subtopic ?? (zhDraft ? "早先版本" : "Earlier versions");
      // An item among items: told as a list item, as the earlier versions are.
      const added = coming.map(paragraph => ({ ...paragraph, subtopic: heading, text: /^\s*[-*+]\s/u.test(paragraph.text) ? paragraph.text : `- ${paragraph.text.trim()}` }));
      const text = added.map(paragraph => paragraph.text).join("\n");
      const last = [...paragraphs].reverse().find(paragraph => paragraph.subtopic === heading);
      // After a list, it is the list's next item.
      const joined = last && /^\s*[-*+]\s/u.test(last.text.trim().split("\n").at(-1) ?? "") ? "\n" : "\n\n";
      body = last ? replaceParagraph(body, last.text, () => `${last.text}${joined}${text}`) : `${body.trimEnd()}\n\n### ${heading}\n\n${text}`;
      const index = last ? paragraphs.indexOf(last) + 1 : paragraphs.length;
      paragraphs = [...paragraphs.slice(0, index), ...added, ...paragraphs.slice(index)];
      return { ...chapter, body, paragraphs };
    });
  };
  const movedByLabel = (written: typeof draft.chapters) => {
    const pairs = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, at) => text.slice(at, at + 2)).filter(pair => /^\p{Script=Han}{2}$/u.test(pair)));
    const places = written.flatMap((chapter, at) => [...new Set(chapter.paragraphs.map(paragraph => paragraph.subtopic))].map(subtopic => ({ at, subtopic, pairs: pairs(subtopic) })));
    const moves: Array<{ from: number; paragraph: number; line: string; to: number; subtopic: string }> = [];
    written.forEach((chapter, at) => chapter.paragraphs.forEach((paragraph, index) => {
      const lines = paragraph.text.split("\n");
      if (lines.length < 2 || !lines.every(line => /^\s*[-*+]\s+\*\*[^*\n]+\*\*/u.test(line))) return;
      const here = new Set([...pairs(paragraph.subtopic), ...pairs(chapter.title)]);
      for (const line of lines) {
        const label = pairs(line.match(/\*\*([^*\n]+)\*\*/u)![1]);
        const followed = chainPlace(written, at, paragraph, line);
        if (followed) { moves.push({ from: at, paragraph: index, line, ...followed }); continue; }
        if (!label.size || [...label].some(pair => here.has(pair))) continue;
        const place = places.filter(item => item.at !== at && item.subtopic !== paragraph.subtopic).map(item => ({ item, shared: [...label].filter(pair => item.pairs.has(pair)).length }))
          .filter(({ shared }) => shared >= LABEL_PLACE.shared && shared / label.size >= LABEL_PLACE.cover).sort((a, b) => b.shared - a.shared);
        // One place only: a label two subtopics could take is left where the writer put it.
        if (place.length === 1 || place.length > 1 && place[0].shared > place[1].shared) moves.push({ from: at, paragraph: index, line, to: place[0].item.at, subtopic: place[0].item.subtopic });
      }
    }));
    if (!moves.length) return written;
    // Each list gives up its moved lines at once, then each line is placed: paragraphs are found by what they say.
    const chapters = written.map(chapter => ({ ...chapter, paragraphs: [...chapter.paragraphs] }));
    const placed: Array<{ to: number; subtopic: string; added: (typeof written)[number]["paragraphs"][number] }> = [];
    const grouped = new Map<string, typeof moves>();
    for (const move of moves) grouped.set(`${move.from}:${move.paragraph}`, [...grouped.get(`${move.from}:${move.paragraph}`) ?? [], move]);
    for (const [key, group] of grouped) {
      const [from, index] = key.split(":").map(Number), source = chapters[from], paragraph = source.paragraphs[index];
      const lines = new Set(group.map(move => move.line)), plain = (value: string) => value.replace(/\*\*/gu, "");
      const goes = (claim: { text: string }) => group.some(move => plain(move.line).includes(plain(claim.text)));
      const rest = paragraph.text.split("\n").filter(line => !lines.has(line)).join("\n").trim(), kept = (paragraph.claims ?? []).filter(claim => !goes(claim));
      chapters[from] = { ...source, body: rest ? replaceParagraph(source.body, paragraph.text, () => rest) : removeParagraph(source.body, paragraph.text),
        paragraphs: source.paragraphs.flatMap((item, at) => at !== index ? [item] : rest ? [{ ...item, text: rest, claims: kept, unitIds: item.unitIds.filter(id => kept.some(claim => claim.unitIds.includes(id)) || !(paragraph.claims ?? []).some(claim => claim.unitIds.includes(id))) }] : []) };
      for (const move of group) {
        const claims = (paragraph.claims ?? []).filter(claim => plain(move.line).includes(plain(claim.text))), ids = [...new Set(claims.flatMap(claim => claim.unitIds))];
        placed.push({ to: move.to, subtopic: move.subtopic, added: { subtopic: move.subtopic, text: move.line.trim(), unitIds: ids.length ? ids : paragraph.unitIds, claims } });
      }
    }
    // A moved item joins the subtopic's list of labelled items when it has one (中央按钮, 盾牌入口, 主行动按钮), else
    // follows its last paragraph.
    const labelled = (text: string) => text.split("\n").every(line => /^\s*[-*+]\s+\*\*[^*\n]+\*\*/u.test(line));
    for (const { to, subtopic, added } of placed) {
      const target = chapters[to], own = target.paragraphs.map((item, at) => ({ item, at })).filter(({ item }) => item.subtopic === subtopic);
      const list = own.filter(({ item }) => labelled(item.text)).at(-1), last = own.at(-1)!;
      if (list) {
        const text = `${list.item.text}\n${added.text}`;
        chapters[to] = { ...target, body: replaceParagraph(target.body, list.item.text, () => text), paragraphs: target.paragraphs.map((item, at) => at !== list.at ? item : { ...item, text, unitIds: [...new Set([...item.unitIds, ...added.unitIds])], claims: [...item.claims ?? [], ...added.claims ?? []] }) };
        continue;
      }
      chapters[to] = { ...target, body: replaceParagraph(target.body, last.item.text, () => `${last.item.text}\n\n${added.text}`), paragraphs: [...target.paragraphs.slice(0, last.at + 1), added, ...target.paragraphs.slice(last.at + 1)] };
    }
    return chapters;
  };
  // A list item telling two versions in one line, from a comparison written as a list: 「- **急救流程**：当前建议：……；早期
  // 版本：……」 put one mark after both. The current version is the item; the earlier one an item of its own, told as before.
  const versionsApart = (chapter: (typeof draft.chapters)[number]) => !zhDraft ? chapter : withLines(chapter, line => {
    const told = line.match(VERSIONS_IN_ITEM);
    if (!told) return line;
    const [, head, now, before] = told;
    return before ? `${head}${now.trim()}\n${head}${/^(?:早期|此前|之前|原先|曾|最初|早先)/u.test(before.trim()) ? before.trim() : `此前${before.trim()}`}` : `${head}${now.trim()}`;
  });
  // A line of prose among a list's items (「SOS急救不要完全收费。」 between two labelled items) read as stray text breaking the
  // list: it is an item of the list too.
  const strayInList = (chapter: (typeof draft.chapters)[number]) => withLines(chapter, (line, index, lines) => {
    const item = (value: string | undefined) => /^\s*[-*+]\s+\S/u.test(value ?? "");
    if (!line.trim() || item(line) || /^\s*(?:\d+\.\s|\||>|#|`|~|\*[^*]|\s{2,})/u.test(line) || !item(lines[index - 1]) || !item(lines.slice(index + 1).find(next => next.trim()))) return line;
    return `${lines[index - 1].match(/^\s*[-*+]\s+/u)![0]}${line.trim()}`;
  });
  // The lines of each paragraph told again: the returned text replaces each line.
  function withLines(chapter: NonNullable<typeof draft>["chapters"][number], change: (line: string, index: number, lines: string[]) => string) {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (/^\s*(?:`{3,}|~{3,})/u.test(paragraph.text)) return paragraph;
      const lines = paragraph.text.split("\n"), text = lines.map((line, index) => change(line, index, lines)).join("\n");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text); changed = true;
      return { ...paragraph, text };
    });
    return changed ? { ...chapter, body, paragraphs } : chapter;
  }
  // Two lists of labelled items one after the other in a subtopic, each a paragraph of its own (「瓶颈诊断分析」: 传播困境……
  // then 日活规模……): a blank line between them read as two lists. They are one.
  const listsJoined = (chapter: (typeof draft.chapters)[number]) => {
    const labelled = (text: string) => { const lines = text.trim().split("\n"); return lines.every(line => /^\s*[-*+]\s+\S/u.test(line)) && lines.some(line => /^\s*[-*+]\s+\*\*[^*\n]+\*\*/u.test(line)); };
    let body = chapter.body;
    const paragraphs: typeof chapter.paragraphs = [];
    for (const paragraph of chapter.paragraphs) {
      const last = paragraphs.at(-1), joined = last ? `${last.text}\n\n${paragraph.text}` : "";
      // Among the earlier versions, any two lists: 「- 此前曾提议初期采用……」 and 「- 此前建议付费墙在第3天……」 stood apart.
      const items = (text: string) => text.trim().split("\n").every(line => /^\s*[-*+]\s+\S/u.test(line));
      const lists = earlierHeading.test(paragraph.subtopic) ? items : labelled;
      if (!last || last.subtopic !== paragraph.subtopic || !lists(last.text) || !lists(paragraph.text) || !body.includes(joined)) { paragraphs.push(paragraph); continue; }
      const text = `${last.text}\n${paragraph.text}`;
      body = body.replace(joined, () => text);
      paragraphs[paragraphs.length - 1] = { ...last, text, unitIds: [...new Set([...last.unitIds, ...paragraph.unitIds])], claims: [...last.claims ?? [], ...paragraph.claims ?? []] };
    }
    return paragraphs.length === chapter.paragraphs.length ? chapter : { ...chapter, body, paragraphs };
  };
  // A list item the writing left as its marker alone gets its label and text back from the unit telling it, or goes.
  const itemsRestored = (chapter: (typeof draft.chapters)[number]) => {
    let body = chapter.body, changed = false;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const told = paragraph.unitIds.flatMap(id => units.get(id) ? [{ id, statement: units.get(id)!.statement }] : []);
      const emptied = restoredEmptyItems(paragraph.text, told), skipped = restoredSkippedOrdinals(emptied.text, told);
      const text = skipped.text, restored = [...emptied.restored, ...skipped.restored];
      if (text === paragraph.text) return paragraph;
      changed = true;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: [...paragraph.claims ?? [], ...restored] };
    });
    // The opening is no paragraph of the chapter: 「开发规划分三版迭代：第一版……，第三版……」 left out the second version
    // there, and the overview's line read it from there.
    const opening = body.startsWith("### ") ? "" : body.split(/\n### /u)[0];
    const openingTold = (chapter.openingUnitIds ?? []).flatMap(id => units.get(id) ? [{ id, statement: units.get(id)!.statement }] : []);
    const filled = opening ? restoredSkippedOrdinals(opening, openingTold).text : opening;
    if (filled !== opening) { body = filled + body.slice(opening.length); changed = true; }
    return changed ? { ...chapter, body, paragraphs } : chapter;
  };
  type Chapter = (typeof draft.chapters)[number];
  const tableLike = (text: string) => /^\s*(?:```|\|)/mu.test(text);
  /** A change made to the chapter's prose wherever it is, the opening included (it has no claims, and passes reading
   * claims never reached it); tables and code are left as written. */
  const proseChanged = (chapter: Chapter, change: (line: string) => string): Chapter => {
    const lines = (text: string) => { let fenced = false; return text.split("\n").map(line => { if (/^\s*```/u.test(line)) fenced = !fenced; return fenced || /^\s*(?:```|\||#)/u.test(line) ? line : change(line); }).join("\n"); };
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    let body = opening ? lines(opening) + chapter.body.slice(opening.length) : chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (tableLike(paragraph.text)) return paragraph;
      const text = lines(paragraph.text);
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => text.includes(claim.text) ? claim : { ...claim, text: change(claim.text) }) };
    });
    return body === chapter.body && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };

  // Versions of one measure as rows of one table (「| 日活 (DAU) | 22人 | …」, 「| 日活 (DAU) | 约40 | …」): rows named alike say
  // nothing of when, and the newest row's 〔你〕 went on the first cell naming it, the June row's. The rows are told by their
  // days, oldest first, and the name they share heads the column of values.
  const TIME_HEADER = /时间|日期|时期|阶段|版本|^when$|^date$|^time$/iu;
  const GENERIC_VALUE_HEADER = /^(?:数值|数据|状态|值|数值\/状态|结果|情况|value|status)$/iu;
  const versionTablesDated = (chapter: Chapter): Chapter => {
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.trim().split("\n");
      if (lines.length < 4 || !lines.every(line => line.trim().startsWith("|")) || !/^\s*\|?\s*:?-{3,}/u.test(lines[1])) return paragraph;
      const cells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map(cell => cell.trim());
      const name = (cell: string) => cell.replace(/\*\*/gu, "").trim();
      const header = cells(lines[0]), rows = lines.slice(2).map(cells), shared = name(rows[0][0] ?? "");
      if (!shared || TIME_HEADER.test(name(header[0] ?? "")) || rows.some(row => name(row[0] ?? "") !== shared)) return paragraph;
      const claims = paragraph.claims ?? [];
      const whenOf = (row: string[]) => {
        const said = claims.filter(claim => name(claim.text) !== shared && row.slice(1).some(cell => cell.includes(claim.text.trim()))).flatMap(claim => claim.unitIds).flatMap(id => units.get(id) ?? []);
        const days = [...new Set(said.map(unit => wikiSaidWhen(unit, zhDraft)).filter(Boolean))];
        return days.length === 1 ? { day: days[0], at: Math.max(...said.map(unit => unit.evidence.conversationSpan?.start ?? 0)) } : undefined;
      };
      const dated = rows.map(row => ({ row, when: whenOf(row) }));
      if (dated.some(item => !item.when) || new Set(dated.map(item => item.when!.day)).size < rows.length) return paragraph;
      dated.sort((a, b) => a.when!.at - b.when!.at);
      const values = header[1] && GENERIC_VALUE_HEADER.test(name(header[1])) ? shared : `${shared}${zhDraft ? "：" : ": "}${header[1] ?? ""}`;
      const text = [`| ${zhDraft ? "时间" : "When"} | ${[values, ...header.slice(2)].join(" | ")} |`, `| ${header.map(() => "---").join(" | ")} |`, ...dated.map(item => `| ${item.when!.day} | ${item.row.slice(1).join(" | ")} |`)].join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: claims.filter(claim => name(claim.text) !== shared && text.includes(claim.text.trim())) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };

  // A table of versions with one row: 「| 阶段/时间点 | 日活(DAU) | 核心/稳定用户 | 留存率指标 |」 over 「| 当前报告 | 约40 | - |
  // 活跃留存率略高于40% |」. One version is no comparison: the table, its 「-」 and its label for when (当前报告) said less
  // than a sentence. It is told as one, led by the day its source was said when the row has one.
  const loneRowTold = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const lines = paragraph.text.trim().split("\n");
      if (lines.length !== 3 || !lines.every(line => line.trim().startsWith("|")) || !/^\s*\|?\s*:?-{3,}/u.test(lines[1])) return paragraph;
      const header = tableCells(lines[0]).map(cell => cell.replace(/\*\*/gu, "").trim()), row = tableCells(lines[2]);
      if (header.length < 2 || row.length !== header.length || !TIME_HEADER.test(header[0])) return paragraph;
      const claims = paragraph.claims ?? [];
      const said = [...new Set(claims.flatMap(claim => claim.unitIds))].flatMap(id => units.get(id) ?? []);
      const days = [...new Set(said.map(unit => wikiSaidWhen(unit, true)).filter(Boolean))];
      const label = row[0].replace(/\*\*/gu, "").trim();
      // The day goes after, in brackets, as a figure's day is told everywhere else: 「……略高于40%（8月18日）。」
      const day = days.length === 1 ? days[0] : "", lead = day || /^(?:当前|目前|现在|近期|最近|最新)/u.test(label) ? "" : label;
      // A value naming its measure already needs no column name: 「活跃留存率略高于40%」 under 留存率指标.
      const names = header.slice(1).map((name, at) => { const core = name.replace(/指标|数据|情况|\(.*\)|（.*）/gu, ""); return core.length >= 2 && row[at + 1].includes(core) ? undefined : name; });
      const told = rowFields(names, row.slice(1), true);
      if (!told) return paragraph;
      const sentence = `${told.replace(/[。]$/u, "")}${day ? `（${day}）` : ""}。`;
      const text = lead ? `${lead}：${sentence}` : sentence;
      body = replaceParagraph(body, paragraph.text, () => text);
      // The cells' claims become the sentence's one claim: a cell claim 「约40」 alone in prose read as the AI's.
      const unitIds = [...new Set(claims.flatMap(claim => claim.unitIds))];
      return { ...paragraph, text, claims: unitIds.length ? [{ ...claims[0], text, unitIds }] : [] };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };

  // A figure called today's where no claim covers it (an opening, which the overview reads): 「针对当前日活卡在32人左右……」,
  // 32 said in July beside the August DAU of 40. Told as then, with its day. A target is no report: 「从15人提升至20人」 stays.
  const userMeasures = all.filter(unit => wikiMeasure(unit) && unit.evidence.role === "user" && !unit.evidence.pasted);
  const NOW_FIGURE = /(当前|目前|现在|如今)([^，。；！？\n\d]{0,10}?)(\d+(?:\.\d+)?)(%|人|个|名|万)?(左右)?/gu;
  const AIMED = /目标|提升|突破|达到|达成|实现|争取|预计|计划|超过|以上/u;
  // The opening can name a full historical range and percentage together, even
  // when its only explicit binding is a decision in another sentence.
  const measuredOpening = (chapter: Chapter): Chapter => !zhDraft ? chapter : proseChanged(chapter, line => qualifyWikiDatedReport(line, userMeasures.filter(unit => !unit.about)));
  const openingOfferAttribution = (chapter: Chapter): Chapter => {
    if (!zhDraft || chapter.body.startsWith("### ")) return chapter;
    const opening = chapter.body.split(/\n### /u)[0];
    const cited = [...new Set(chapter.paragraphs.flatMap(paragraph => paragraph.unitIds))].flatMap(id => units.get(id) ?? []);
    const text = qualifyWikiOpeningOffer(opening, cited, statuses);
    return text === opening ? chapter : { ...chapter, body: text + chapter.body.slice(opening.length) };
  };
  const staleNowTold = (chapter: Chapter): Chapter => newestMeasure === Infinity ? chapter : proseChanged(chapter, line => line.replace(NOW_FIGURE, (whole: string, _now: string, between: string, figure: string, measure: string | undefined, about: string | undefined, at: number, text: string) => {
    // The figure's own clause, to the next mark or joining word: 「……卡在32人左右且难以突破40人」 aims at nothing with its 32.
    const clause = whole + text.slice(at + whole.length).split(/[，。；！？]|且|并|而/u)[0];
    if (AIMED.test(clause) || !/日活|DAU|MAU|留存|付费|用户|人数/u.test(`${between}${measure ?? ""}`) && measure !== "人" || /^\s*[（(]\d+月/u.test(text.slice(at + whole.length))) return whole;
    const givers = userMeasures.filter(unit => figuresIn(unit.statement).includes(figure));
    if (!givers.length || givers.some(unit => (unit.evidence.conversationSpan?.start ?? 0) >= newestMeasure)) return whole;
    const day = wikiSaidWhen(givers[0], true);
    return day ? `当时${between}${figure}${measure ?? ""}${about ?? ""}（${day}）` : whole;
  }));

  // The AI's own figure for the user's product, which the user never gave: 「日活约30人（近期降至22人）」 and 「鉴于当前约30日活」,
  // when the user reported 22, 25, 32 and 40 and never 30. It read as a report beside theirs and contradicted them. The clause
  // goes; targets, conditions, benchmarks and other products' figures are no report and stay.
  const NOT_REPORTED = /目标|提升|突破|达到|达成|实现|超|至少|不低于|以上|以内|争取|预计|计划|≥|≤|行业|平均|通常|一般|区间|标准|竞品|宣称|下载|评价|收入|广义|大约在|基准/u;
  /** A figure right beside the measure it counts: 「日活约30人」, 「约30日活」, 「留存为19%」; 「7日留存」 and 「超30%活跃用户」 count none. */
  const MEASURED_FIGURE = /(?:日活|DAU|MAU|留存率?|付费率|稳定用户|核心用户|累计用户|新增用户)\s*(?:约|仅|为|在|是|达|有|稳定在|卡在|停留在|：|:)?\s*(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*人?\s*(?:日活|DAU)/gu;
  const userGiven = new Set(all.filter(unit => unit.evidence.role === "user").flatMap(unit => figuresIn(`${unit.statement} ${unit.evidence.quote}`, { counts: true })));
  /** A sentence's clauses, never split inside brackets: 「（6月14日—7月7日；其后降至22人）」 is one clause's. */
  const clausesOf = (sentence: string) => { const out: string[] = []; let depth = 0, start = 0; for (let at = 0; at < sentence.length; at++) { const char = sentence[at]; if ("（(".includes(char)) depth++; else if ("）)".includes(char)) depth = Math.max(0, depth - 1); else if (!depth && "，,；;".includes(char)) { out.push(sentence.slice(start, at + 1)); start = at + 1; } } out.push(sentence.slice(start)); return out.filter(Boolean); };
  /** A sentence as its claim was written, before later passes dated it or labelled it: brackets, an item's lead and
   * label, bold and stops left out. 「- **近期日活**：日活约30人（6月14日—7月7日；其后降至22人）。」 is the claim
   * 「日活约30人（近期降至22人）。」, and matched to it the sentence is known to be the AI's alone. */
  const barely = (text: string) => text.replace(/[（(][^）)]*[）)]/gu, "").replace(/^\s*(?:[-*+]|\d+\.)\s*(?:\*\*[^*\n]+\*\*\s*[：:]\s*)?/u, "").replace(/\*\*/gu, "").replace(/[。！？\s]/gu, "");
  const aiOwnFiguresOut = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (tableLike(paragraph.text)) return paragraph;
      const claims = paragraph.claims ?? [];
      const aiOnly = (sentence: string) => { const told = barely(sentence), covering = claims.filter(claim => { const own = barely(claim.text); return Boolean(own && told) && (told.includes(own) || own.includes(told)); }); const ids = covering.length ? covering.flatMap(claim => claim.unitIds) : paragraph.unitIds; return ids.length > 0 && ids.every(id => units.get(id)?.evidence.role === "assistant"); };
      const invented = (clause: string) => !NOT_REPORTED.test(clause) && [...clause.matchAll(MEASURED_FIGURE)].some(match => !userGiven.has(match[1] ?? match[2]));
      let text = paragraph.text;
      for (const sentence of paragraph.text.match(/[^。！？\n]+[。！？]?/gu) ?? []) {
        if (!aiOnly(sentence)) continue;
        const clauses = clausesOf(sentence), kept = clauses.filter(clause => !invented(clause));
        if (kept.length === clauses.length) continue;
        // Nor when what stays leans on the clause taken out.
        if (clauses.some((clause, at) => at > 0 && kept.includes(clause) && !kept.includes(clauses[at - 1]) && LEANS_ON_BEFORE.test(clause.trim()))) continue;
        const cut = kept.join("").replace(/^\s*[，,；;]\s*/u, "").replace(/[，,；;]\s*$/u, "。");
        text = text.replace(sentence, kept.length ? cut : "");
      }
      if (text === paragraph.text) return paragraph;
      text = text.split("\n").map(line => line.replace(/[ \t]{2,}/gu, " ").trimEnd()).filter(line => !/^\s*(?:[-*+]|\d+\.)\s*(?:\*\*[^*\n]+\*\*\s*[：:]\s*)?$/u.test(line)).join("\n").trim();
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      return { ...paragraph, text, claims: claims.filter(claim => text.includes(claim.text.trim())) };
    }).filter(paragraph => paragraph.text);
    return paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };

  // An item going on from the one before it, 「- 随后进一步升级为“今天只做这一件事”……」 after 「- 此前将……合并为单一的“今日
  // 任务”卡片。」: on its own it upgraded nothing the reader could name, and a lead put before it read 「此前建议随后进一步
  // 升级」. It is the item before it going on, joined to it as its next clause.
  const FOLLOW_ON = /^\s*[-*+]\s+((?:随后|之后|后来|然后|接着|进而|进一步)[^\n]*)$/u;
  const followOnJoined = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (tableLike(paragraph.text)) return paragraph;
      const lines = paragraph.text.split("\n"), joined: string[] = [];
      for (const line of lines) {
        const follow = line.match(FOLLOW_ON), last = joined[joined.length - 1];
        if (follow && last && /^\s*[-*+]\s+/u.test(last)) joined[joined.length - 1] = `${last.replace(/[。！？]\s*$/u, "")}，${follow[1]}`;
        else joined.push(line);
      }
      if (joined.length === lines.length) return paragraph;
      const text = joined.join("\n");
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A one-line earlier version written as a paragraph between items of the earlier versions (「- 此前将……」, 「此前破戒后提供
  // 30秒结构化复盘……」, 「- 此前将……」): one list read as two shapes. It is an item like the others.
  const earlierItemsAlike = (chapter: Chapter): Chapter => {
    const listed = (paragraph: Chapter["paragraphs"][number] | undefined) => Boolean(paragraph) && earlierHeading.test(paragraph!.subtopic) && /^\s*[-*+]\s/u.test(paragraph!.text) && paragraph!.text.trim().split("\n").every(line => /^\s*[-*+]\s/u.test(line));
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map((paragraph, at, list) => {
      if (!earlierHeading.test(paragraph.subtopic) || tableLike(paragraph.text) || /\n|^\s*(?:[-*+#>*]|\d+\.)/u.test(paragraph.text.trim()) || /[：:]$/u.test(paragraph.text.trim())) return paragraph;
      if (!listed(list[at - 1]) && !listed(list[at + 1])) return paragraph;
      const text = `- ${paragraph.text.trim()}`;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // Rejections told one sentence each, 「你否定了……。你否定了……。你否定了……。」: read as a refrain, and 「你否定了采用系统自动分配
  // 同期小组（滚动制），而非用户主动寻找战友或创建队伍」 read as rejecting the users' own search. They are listed under one lead.
  const REJECTED = /^你否定了(?:「([^」]+)」的方案|(.+?))[。]?$/u;
  const rejectionsListed = (chapter: Chapter): Chapter => {
    if (!zhDraft) return chapter;
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      if (!earlierHeading.test(paragraph.subtopic) || tableLike(paragraph.text) || /\n/u.test(paragraph.text.trim())) return paragraph;
      const sentences = paragraph.text.trim().match(/[^。]+。?/gu) ?? [];
      if (sentences.length < 2 || !sentences.every(sentence => REJECTED.test(sentence.trim()))) return paragraph;
      const items = sentences.map(sentence => { const [, quoted, plain] = sentence.trim().match(REJECTED)!; return (quoted ?? plain).replace(/的(?:方案|做法)$/u, "").trim(); });
      const text = `你否定过这些方案：\n${items.map(item => `- ${item}。`).join("\n")}`;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text, claims: (paragraph.claims ?? []).map(claim => { const item = items.find(value => claim.text.includes(value) || value.includes(claim.text.replace(/^你否定了/u, "").replace(/[。]$/u, ""))); return item ? { ...claim, text: `${item}。` } : claim; }).filter(claim => text.includes(claim.text)) };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // The passes by name, in order: a probe the tests set reads the chapters after each one, so a sentence broken by a
  // pass is traced to that pass, not found later in the exported document.
  const perChapter = (pass: (chapter: Chapter) => Chapter) => (written: Chapter[]) => written.map(pass);
  const withoutGone = (chapter: Chapter): Chapter => chapter.paragraphs.some(gone) ? { ...chapter, body: chapter.paragraphs.filter(gone).reduce((body, paragraph) => removeParagraph(body, paragraph.text), chapter.body), paragraphs: chapter.paragraphs.filter(paragraph => !gone(paragraph)) } : chapter;
  const tidyBody = (chapter: Chapter): Chapter => { const body = withoutEmptyHeadings(chapter.body.replace(FOLDED_NOTE, "")).replace(CJK_STOP_SPACE, "$1"); return body === chapter.body ? chapter : { ...chapter, body }; };
  // A list a label leads starts on its own line: drafts kept 「AI 对具体细节的建议：- **模块顺序**：……」, the first item read as prose.
  const LABEL_OVER_LIST = /((?:AI 对具体细节的建议|以下细节待核对|AI proposal for the details|Details requiring review)[：:])[ \t]*(?=(?:[-*+]|\d+[.)])\s)/gu;
  // A sentence opening on the stub of a cut lead-in, 「……小程序环境。中引用，2025年媒体报道称……」: the lead named only where
  // the figures came from, which the note after such figures says.
  const CUT_LEAD = /(^|[。！？；]\s*)中(?:引用|提到|提及|指出)(?:的)?[，,：:]\s*/gu;
  const labelOverList = (chapter: Chapter): Chapter => {
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.map(paragraph => {
      const text = paragraph.text.replace(LABEL_OVER_LIST, "$1\n").replace(CUT_LEAD, "$1");
      if (text === paragraph.text) return paragraph;
      body = replaceParagraph(body, paragraph.text, () => text);
      return { ...paragraph, text };
    });
    return paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  };
  // A sentence telling the user's confirmation that no point it cites backs: 「你已确认将产品定位从“戒色”扩展至“男性状态恢复/
  // 自律成长”，但V0.1仍以戒色为核心功能。」 cited an AI proposal and the user's question, told with a version no source gives,
  // while the decision itself stood confirmed in 产品定位. Repeating a confirmed decision told in another chapter, it goes;
  // otherwise it is told as what the discussion proposed.
  const CONFIRMATION_SAID = /^(\*\*)?(?:你|用户)(?:已经|已)?(?:确认|决定|选定)(?:了)?/u;
  const backs = (unit: WikiKnowledgeUnit) => statuses.get(unit.id) === "confirmed" || statuses.get(unit.id) === "stated" && unit.evidence.role === "user" && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind);
  const unbackedConfirmation = (written: Chapter[]): Chapter[] => written.map((chapter, index) => {
    // Confirmed decisions another chapter tells.
    const elsewhere = new Set(written.flatMap((other, at) => at === index ? [] : [...other.openingUnitIds ?? [], ...other.paragraphs.flatMap(paragraph => paragraph.unitIds)]));
    const toldElsewhere = confirmed.filter(unit => elsewhere.has(unit.id));
    let body = chapter.body;
    const paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (/^\s*(?:\||```|>)/u.test(paragraph.text)) return [paragraph];
      let text = paragraph.text, claims = paragraph.claims ?? [];
      for (const line of paragraph.text.split("\n")) {
        if (/^\s*(?:[-*+]\s|\d+[.)]\s|\||>|#)/u.test(line)) continue;
        for (const sentence of line.split(/(?<=[。！？])/u).map(item => item.trim()).filter(Boolean)) {
          if (!CONFIRMATION_SAID.test(sentence)) continue;
          const own = claims.filter(claim => claim.text && (sentence.includes(claim.text) || claim.text.includes(sentence.replace(/[。！？]$/u, ""))));
          const cited = (own.length ? own.flatMap(claim => claim.unitIds) : paragraph.unitIds).flatMap(id => units.get(id) ?? []);
          if (!cited.length || cited.some(backs)) continue;
          const terms = knowledgeTerms(sentence);
          const repeat = toldElsewhere.some(unit => saysMostOf(terms, unit.statement));
          const told = repeat ? "" : sentence.replace(CONFIRMATION_SAID, (_, bold = "") => `${bold}讨论中提出`);
          const at = text.indexOf(sentence);
          if (at < 0) continue;
          text = `${text.slice(0, at)}${told}${text.slice(at + sentence.length)}`.replace(/^\s+|\s+$/gu, "");
          if (repeat) {
            // Its points go on citing the sentence after it that no claim covers (「建议优先深耕单一垂直领域……」 told the proposal).
            claims = claims.filter(claim => !own.includes(claim));
            const next = text.slice(at).split(/(?<=[。！？])/u).map(item => item.trim()).find(item => item && !claims.some(claim => item.includes(claim.text)));
            const ids = [...new Set(own.flatMap(claim => claim.unitIds))].filter(id => next && saysMostOf(knowledgeTerms(next), units.get(id)?.statement ?? ""));
            if (next && ids.length) claims = [...claims, { text: next, unitIds: ids }];
          } else claims = claims.map(claim => own.includes(claim) ? { ...claim, text: claim.text.replace(CONFIRMATION_SAID, (_, bold = "") => `${bold}讨论中提出`) } : claim);
        }
      }
      if (text === paragraph.text) return [paragraph];
      body = text ? replaceParagraph(body, paragraph.text, () => text) : removeParagraph(body, paragraph.text);
      return text ? [{ ...paragraph, text, claims }] : [];
    });
    return paragraphs.length === chapter.paragraphs.length && paragraphs.every((paragraph, at) => paragraph === chapter.paragraphs[at]) ? chapter : { ...chapter, body, paragraphs };
  });
  const passes: Array<[string, (written: Chapter[]) => Chapter[]]> = [
    ["labelOverList", perChapter(labelOverList)], ["unbackedConfirmation", unbackedConfirmation],
    ...Object.entries({ itemsRestored, cutOffRestored, headRestored, magnitudeKept, rejectedLabelTold, blockLineOut, earlierPriceAsideOut, unsaidRejectionOut, userIdeaTold, misCitedRowsOut, declinedListTrue, ownDecisionTold, versionsApart, strayInList, rowListsAsTables, madeRanges, keptToSources, differingNoted, openingNotOpen, stageHeaders, plainerSentences, withoutUnsaidPlans, saidByOpening, yourWords, versionTablesDated, loneRowTold, measuredTable, figuresByDay, captionsNow, withoutUnsourcedRows, openingWithoutEarlier, currentOutOfEarlier, laterExistsOut, earlierToldOut, earlierItemsOut, borrowedFiguresOut, reportedFigureClauseOut, aiOwnFiguresOut, leadingEarlierOut, withoutFiller, aiNamed, coinsNamed, turnedDown, refusedOnce, earlierNotNow, notInForce, figuresQuoted, nowDated, staleNowTold, positioningOnce, listFiguresOnce, repeatedBlocks, pointsAhead, firstVersionNamed, openingGoals, openingDated, ownParagraphs, subtopicJoinedOff, versionRowsTold, stageLabelOut, strayRowsOut, fieldLinesTold, askedRaised, suggestionWords, earlierSuggested, anotherAlone, earlierTidy, followOnJoined, rejectionsListed, earlierItemsAlike, emptyItemsOut, heldInText, pastLabelNow, openingTailOut, openingTargetOut, openingFromListedDecision, openingFromDecision, decidedAgainstDeclinedNoted, listsJoined, withoutGone }).map(([name, pass]): [string, (written: Chapter[]) => Chapter[]] => [name, perChapter(pass)]),
    ["keptUserPoints", keptUserPoints], ["repeatedFigures", repeatedFigures], ["movedByLabel", movedByLabel], ["earlierFollowsCurrent", earlierFollowsCurrent],
    ["earlierReportJoined", perChapter(earlierReportJoined)], ["qualifiedAlternatives", perChapter(qualifiedAlternatives)], ["measuredOpening", perChapter(measuredOpening)], ["openingOfferAttribution", perChapter(openingOfferAttribution)], ["tidyBody", perChapter(tidyBody)],
  ];
  const chapters = passes.reduce((written, [name, pass]) => { const next = pass(written); ledgerPassProbe?.(name, written, next); return next; }, draft.chapters);
  const sections = chapters.filter(chapter => chapter.paragraphs.length).map((chapter): FocusSection => {
    const chapterUnits = [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => units.get(id) ?? []);
    // The opening has no claims of its own: a decision it states ("优先实现复制上下文功能……") gets one on the sentence
    // saying it, so its mark shows there too.
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    // One claim per sentence: two confirmed units said by the opening's first sentence put two 已定 marks after it.
    const openingUnits = new Map<string, string[]>();
    // An opening sentence is marked as decided only when most of what it says is a decision of the chapter: "系统采用以
    // Hardware IR 为唯一事实源的架构，通过 Zod 定义……" was marked 〔已定〕 on the rule "禁止改变 Hardware IR 作为唯一事实源……",
    // which says nothing of Zod.
    // The user's own decision is one too (「决定先深耕“戒色”单一垂直领域……」, said by the user), put back in the opening.
    const ownDecision = (unit: WikiKnowledgeUnit) => statuses.get(unit.id) === "stated" && unit.evidence.role === "user" && !unit.evidence.pasted && DECIDING_KINDS.includes(unit.kind);
    const decidedTerms = knowledgeTerms(chapterUnits.filter(unit => statuses.get(unit.id) === "confirmed" || ownDecision(unit)).map(unitClaimText).join(" "));
    const mostlyDecided = (sentence: string) => { const own = knowledgeTerms(sentence); let shared = 0; for (const term of own) if (decidedTerms.has(term)) shared++; return shared / Math.max(1, own.size) >= OPENING_DECIDED; };
    for (const id of chapter.openingUnitIds ?? []) {
      const unit = units.get(id);
      if (!unit || statuses.get(id) !== "confirmed" && !ownDecision(unit)) continue;
      const whole = opening.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])/u).map(item => item.trim()).find(item => item && saysMostOf(knowledgeTerms(item), unit.statement));
      // A sentence the decision says up to a semicolon, a stage limit after it ("……及链接的功能；本阶段不包含比价。"): the
      // claim ends there, so 〔已定〕 does not take in the limit, which is not the user's decision.
      // Not a decision itself told over semicolons: 「分三版迭代：第一版……；第二版……；第三版……」 ended its 〔已定〕 after the first
      // version, and the key decisions listed it so.
      const clause = /[；;]/u.test(unit.statement) ? undefined : whole?.split(/(?<=[；;])/u).map(item => item.replace(/[；;]$/u, "").trim()).find(item => item.length >= SPLIT_CHARS && saysMostOf(knowledgeTerms(item), unit.statement));
      const sentence = whole && clause && clause !== whole.replace(/[。！？!?]$/u, "") ? clause : whole;
      if (sentence && mostlyDecided(sentence)) openingUnits.set(sentence, [...openingUnits.get(sentence) ?? [], id]);
    }
    const openingClaims = [...openingUnits].flatMap(([sentence, ids]) => [claimOn(sentence, ids, true)].flatMap(claim => claim ? [{ ...claim, holderMark: true }] : []));
    const claims = [...openingClaims, ...chapter.paragraphs.flatMap(paragraph => {
      const written = paragraph.claims?.length ? paragraph.claims.map(answerOwnWords).flatMap(claim => splitMixed(claim.text, decisionsSaid(claim.text, claim.unitIds, paragraph.unitIds)).flatMap(part => claimOn(part.text, part.unitIds, claim.markOnly, chapterUnits, itemLabel(paragraph.text, part.text)) ?? [])) : [];
      // A block shown as it was sent (a caption over a fence or a table) states no sentence of its own: its first
      // "sentence" was the whole block, and its mark landed after the closing fence ("```〔已纠正〕").
      if (!written.length && (SHOWN_BLOCK.test(paragraph.text.trim()) || /^>\s*(?:版本未定|范围有分歧|Not settled)[：:]/u.test(paragraph.text.trim()))) return [];
      return holderMarks(paragraph.text, written.length ? written : [claimOn(sentenceOf(paragraph.text), paragraph.unitIds)].flatMap(claim => claim ?? []), claim => [...new Set(claim.evidenceIds.flatMap(id => evidence.find(item => item.id === id)?.conversationId ?? []))].sort().join(" "));
    })];
    const cited = chapterUnits.flatMap(unit => {
      const source = cite(unit), approval = unit.adoption.approval;
      if (statuses.get(unit.id) !== "confirmed" || unit.adoption.status !== "user_adopted" || !approval) return [source];
      const key = `approval:${unit.evidence.conversationId}:${approval.evidenceId}`;
      let id = evidenceOf.get(key);
      if (!id) {
        id = `u${evidence.length + 1}`;
        evidenceOf.set(key, id);
        evidence.push({ id, conversationId: unit.evidence.conversationId, messageId: approval.messageId, title: conversationTitles[unit.evidence.conversationId] ?? "", excerpt: approval.quote });
      }
      return [source, id];
    });
    const subtopics = [...new Set(chapter.paragraphs.map(paragraph => paragraph.subtopic))];
    return { id: chapter.id, title: chapter.title, body: chapter.body.replace(FOLDED_NOTE, "").replace(/\n{3,}/gu, "\n\n").trim(), transition: "", evidenceIds: [...new Set(cited)], kind: "finding",
      ...(chapter.group ? { wikiGroup: chapter.group } : {}), wikiQuestion: chapter.question, wikiOwnerId: chapter.id, wikiSubtopics: subtopics.map(title => ({ title, question: "" })), claims };
  });
  return { sections, evidence };
}

/** The label of the list item a claim opens: "- **Global corner radius**: Global standard is 8px" → "Global corner radius". */
function itemLabel(text: string, claim: string): string {
  const line = text.split("\n").find(item => item.includes(claim));
  const match = line?.match(/^\s*(?:[-*+]|\d+\.)\s+\*\*([^*\n]+)\*\*\s*[:：]\s*(.*)$/u);
  return match && match[2].startsWith(claim.slice(0, 12)) ? match[1] : "";
}
/** A sentence's current part, then its earlier one: "…; earlier proposals of …", "…, replacing earlier suggestions of
 * 16px or 24px.", "……，此前的 16px 方案已被取代", "……10 分钟（取代早期讨论的 25/5 分钟方案）". */
const EARLIER_AFTER = /^(.+?)(?:[;；,，]\s*|\s*[（(])((?:(?:replacing|superseding|in place of)\s+|(?:取代|替代|替换)了?)?(?:the\s+)?(?:earlier|previous|prior|former|older|original|此前|之前|原先|早先|最初|早期)[\s\S]+)$/iu;
// "… of 8px; earlier specifications for larger card (16px) and dialog (24px) radii are ignored.": the user's answer
// told beside the decision, and the whole line read as earlier.
const EARLIER_TOLD = /\b(?:were|was|have been|has been|are|is)\s+(?:replaced|superseded|dropped|retired|withdrawn|revised|ignored|discarded|void)\b|\b(?:no longer apply|no longer applies|no longer hold)\b|^(?:replacing|superseding|in place of)\s|(?:已被?|被)(?:取代|替换|替代|废弃|弃用)|^(?:取代|替代|替换)了?(?:早期|此前|之前|原先|早先|最初)/iu;
/** A value a reader looks up: a colour or a size. */
const VALUE_TOKEN = /#[0-9A-Fa-f]{6}\b|\d+(?:\.\d+)?\s*px\b/gu;
/** Whether every value of the claim no current unit gives comes from an earlier unit, under a label no current unit sets
 * ("Panel #151516" where the later palette names no Panel). A value without a label, or under one a current unit sets
 * (its "Border"), was replaced, and the claim keeps its 〔此前〕. */
export function earlierValuesHold(text: string, current: WikiKnowledgeUnit[], earlier: WikiKnowledgeUnit[], newerOf: (id: string) => WikiKnowledgeUnit[] = () => []): boolean {
  const lower = (value: string) => value.toLowerCase().replace(/\s+/gu, "");
  const given = (value: string, unit: WikiKnowledgeUnit) => lower(unit.statement).includes(lower(value));
  const missing = [...new Set(text.match(VALUE_TOKEN) ?? [])].filter(value => !current.some(unit => given(value, unit)));
  if (!missing.length) return false;
  return missing.every(value => {
    const source = earlier.find(unit => given(value, unit));
    if (!source) return false;
    const at = source.statement.toLowerCase().indexOf(value.toLowerCase()), lead = source.statement.slice(0, at);
    const label = lead.slice(Math.max(...["，", ",", "；", ";", "：", ":", "（", "("].map(mark => lead.lastIndexOf(mark))) + 1).trim().match(/([A-Za-z][\w ]*[A-Za-z]|[一-鿿]{2,})\s*$/u)?.[1]?.trim();
    if (!label) return false;
    // The units that replaced it, or the current ones cited beside it when none is known. A label is set again when they
    // name it, or share a two-character part of a Chinese one (主背景 / 背景色).
    const replacing = newerOf(source.id).length ? newerOf(source.id) : current;
    // An English label is set again by its head noun: "Default card radius is 16px" was replaced by "a global corner
    // radius of 8px", which one run read as leaving 16px in force and marked 〔已定〕.
    const head = label.replace(/(?:\s+(?:is|are|was|were|of|at|to|be|set|defaults?))+$/iu, "").split(/\s+/u).at(-1)?.toLowerCase() ?? "";
    const parts = /^[A-Za-z]/u.test(label) ? [head && head.length > 2 ? head : label.toLowerCase()] : [...label].slice(0, -1).map((char, index) => char + label[index + 1]);
    return !replacing.some(unit => parts.some(part => unit.statement.toLowerCase().includes(part)));
  });
}
