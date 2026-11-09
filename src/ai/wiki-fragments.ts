import type { WikiDraftChapter, WikiKnowledgeUnit } from "../shared/wiki-knowledge";
import { replaceParagraph } from "../shared/wiki-body-text";
import { claimSupported } from "./wiki-claim-support";
import { knowledgeTerms } from "../shared/knowledge-subject";

const bare = (text: string) => text.toLowerCase().replace(/[\s*`"'“”‘’]/gu, "").replace(/[.。]$/u, "");

/** An English paragraph left as the tail of a sentence ("not a confirmed V1 requirement."), its head cut by a pass over
 * clauses: it starts in lower case and is the end of a statement it cites ("A fuller backup/restore workflow is a
 * recommendation, not a confirmed V1 requirement."). It takes that statement back, in text and claims. A code name
 * ("useLiveQuery() …", "npm run …") is no fragment. Returns how many were restored. */
export function restoredFragments(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let restored = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const text = paragraph.text.trim();
    if (!/^[a-z][a-z]*\s/u.test(text) || /\n/u.test(text) || /^[a-z]+[A-Z(]|^(?:npm|npx|git|pnpm|yarn)\s/u.test(text)) continue;
    const tail = bare(text);
    if (tail.length < 8) continue;
    const unit = paragraph.unitIds.map(unitOf).find(unit => unit && bare(unit.statement).length > tail.length && bare(unit.statement).endsWith(tail));
    if (!unit) continue;
    const whole = unit.statement.trim();
    if (chapter.body.includes(whole)) {
      // The statement stands elsewhere already: the tail goes.
      chapter.body = chapter.body.replace(`\n\n${paragraph.text}`, () => "");
      paragraph.text = "";
    } else {
      chapter.body = replaceParagraph(chapter.body, paragraph.text, () => whole);
      paragraph.claims = (paragraph.claims ?? []).map(claim => bare(claim.text) === tail ? { ...claim, text: whole } : claim);
      paragraph.text = whole;
    }
    restored++;
  }
  // Or a sentence ending on such a tail after a head in other words: "Additionally, while a fuller backup/restore workflow
  // was suggested, not a confirmed V1 requirement." The head names the statement's subject; the statement takes its place.
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/\n/u.test(paragraph.text.trim()) || /^\s*(?:[-*+]\s|\d+\.\s|\||>|`|#)/u.test(paragraph.text)) continue;
    for (const claim of [...paragraph.claims ?? []]) {
      if (!/^[a-z]/u.test(claim.text) || claim.unitIds.length !== 1 || bare(claim.text).length < 8) continue;
      const unit = unitOf(claim.unitIds[0]), tail = bare(claim.text);
      if (!unit || !(bare(unit.statement).length > tail.length && bare(unit.statement).endsWith(tail))) continue;
      const sentence = paragraph.text.split(SENTENCE_END).map(item => item.trim()).find(item => item.endsWith(claim.text.trim()) && item.length > claim.text.trim().length);
      if (!sentence || (paragraph.claims ?? []).some(other => other !== claim && sentence.includes(other.text))) continue;
      const head = sentence.slice(0, sentence.length - claim.text.trim().length), subject = plainTerms(unit.statement.slice(0, unit.statement.length - claim.text.trim().length));
      if ([...plainTerms(head)].filter(term => subject.has(term)).length < 2) continue;
      const whole = unit.statement.trim(), before = paragraph.text;
      paragraph.text = before.replace(sentence, () => whole);
      claim.text = whole;
      chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
      restored++;
    }
  }
  for (const chapter of chapters) chapter.paragraphs = chapter.paragraphs.filter(paragraph => paragraph.text);
  return restored;
}

/** A list item that opens on what was done to its subject, the subject left out ("- Confirmed at 48px for both desktop
 * and mobile views."): it takes its unit's topic as its label ("**Dashboard Top Bar Height**: Confirmed at 48px …"). */
const DONE_VERB = "(?:Confirmed|Set|Fixed|Kept|Defined|Limited|Capped|Moved|Changed|Reduced|Increased|Raised|Lowered|Locked)";
// The item, with a label the writer gave it or none ("- **UI specification**: **Confirmed as 48px …**").
const SUBJECTLESS = new RegExp(`^(\\s*[-*+]\\s+)(?:\\*\\*([^*\\n]+)\\*\\*\\s*[：:]\\s*)?((?:\\*\\*)?${DONE_VERB}\\s+(?:at|as|to|from|in|for)\\b.*)$`, "u");
const shortName = (name: string | undefined) => Boolean(name) && name!.length <= 32 && name!.trim().split(/\s+/u).length <= 4 && !/[.:;!?]$/u.test(name!.trim());
/** What a statement is about, before the verb the item opens on: "The dashboard top bar height is confirmed as 48px …"
 * is about "Dashboard top bar height". */
export function statementSubject(statement: string): string | undefined {
  const hit = (statement ?? "").trim().match(new RegExp(`^(?:The\\s+)?(.+?)\\s+(?:is|are|was|were)\\s+${DONE_VERB.toLowerCase()}\\b`, "u"));
  const name = hit?.[1].trim();
  return name && name.split(/\s+/u).length <= 6 && !/[,;:]/u.test(name) ? `${name.charAt(0).toUpperCase()}${name.slice(1)}` : undefined;
}
export function labelledSubjectlessItems(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let labelled = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    let changed = false;
    const text = paragraph.text.split("\n").map(line => {
      const hit = line.match(SUBJECTLESS);
      if (!hit) return line;
      const ids = (paragraph.claims ?? []).filter(claim => claim.text.length >= 8 && line.includes(claim.text)).flatMap(claim => claim.unitIds);
      const units = ids.flatMap(id => unitOf(id) ?? []);
      // The subject its statement names first; a label of the writer's that only names the topic ("UI specification")
      // gives way to it. Without one, the unit's topic, when there is no label yet.
      const name = units.map(unit => statementSubject(unit.statement)).find(Boolean) ?? (hit[2] ? undefined : units.map(unit => unit.subject).find(shortName));
      if (!name || hit[2]?.trim().toLowerCase() === name.toLowerCase()) return line;
      changed = true; labelled++;
      return `${hit[1]}**${name.trim()}**: ${hit[3]}`;
    }).join("\n");
    if (!changed) continue;
    chapter.body = replaceParagraph(chapter.body, paragraph.text, () => text);
    paragraph.text = text;
  }
  return labelled;
}

/** A paragraph that says nearly nothing its units say: of its words, under a fifth are in what it cites. One supplement
 * cited "Select useful student-friendly categories" for a summary of currencies, servers and the MVP test plan, with
 * numbers no unit gave. It goes; its units are told where they belong or reported as left out. Lists, tables, code
 * and one-sentence paragraphs are not judged. Returns how many went. */
const UNRELATED_SHARE = .2, UNRELATED_MIN_TERMS = 10;
const folded = (text: string) => new Set([...knowledgeTerms(text)].map(term => term.replace(/[.,;:!?)"'’”]+$/u, "").replace(/^[("'‘“]+/u, "")).map(term => /^[a-z]{4,}$/u.test(term) ? term.replace(/ies$/u, "y").replace(/(?<=[^s])s$/u, "") : term).filter(Boolean));
export function droppedUnrelatedParagraphs(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined): number {
  let dropped = 0;
  for (const chapter of chapters) {
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => {
      const text = paragraph.text.trim();
      if (!paragraph.unitIds.length || /\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s])/u.test(text)) return true;
      if (text.split(/(?<=[。！？!?])|(?<=[a-z0-9)]\.)\s/u).filter(Boolean).length < 2) return true;
      const own = folded(text);
      if (own.size < UNRELATED_MIN_TERMS) return true;
      const cited = folded(paragraph.unitIds.flatMap(id => { const unit = unitOf(id); return unit ? [unit.statement, unit.evidence.quote, ...unit.details] : []; }).join(" "));
      if (!cited.size || [...own].filter(term => cited.has(term)).length / own.size >= UNRELATED_SHARE) return true;
      chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
      dropped++;
      return false;
    });
  }
  return dropped;
}

