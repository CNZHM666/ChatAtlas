import { sourceQuoteText } from "../shared/source-quote-text";
import { meaningTerms } from "./claim-highlight";

// Component markup (<box>, <text>) is read through, not as one block of HTML with no words.
const visibleTerms=(text:string)=>meaningTerms(sourceQuoteText(text.replace(/<[^>]*>/gu," ")));
const overlap=(own:Set<string>,theirs:Set<string>)=>{let shared=0;for(const term of own)if(theirs.has(term))shared++;return shared;};
const quotePieces = (quote: string) => [...quote.matchAll(/[^。！？!?\n]+[。！？!?]*/gu)].map(match=>({text:match[0],at:match.index!})).filter(piece=>piece.text.trim().length>1);

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
  const primary = narrowQuote(claim, quote);
  if (primary === quote) return [quote];
  const covered = visibleTerms(primary), wanted = Array.from(meaningTerms(claim)).filter(term => !covered.has(term));
  const candidates = quotePieces(quote).filter(piece => !primary.includes(piece.text.trim())).map(piece => {
    const terms = visibleTerms(piece.text);
    const matched = wanted.filter(term => terms.has(term));
    return { ...piece, matched, fit: matched.length / Math.max(1, terms.size) };
  });
  const selected = [{ text: primary, at: quote.indexOf(primary) }];
  for (const piece of candidates.filter(piece => piece.matched.length >= 3 && piece.fit >= .25).sort((a,b)=>b.matched.length-a.matched.length || b.fit-a.fit)) {
    const fresh = piece.matched.filter(term => !covered.has(term));
    if (fresh.length < 3 || fresh.length < piece.matched.length / 2) continue;
    selected.push({ text: piece.text.trim(), at: piece.at });
    fresh.forEach(term => covered.add(term));
    if (selected.length === 3) break;
  }
  return selected.sort((a,b)=>a.at-b.at).map(piece=>piece.text);
}
