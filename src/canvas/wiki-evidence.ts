import { localMeaningProblem, type ClaimMeaningCheck, type EvidenceAttention } from "../shared/claim-meaning";
import type { FocusEvidence, FocusSection } from "../shared/focus-session";
import { wikiClaimSource, wikiClaimSourceLabel, type WikiClaimSource } from "../shared/wiki-chapter-status";
import { wikiQuoteRange, type WikiClaim } from "../shared/wiki-claims";
import type { EvidencePoint } from "./workspace-evidence-context";
import { pastedMaterial } from "../shared/source-text-display";
import type { WikiHistoryEntry } from "../shared/wiki-history";

const normalized = (text: string) => text.normalize("NFKC").replace(/\s+/gu, " ").trim();
const snapshotKey = (ref: FocusEvidence) => JSON.stringify([ref.conversationId, ref.sourceVersionId ?? ""]);

/** Duplicate aliases collapse; distinct messages and source snapshots remain navigable. */
export function wikiEvidenceItems(section: FocusSection, evidence: FocusEvidence[]) {
  const claims = new Map<string, { text: string; quote: string; evidenceIds: Set<string>; verification?: "supported" | "uncertain"; meaning?: ClaimMeaningCheck; source: WikiClaimSource; userEvidenceId?: string; phrases: Set<string>; holder?: WikiClaim["holder"]; holderMark?: boolean; checked?: boolean }>();
  for (const claim of section.claims ?? []) {
    const key = JSON.stringify([normalized(claim.text), normalized(claim.quote)]);
    const existing = claims.get(key);
    const item = existing ?? { text: claim.text, quote: claim.quote, evidenceIds: new Set<string>(), verification: claim.verification, meaning: claim.meaning, source: wikiClaimSource(claim), phrases: new Set<string>(), ...(claim.holder ? { holder: claim.holder } : {}) };
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
    for (const ref of evidence) {
      if (!claim.evidenceIds.has(ref.id)) continue;
      const key = ref.conversationId, identity = JSON.stringify([snapshotKey(ref), ref.messageId, ref.sourceSignature ?? ""]);
      if (seen.has(identity)) continue;
      seen.add(identity);
      const group = groups.get(key) ?? { title: ref.title, refs: [] };
      group.refs.push(ref); groups.set(key, group);
    }
    return { text: claim.text, quote: claim.quote, verification: claim.verification, meaning: claim.meaning, source: claim.source, userEvidenceId: claim.userEvidenceId, phrases: [...claim.phrases], holder: claim.holder, holderMark: claim.holderMark, checked: claim.checked, sources: [...groups.values()] };
  });
}

/** Checkable points for one chapter, in claim order. Each opens only its own
 * originals, starting at the user's message for a decision or report. */
/** Prose that presents a point as settled by the user. */
const SETTLED = /已决定|已确定|已确认|决定采用|确定采用|用户(?:已经?)?(?:确认|决定)|(?:decided|confirmed)/iu;
/** A point checks itself when its quote is found in the cited original and its wording claims no more than its
 * source: a missing quote, a decision drawn from proposals, or a meaning the quote does not carry is left for the reader. */
function attentionOf(claim: string, quote: string | undefined, source: EvidencePoint["source"], ownQuote?: string): EvidenceAttention | undefined {
  if (!quote) return { kind: "missing" };
  if (SETTLED.test(claim) && (source === "aiProposal" || source === "proposal")) return { kind: "settled" };
  // Only local source checks remain. Legacy model verdicts stay in saved data
  // but no longer create review tasks after the feature's removal.
  return localMeaningProblem(claim, ownQuote || quote);
}

export function wikiEvidencePoints(section: FocusSection, evidence: FocusEvidence[], zh: boolean): Array<EvidencePoint & { phrases: string[] }> {
  if (section.userEdited || section.origin) return [];
  return wikiEvidenceItems(section, evidence).flatMap((item, index) => {
    const references = item.sources.flatMap(source => source.refs);
    // The original holding the claim's quote opens first; the first cited one only when none holds it.
    const reference = references.find(ref => ref.id === item.userEvidenceId) ?? references.find(ref => wikiQuoteRange(ref.excerpt, item.quote)) ?? references[0];
    if (!reference) return [];
    // A confirming reply does not contain the claim's quote; highlight the reply itself.
    const quote = wikiQuoteRange(reference.excerpt, item.quote) ? item.quote : reference.id === item.userEvidenceId ? reference.excerpt : undefined;
    const attention = attentionOf(item.text, quote, item.source, item.quote);
    return [{ key: `${section.id}:${index}`, claim: item.text, quote, source: item.source, label: wikiClaimSourceLabel(item.source, zh), reference, references, placed: false, phrases: item.phrases, ...(item.holder ? { holder: item.holder, ...(item.holderMark ? { holderMark: true } : {}) } : {}), ...(attention ? { attention } : {}), ...(item.checked ? { checked: true } : {}) }];
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
  const refs = sources.filter(ref => ref.conversationId && ref.messageId).map(ref => ({ ref, pasted: pastedMaterial(ref.excerpt), grams: trigrams(ref.excerpt), sentences: splitSentences(ref.excerpt).map(text => ({ text, grams: trigrams(text) })) }));
  if (!refs.length) return [];
  const matches = proseSentences(body).flatMap((sentence, order) => {
    const grams = trigrams(sentence);
    if (grams.size < 12) return [];
    // Most of the sentence must come from one original; a few shared terms are not evidence.
    const candidates = refs.map(item => ({ item, overlap: shared(grams, item.grams) })).filter(match => match.overlap >= 8 && match.overlap / grams.size >= .45);
    // A pasted document repeats older text; prefer the discussion where it was actually said.
    const best = candidates.sort((a, b) => Number(a.item.pasted) - Number(b.item.pasted) || b.overlap - a.overlap)[0];
    if (!best) return [];
    const quote = best.item.sentences.map(part => ({ text: part.text, overlap: shared(grams, part.grams) })).sort((a, b) => b.overlap - a.overlap)[0]?.text;
    return [{ sentence: sentence.replace(/[。！？!?]$/u, ""), order, score: best.overlap / grams.size, ref: best.item.ref, pasted: best.item.pasted, quote }];
  });
  const seen = new Set<string>();
  return matches.filter(match => !seen.has(match.sentence) && seen.add(match.sentence)).sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.order - b.order)
    .map((match, index) => ({ key: `${prefix}:a${index}`, claim: match.sentence, quote: match.quote, source: "other" as const,
      label: match.pasted ? zh ? "相似原文 · 粘贴资料" : "Similar original · pasted" : zh ? "相似原文（未确认对应）" : "Similar original (approximate)",
      reference: match.ref, references: [match.ref], placed: false, approximate: true, attention: { kind: "approximate" }, phrases: [match.sentence] }));
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
