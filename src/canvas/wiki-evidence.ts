import { isRejectedQuoteLead, listItems, localMeaningProblem, type ClaimMeaningCheck, type EvidenceAttention } from "../shared/claim-meaning";
import type { FocusEvidence, FocusSection } from "../shared/focus-session";
import { wikiClaimSource, wikiClaimSourceLabel, type WikiClaimSource } from "../shared/wiki-chapter-status";
import { wikiQuoteRange, type WikiClaim } from "../shared/wiki-claims";
import type { EvidencePoint } from "./workspace-evidence-context";
import { pastedMaterial } from "../shared/source-text-display";
import type { WikiHistoryEntry } from "../shared/wiki-history";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiDocumentBlocks } from "../shared/wiki-document-blocks";
import type { WikiHolder } from "../shared/wiki-holder";

export function wikiStatusGroups(ordered: readonly EvidencePoint[], learning = false) {
  // Four clean, non-overlapping core switches for project reading: Decided, Open, Earlier plan, AI suggestion.
  // Learning mode keeps its user-work and corrected switches.
  const categories: Array<[WikiHolder, boolean]> = learning
    ? [["user", false], ["corrected", false], ["earlier", false], ["ai", false]]
    : [["decided", false], ["open", false], ["earlier", false], ["ai", false]];
  return categories.flatMap(([holder, reported]) => {
    const points = ordered.filter(point => point.holder === holder);
    return points.length ? [{ holder, reported, points }] : [];
  });
}

const normalized = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
const snapshotKey = (ref: FocusEvidence) => JSON.stringify([ref.conversationId, ref.sourceVersionId ?? ""]);

/** Duplicate aliases collapse; distinct messages and source snapshots remain navigable. */
export function wikiEvidenceItems(section: FocusSection, evidence: FocusEvidence[]) {
  let index=evidenceIndexes.get(evidence);
  if(!index){index=new Map(evidence.map((ref,at)=>[ref.id,{ref,index:at}]));evidenceIndexes.set(evidence,index);}
  return evidenceItems(section,index);
}