/** A prose paragraph citing nothing: no unit, no claim. The writer's own aside ("This market shift highlights the
 * volatility of third-party financial aggregators and underscores the value of a locally-stored, independent solution
 * like Pocket Ledger.") read as the project's view, and no source said it. Lists, tables, code, captions and notes stay.
 * Returns how many went. */
export function droppedUncitedParagraphs(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) {
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => {
      const text = paragraph.text.trim();
      if (paragraph.unitIds.length || paragraph.claims?.length || !text || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s]|#)/u.test(text)) return true;
      if (chapter.paragraphs.length < 2) return true;
      chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
      dropped++;
      return false;
    });
  }
  return dropped;
}

/** A claim on decisions alone that runs past them: "The frontend stack is confirmed as React + Vite + TypeScript, …. A
 * proposed responsive web layout aligns with this stack …" cited only the stack decision, and the 已定 mark after it
 * took in the proposal. The claim keeps its leading sentences the decisions support. Returns how many were trimmed. */
const SENTENCE_END = /(?<=[。！？!?])|(?<=[A-Za-z0-9)\]"'’*%`]\.)(?<!\b(?:e\.g|i\.e|vs|etc|incl|approx|cf)\.)(?=\s)/u;
export function trimmedDecidedClaims(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined, confirmed: (id: string) => boolean): number {
  let trimmed = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) for (const claim of paragraph.claims ?? []) {
    if (!claim.unitIds.length || !claim.unitIds.every(confirmed)) continue;
    const sentences = claim.text.split(SENTENCE_END).filter(sentence => sentence.trim());
    if (sentences.length < 2) continue;
    const units = claim.unitIds.flatMap(id => unitOf(id) ?? []);
    // One decision told by one sentence of several: "Bank connections, AI financial advisors, … are excluded from v1.
    // Specifically, Bank syncing, Receipt OCR, and Shared budgets are confirmed exclusions." cited only "Bank syncing and
    // receipt OCR are excluded", and the key decisions listed the AI's whole list as yours. The claim is the sentence
    // holding most of the decision's words, at least half and twice any other's.
    if (units.length === 1) {
      // Scored by how much of the decision a sentence says and how little else: the AI's longer list shares words too.
      const own = plainTerms(units[0].statement);
      const scored = sentences.map(sentence => {
        const terms = plainTerms(sentence), both = [...own].filter(term => terms.has(term)).length;
        return { sentence, said: both / Math.max(1, own.size), score: both * both / Math.max(1, own.size * terms.size) };
      }).sort((a, b) => b.score - a.score);
      if (scored[0].said >= .5 && scored[0].score >= scored[1].score * 2) {
        claim.text = scored[0].sentence.trim();
        trimmed++;
        continue;
      }
    }
    let kept = 0;
    while (kept < sentences.length && claimSupported(sentences[kept].trim(), units)) kept++;
    if (!kept || kept === sentences.length) continue;
    claim.text = sentences.slice(0, kept).join("").trim();
    trimmed++;
  }
  return trimmed;
}

/** A platform the user ruled out, named as what the product is: "Pocket Ledger is a mobile application designed for
 * college students …" opened the positioning chapter while the user had confirmed "v1 is web only, with no native mobile
 * app." With such a decision, "a mobile app(lication)" reads "a web app(lication)", in openings and paragraphs alike.
 * Returns how many were changed. */
const WEB_ONLY = /\bweb[- ]only\b|\bno native (?:mobile|ios|android)\b|\bnot? (?:a )?native (?:mobile )?app/iu;
const NAMED_MOBILE = /\b(an?)\s+(?:native\s+)?(?:mobile|iOS|Android|phone)\s+(app(?:lication)?s?)\b/giu;
export function webPlatformKept(chapters: WikiDraftChapter[], confirmed: WikiKnowledgeUnit[]): number {
  if (!confirmed.some(unit => WEB_ONLY.test(unit.statement))) return 0;
  let changed = 0;
  const fix = (text: string) => text.replace(NAMED_MOBILE, (_, article: string, noun: string) => `${/^A/u.test(article) ? "A" : "a"} web ${noun}`);
  for (const chapter of chapters) {
    const before = chapter.body;
    chapter.body = fix(before);
    if (chapter.body !== before) changed++;
    for (const paragraph of chapter.paragraphs) {
      paragraph.text = fix(paragraph.text);
      for (const claim of paragraph.claims ?? []) claim.text = fix(claim.text);
    }
  }
  return changed;
}

/** A one-sentence aside on what something means, citing units or not: "This mechanism narrows the previously recommended
 * but unconfirmed dependency status into a specific implementation strategy …", "This market shift highlights …". No
 * source says it; the paragraph goes. Returns how many went. */
const ASIDE = /^This\s+(?:[A-Za-z-]+\s+){0,2}(?:narrows|highlights|underscores|reflects|demonstrates|reinforces|signals|illustrates|represents|showcases)\b/u;
const BACK_FILLER = /^(?:The\s+(?:application|app|system|product|interface|design)|It|This)\s+(?:must|should|will|needs to)\s+(?:maintain|keep|preserve|follow|respect|honou?r)\s+(?:these|those|this|that|the same|such)\s+(?:[A-Za-z-]+\s+){0,2}?(?:in order\s+)?to\s+(?:ensure|maintain|keep|guarantee|achieve)\b[^.]*\.$/u;
export function droppedEnglishAsides(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      // A closing sentence that only points back and gives a purpose: "Earlier proposals suggested larger radii … replaced
      // by the current 8px standard. The application must maintain these dimensions to ensure visual consistency."
      const text = paragraph.text.trim();
      if (/\n/u.test(text)) continue;
      const sentences = text.split(SENTENCE_END).filter(sentence => sentence.trim()), last = sentences.at(-1)?.trim() ?? "";
      if (sentences.length < 2 || !BACK_FILLER.test(last) || /\d/u.test(last)) continue;
      const before = paragraph.text;
      paragraph.text = sentences.slice(0, -1).join("").trim();
      paragraph.claims = (paragraph.claims ?? []).map(claim => ({ ...claim, text: claim.text.includes(last) ? claim.text.replace(last, "").trim() : claim.text })).filter(claim => claim.text && paragraph.text.includes(claim.text));
      chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
      dropped++;
    }
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => {
      const text = paragraph.text.trim();
      if (!ASIDE.test(text) || /\n/u.test(text) || text.split(SENTENCE_END).filter(sentence => sentence.trim()).length > 1 || chapter.paragraphs.length < 2) return true;
      chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
      dropped++;
      return false;
    });
  }
  return dropped;
}

/** A clause a later sentence of the same paragraph says in full, from the same unit: "… ≥90% successful first entries,
 * Milestone 3 is complete when there are no known critical data-loss bugs, and all CSV test cases passing. … Complete
 * when there are no known critical data-loss bugs, primary workflows function …". The clause and its claim go; when the
 * later sentence leaves the clause's condition out, the condition goes into it. Returns how many went. */
