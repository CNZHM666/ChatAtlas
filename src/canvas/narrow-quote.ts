import { sourceQuoteText } from "../shared/source-quote-text";
import { meaningTerms } from "./claim-highlight";

// Component markup (<box>, <text>) is read through, not as one block of HTML with no words.
const visibleTerms=(text:string)=>meaningTerms(sourceQuoteText(text.replace(/<[^>]*>/gu," ")));
const overlap=(own:Set<string>,theirs:Set<string>)=>{let shared=0;for(const term of own)if(theirs.has(term))shared++;return shared;};

/** The part of a long quote that states its claim: the best-matching sentence and the sentences next to it that share
 * its words. A quote saved across three paragraphs (the tail of the one before, a passing remark, then the naming)
 * otherwise marks the neighbours as evidence too; a quote with no sentence clearly closer than the rest stays whole. */
export function narrowQuote(claim:string,quote:string){
  const pieces=[...quote.matchAll(/[^。！？!?\n]+[。！？!?]*/gu)].map(match=>({text:match[0],at:match.index!})).filter(piece=>piece.text.trim().length>1);
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
