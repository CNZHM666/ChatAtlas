import {sourceMessageSignature} from "./source-signature";
import type {FocusSection} from "./focus-session";

/** A sentence of 20+ characters is a repeat when this share of the SHORTER
 * sentence's character trigrams also appears in another chapter's sentence.
 * Containment, unlike Jaccard, still matches a rephrased lead-in or added clause. */
const MIN_CHARACTERS=20,THRESHOLD=.7;
// Status disclaimers repeat by design and are not explanations.
export const WIKI_STATUS_DISCLAIMER=/材料未显示|未显示用户(?:已)?确认|尚未确认采用|(?:均|多)(?:为|属|来自)\s*AI\s*建议|no evidence the user (?:adopted|confirmed)/iu;
const DISCLAIMER=WIKI_STATUS_DISCLAIMER;
/** "尚未有用户确认或报告的实际进展": a claim of absence the overview cannot prove,
 * since detection covers only cited passages. The status line states this instead. */
const PROGRESS_ABSENCE=/尚未有用户(?:确认|报告|决定)|(?:未见|没有|尚无)用户(?:确认|报告|决定)|尚无(?:用户)?(?:确认|报告)的(?:实际)?进展|no user[- ](?:confirmed|reported|confirmation|report)/iu;
export function withoutProgressDisclaimer(text:string):string {
 const sentences=text.split(/(?<=[。！？!?])\s*/u).filter(Boolean),kept=sentences.filter(sentence=>!PROGRESS_ABSENCE.test(sentence));
 return kept.length&&kept.length<sentences.length?kept.join(/[一-鿿]/u.test(text)?"":" "):text;
}