const lowerBare = (text: string) => text.toLowerCase().replace(/[\s*`"'“”‘’.,;:]/gu, "");
export function droppedInnerRepeats(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    for (const claim of [...paragraph.claims ?? []]) {
      if (claim.unitIds.length !== 1) continue;
      // The clause without the subject it repeats ("Milestone 3 is complete when …" → "complete when …").
      const core = claim.text.replace(/^(?:[A-Z][\w-]*\s+){1,3}?(?:\d+\s+)?(?:is|are)\s+/u, "");
      if (core === claim.text || lowerBare(core).length < 20) continue;
      const longer = (paragraph.claims ?? []).find(other => other !== claim && other.unitIds.includes(claim.unitIds[0]) && lowerBare(other.text).length > lowerBare(core).length && lowerBare(other.text).includes(lowerBare(core)));
      const at = paragraph.text.indexOf(`, ${claim.text}`);
      // A later sentence of the unit opening as the clause does but leaving its condition out ("Complete when primary
      // workflows function …"): the condition joins it there. One run read "… ≥90% successful first entries, Milestone 3
      // is complete when there are no known critical data-loss bugs, and all CSV test cases passing."
      const lead = core.match(/^(\S+\s+\S+)\s+(.+?)\.?$/u);
      const opening = !longer && lead ? (paragraph.claims ?? []).find(other => other !== claim && other.unitIds.includes(claim.unitIds[0]) && other.text.toLowerCase().startsWith(`${lead[1].toLowerCase()} `) && paragraph.text.includes(other.text)) : undefined;
      if (!longer && !opening || at < 0) continue;
      const before = paragraph.text;
      paragraph.text = before.slice(0, at) + before.slice(at + claim.text.length + 2);
      if (opening && lead) {
        const joined = `${opening.text.slice(0, lead[1].length)} ${lead[2]}, ${opening.text.slice(lead[1].length + 1)}`;
        paragraph.text = paragraph.text.replace(opening.text, () => joined);
        opening.text = joined;
      }
      paragraph.claims = (paragraph.claims ?? []).filter(other => other !== claim);
      chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
      dropped++;
    }
  }
  return dropped;
}
/** Words of a text, punctuation and dashes apart, plurals and case folded: "exclusions" is "exclusion", "syncing,"
 * is "syncing". */
function plainTerms(text: string): Set<string> {
  return new Set([...knowledgeTerms(text.replace(/[—–]/gu, " "))].map(term => term.replace(/[.,;:!?)"'’”]+$/u, "").replace(/^[("'‘“]+/u, "").toLowerCase()).map(term => /^[a-z]{4,}$/u.test(term) ? term.replace(/ies$/u, "y").replace(/(?<=[^s])s$/u, "") : term).filter(term => term && !FUNCTION_WORDS.has(term)));
}
/** Words that say nothing of their own: "are", "if" and "because" made two sentences saying one thing look apart. */
const FUNCTION_WORDS = new Set("a an the is are was were be been being am if to of and or nor but so as at by for in on with from into that this these those it its can could may might will would should must do does did has have had because consequently therefore thus also".split(" "));

/** A sentence another sentence of its paragraph says: "Consequently, reliable export mechanisms are critical to prevent
 * data loss if browser storage is cleared. Export and backup features are critical because browser storage can be
 * cleared, leading to data loss." A sentence goes when one with a stronger source (yours over the AI's) holds most of
 * its words, or one with as strong a source holds nearly all: "Delete, category management, and budget tracking are
 * unverified." beside "… Budget tracking and Category management are not yet verified." adds Delete and stays. A
 * sentence never goes for a weaker one, and a decision never goes. weight: 2 for a sentence stating a decision, 1 for
 * the user's own words, 0 otherwise. Returns how many went. */
const SAME_SENTENCE = .6, SAME_SENTENCE_ALIKE = .75, SAME_SENTENCE_SHARED = 3;
export function droppedRepeatedSentences(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    const text = paragraph.text.trim();
    if (/\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s]|#)/u.test(text)) continue;
    const sentences = paragraph.text.split(SENTENCE_END).filter(sentence => sentence.trim());
    if (sentences.length < 2) continue;
    const claimsOf = (sentence: string) => (paragraph.claims ?? []).filter(claim => sentence.includes(claim.text) || claim.text.includes(sentence.trim()));
    const strength = (sentence: string) => weight(claimsOf(sentence).flatMap(claim => claim.unitIds));
    const terms = sentences.map(sentence => plainTerms(sentence));
    // How much of sentence b sentence a holds.
    const cover = (a: number, b: number) => { const shared = [...terms[b]].filter(term => terms[a].has(term)).length; return shared >= SAME_SENTENCE_SHARED ? shared / Math.max(1, terms[b].size) : 0; };
    const weights = sentences.map(strength);
    const gone = new Set<number>();
    // Later sentences first: of two alike, the later one goes.
    for (let x = sentences.length - 1; x >= 0; x--) {
      if (weights[x] >= 2) continue;
      const by = sentences.findIndex((_, y) => y !== x && !gone.has(y) && (weights[y] > weights[x] && cover(y, x) >= SAME_SENTENCE || weights[y] === weights[x] && cover(y, x) >= SAME_SENTENCE_ALIKE && (y < x || cover(x, y) < SAME_SENTENCE_ALIKE)));
      if (by >= 0) gone.add(x);
    }
    if (!gone.size) continue;
    const before = paragraph.text;
    const kept = sentences.filter((_, index) => !gone.has(index));
    paragraph.text = kept.join("").trim();
    // A claim holding a sentence that went keeps the rest of its words.
    const goneText = sentences.filter((_, index) => gone.has(index)).map(sentence => sentence.trim());
    paragraph.claims = (paragraph.claims ?? []).map(claim => ({ ...claim, text: goneText.reduce((text, sentence) => text.includes(sentence) ? text.replace(sentence, "").replace(/\s{2,}/gu, " ").trim() : text, claim.text) }))
      .filter(claim => claim.text && paragraph.text.includes(claim.text));
    chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
    dropped += gone.size;
  }
  return dropped;
}

/** A decision told in part and then whole in the same chapter: "… must run entirely in the browser. Transaction data
 * must never be sent to any server in v1. [Decided]" and, restored later, "Transaction data must never be sent to any
 * server in v1; analytics may collect only anonymous page views …". The part goes; the whole stays. Returns how many
 * went. */
// kept: the decisions ensureWikiDecisions wrote because no sentence stated them as decided: one telling it inside
// another point ("External feedback suggests …, but Pocket Ledger v1 supports USD only; …") holds it, not as the decision.
export function droppedContainedDecisions(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number, kept: ReadonlySet<object> = new Set()): number {
  let dropped = 0;
  for (const chapter of chapters) {
    // Prose only, blank lines between its paragraphs allowed: no list, table, quote or code line.
    const prose = (paragraph: WikiDraftChapter["paragraphs"][number]) => !paragraph.text.split("\n").some(line => /^\s*(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|#)/u.test(line));
    const decided = chapter.paragraphs.filter(prose).flatMap(paragraph => paragraph.text.split(SENTENCE_END).filter(sentence => sentence.trim()).map(sentence => ({ paragraph, sentence: sentence.trim(),
      strength: weight((paragraph.claims ?? []).filter(claim => sentence.includes(claim.text) || claim.text.includes(sentence.trim())).flatMap(claim => claim.unitIds)) })))
      .filter(item => item.strength >= 2 && lowerBare(item.sentence).length >= 20);
    for (const part of decided) {
      const whole = decided.find(other => other.paragraph !== part.paragraph && lowerBare(other.sentence).length > lowerBare(part.sentence).length && lowerBare(other.sentence).includes(lowerBare(part.sentence)));
      if (!whole || kept.has(part.paragraph) || !chapter.paragraphs.includes(part.paragraph)) continue;
      const before = part.paragraph.text, rest = before.replace(part.sentence, "").replace(/[ \t]{2,}/gu, " ").replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
      if (!rest) {
        chapter.paragraphs = chapter.paragraphs.filter(paragraph => paragraph !== part.paragraph);
        chapter.body = chapter.body.includes(`\n\n${before}`) ? chapter.body.replace(`\n\n${before}`, () => "") : replaceParagraph(chapter.body, before, () => "");
      } else {
        part.paragraph.text = rest;
        part.paragraph.claims = (part.paragraph.claims ?? []).filter(claim => rest.includes(claim.text));
        chapter.body = replaceParagraph(chapter.body, before, () => rest);
      }
      dropped++;
    }
  }
  return dropped;
}

/** A short paragraph its chapter's opening says in full, sentence by sentence: "The application is designed specifically
 * for college students. The proposed value proposition is 'Know what you can spend.'" under an opening telling both.
 * It goes, its units cited by the opening. Returns how many went. */
const OPENING_SAYS = .75, OPENING_DECISION_SAYS = .5;
// kept: the decisions ensureWikiDecisions wrote because the opening, saying them among other points, carries no mark for
// them: "CSV export moves to Milestone 2." went as said by "The roadmap consists of four milestones …, with CSV export
// moved from Milestone 1 to Milestone 2.", and the move showed 〔已定〕 nowhere.
export function droppedOpeningRepeats(chapters: WikiDraftChapter[], unitOf: (id: string) => WikiKnowledgeUnit | undefined = () => undefined, decided: (id: string) => boolean = () => false, kept: ReadonlySet<object> = new Set()): number {
  let dropped = 0;
  for (const chapter of chapters) {
    const opening = chapter.body.startsWith("### ") ? "" : chapter.body.split(/\n### /u)[0];
    if (!opening.trim()) continue;
    // The decisions the opening states, in their own words too: "The first version is restricted to the web platform,
    // explicitly excluding any native mobile applications." and "V1 is Web only; no native iOS or Android apps." under an
    // opening stating "v1 is web only, with no native mobile app" each told it again in other words.
    const decisions = (chapter.openingUnitIds ?? []).filter(decided).flatMap(id => unitOf(id) ?? []);
    const said = plainTerms(opening), held = plainTerms(`${opening} ${decisions.map(unit => unit.statement).join(" ")}`);
    const numbersOf = (text: string): string[] => [...text.matchAll(/\d+(?:\.\d+)?/gu)].map(match => match[0]);
    chapter.paragraphs = chapter.paragraphs.filter(paragraph => {
      const text = paragraph.text.trim();
      if (kept.has(paragraph) || /\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s]|#)/u.test(text) || opening.includes(text)) return true;
      const sentences = text.split(SENTENCE_END).filter(sentence => sentence.trim());
      // One sentence, not a list (one naming items besides the decision's adds them), and not what opens its subtopic: "The
      // confirmed frontend stack is React + Vite + TypeScript …" leads its Tech Stack part, the next paragraph's "This
      // choice" reading back to it.
      const leads = chapter.paragraphs.find(other => other.subtopic === paragraph.subtopic) === paragraph;
      const restated = sentences.length === 1 && !leads && (text.match(/,/gu) ?? []).length < 2 && numbersOf(text).every(number => numbersOf(opening).includes(number)) && decisions.some(unit => claimSupported(text, [unit]) && (() => { const own = [...plainTerms(text)]; return own.length >= 3 && own.filter(term => held.has(term)).length / own.length >= OPENING_DECISION_SAYS && [...plainTerms(unit.statement)].filter(term => plainTerms(text).has(term)).length / Math.max(1, plainTerms(unit.statement).size) >= OPENING_DECISION_SAYS; })());
      if (!restated && (sentences.length > 2 || !sentences.every(sentence => { const own = [...plainTerms(sentence)]; return own.length >= 3 && own.filter(term => said.has(term)).length / own.length >= OPENING_SAYS; }))) return true;
      if (chapter.paragraphs.filter(other => other.subtopic === paragraph.subtopic).length < 2) return true;
      chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
      chapter.openingUnitIds = [...new Set([...chapter.openingUnitIds ?? [], ...paragraph.unitIds])];
      dropped++;
      return false;
    });
  }
  return dropped;
}

/** A second list of the same labelled items in one subtopic: "1. **Milestone 1**: Complete when expenses can be added …
 * 2. **Milestone 2**: Complete when a new user can configure a budget …" under the Roadmap's own "1. **Milestone 1**:
 * Focuses exclusively on data reliability …". When every label of the later list is a label of an earlier one, each
 * item joins its namesake and the later list goes. Returns how many lists went. */
const LIST_LINE = /^(\s*)(?:[-*+]|\d+\.)\s+\*\*([^*\n]+)\*\*\s*[:：]\s*(.*)$/u;
export function mergedLabelledLists(chapters: WikiDraftChapter[]): number {
  let merged = 0;
  const itemsOf = (text: string) => { const lines = text.trim().split("\n"); const items = lines.map(line => line.match(LIST_LINE)); return items.every(Boolean) ? items as RegExpMatchArray[] : undefined; };
  const key = (label: string) => label.toLowerCase().replace(/\s+/gu, " ").trim();
  for (const chapter of chapters) {
    for (let later = chapter.paragraphs.length - 1; later > 0; later--) {
      const paragraph = chapter.paragraphs[later], items = itemsOf(paragraph.text);
      if (!items || items.length < 2) continue;
      const earlier = chapter.paragraphs.slice(0, later).find(other => other.subtopic === paragraph.subtopic && (() => { const own = itemsOf(other.text); return own && items.every(item => own.some(line => key(line[2]) === key(item[2]))); })());
      if (!earlier) continue;
      const before = earlier.text;
      const lines = before.trim().split("\n");
      for (const item of items) {
        const at = lines.findIndex(line => key(line.match(LIST_LINE)![2]) === key(item[2]));
        lines[at] = `${lines[at].replace(/\s+$/u, "")} ${item[3].trim()}`;
      }
      earlier.text = lines.join("\n");
      earlier.unitIds = [...new Set([...earlier.unitIds, ...paragraph.unitIds])];
      earlier.claims = [...earlier.claims ?? [], ...(paragraph.claims ?? []).filter(claim => earlier.text.includes(claim.text))];
      chapter.body = replaceParagraph(chapter.body, before, () => earlier.text);
      chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
      chapter.paragraphs.splice(later, 1);
      merged++;
    }
  }
  return merged;
}

/** A sentence that only says a decision of its chapter is settled: "Dexie and IndexedDB are the settled persistence
 * architecture for Pocket Ledger." after "Local data persistence uses IndexedDB via Dexie; localStorage is prohibited.
 * [Decided]". Every word it has of its own, the project's name and words of settling aside, is the decision's. It goes.
 * ignore: the project's name. Returns how many went. */
const SETTLING = new Set("settled confirmed decided chosen final finalized agreed fixed architecture approach choice solution option direction current".split(" "));
export function droppedDecisionEchoes(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number, ignore = ""): number {
  let dropped = 0;
  const skip = plainTerms(ignore);
  for (const chapter of chapters) {
    const prose = (paragraph: WikiDraftChapter["paragraphs"][number]) => !paragraph.text.split("\n").some(line => /^\s*(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|#|\*)/u.test(line));
    const strengthOf = (paragraph: WikiDraftChapter["paragraphs"][number], sentence: string) => weight((paragraph.claims ?? []).filter(claim => sentence.includes(claim.text) || claim.text.includes(sentence)).flatMap(claim => claim.unitIds));
    const sentencesOf = (paragraph: WikiDraftChapter["paragraphs"][number]) => paragraph.text.split(SENTENCE_END).map(sentence => sentence.trim()).filter(Boolean);
    const decided = chapter.paragraphs.filter(prose).flatMap(paragraph => sentencesOf(paragraph).filter(sentence => strengthOf(paragraph, sentence) >= 2)).map(sentence => plainTerms(sentence));
    if (!decided.length) continue;
    for (const paragraph of [...chapter.paragraphs].filter(prose)) {
      const echoes = sentencesOf(paragraph).filter(sentence => {
        if (strengthOf(paragraph, sentence) >= 2) return false;
        const own = [...plainTerms(sentence)].filter(term => !SETTLING.has(term) && !skip.has(term));
        return own.length >= 2 && SETTLED_SAYS.test(sentence) && decided.some(terms => own.every(term => terms.has(term)));
      });
      if (!echoes.length) continue;
      const before = paragraph.text;
      let rest = before;
      for (const sentence of echoes) rest = rest.replace(sentence, "");
      rest = rest.replace(/[ \t]{2,}/gu, " ").replace(/[ \t]+\n/gu, "\n").replace(/\n{3,}/gu, "\n\n").trim();
      if (!rest) {
        chapter.paragraphs = chapter.paragraphs.filter(other => other !== paragraph);
        chapter.body = chapter.body.includes(`\n\n${before}`) ? chapter.body.replace(`\n\n${before}`, () => "") : replaceParagraph(chapter.body, before, () => "");
      } else {
        paragraph.text = rest;
        paragraph.claims = (paragraph.claims ?? []).filter(claim => rest.includes(claim.text));
        chapter.body = replaceParagraph(chapter.body, before, () => rest);
      }
      dropped += echoes.length;
    }
  }
  return dropped;
}
/** Saying a choice is made, and nothing else: "… are the settled …", "… is the confirmed …". */
const SETTLED_SAYS = /\b(?:is|are|remains?|stays?)\s+(?:the\s+)?(?:settled|confirmed|decided|chosen|final|agreed)\b/iu;

/** A value a reader looks up: a size, a duration, a share or a colour. */
const LOOKED_UP = /\b\d+(?:\.\d+)?\s*(?:px|ms|rem|dp|pt|%)(?![A-Za-z])|#[0-9A-Fa-f]{6}\b/giu;
const valuesOf = (text: string) => new Set([...text.matchAll(LOOKED_UP)].map(match => match[0].replace(/\s+/gu, "").toLowerCase()));
/** Words between a value and what it sets: "a global corner radius of 8px", "radius is confirmed at 8px". */
const VALUE_LINK = new Set(["of", "is", "are", "at", "to", "a", "an", "the", "be", "as", "confirmed", "set", "fixed", "use", "uses", "with", "has", "have", "standard"]);
/** What a value sets, from the sentence giving it: "Standard UI components use a global corner radius of 8px." →
 * "Global corner radius". Up to three words, English only. */
export function valueLabel(sentence: string, value: string): string | undefined {
  const at = sentence.toLowerCase().replace(/(\d)\s+(?=[a-z%])/gu, "$1").indexOf(value);
  if (at <= 0) return undefined;
  const words = sentence.replace(/(\d)\s+(?=[a-z%])/giu, "$1").slice(0, at).split(/\s+/u).filter(Boolean);
  while (words.length && VALUE_LINK.has(words[words.length - 1].toLowerCase())) words.pop();
  const name: string[] = [];
  while (words.length && name.length < 3 && /^[A-Za-z][A-Za-z-]*$/u.test(words[words.length - 1]) && !VALUE_LINK.has(words[words.length - 1].toLowerCase())) name.unshift(words.pop()!);
  if (!name.length || name.length === 1 && name[0].length < 4) return undefined;
  const label = name.join(" ");
  return label[0].toUpperCase() + label.slice(1).toLowerCase();
}

/** A decision kept as its own paragraph after the list item that gives its value: "- Global standard is 8px; earlier
 * proposals of 16px/24px were replaced." then, below the tables, "Standard UI components use a global corner radius of
 * 8px." The writer's item lost what the value sets, so the decision was kept again. The item gets that as its label
 * ("Global corner radius") and the paragraph goes. Returns how many went. */
export function foldedValueDecisions(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number): number {
  let folded = 0;
  for (const chapter of chapters) for (const paragraph of [...chapter.paragraphs]) {
    const text = paragraph.text.trim(), claims = paragraph.claims ?? [];
    if (/\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`|\*|#)/u.test(text) || claims.length !== 1 || weight(claims[0].unitIds) < 2) continue;
    const values = valuesOf(text);
    if (!values.size) continue;
    const own = new Set(claims[0].unitIds);
    const home = chapter.paragraphs.find(other => other !== paragraph && other.subtopic === paragraph.subtopic && (other.claims ?? []).some(claim => claim.unitIds.some(id => own.has(id)) && /^\s*[-*+]\s/mu.test(other.text) && other.text.split("\n").some(line => line.includes(claim.text) && /^\s*[-*+]\s/u.test(line) && [...values].every(value => valuesOf(line).has(value)))));
    if (!home) continue;
    const claim = home.claims!.find(item => item.unitIds.some(id => own.has(id)) && home.text.split("\n").some(line => line.includes(item.text) && [...values].every(value => valuesOf(line).has(value))))!;
    const lines = home.text.split("\n"), index = lines.findIndex(line => line.includes(claim.text) && /^\s*[-*+]\s/u.test(line));
    const label = [...values].map(value => valueLabel(text, value)).find(Boolean);
    const unlabelled = lines[index].match(/^(\s*[-*+]\s+)(?!\*\*)(.+)$/u);
    // Labelled already, or by what the value sets: the item says the decision. Otherwise it needs the label to.
    if (unlabelled && !label) continue;
    if (unlabelled && label && !unlabelled[2].toLowerCase().includes(label.toLowerCase())) {
      const before = home.text;
      lines[index] = `${unlabelled[1]}**${label}**: ${unlabelled[2]}`;
      home.text = lines.join("\n");
      chapter.body = replaceParagraph(chapter.body, before, () => home.text);
    }
    for (const id of own) if (!home.unitIds.includes(id)) home.unitIds.push(id);
    chapter.paragraphs = chapter.paragraphs.filter(item => item !== paragraph);
    chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
    folded++;
  }
  return folded;
}

