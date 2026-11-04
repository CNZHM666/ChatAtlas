import { claimSourceUnits, claimSupported, unitClaimText } from "./wiki-claim-support";
import type { FocusEvidence, FocusSection } from "../shared/focus-session";
import type { WikiClaim } from "../shared/wiki-claims";
import { type WikiKnowledgeLedger, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
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
const saysMostOf = (sentence: Set<string>, statement: string) => { const own = knowledgeTerms(statement); let shared = 0; for (const term of own) if (sentence.has(term)) shared++; return shared >= SAYS_SHARED && shared / Math.max(1, Math.min(own.size, sentence.size)) >= SAYS_COVER; };
const SAYS_SHARED = 3, SAYS_COVER = .4;
/** A short clause sharing a few words with a decision ("P2：实现自动维护项目记忆" beside "优先实现复制上下文功能，待项目
 * 知识准确后再逐步加入自动记忆读取") is not that decision: a sentence is the decision only when it says a good part of it. */
const saysEnoughOf = (sentence: Set<string>, statement: string) => { const own = knowledgeTerms(statement); let shared = 0; for (const term of own) if (sentence.has(term)) shared++; return shared / Math.max(1, own.size) >= DECISION_COVER; };
const DECISION_COVER = .35;
/** A sentence giving the reason for what the sentence before decided ("这一转变旨在提升上下文组装的准确性……"): it
 * names the decision only by "这一", so it is no decision of its own and carries no 已定. */
const REASON_ONLY = /^(?:这一|这种|这些|这样|此举|此|该(?:转变|调整|决定|做法|方案|设计|策略))[^。！？!?]{0,30}?(?:旨在|是为了|为了|以便|目的是|意在|有助于|能够|可以)/u;
const sentenceOf = (text: string) => text.split(/(?<=[。！？!?])(?![^“”「」\n]*[”」])/u).map(sentence => sentence.trim()).find(Boolean) ?? text.trim();
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
  return ordered.map((claim, index) => claim.holder && ordered[index + 1]?.holder !== claim.holder ? { ...claim, holderMark: true } : claim);
}

/** Characters each part of a split sentence holds at least, punctuation aside. */
const SPLIT_CHARS = 8;
/** The ledger's draft as a project document: one section per chapter, its paragraphs' sources as evidence and
 * every high-impact sentence as a claim on the units it states. A paragraph without one gets a claim on its
 * first sentence, so every paragraph shows its sources in the Wiki. */
