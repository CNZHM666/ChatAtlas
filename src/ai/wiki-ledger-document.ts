import { LEAVES_OUT } from "../shared/negation";
import { FIRST_VERSION_ZH, ITERATION_ZH, PHASE } from "../shared/stage-words";
import { claimSourceUnits, claimSupported, unitClaimText } from "./wiki-claim-support";
import type { FocusEvidence, FocusSection } from "../shared/focus-session";
import type { WikiClaim } from "../shared/wiki-claims";
import { statesCore, type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { resolveWikiReading } from "./wiki-knowledge-reading";
import { wikiHolderOf } from "../shared/wiki-holder";
import { knowledgeTerms } from "../shared/knowledge-subject";

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
function holderMarks(text: string, claims: WikiClaim[]): WikiClaim[] {
  const at = (claim: WikiClaim) => { const index = text.indexOf(claim.text); return index < 0 ? Number.MAX_SAFE_INTEGER : index; };
  const ordered = [...claims].sort((a, b) => at(a) - at(b));
  // A run of one holder shares one mark, within a line: each list item is read alone. "- **UI specification**: The
  // dashboard top bar height is confirmed as 48px …" showed no mark, the 8px item after it carrying the run's.
  const apart = (claim: WikiClaim, next: WikiClaim | undefined) => Boolean(next) && at(next!) < Number.MAX_SAFE_INTEGER && text.slice(at(claim), at(next!)).includes("\n");
  return ordered.map((claim, index) => claim.holder && (ordered[index + 1]?.holder !== claim.holder || apart(claim, ordered[index + 1])) ? { ...claim, holderMark: true } : claim);
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
const ASKS = /[？?]|吗|呢|还是|有没有|怎么|如何|什么|为什么|可不可以|能不能|要不要|是否|教我|告诉我|发出来|给我|帮我|列出来|\b(?:how|what|why|should i|can you|could you|tell me|show me)\b/iu;
/** The ledger's draft as a project document: one section per chapter, its paragraphs' sources as evidence and
 * every high-impact sentence as a claim on the units it states. A paragraph without one gets a claim on its
 * first sentence, so every paragraph shows its sources in the Wiki. */
export function ledgerDocument(ledger: WikiKnowledgeLedger, conversationTitles: Record<string, string>): { sections: FocusSection[]; evidence: FocusEvidence[] } {
  const { ledger: reading, organization, units: all, statuses } = resolveWikiReading(ledger);
  const draft = reading.draft;
  if (!draft || !organization) return { sections: [], evidence: [] };
  const units = new Map(all.map(unit => [unit.id, unit]));
  const roles = reading.documentType === "learning" ? reading.learningRoles ?? {} : undefined;
  const confirmed = all.filter(unit => statuses.get(unit.id) === "confirmed");
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
    const listedStatuses = own.map(unit => statuses.get(unit.id)!).filter(status => status && !(earlierHolds && status === "history"));
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
    const settled = weaker === "earlier" && confirmed.some(unit => claimSupported(text, [unit]) && saysMostOf(terms, unit.statement) && saysEnoughOf(terms, unit.statement)) ? undefined : weaker;
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
  const sections = draft.chapters.filter(chapter => chapter.paragraphs.length).map((chapter): FocusSection => {
    const chapterUnits = [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => units.get(id) ?? []);
    // The opening has no claims of its own: a decision it states ("优先实现复制上下文功能……") gets one on the sentence
    // saying it, so its mark shows there too.
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    // One claim per sentence: two confirmed units said by the opening's first sentence put two 已定 marks after it.
    const openingUnits = new Map<string, string[]>();
    // An opening sentence is marked as decided only when most of what it says is a decision of the chapter: "系统采用以
    // Hardware IR 为唯一事实源的架构，通过 Zod 定义……" was marked 〔已定〕 on the rule "禁止改变 Hardware IR 作为唯一事实源……",
    // which says nothing of Zod.
    const decidedTerms = knowledgeTerms(chapterUnits.filter(unit => statuses.get(unit.id) === "confirmed").map(unitClaimText).join(" "));
    const mostlyDecided = (sentence: string) => { const own = knowledgeTerms(sentence); let shared = 0; for (const term of own) if (decidedTerms.has(term)) shared++; return shared / Math.max(1, own.size) >= OPENING_DECIDED; };
    for (const id of chapter.openingUnitIds ?? []) {
      const unit = units.get(id);
      if (!unit || statuses.get(id) !== "confirmed") continue;
      const whole = opening.split(/(?:(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s))(?![^“”「」\n]*[”」])/u).map(item => item.trim()).find(item => item && saysMostOf(knowledgeTerms(item), unit.statement));
      // A sentence the decision says up to a semicolon, a stage limit after it ("……及链接的功能；本阶段不包含比价。"): the
      // claim ends there, so 〔已定〕 does not take in the limit, which is not the user's decision.
      const clause = whole?.split(/(?<=[；;])/u).map(item => item.replace(/[；;]$/u, "").trim()).find(item => item.length >= SPLIT_CHARS && saysMostOf(knowledgeTerms(item), unit.statement));
      const sentence = whole && clause && clause !== whole.replace(/[。！？!?]$/u, "") ? clause : whole;
      if (sentence && mostlyDecided(sentence)) openingUnits.set(sentence, [...openingUnits.get(sentence) ?? [], id]);
    }
    const openingClaims = [...openingUnits].flatMap(([sentence, ids]) => [claimOn(sentence, ids, true)].flatMap(claim => claim ? [{ ...claim, holderMark: true }] : []));
    const claims = [...openingClaims, ...chapter.paragraphs.flatMap(paragraph => {
      const written = paragraph.claims?.length ? paragraph.claims.flatMap(claim => splitMixed(claim.text, decisionsSaid(claim.text, claim.unitIds, paragraph.unitIds)).flatMap(part => claimOn(part.text, part.unitIds, claim.markOnly, chapterUnits, itemLabel(paragraph.text, part.text)) ?? [])) : [];
      // A block shown as it was sent (a caption over a fence or a table) states no sentence of its own: its first
      // "sentence" was the whole block, and its mark landed after the closing fence ("```〔已纠正〕").
      if (!written.length && SHOWN_BLOCK.test(paragraph.text.trim())) return [];
      return holderMarks(paragraph.text, written.length ? written : [claimOn(sentenceOf(paragraph.text), paragraph.unitIds)].flatMap(claim => claim ?? []));
    })];
    const cited = [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => units.get(id) ? [cite(units.get(id)!)] : []);
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