/** A sentence opening as another's lead before its colon, adding only a few words: "The roadmap consists of four
 * milestones: M1 Data reliability (Week 1), …" then "The roadmap consists of four milestones leading to a public beta."
 * The added words join the lead ("…four milestones leading to a public beta: M1 …") and the second sentence goes; each
 * claim keeps its part, so the user's words keep their mark. Returns how many joined. */
export function joinedLeadRepeats(chapters: WikiDraftChapter[]): number {
  let joined = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (paragraph.text.split("\n").some(line => /^\s*(?:[-*+]\s|\d+\.\s|\||>|`{3}|#)/u.test(line))) continue;
    for (let again = true; again;) {
      again = false;
      const sentences = paragraph.text.split(SENTENCE_END).map(sentence => sentence.trim()).filter(Boolean);
      for (const listed of sentences) {
        const colon = listed.indexOf(": ");
        if (colon < 12) continue;
        const lead = listed.slice(0, colon);
        const extra = sentences.find(other => other !== listed && other.toLowerCase().startsWith(`${lead.toLowerCase()} `) && !other.includes(":") && other.length - lead.length <= 60);
        if (!extra) continue;
        const added = extra.slice(lead.length).replace(/[.。]\s*$/u, ""), rest = listed.slice(colon + 2);
        const before = paragraph.text, written = `${lead}${added}: ${rest}`;
        const kept = paragraph.text.replace(listed, () => written), at = kept.indexOf(extra);
        paragraph.text = at < 0 ? kept : `${kept.slice(0, at).trimEnd()}${at + extra.length < kept.length ? " " : ""}${kept.slice(at + extra.length).trimStart()}`.trim();
        for (const claim of paragraph.claims ?? []) {
          if (claim.text === extra || extra.includes(claim.text) && claim.text.length > lead.length) claim.text = `${lead}${added}`;
          else if (claim.text === listed || listed.includes(claim.text) && claim.text.startsWith(lead)) claim.text = claim.text.slice(colon + 2) || rest;
        }
        chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
        joined++; again = true;
        break;
      }
    }
  }
  return joined;
}

/** The state a listing clause gives its items, in one word: "are excluded from v1", "is out of scope for V1" → excluded;
 * "are not yet verified", "are unverified" → unverified. */
const LISTED_STATE: Array<[string, RegExp]> = [
  ["excluded", /^(?:explicitly\s+|entirely\s+)?(?:excluded|out of scope|not included|left out|dropped)\b/iu],
  ["unverified", /^(?:still\s+|yet\s+)?(?:unverified|not\s+(?:yet\s+)?verified|untested|not\s+(?:yet\s+)?tested)\b/iu],
];
/** A clause listing items and their state: "Delete, category management, and budget tracking are unverified". */
const LISTING = /^(?:\*\*[^*\n]+\*\*\s*:\s*)?(.+?)\s+(?:are|is)\s+(.+)$/u;
const itemsOf = (subject: string) => subject.replace(/\*\*/gu, "").split(/\s*,\s*(?:and\s+|or\s+)?|\s+and\s+|\s+or\s+/u).map(item => [...plainTerms(item)]).filter(terms => terms.length);
function listedClause(clause: string): { state: string; items: string[][] } | undefined {
  const hit = clause.trim().replace(/[.;]$/u, "").match(LISTING);
  if (!hit) return undefined;
  const state = LISTED_STATE.find(([, test]) => test.test(hit[2]))?.[0];
  return state ? { state, items: itemsOf(hit[1]) } : undefined;
}
/** An item another list names: all its words but one there, at least one ("AI financial coaching" beside "AI coaching",
 * "Budget tracking" beside "budget tracking"). */
const namedIn = (item: string[], items: string[][]) => items.some(other => item.filter(term => other.includes(term)).length >= Math.max(1, item.length - 1) && other.some(term => item.includes(term)));

/** A clause listing items in a state another clause of its chapter gives all of them: "Budget tracking and Category
 * management are not yet verified" before "Delete, category management, and budget tracking are unverified.";
 * "- **AI Coaching**: AI financial coaching is out of scope for V1." under a list already excluding AI coaching. The
 * shorter goes, never a decision's, and its claim with it. A clause naming an item no other gives stays. Returns how many went. */
export function droppedCoveredListings(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number): number {
  let dropped = 0;
  for (const chapter of chapters) {
    type Clause = { paragraph: WikiDraftChapter["paragraphs"][number]; text: string; state: string; items: string[][]; line: boolean };
    const clauses: Clause[] = [];
    for (const paragraph of chapter.paragraphs) {
      if (/^\s*(?:\||`{3}|~{3}|>|\*Table|\*Code)/u.test(paragraph.text)) continue;
      for (const line of paragraph.text.split("\n")) {
        const item = line.match(/^\s*(?:[-*+]|\d+\.)\s+(.+)$/u);
        const parts = item ? [item[1]] : line.split(SENTENCE_END).flatMap(sentence => sentence.split(/(?<=;)\s+/u));
        for (const part of parts) {
          const text = part.trim(), listed = listedClause(text);
          if (listed && text.length >= 12) clauses.push({ paragraph, text, ...listed, line: Boolean(item) });
        }
      }
    }
    const gone = new Set<Clause>();
    for (const clause of clauses) {
      const claims = (clause.paragraph.claims ?? []).filter(claim => claim.text.includes(clause.text.replace(/[;.]$/u, "").replace(/^\*\*[^*\n]+\*\*\s*:\s*/u, "")) || clause.text.includes(claim.text.replace(/[;.]$/u, "")));
      if (weight(claims.flatMap(claim => claim.unitIds)) >= 2) continue;
      const cover = clauses.find(other => other !== clause && !gone.has(other) && other.state === clause.state && other.items.length >= clause.items.length && clause.items.every(item => namedIn(item, other.items)) && !(other.items.length === clause.items.length && clauses.indexOf(other) > clauses.indexOf(clause)));
      if (!cover) continue;
      const paragraph = clause.paragraph, before = paragraph.text;
      let next = before;
      if (clause.line) next = before.split("\n").filter(line => !line.includes(clause.text)).join("\n");
      else if (clause.text.endsWith(";")) next = before.replace(`${clause.text} `, () => "");
      else if (before.includes(`; ${clause.text}`)) next = before.replace(`; ${clause.text}`, () => clause.text.endsWith(".") ? "." : "");
      else next = before.replace(clause.text, () => "");
      next = next.replace(/[ \t]{2,}/gu, " ").replace(/\s+\./gu, ".").trim();
      if (next === before) continue;
      gone.add(clause);
      dropped++;
      if (!next) {
        chapter.paragraphs = chapter.paragraphs.filter(item => item !== paragraph);
        chapter.body = chapter.body.includes(`\n\n${before}`) ? chapter.body.replace(`\n\n${before}`, () => "") : replaceParagraph(chapter.body, before, () => "");
        continue;
      }
      paragraph.text = next;
      const bareClause = clause.text.replace(/^\*\*[^*\n]+\*\*\s*:\s*/u, "").replace(/[;.]$/u, "");
      paragraph.claims = (paragraph.claims ?? []).flatMap(claim => {
        if (next.includes(claim.text)) return [claim];
        const trimmed = claim.text.replace(`; ${bareClause}`, "").replace(bareClause, "").replace(/[;\s]+$/u, "").trim();
        // The claim was the clause: it goes with it.
        return /[A-Za-z0-9]/u.test(trimmed) && next.includes(trimmed) ? [{ ...claim, text: /[.!?]$/u.test(trimmed) ? trimmed : next.includes(`${trimmed}.`) ? `${trimmed}.` : trimmed }] : [];
      });
      chapter.body = replaceParagraph(chapter.body, before, () => next);
    }
  }
  return dropped;
}

