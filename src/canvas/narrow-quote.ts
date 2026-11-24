import { sourceQuoteText } from "../shared/source-quote-text";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { isRejectedQuoteLead } from "../shared/claim-meaning";
import { meaningTerms } from "./claim-highlight";

// Component markup (<box>, <text>) is read through, not as one block of HTML with no words.
const visibleTerms=(text:string)=>meaningTerms(sourceQuoteText(text.replace(/<[^>]*>/gu," ")));
const overlap=(own:Set<string>,theirs:Set<string>)=>{let shared=0;for(const term of own)if(theirs.has(term))shared++;return shared;};
const quotePieces = (quote: string) => [...quote.matchAll(/[^。！？!?\n]+[。！？!?]*/gu)].map(match=>({text:match[0],at:match.index!})).filter(piece=>piece.text.trim().length>1);

/** Recover a missing saved quote from an unambiguous whole assertion in its
 * cited message. A phrase inside “不要…” or a different clause is insufficient. */
export function exactSourceSentence(claim: string, content: string): string | undefined {
  const text = sourceQuoteText(claim).trim().replace(/[。！？.!?]$/u, "");
  if (text.length < 12) return;
  const range = wikiQuoteRange(content, text);
  if (!range || wikiQuoteRange(content.slice(range.end), text)) return;
  const before = content.slice(0, range.start).split(/\n|(?<=[。！？!?；;])|(?<=\.)\s/u).at(-1) ?? "";
  if (!/^\s*(?:>\s*)?(?:(?:[-*+]\s+|\d+[.)]\s+))?[*_`]*$/u.test(before)) return;
  if (/^\s*>/u.test(before)) {
    const previous = content.slice(0, range.start - before.length).trimEnd().split(/\r?\n/u).at(-1);
    if (previous && isRejectedQuoteLead(previous)) return;
  }
  const after = content.slice(range.end);
  if (!/^[ \t*_`]*(?:[。！？.!?；;\r\n]|$)/u.test(after)) return;
  return content.slice(range.start, range.end);
}

/** Keep the contiguous source between the first and last matching step.
 * Short steps such as IR or BOM get their meaning from the ordered chain. */
function verticalQuotePassage(claim: string, quote: string) {
  const own = meaningTerms(claim);
  const candidates: Array<{text: string; at: number; count: number}> = [];
  for (const match of quote.matchAll(/^[^\r\n]{1,100}(?:\r?\n[ \t]*↓[ \t]*\r?\n[^\r\n]{1,100}){2,}/gmu)) {
    const text = match[0];
    const steps = [...text.matchAll(/^(?!\s*↓)[^\r\n]+/gmu)];
    const relevant = steps.filter(step => {
      const terms = visibleTerms(step[0]), shared = overlap(own, terms);
      return shared >= Math.min(2, terms.size) && shared > 0 && shared / terms.size >= .6;
    });
    if (relevant.length < 2) continue;
    const first = relevant[0], last = relevant.at(-1)!;
    candidates.push({ text: text.slice(first.index, last.index + last[0].length).trim(), at: match.index + first.index, count: relevant.length });
  }
  const [best, next] = candidates.sort((a, b) => b.count - a.count);
  return best && best.count !== next?.count ? best : undefined;
}

/** The part of a long quote that states its claim: the best-matching sentence and the sentences next to it that share
 * its words. A quote saved across three paragraphs (the tail of the one before, a passing remark, then the naming)
 * otherwise marks the neighbours as evidence too; a quote with no sentence clearly closer than the rest stays whole. */
export function narrowQuote(claim:string,quote:string){
  const pieces=quotePieces(quote);
  if(pieces.length<2)return quote;
  const own=meaningTerms(claim);
  const scores=pieces.map(piece=>overlap(own,visibleTerms(piece.text)));
  const best=scores.reduce((top,score,index)=>score>scores[top]?index:top,0);
  if(scores[best]<NARROW.shared)return quote;
  const joins=(index:number)=>scores[index]>=Math.max(NARROW.neighbour,scores[best]*NARROW.ratio);
  let first=best,last=best;
  while(first>0&&joins(first-1))first--;
  while(last<pieces.length-1&&joins(last+1))last++;
  if(first===0&&last===pieces.length-1)return quote;
  return quote.slice(pieces[first].at,pieces[last].at+pieces[last].text.length).trim();
}
const NARROW={shared:3,neighbour:2,ratio:.4};

/** Keep separate literal passages when each accounts for different words in a compound claim. */
export function narrowQuotePassages(claim: string, quote: string): string[] {
  const vertical = verticalQuotePassage(claim, quote);
  const primary = vertical?.text ?? narrowQuote(claim, quote);
  if (primary === quote) return [quote];
  const covered = visibleTerms(primary), wanted = Array.from(meaningTerms(claim)).filter(term => !covered.has(term));
  const candidates = quotePieces(quote).filter(piece => !primary.includes(piece.text.trim())).map(piece => {
    const terms = visibleTerms(piece.text);
    const matched = wanted.filter(term => terms.has(term));
    return { ...piece, matched, fit: matched.length / Math.max(1, terms.size) };
  });
  const selected = [{ text: primary, at: vertical?.at ?? quote.indexOf(primary) }];
  for (const piece of candidates.filter(piece => piece.matched.length >= 3 && piece.fit >= .25).sort((a,b)=>b.matched.length-a.matched.length || b.fit-a.fit)) {
    const fresh = piece.matched.filter(term => !covered.has(term));
    if (fresh.length < 3 || fresh.length < piece.matched.length / 2) continue;
    selected.push({ text: piece.text.trim(), at: piece.at });
    fresh.forEach(term => covered.add(term));
    if (selected.length === 3) break;
  }
  return selected.sort((a,b)=>a.at-b.at).map(piece=>piece.text);
}