const evidenceIndexes=new WeakMap<FocusEvidence[],Map<string,{ref:FocusEvidence;index:number}>>();
function evidenceItems(section: FocusSection, refsById: Map<string,{ref:FocusEvidence;index:number}>) {
  const claims = new Map<string, { claimId?: string; text: string; quote: string; evidenceIds: Set<string>; unitIds:Set<string>; markOnly:boolean; verification?: "supported" | "uncertain"; meaning?: ClaimMeaningCheck; source: WikiClaimSource; userEvidenceId?: string; phrases: Set<string>; holder?: WikiClaim["holder"]; holderMark?: boolean; checked?: boolean }>();
  for (const claim of section.claims ?? []) {
    const key = JSON.stringify([normalized(claim.text), normalized(claim.quote)]);
    const existing = claims.get(key);
    const item = existing ?? { claimId: claim.id, text: claim.text, quote: claim.quote, evidenceIds: new Set<string>(), unitIds:new Set<string>(),markOnly:true,verification: claim.verification, meaning: claim.meaning, source: wikiClaimSource(claim), phrases: new Set<string>(), ...(claim.holder ? { holder: claim.holder } : {}) };
    if (!item.claimId && claim.id) item.claimId = claim.id;
    item.markOnly&&=Boolean(claim.markOnly);
    claim.unitIds?.forEach(id=>item.unitIds.add(id));
    if (claim.holderMark) item.holderMark = true;
    if (claim.checked) item.checked = true;
    // Literal formulations locate the claim in the prose; the claim text is a fallback.
    for (const phrase of [...claim.formulations ?? [], claim.text]) if (phrase.trim()) item.phrases.add(phrase);
    // A merged alias carrying a user decision outranks one read as a proposal.
    const source = wikiClaimSource(claim);
    if (source === "decision" || item.source === "other") item.source = source;
    // The user's own message (for a decision, the confirming reply) is where reading should start.
    const user = claim.sourceReading?.sources.filter(entry => entry.role === "user").at(-1);
    if (user && (!item.userEvidenceId || source === "decision")) item.userEvidenceId = user.id;
    if (user) item.evidenceIds.add(user.id);
    if (existing && existing.verification !== claim.verification) item.verification = existing.verification === "uncertain" || claim.verification === "uncertain" ? "uncertain" : undefined;
    claim.evidenceIds.forEach(id => item.evidenceIds.add(id));
    claims.set(key, item);
  }
  return [...claims.values()].map(claim => {
    const groups = new Map<string, { title: string; refs: FocusEvidence[] }>();
    const seen = new Set<string>();
    const refs=[...claim.evidenceIds].flatMap(id=>refsById.get(id)??[]).sort((a,b)=>a.index-b.index);
    for (const {ref} of refs) {
      const key = ref.conversationId, identity = JSON.stringify([snapshotKey(ref), ref.messageId, ref.sourceSignature ?? ""]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const group = groups.get(key) ?? { title: ref.title, refs: [] };
      group.refs.push(ref); groups.set(key, group);
    }
    return { claimId: claim.claimId, text: claim.text, quote: claim.quote, unitIds:[...claim.unitIds],markOnly:claim.markOnly,verification: claim.verification, meaning: claim.meaning, source: claim.source, userEvidenceId: claim.userEvidenceId, phrases: [...claim.phrases], holder: claim.holder, holderMark: claim.holderMark, checked: claim.checked, sources: [...groups.values()] };
  });
}

/** Checkable points for one chapter, in claim order. Each opens only its own
 * originals, anchoring directly to the passage that states the claim. */
/** Prose that presents a point as settled by the user or already completed. */
const SETTLED = /已决定|已确定|已确认|决定采用|确定采用|用户(?:已经?)?(?:确认|决定)|\b(?:decided|confirmed)\b/iu;
const COMPLETED = /(?:已(?:经)?(?:全部|正式|基本)?(?:实现|完成|通过|发布|上线|接入|定型)|完成了|实现了|\b(?:implemented|completed|shipped|released)\b)/iu;
const QUALIFIED_NOT_DONE = /尚未|还未|未完成|没有完成|未实现|尚未实现|计划|准备|拟|\b(?:not yet|not completed|not implemented|planned)\b/iu;
const TENTATIVE_SOURCE = /可以考虑|也许|或许|是否|要不要|能不能|\b(?:maybe|might|could consider|perhaps)\b/iu;
const DEFERRED_SCOPE = /\bV\s*[2-9]\d*(?:\.\d+)*\b|以后|后续|下一版|第二版|暂不|先不|不做|不需要|不在.{0,6}范围/iu;
const sentenceBoundary = /(?<=[。！？!?；;])|(?<=\.)(?=\s)|\n/u;
function quoteWithSentenceContext(excerpt: string, range: { start: number; end: number }): string {
  const before = excerpt.slice(0, range.start).split(sentenceBoundary).at(-1) ?? "";
  const after = excerpt.slice(range.end).split(sentenceBoundary)[0] ?? "";
  const match = excerpt.slice(range.start, range.end);
  const passage = before + match + (/[。！？!?；;.\n]$/u.test(match) ? "" : after);
  if (!/^\s*>/u.test(passage)) return passage;
  const previous = excerpt.slice(0, range.start - before.length).trimEnd().split(/\r?\n/u).at(-1);
  return previous && isRejectedQuoteLead(previous) ? `${previous}\n${passage}` : passage;
}
/** Flag only genuine, high-signal evidence risks:
 * 1) missing/unanchored quote in the cited source;
 * 2) unconfirmed AI proposal / tentative discussion / pasted material written as settled or completed;
 * 3) a retired earlier plan presented in prose as currently settled/adopted;
 * 4) a scope enumeration item explicitly deferred to a later version (e.g. V2 / 暂不做) in its source.
 * Generic lexical negation nitpicks no longer clutter the review queue. */
function attentionOf(wordings: string[], quote: string | undefined, source: EvidencePoint["source"], holder?: WikiHolder): EvidenceAttention | undefined {
  if (!quote) return { kind: "missing", claimExcerpt: wordings[0] };
  if (source === "aiProposal" || source === "proposal" || source === "plan" && holder === "decided" || holder === "ai" || holder === "material") {
    const settled = holder === "decided" ? wordings[0] : wordings.find(text => SETTLED.test(text));
    if (settled) return { kind: "settled", claimExcerpt: settled };
    const unprovenDone = wordings.find(text => COMPLETED.test(text) && !QUALIFIED_NOT_DONE.test(text) && !COMPLETED.test(quote));
    if (unprovenDone) return { kind: "tentative", claimExcerpt: unprovenDone, reason: "依据是建议或资料，正文写成了已完成" };
  }
  const settledWording = wordings.find(text => SETTLED.test(text));
  if (settledWording && TENTATIVE_SOURCE.test(quote) && !SETTLED.test(quote)) {
    const cue = quote.split(sentenceBoundary).find(part => TENTATIVE_SOURCE.test(part))?.trim();
    return { kind: "tentative", cue, claimExcerpt: settledWording };
  }
  if (holder === "earlier") {
    const revived = wordings.find(text => SETTLED.test(text) && !/此前|早期|原方案|已替换|已放弃|\b(?:earlier|replaced|retired)\b/iu.test(text));
    if (revived) return { kind: "negation", claimExcerpt: revived, reason: "早先被替代的方案在正文中写成了现行决定" };
  }
  if (DEFERRED_SCOPE.test(quote)) {
    const lines = quote.split(/\n+/u).map(line => line.trim()).filter(Boolean);
    for (const wording of wordings) {
      for (const item of listItems(wording)) {
        const line = lines.find(text => text.includes(item) && DEFERRED_SCOPE.test(text));
        if (line) return { kind: "negation", subject: item, cue: line.match(DEFERRED_SCOPE)![0], claimExcerpt: wording };
      }
    }
  }
  return wordings.map(wording => localMeaningProblem(wording, quote)).find(problem => problem?.kind === "negation");
}

export function wikiEvidencePoints(section: FocusSection, evidence: FocusEvidence[], zh: boolean): Array<EvidencePoint & { phrases: string[] }> {
  if (section.userEdited || section.origin) return [];
  const items = wikiEvidenceItems(section, evidence);
  if (!items.length) return [];
  const sentences = wikiDocumentBlocks(section.body).filter(block => block.kind === "paragraph" || block.kind === "list")
    .flatMap(block => block.text.replace(/^\s*(?:[-+*]|\d+[.)])\s+/gmu, "").split(sentenceBoundary))
    .map(text => normalized(text.replace(/\*\*|__|`/gu, "")))
    .filter(Boolean);
  return items.flatMap(item => {
    const references = item.sources.flatMap(source => source.refs);
    // Prefer the message that actually contains the claim's quoted substance (e.g. the AI proposal details),
    // falling back to the user's confirming reply only when it carries the quote itself or no quote match exists.
    const quoteHolder = references.find(ref => wikiQuoteRange(ref.excerpt, item.quote));
    const userRef = references.find(ref => ref.id === item.userEvidenceId);
    const reference = (userRef && wikiQuoteRange(userRef.excerpt, item.quote) ? userRef : quoteHolder ?? userRef) ?? references[0];
    if (!reference) return [];
    const retainedRange = wikiQuoteRange(reference.excerpt, item.quote);
    const retainedQuote = retainedRange ? item.quote : reference.id === item.userEvidenceId ? reference.excerpt : undefined;
    const quote = retainedQuote ?? (item.quote.trim() || undefined);
    const clippedExcerpt = reference.excerpt.trim().length >= 24 && wikiQuoteRange(item.quote, reference.excerpt);
    const boundPhrases = item.phrases.map(text => normalized(text.replace(/\*\*|__|`/gu, ""))).filter(Boolean);
    const wordings = sentences.filter(sentence => boundPhrases.some(phrase => sentence.includes(phrase)));
    const listedItems = wordings.map(listItems).find(items => items.length);
    const meaningQuote = retainedRange ? quoteWithSentenceContext(reference.excerpt, retainedRange) : retainedQuote ?? (clippedExcerpt ? reference.excerpt : undefined);
    const sourceLocated = Boolean(retainedRange || clippedExcerpt);
    const evidenceIssue = !sourceLocated && item.meaning?.verdict === "unsupported" && normalized(item.meaning.text) === normalized(item.text)
      ? { kind: "unsupported" as const, reason: item.meaning.reason, claimExcerpt: wordings[0] } : undefined;
    const attention = item.checked || item.markOnly || !wordings.length ? undefined
      : evidenceIssue ?? attentionOf(wordings, sourceLocated ? meaningQuote : undefined, item.source, item.holder);
    const identity=sourceMessageSignature(JSON.stringify([normalized(item.text),normalized(item.quote)]));
    return [{ key: `${section.id}:${identity.replace(":","-")}`, ...(item.claimId ? { claimId: item.claimId } : {}), claim: item.text, quote, source: item.source, label: wikiClaimSourceLabel(item.source, zh), reference, references, placed: false, sourceLocated, phrases: item.phrases, unitIds:item.unitIds,...(listedItems ? { listedItems } : {}), ...(item.holder ? { holder: item.holder, ...(item.holderMark ? { holderMark: true } : {}) } : {}), ...(attention ? { attention } : {}), ...(item.checked ? { checked: true } : {}) }];
  });
}