/** A status the user reported, told again by the AI in another chapter: "Add transactions, Edit transactions, and
 * Monthly spending chart are built." under the roadmap beside "- **Built**: Adding/editing transactions and the monthly
 * spending chart are built. [You]" under Status. The AI's sentence goes when the user's line holds most of its words;
 * one adding a point ("Delete, category management, and budget tracking are unverified.") stays, and a paragraph keeps
 * at least one sentence. weight: 2 for a decision, 1 for the user's own words, 0 otherwise. Returns how many went. */
const REPORT = /\b(?:built|implemented|working|unfinished|unverified|verified|shipped|broken|done|completed?)\b/iu;
const ECHOED_REPORT = .6;
export function droppedEchoedReports(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number): number {
  let dropped = 0;
  const lineOf = (text: string) => text.replace(/^\s*(?:[-*+]|\d+\.)\s+/u, "").replace(/^\*\*[^*\n]+\*\*\s*[:：]\s*/u, "");
  const reports = chapters.map(chapter => chapter.paragraphs.flatMap(paragraph => paragraph.text.split("\n").flatMap(line => lineOf(line).split(SENTENCE_END)).map(sentence => sentence.trim())
    .filter(sentence => REPORT.test(sentence) && weight((paragraph.claims ?? []).filter(claim => sentence.includes(claim.text) || claim.text.includes(sentence)).flatMap(claim => claim.unitIds)) >= 1).map(plainTerms)));
  for (const [at, chapter] of chapters.entries()) {
    const others = reports.filter((_, index) => index !== at).flat();
    if (!others.length) continue;
    for (const paragraph of chapter.paragraphs) {
      const text = paragraph.text.trim();
      if (/\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`{3}|~{3}|\*[^*\s]|#)/u.test(text)) continue;
      const sentences = paragraph.text.split(SENTENCE_END).filter(sentence => sentence.trim());
      const gone = sentences.filter(sentence => {
        if (!REPORT.test(sentence)) return false;
        const ids = (paragraph.claims ?? []).filter(claim => sentence.includes(claim.text) || claim.text.includes(sentence.trim())).flatMap(claim => claim.unitIds);
        if (weight(ids) >= 1) return false;
        const own = plainTerms(sentence);
        return others.some(terms => { const shared = [...own].filter(term => terms.has(term)).length; return shared >= 3 && shared / Math.max(1, own.size) >= ECHOED_REPORT; });
      });
      if (!gone.length || gone.length === sentences.length) continue;
      const before = paragraph.text;
      paragraph.text = sentences.filter(sentence => !gone.includes(sentence)).join("").trim();
      paragraph.claims = (paragraph.claims ?? []).filter(claim => paragraph.text.includes(claim.text));
      chapter.body = replaceParagraph(chapter.body, before, () => paragraph.text);
      dropped += gone.length;
    }
  }
  return dropped;
}

/** A one-sentence paragraph of the AI's told again by the source table right after it: "Proposed targets for the
 * private alpha include expense entry time under 10 seconds, ≥90% successful first entries …" above "| Expense entry
 * time | Under 10 seconds |", "| Successful first expense entry | ≥90% of testers |". The table holds every figure and
 * most words of the sentence; the sentence goes. Run after the source tables are placed. Returns how many went. */
const TOLD_BY_TABLE = .7;
export function droppedTableEchoes(chapters: WikiDraftChapter[], weight: (unitIds: string[]) => number): number {
  let dropped = 0;
  for (const chapter of chapters) {
    const gone = new Set<number>();
    chapter.paragraphs.forEach((paragraph, index) => {
      const text = paragraph.text.trim(), next = chapter.paragraphs[index + 1];
      if (!next || next.subtopic !== paragraph.subtopic || !/^\*[^*\n]+\*\s*\n+\|/u.test(next.text.trim()) || /\n/u.test(text) || /^(?:[-*+]\s|\d+\.\s|\||>|`|#|\*)/u.test(text)) return;
      if (text.split(SENTENCE_END).filter(sentence => sentence.trim()).length !== 1 || weight(paragraph.unitIds) >= 1) return;
      const table = next.text.replace(/\*\*/gu, "");
      if (!(text.match(/\d+(?:\.\d+)?/gu) ?? []).every(figure => table.includes(figure))) return;
      // Each cell a term run of its own: joined at a line break, "Target" and "Expense" read as "targetexpense".
      const own = plainTerms(text), held = plainTerms(table.replace(/\s*[|\n]\s*/gu, " , "));
      if (own.size >= 4 && [...own].filter(term => held.has(term)).length / own.size >= TOLD_BY_TABLE) gone.add(index);
    });
    if (!gone.size) continue;
    for (const index of gone) chapter.body = chapter.body.replace(`${chapter.paragraphs[index].text}\n\n`, () => "");
    chapter.paragraphs = chapter.paragraphs.filter((_, index) => !gone.has(index));
    dropped += gone.size;
  }
  return dropped;
}