export function ledgerDocument(ledger: WikiKnowledgeLedger, conversationTitles: Record<string, string>): { sections: FocusSection[]; evidence: FocusEvidence[] } {
  const { ledger: reading, organization, units: all, statuses } = resolveWikiReading(ledger);
  const draft = reading.draft;
  if (!draft || !organization) return { sections: [], evidence: [] };
  const units = new Map(all.map(unit => [unit.id, unit]));
  const confirmed = all.filter(unit => statuses.get(unit.id) === "confirmed");
  const evidence: FocusEvidence[] = [], evidenceOf = new Map<string, string>();
  const cite = (unit: WikiKnowledgeUnit) => {
    const known = evidenceOf.get(unit.id);
    if (known) return known;
    const id = `u${evidence.length + 1}`;
    evidenceOf.set(unit.id, id);
    evidence.push({ id, conversationId: unit.evidence.conversationId, messageId: unit.evidence.messageId, title: conversationTitles[unit.evidence.conversationId] ?? "", excerpt: unit.evidence.quote });
    return id;
  };
  const claimOn = (text: string, unitIds: string[], markOnly = false, candidates: WikiKnowledgeUnit[] = []): WikiClaim | undefined => {
    // The unit the sentence says most of comes first: its quote is the one highlighted, its original the one opened.
    const listed = claimSourceUnits(text, unitIds.flatMap(id => units.get(id) ? [units.get(id)!] : []), candidates), terms = knowledgeTerms(text);
    const overlap = (unit: WikiKnowledgeUnit) => { const own = knowledgeTerms(unit.statement); return [...terms].filter(term => own.has(term)).length; };
    const own = [...listed].sort((a, b) => overlap(b) - overlap(a));
    if (!own.length || !text.trim()) return undefined;
    const supported = claimSupported(text, own);
    const status = supported ? workStatus(own.map(unit => statuses.get(unit.id)!)) : "proposed";
    // Every unit the claim states is the user's decision (their own words, or confirmed in the ledger): counted as one.
    const decided = supported && own.every(unit => statuses.get(unit.id) === "confirmed");
    // A sentence saying the user's decision, with material or a suggestion only adding its details, is the decision:
    // "新手首页确立为浅色极简风格基准" with the pasted design spec behind it was shown as 资料. A sentence citing an
    // earlier, open or contested point keeps the weaker mark.
    const listedStatuses = own.map(unit => statuses.get(unit.id)!).filter(Boolean);
    const confirmedTerms = knowledgeTerms(own.filter(unit => statuses.get(unit.id) === "confirmed").map(unitClaimText).join(" "));
    const decisionCover = [...terms].filter(term => confirmedTerms.has(term)).length / Math.max(1, terms.size);
    const reasonOnly = REASON_ONLY.test(text.trim()), sayingDecision = !reasonOnly && decisionCover >= .7 && claimSupported(text, own.filter(unit => statuses.get(unit.id) === "confirmed")) && !listedStatuses.some(value => value === "history" || value === "open" || value === "contested") && own.some(unit => statuses.get(unit.id) === "confirmed" && saysMostOf(terms, unit.statement) && saysEnoughOf(terms, unit.statement));
    const weaker = sayingDecision ? "decided" as const : reasonOnly ? undefined : supported ? wikiHolderOf(listedStatuses) : "ai";
    // A sentence marked as replaced that says what a decision of the user's says (the first wording of the design the
    // user then chose) is not the earlier option: 〔此前〕 beside the chapter's 〔已定〕 told one design both ways.
    const holder = weaker === "earlier" && confirmed.some(unit => claimSupported(text, [unit]) && saysMostOf(terms, unit.statement) && saysEnoughOf(terms, unit.statement)) ? undefined : weaker;
    return { text: text.trim(), quote: own[0].evidence.quote, evidenceIds: own.map(cite), ...(status ? { workStatus: status } : {}), ...(decided && !reasonOnly ? { userDecided: true } : {}), ...(holder ? { holder } : {}), unitIds: own.map(unit => unit.id), ...(markOnly ? { markOnly: true } : {}) };
  };
  // A sentence joining the user's decision with a point they never confirmed ("采用浅色极简首页……，并认可推开式分屏",
  // the second half only from a pasted summary) is not decided as a whole: its last clauses, said by an unconfirmed
  // unit and by no confirmed one, are a claim of their own, so each part keeps its own mark.
  const splitMixed = (text: string, unitIds: string[]): Array<{ text: string; unitIds: string[] }> => {
    const listed = unitIds.flatMap(id => units.get(id) ? [units.get(id)!] : []);
    const confirmed = listed.filter(unit => statuses.get(unit.id) === "confirmed"), others = listed.filter(unit => statuses.get(unit.id) !== "confirmed");
    const clauses = text.split(/(?<=[，,；;])/u);
    if (!confirmed.length || !others.length || clauses.length < 2) return [{ text, unitIds }];
    for (let index = 1; index < clauses.length; index++) {
      const head = clauses.slice(0, index).join("").replace(/[，,；;]\s*$/u, ""), tail = clauses.slice(index).join("").trim();
      const headTerms = knowledgeTerms(head), tailTerms = knowledgeTerms(tail);
      // A part too short to state anything ("针对小白用户") is the sentence's condition, not a claim: marked on its own it
      // carried 〔已定〕 to another sentence opening with the same words.
      if ([head, tail].some(part => part.replace(/[\s\p{P}\p{S}]/gu, "").length < SPLIT_CHARS)) continue;
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
  const sections = draft.chapters.filter(chapter => chapter.paragraphs.length).map((chapter): FocusSection => {
    const chapterUnits = [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => units.get(id) ?? []);
    // The opening has no claims of its own: a decision it states ("优先实现复制上下文功能……") gets one on the sentence
    // saying it, so its mark shows there too.
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    // One claim per sentence: two confirmed units said by the opening's first sentence put two 已定 marks after it.
    const openingUnits = new Map<string, string[]>();
    for (const id of chapter.openingUnitIds ?? []) {
      const unit = units.get(id);
      if (!unit || statuses.get(id) !== "confirmed") continue;
      const sentence = opening.split(/(?<=[。！？!?])(?![^“”「」\n]*[”」])/u).map(item => item.trim()).find(item => item && saysMostOf(knowledgeTerms(item), unit.statement));
      if (sentence) openingUnits.set(sentence, [...openingUnits.get(sentence) ?? [], id]);
    }
    const openingClaims = [...openingUnits].flatMap(([sentence, ids]) => [claimOn(sentence, ids, true)].flatMap(claim => claim ? [{ ...claim, holderMark: true }] : []));
    const claims = [...openingClaims, ...chapter.paragraphs.flatMap(paragraph => {
      const written = paragraph.claims?.length ? paragraph.claims.flatMap(claim => splitMixed(claim.text, claim.unitIds).flatMap(part => claimOn(part.text, part.unitIds, claim.markOnly, chapterUnits) ?? [])) : [];
      return holderMarks(paragraph.text, written.length ? written : [claimOn(sentenceOf(paragraph.text), paragraph.unitIds)].flatMap(claim => claim ?? []));
    })];
    const cited = [...new Set([...chapter.openingUnitIds ?? [], ...chapter.paragraphs.flatMap(paragraph => paragraph.unitIds)])].flatMap(id => units.get(id) ? [cite(units.get(id)!)] : []);
    const subtopics = [...new Set(chapter.paragraphs.map(paragraph => paragraph.subtopic))];
    return { id: chapter.id, title: chapter.title, body: chapter.body.replace(FOLDED_NOTE, "").replace(/\n{3,}/gu, "\n\n").trim(), transition: "", evidenceIds: [...new Set(cited)], kind: "finding",
      ...(chapter.group ? { wikiGroup: chapter.group } : {}), wikiQuestion: chapter.question, wikiOwnerId: chapter.id, wikiSubtopics: subtopics.map(title => ({ title, question: "" })), claims };
  });
  return { sections, evidence };
}