// Pure functions of their text, called for every sentence pair while reading a
// chapter: bounded memo caches keep the pairwise checks from re-deriving them.
const CACHE_LIMIT=20000;
function memo<T>(compute:(text:string)=>T):(text:string)=>T{
 const cache=new Map<string,T>();
 return text=>{let value=cache.get(text);if(value===undefined){if(cache.size>=CACHE_LIMIT)cache.clear();value=compute(text);cache.set(text,value);}return value;};
}
const normalize=memo((sentence:string)=>sentence.replace(/[*_`~[\]()（）「」『』“”"'‘’、，,。.！!？?；;：:\s-]/gu,"").toLocaleLowerCase());
const prose=memo(proseOf);
function proseOf(body:string):string[]{
 // Code, tables, quotations and headings are literal or navigational, not explanations.
 const text=body.replace(/^(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1[^\n]*$/gmu,"").split("\n").filter(line=>!/^\s*(?:#{1,6}\s|\||>)/u.test(line)).join("\n");
 return text.split(/(?<=[。！？!?])|\n+/u).filter(sentence=>!DISCLAIMER.test(sentence)).map(normalize).filter(sentence=>sentence.length>=MIN_CHARACTERS);
}
// Callers only read the returned sets; a shared cached set is never mutated.
const trigrams=memo((sentence:string)=>{const grams=new Set<string>();for(let i=0;i+3<=sentence.length;i++)grams.add(sentence.slice(i,i+3));return grams;});

/** For each chapter, the EARLIER chapters (reading order) that already explain
 * one of its sentences. Local and deterministic; it flags, never deletes. */
export function wikiCrossChapterDuplicates(sections:Array<Pick<FocusSection,"id"|"title"|"body">>):Map<string,string[]> {
 const index=new Map<string,number[]>(),rows:Array<{chapter:number;grams:Set<string>}>=[],found=new Map<string,string[]>();
 sections.forEach((section,chapter)=>{
  const earlier=new Set<number>();
  for(const sentence of new Set(prose(section.body))){
   const grams=trigrams(sentence),shared=new Map<number,number>();
   for(const gram of grams)for(const row of index.get(gram)??[])if(rows[row].chapter!==chapter)shared.set(row,(shared.get(row)??0)+1);
   for(const [row,count] of shared){
    const other=rows[row];if(earlier.has(other.chapter))continue;
    if(count/Math.min(grams.size,other.grams.size)>=THRESHOLD)earlier.add(other.chapter);
   }
   rows.push({chapter,grams});for(const gram of grams){const list=index.get(gram)??[];list.push(rows.length-1);index.set(gram,list);}
  }
  if(earlier.size)found.set(section.id,[...earlier].sort((a,b)=>a-b).map(other=>sections[other].title));
 });
 return found;
}

/** Add review hints for repeated explanations; personal and edited chapters stay untouched. */
export function withCrossChapterDuplicates(sections:FocusSection[]):FocusSection[] {
 const generated=sections.filter(section=>!section.userEdited&&!section.origin);
 const duplicates=wikiCrossChapterDuplicates(generated);
 return sections.map(section=>{
  const titles=duplicates.get(section.id);if(!titles)return section;
  const signature=sourceMessageSignature(section.body),current=section.writingQuality?.signature===signature?section.writingQuality.issues.filter(issue=>issue.code!=="cross_chapter_duplicate"):[];
  return {...section,writingQuality:{signature,issues:[...current,...titles.map(title=>({code:"cross_chapter_duplicate" as const,title}))]}};
 });
}

/** Share of `text`'s explanatory sentences that `reference` already explains. */
export function wikiSentenceCoverage(text:string,reference:string,threshold=THRESHOLD):number {
 return referenceIndex(reference)(text,threshold);
}

/** Explanatory sentences (20+ characters, status disclaimers excluded) in `text`. */
export function wikiExplanatorySentenceCount(text:string):number {
 return prose(text).length;
}

/** A reference's sentences indexed by trigram: a sentence is compared only with
 * reference sentences it shares trigrams with, counted in one pass. */
const referenceIndex=memo((reference:string)=>{
 const others=prose(reference).map(trigrams),index=new Map<string,number[]>();
 others.forEach((grams,row)=>{for(const gram of grams){const list=index.get(gram);if(list)list.push(row);else index.set(gram,[row]);}});
 return (text:string,threshold:number)=>{
  const sentences=prose(text);if(!sentences.length)return 1;
  return sentences.filter(sentence=>{
   const grams=trigrams(sentence),shared=new Map<number,number>();
   for(const gram of grams)for(const row of index.get(gram)??[])shared.set(row,(shared.get(row)??0)+1);
   for(const [row,count] of shared)if(count/Math.min(grams.size,others[row].size)>=threshold)return true;
   return false;
  }).length/sentences.length;
 };
});

/** Index `reference` once; returns the coverage of any text against it. */
export function wikiCoverageMatcher(reference:string,threshold=THRESHOLD):(text:string)=>number {
 const covers=referenceIndex(reference);
 return text=>covers(text,threshold);
}

// Sentences that differ only in a negation or a number say different things.
const NEGATION=/不|没|未|无|非|禁止|勿|\b(?:not|no|never|without)\b/giu;
const shape=(key:string)=>`${(key.match(NEGATION)??[]).length}|${(key.match(/\d+(?:\.\d+)?/gu)??[]).join(",")}`;
const tokens=(key:string)=>{const counts=new Map<string,number>();for(const token of [...key.match(NEGATION)??[],...key.match(/\d+(?:\.\d+)?/gu)??[]])counts.set(token,(counts.get(token)??0)+1);return counts;};
/** Every negation and number of `part` also occurs in `whole`. */
const within=(part:Map<string,number>,whole:Map<string,number>)=>[...part].every(([token,count])=>(whole.get(token)??0)>=count);
/** True when earlier text already says `sentence`: one earlier sentence with at
 * most a one-character difference (two trigrams), or two or three consecutive
 * earlier sentences that together contain it (three, for the joins); a short
 * sentence only when an earlier one is identical. A changed
 * subject word ("侧栏" for "工作台") changes more and keeps the sentence, so does
 * an added clause; a negation or number the earlier text lacks keeps it too. */
export function wikiSentenceRepeats(sentence:string,earlier:string[]):boolean {
 const own=normalize(sentence),keys=earlier.map(normalize);
 // A short sentence ("检索粒度必须达到消息级。") repeats only word for word.
 if(own.length<MIN_CHARACTERS)return own.length>=8&&keys.includes(own);
 const grams=trigrams(own),form=shape(own),needed=tokens(own);
 const covers=(key:string,tolerance:number)=>{const set=trigrams(key);let missing=0;for(const gram of grams)if(!set.has(gram)&&++missing>tolerance)return false;return true;};
 // A joined window holds at most its parts' shared trigrams plus two per join, so
 // windows that cannot reach the tolerance are skipped without building them.
 const shared=keys.map(key=>{const set=trigrams(key);let count=0;for(const gram of grams)if(set.has(gram))count++;return count;});
 return keys.some((key,index)=>{
  if(key.length>=MIN_CHARACTERS&&shape(key)===form&&covers(key,2))return true;
  for(const size of [2,3]){
   if(index+size>keys.length)break;
   if(shared.slice(index,index+size).reduce((sum,count)=>sum+count,0)+2*(size-1)<grams.size-3)continue;
   const joined=keys.slice(index,index+size).join("");
   if(joined.length>=own.length&&within(needed,tokens(joined))&&covers(joined,3))return true;
  }
  return false;
 });
}