/** What an earlier version said, told after what holds now: each chapter's paragraphs telling only replaced points (the
 * 12/16/24px radius scale and the sentence naming it, beside the confirmed 8px), and the rows of a table the writer made
 * that tell only a replaced point ("| Milestone 1 | … exported without data corruption … |" among the current stage
 * criteria), go under one heading at the chapter's end, in their order and words. Marked [Earlier] as before; read
 * among the current lines, they were taken for current. Run after the source blocks are placed. Returns how many moved. */
/** A claim's closing sentences that only its replaced units state, as a claim of their own after the rest. */
function separatedEarlier(claim: NonNullable<WikiDraftChapter["paragraphs"][number]["claims"]>[number], statusOf: (id: string) => string | undefined, unitOf: (id: string) => WikiKnowledgeUnit | undefined) {
  const history = claim.unitIds.filter(id => statusOf(id) === "history"), current = claim.unitIds.filter(id => statusOf(id) !== "history");
  if (!history.length || !current.length) return [claim];
  const sentences = claim.text.split(SENTENCE_END).map(sentence => sentence.trim()).filter(Boolean);
  if (sentences.length < 2) return [claim];
  const units = (ids: string[]) => ids.flatMap(id => unitOf(id) ?? []);
  const onlyEarlier = (sentence: string) => units(history).some(unit => claimSupported(sentence, [unit])) && !units(current).some(unit => claimSupported(sentence, [unit]));
  let cut = sentences.length;
  while (cut > 1 && onlyEarlier(sentences[cut - 1])) cut--;
  if (cut === sentences.length) return [claim];
  const head = sentences.slice(0, cut).join(" "), tail = sentences.slice(cut).join(" ");
  const tailIds = history.filter(id => claimSupported(tail, units([id])));
  return [{ ...claim, text: head, unitIds: claim.unitIds.filter(id => !tailIds.includes(id) || claimSupported(head, units([id]))) }, { text: tail, unitIds: tailIds }];
}