export function wikiChapterEvidencePoints(section: FocusSection, evidence: FocusEvidence[], zh: boolean) {
  const seen = new Set<string>();
  return wikiEvidencePoints(section, evidence, zh).filter(point => {
    const key = JSON.stringify([point.claim, point.holder]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const compactText = (text: string) => text.normalize("NFKC").replace(/\s/gu, "");
const trigrams = (text: string) => { const chars = Array.from(compactText(text)); return new Set(chars.slice(2).map((_, i) => chars.slice(i, i + 3).join(""))); };
const shared = (a: Set<string>, b: Set<string>) => { let count = 0; for (const gram of a) if (b.has(gram)) count++; return count; };
const splitSentences = (text: string) => text.match(/[^。！？!?\n]+[。！？!?]?/gu)?.map(sentence => sentence.trim()).filter(Boolean) ?? [];
/** Visible prose sentences: headings, code, tables and quotations are not claims. */
function proseSentences(body: string): string[] {
  let fenced = false;
  return body.split("\n").flatMap(line => {
    if (/^\s*(```|~~~)/u.test(line)) { fenced = !fenced; return []; }
    if (fenced || /^\s*(?:#|>|\|)/u.test(line)) return [];
    const visible = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/u, "").replace(/!?\[([^\]]*)\]\([^)]*\)/gu, "$1").replace(/\*\*|__|`/gu, "");
    return splitSentences(visible);
  });
}

/** Fallback when a chapter has no claim records: each prose sentence that clearly
 * reuses one cited original becomes a point. It is labelled as an approximate
 * match, never as a verified claim, and sentences without a match stay unmarked. */
export function wikiApproximatePoints(section: FocusSection, evidence: FocusEvidence[], body: string, zh: boolean, limit = 24): Array<EvidencePoint & { phrases: string[] }> {
  if (section.userEdited || section.origin) return [];
  return approximatePoints(section.id, evidence.filter(ref => section.evidenceIds.includes(ref.id)), body, zh, limit);
}

/** Sentence-to-original matching shared by Wiki chapters and the project overview. */
export function approximatePoints(prefix: string, sources: FocusEvidence[], body: string, zh: boolean, limit = 24): Array<EvidencePoint & { phrases: string[] }> {
  const refs = sources.filter(ref => ref.conversationId && ref.messageId).map(ref => ({ ref, pasted: pastedMaterial(ref.excerpt), grams: trigrams(ref.excerpt) }));
  const sourceSentences=new Map<FocusEvidence,Array<{text:string;grams:Set<string>}>>();
  if (!refs.length) return [];
  const matches = proseSentences(body).flatMap((sentence, order) => {
    const grams = trigrams(sentence);
    if (grams.size < 12) return [];
    // Most of the sentence must come from one original; a few shared terms are not evidence.
    const candidates = refs.map(item => ({ item, overlap: shared(grams, item.grams) })).filter(match => match.overlap >= 8 && match.overlap / grams.size >= .45);
    // A pasted document repeats older text; prefer the discussion where it was actually said.
    const best = candidates.sort((a, b) => Number(a.item.pasted) - Number(b.item.pasted) || b.overlap - a.overlap)[0];
    if (!best) return [];
    const ref=best.item.ref;
    const excerpts=sourceSentences.get(ref)??splitSentences(ref.excerpt).map(text=>({text,grams:trigrams(text)}));
    sourceSentences.set(ref,excerpts);
    const quote = excerpts.map(part => ({ text: part.text, overlap: shared(grams, part.grams) })).sort((a, b) => b.overlap - a.overlap)[0]?.text;
    return [{ sentence: sentence.replace(/[。！？!?]$/u, ""), order, score: best.overlap / grams.size, ref: best.item.ref, pasted: best.item.pasted, quote }];
  });
  const seen = new Set<string>();
  return matches.filter(match => !seen.has(match.sentence) && seen.add(match.sentence)).sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.order - b.order)
    .map((match, index) => ({ key: `${prefix}:a${index}`, claim: match.sentence, quote: match.quote, source: "other" as const,
      label: match.pasted ? zh ? "相似原文 · 粘贴资料" : "Similar original · pasted" : zh ? "相似原文（未确认对应）" : "Similar original (approximate)",
      reference: match.ref, references: [match.ref], placed: false, approximate: true, phrases: [match.sentence] }));
}

/** Evidence points for a chapter's evolution card. Structured records open their own
 * proof messages; a discussion note is matched to the chapter's originals like prose. */
export function wikiHistoryPoints(section: FocusSection, entries: WikiHistoryEntry[], evidence: FocusEvidence[], zh: boolean) {
  const points: Array<EvidencePoint & { phrases: string[] }> = [], markers: Record<string, string> = {};
  entries.forEach((entry, index) => {
    const key = `${section.id}:h${index}`;
    if (entry.kind === "record") {
      const reference = entry.sources[0];
      if (!reference) return;
      const source: WikiClaimSource = entry.status === "confirmed" ? "decision" : entry.status === "proposal" ? "proposal" : "other";
      points.push({ key, claim: `${entry.before} → ${entry.after}`, quote: reference.excerpt, source, label: source === "other" ? zh ? "演变记录" : "History" : wikiClaimSourceLabel(source, zh), reference, references: entry.sources, placed: false, phrases: [] });
    } else {
      const match = approximatePoints(key, evidence.filter(ref => section.evidenceIds.includes(ref.id)), entry.text, zh, 1)[0];
      if (!match) return;
      points.push({ ...match, key, claim: entry.text, phrases: [] });
    }
    markers[entry.id] = key;
  });
  return { points, markers };
}