export function earlierVersionsLast(chapters: WikiDraftChapter[], statusOf: (id: string) => string | undefined, zh: boolean, unitOf: (id: string) => WikiKnowledgeUnit | undefined = () => undefined): number {
  const heading = zh ? "早先版本" : "Earlier versions";
  let moved = 0;
  const replaced = (ids: string[]) => ids.length > 0 && ids.some(id => statusOf(id) === "history");
  for (const chapter of chapters) {
    const earlier: WikiDraftChapter["paragraphs"] = [];
    chapter.paragraphs = chapter.paragraphs.flatMap(paragraph => {
      if (paragraph.subtopic === heading) return [paragraph];
      const claims = paragraph.claims ?? [];
      const sourceBlock = /^\*[^*\n]+\*\n\n/u.test(paragraph.text.trimStart());
      // A source block whose every carrier was replaced, or a paragraph each claim of which tells a replaced point.
      const whole = sourceBlock ? paragraph.unitIds.length > 0 && paragraph.unitIds.every(id => statusOf(id) === "history")
        : !/^\s*\|/u.test(paragraph.text) && claims.length > 0 && claims.every(claim => replaced(claim.unitIds)) && paragraph.unitIds.every(id => ["history", "confirmed"].includes(statusOf(id) ?? ""));
      if (whole) {
        chapter.body = chapter.body.includes(`\n\n${paragraph.text}`) ? chapter.body.replace(`\n\n${paragraph.text}`, () => "") : replaceParagraph(chapter.body, paragraph.text, () => "");
        earlier.push({ ...paragraph, subtopic: heading });
        moved++;
        return [];
      }
      if (!sourceBlock && /^\s*(?:[-*+]|\d+\.)\s/u.test(paragraph.text)) {
        // A sentence of a list item telling only a replaced point, after what the item says now: "1. **Milestone 1**:
        // Focuses exclusively on data reliability, …, excluding CSV export. Complete when expenses can be … exported
        // without data corruption …" kept the first roadmap's criterion inside the revised milestone, marked [Earlier].
        let text = paragraph.text;
        const gone: typeof claims = [];
        // One claim telling what holds now and then the replaced criterion, citing both ("Focuses exclusively on data
        // reliability, …. It excludes CSV export. Completion requires expenses can be … exported without data corruption
        // …", the last sentence the first roadmap's only): its sentences said by a replaced unit alone are a claim apart.
        claims.splice(0, claims.length, ...claims.flatMap(claim => separatedEarlier(claim, statusOf, unitOf)));
        for (const claim of claims) {
          const said = claim.text.trim();
          if (said.length < 12 || !/[.!?。！？]$/u.test(said) || !claim.unitIds.length || !claim.unitIds.every(id => statusOf(id) === "history")) continue;
          const line = text.split("\n").find(line => line.includes(` ${said}`) || line.includes(said));
          const label = line?.match(/^\s*(?:[-*+]|\d+\.)\s+\*\*([^*\n]+)\*\*\s*[:：]/u)?.[1];
          if (!line || !label) continue;
          const at = line.indexOf(said), lead = line.slice(0, at);
          // After a whole sentence of what holds now, cited to a point not replaced.
          if (!/[.!?。！？]\s*$/u.test(lead) || !claims.some(other => other !== claim && lead.includes(other.text.trim()) && other.unitIds.some(id => statusOf(id) !== "history"))) continue;
          text = text.replace(line, () => `${lead.trimEnd()}${line.slice(at + said.length).replace(/^\s+/u, " ").trimEnd()}`.trimEnd());
          earlier.push({ subtopic: heading, text: `- **${label}**: ${said}`, unitIds: [...claim.unitIds], claims: [claim] });
          gone.push(claim);
          moved++;
        }
        if (!gone.length) return [paragraph];
        const rest = claims.filter(claim => !gone.includes(claim));
        chapter.body = replaceParagraph(chapter.body, paragraph.text, () => text);
        return [{ ...paragraph, text, claims: rest, unitIds: paragraph.unitIds.filter(id => rest.some(claim => claim.unitIds.includes(id)) || !gone.some(claim => claim.unitIds.includes(id))) }];
      }
      if (sourceBlock || !/^\s*\|/u.test(paragraph.text)) return [paragraph];
      // A table of the writer's: its rows telling only replaced points.
      const lines = paragraph.text.trim().split("\n");
      if (lines.length < 3 || !/^\s*\|?\s*:?-{3,}/u.test(lines[1])) return [paragraph];
      const cells = (line: string) => line.trim().replace(/^\||\|$/gu, "").split("|").map(cell => cell.trim());
      const header = cells(lines[0]);
      const rowClaims = (line: string) => claims.filter(claim => claim.text.trim().length >= 2 && line.includes(claim.text.trim()));
      const old = lines.slice(2).filter(line => { const own = rowClaims(line); return own.length > 0 && own.every(claim => claim.unitIds.length > 0 && claim.unitIds.every(id => statusOf(id) === "history")); });
      if (!old.length) return [paragraph];
      const kept = [...lines.slice(0, 2), ...lines.slice(2).filter(line => !old.includes(line))];
      const before = paragraph.text;
      const rest = kept.length > 2 ? kept.join("\n") : "";
      for (const line of old) {
        const [name, ...values] = cells(line);
        const text = `- **${name}** · ${values.map((value, index) => header[index + 1] ? `${header[index + 1]}: ${value}` : value).join("; ")}`;
        earlier.push({ subtopic: heading, text, unitIds: [...new Set(rowClaims(line).flatMap(claim => claim.unitIds))], claims: rowClaims(line) });
        moved++;
      }
      if (!rest) { chapter.body = chapter.body.includes(`\n\n${before}`) ? chapter.body.replace(`\n\n${before}`, () => "") : replaceParagraph(chapter.body, before, () => ""); return []; }
      chapter.body = replaceParagraph(chapter.body, before, () => rest);
      return [{ ...paragraph, text: rest, claims: claims.filter(claim => rest.includes(claim.text)), unitIds: paragraph.unitIds.filter(id => claims.some(claim => rest.includes(claim.text) && claim.unitIds.includes(id)) || !claims.some(claim => claim.unitIds.includes(id))) }];
    });
    if (!earlier.length) continue;
    // Rows told one after another make one list.
    const merged: typeof earlier = [];
    for (const item of earlier) {
      const last = merged.at(-1);
      if (last && /^- /u.test(last.text) && /^- /u.test(item.text)) merged[merged.length - 1] = { ...last, text: `${last.text}\n${item.text}`, unitIds: [...new Set([...last.unitIds, ...item.unitIds])], claims: [...last.claims ?? [], ...item.claims ?? []] };
      else merged.push(item);
    }
    chapter.paragraphs.push(...merged);
    // Before the chapter's closing note ("> 17 more related points in the ledger"), which is about the whole chapter.
    const body = chapter.body.replace(/\n{3,}/gu, "\n\n").trimEnd(), note = body.match(/\n\n(>[^\n]*)$/u);
    const section = `### ${heading}\n\n${merged.map(item => item.text).join("\n\n")}`;
    chapter.body = note && !chapter.paragraphs.some(paragraph => paragraph.text.trim() === note[1].trim()) ? `${body.slice(0, note.index)}\n\n${section}\n\n${note[1]}` : `${body}\n\n${section}`;
  }
  return moved;
}

/** An item of an exclusion list the paragraph ruled out a sentence before: "… for v1, with no native iOS or Android
 * apps. Bank syncing, receipt OCR, AI coaching, native mobile apps, complex reports, … are excluded from v1/beta scope."
 * The item ("native mobile apps") goes from the list, its claim kept in step. Returns how many items went. */
const EXCLUSION_LIST = /^(\s*)(.+?)(\s+(?:are|is)\s+(?:excluded|out of scope|not included)\b.*)$/su;
export function droppedRepeatedExclusions(chapters: WikiDraftChapter[]): number {
  let dropped = 0;
  for (const chapter of chapters) for (const paragraph of chapter.paragraphs) {
    if (/\n/u.test(paragraph.text.trim()) || /^\s*(?:[-*+]\s|\d+\.\s|\||>|`|#|\*)/u.test(paragraph.text)) continue;
    const sentences = paragraph.text.split(SENTENCE_END);
    const ruledOut: Array<Set<string>> = [];
    let changed = false;
    const next = sentences.map(sentence => {
      const list = sentence.match(EXCLUSION_LIST), items = list?.[2].split(/,\s*(?:and\s+)?|\s+and\s+/u).map(item => item.trim()).filter(Boolean) ?? [];
      if (list && items.length >= 3) {
        const kept = items.filter(item => {
          const own = plainTerms(item);
          const said = item.split(/\s+/u).length <= 4 && ruledOut.some(terms => { const shared = [...own].filter(term => terms.has(term)).length; return shared >= 2 && own.size <= shared + 1; });
          if (said) dropped++;
          return !said;
        });
        if (kept.length < items.length && kept.length >= 2) {
          changed = true;
          const oxford = /,\s*and\s+[^,]+$/u.test(list[2]);
          const head = `${kept.slice(0, -1).join(", ")}${oxford ? "," : ""} and ${kept.at(-1)}`;
          return `${list[1]}${head}${list[3]}`;
        }
      }
      // What this sentence rules out ("with no native iOS or Android apps"), for the lists after it.
      for (const clause of sentence.split(/[,;]/u)) { const at = clause.search(/\b(?:no|without|not)\b/u); if (at >= 0) ruledOut.push(plainTerms(clause.slice(at))); }
      return sentence;
    });
    if (!changed) continue;
    const before = paragraph.text, text = next.join("");
    paragraph.text = text;
    paragraph.claims = (paragraph.claims ?? []).map(claim => {
      if (text.includes(claim.text)) return claim;
      const at = sentences.findIndex(sentence => sentence.includes(claim.text) || claim.text.includes(sentence.trim()));
      return at >= 0 && next[at] !== sentences[at] ? { ...claim, text: next[at].trim() } : claim;
    }).filter(claim => text.includes(claim.text));
    chapter.body = replaceParagraph(chapter.body, before, () => text);
  }
  return dropped;
}
