/** The document highlights the claims the evidence panel shows, so the reader sees the claim on the left and its
 * origin on the right. A claim's text is the sentence before its marker: from the last sentence end (or the previous
 * marker, or the start of its paragraph) up to the marker. The CSS Custom Highlight API paints it without touching
 * the rendered prose; markers also carry an attribute, for styling where that API is missing. */
import { evidenceTextLocator } from "./evidence-highlight";
import { evidenceConditionDescription, evidenceConditionDescriptionMatches, evidenceConditionLabel, evidenceConditions, evidenceConditionsMatch } from "./evidence-conditions";
const NAME = "atlas-claim";
const SENTENCE_END = /[。！？!?；;]/gu;
const FOLLOWING = 4, PRECEDING = 2;

function markerBetween(block: Element, before: Node, after: Node): boolean {
  return [...block.querySelectorAll(".wiki-claim-marker")].some(marker => Boolean(before.compareDocumentPosition(marker) & FOLLOWING) && Boolean(after.compareDocumentPosition(marker) & PRECEDING));
}

export function claimRange(marker: HTMLElement): Range | undefined {
  const block = marker.closest("p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6") ?? marker.parentElement;
  if (!block) return undefined;
  const walker = block.ownerDocument.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */), texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (marker.contains(node)) continue;
    if (marker.compareDocumentPosition(node) & FOLLOWING) break;
    texts.push(node as Text);
  }
  const last = texts.at(-1);
  if (!last) return undefined;
  const range = block.ownerDocument.createRange();
  range.setEnd(last, last.data.length);
  for (let index = texts.length - 1; index >= 0; index--) {
    const node = texts[index];
    // The sentence's own closing mark is not where it starts.
    const searchable = index === texts.length - 1 ? node.data.replace(/[\s。！？!?；;]+$/u, "") : node.data;
    const ends = [...searchable.matchAll(SENTENCE_END)];
    if (ends.length) { range.setStart(node, ends.at(-1)!.index! + 1); return range; }
    const previous = texts[index - 1];
    if (!previous || markerBetween(block, previous, node)) { range.setStart(node, 0); return range; }
  }
  return range;
}

/** A claim the prose holds without a marker: the first text node containing one of its phrases. */
function phraseRange(root: HTMLElement, phrases: string[], before?: HTMLElement): Range | undefined {
  const wanted = phrases.map(phrase => phrase.trim()).filter(phrase => phrase.length >= 4);
  if (!wanted.length) return undefined;
  const locate = evidenceTextLocator(root), boundary = before ? root.ownerDocument.createRange() : undefined;
  if (boundary && before) { boundary.selectNodeContents(root); boundary.setEndBefore(before); }
  for (const phrase of wanted) {
    let nearest: Range | undefined;
    for (let occurrence = 0; occurrence <= locate.text.length; occurrence++) {
      const range = locate(phrase, occurrence);
      if (!range || boundary && range.compareBoundaryPoints(Range.END_TO_END, boundary) > 0) break;
      if (range.startContainer.parentElement?.closest(".wiki-chapter-status, .evidence-review-button, summary")) continue;
      // Inline emphasis may split a formulation; separate paragraphs may not.
      const block = "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6";
      if (range.startContainer.parentElement?.closest(block) !== range.endContainer.parentElement?.closest(block)) continue;
      if (!before) return range;
      nearest = range;
    }
    if (nearest) return nearest;
  }
  return undefined;
}

/** Words a restatement shares with its source: pairs of Chinese characters, and whole Latin words and numbers, so
 * "AI 对话的文件管理器" and "an AI file manager" are compared by meaning-bearing pieces, not by single letters. */
const FILLER = /^(?:the|and|for|with|from|this|that|are|was|were|has|have|will|can|not|but|its|our|you|your|which|into|also|中的|一个|这个|可以|进行|以及|通过|我们|他们|就是|还是|需要|应该|如果|因为|所以|然后|已经)$/u;
export function meaningTerms(text: string): Set<string> {
  const terms = new Set<string>();
  for (const word of text.normalize("NFKC").toLocaleLowerCase().match(/[\p{Script=Han}]+|[\p{L}\p{N}][\p{L}\p{N}_.+#-]*/gu) ?? []) {
    if (/\p{Script=Han}/u.test(word)) { if (word.length === 1) terms.add(word); for (let index = 0; index + 1 < word.length; index++) terms.add(word.slice(index, index + 2)); }
    else { const clean = word.replace(/[.\-_]+$/u, ""); if (clean.length >= 2 || /\d/u.test(clean)) terms.add(clean); }
  }
  for (const term of terms) if (FILLER.test(term)) terms.delete(term);
  return terms;
}

/** How much of the shorter text the longer one holds, and how many pieces they share: a one-line conclusion drawn from
 * a long original sentence still matches it, which a share of the long sentence alone would miss. */
function closeness(own: Set<string>, source: Set<string>): { cover: number; shared: number } {
  let shared = 0; for (const term of own) if (source.has(term)) shared++;
  return { cover: shared / Math.max(1, Math.min(own.size, source.size)), shared };
}

/** The names and numbers among a text's pieces: what a translation keeps as it is. */
const anchors = (terms: Set<string>) => new Set([...terms].filter(term => !/\p{Script=Han}/u.test(term) && (term.length >= 3 || /\d/u.test(term))));
/** A strict bar for prose that merely shares a topic, and a looser one used only when the strict bar finds nothing
 * for a passage that is known to be the source. */
const BARS = { strict: { cover: .4, shared: 4 }, loose: { cover: .25, shared: 3 } } as const;

/** Sentences closest in wording to one or more texts (a conclusion, its quote, the unit it was written from): the best
 * one or two, for text that restates its source in its own words and so has no literal quote or marker to find. */
export function similarSentenceRanges(root: HTMLElement | null, original: string | string[], limit = 2, bar: keyof typeof BARS = "strict", headings = false): Range[] {
  const texts=(Array.isArray(original) ? original : [original]).filter(text => text?.trim());
  const sources = texts.map(meaningTerms).filter(terms => terms.size >= 3);
  if (!root || !sources.length || limit <= 0) return [];
  const required=evidenceConditions(texts[0]),predicate=meaningTerms(evidenceConditionDescription(texts[0]));
  const { cover: minCover, shared: minShared } = BARS[bar], scored: Array<{ range: Range; score: number; block:HTMLElement; start:number; end:number; blocks?:HTMLElement[] }> = [];
  const fragments:Array<{block:HTMLElement;text:string;nodes:Text[]}>=[];
  const scorePassage=(text:string,code=false)=>{
    const own=meaningTerms(text);
    if(own.size<3||!evidenceConditionsMatch(required,text))return 0;
    if(required.length&&!evidenceConditionDescriptionMatches(predicate,own))return 0;
    let score=0;
    for(const source of sources){
      const {cover,shared}=closeness(own,source);
      if(cover>=minCover&&shared>=minShared)score=Math.max(score,cover+shared/100+(code?2*shared/source.size:0));
      else if(bar==="loose"){const names=closeness(anchors(own),anchors(source));if(names.shared>=2&&names.cover>=.5)score=Math.max(score,names.cover/2+names.shared/100);}
    }
    return score;
  };
  // Whole sentences of each paragraph, read across bold, links and code inside it; an original's headings too, where a
  // reply often puts its point ("1. Mem0 擅长记忆召回，但 Atlas 需要管理项目的「现行状态」").
  for (const block of root.querySelectorAll<HTMLElement>(headings ? "p, li, td, th, blockquote, pre, h1, h2, h3, h4, h5, h6" : "p, li, td, th, blockquote, pre")) {
    if (block.querySelector("p, li, td, th, blockquote, pre") || block.closest('button, summary, .wiki-chapter-status, [hidden], [aria-hidden="true"]')) continue;
    const nodes: Text[] = [], starts: number[] = [];
    let text = "";
    const walker = block.ownerDocument.createTreeWalker(block, 4 /* NodeFilter.SHOW_TEXT */);
    for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
      if (node.parentElement?.closest('.wiki-claim-marker, button, svg, [hidden], [aria-hidden="true"]')) continue;
      nodes.push(node); starts.push(text.length); text += node.data;
    }
    if(!nodes.length)continue;
    fragments.push({block,text,nodes});
    const locate = (offset: number): [Text, number] => { let index = starts.length - 1; while (index > 0 && starts[index] > offset) index--; return [nodes[index], Math.min(nodes[index].data.length, offset - starts[index])]; };
    const code=block.tagName==="PRE";
    const passages=code ? (()=>{
      // Numbered instructions and vertical flows are one passage, even when a
      // single line ("设计") is too short to match safely on its own.
      const lines=[...text.matchAll(/[^\r\n]+/gu)].filter(line=>meaningTerms(line[0]).size);
      const windows:Array<{text:string;index:number}>=[];
      for(let first=0;first<lines.length;first++)for(let last=first;last<Math.min(lines.length,first+12);last++){
        const start=lines[first].index,end=lines[last].index+lines[last][0].length;
        if(end-start>2400)break;
        windows.push({text:text.slice(start,end),index:start});
      }
      return windows;
    })() : [...text.matchAll(/(?:[^。！？!?；;\n.]|\.(?!\s))+(?:[。！？!?；;]|\.(?=\s|$))?/gu)].map(match=>({text:match[0],index:match.index}));
    for (const match of passages) {
      const sentence = match.text, score=scorePassage(sentence,code);
      if (!score) continue;
      const lead = sentence.length - sentence.trimStart().length, start=match.index+lead,end=match.index+sentence.trimEnd().length;
      const [startNode, startOffset] = locate(start), [endNode, endOffset] = locate(end);
      const range = block.ownerDocument.createRange(); range.setStart(startNode, startOffset); range.setEnd(endNode, endOffset);
      scored.push({ range, score, block, start, end });
    }
  }
  if(required.length){
    const byBlock=new Map(fragments.map(fragment=>[fragment.block,fragment]));
    for(const first of fragments){
      if(first.block.tagName==="PRE"||!evidenceConditionLabel(first.text))continue;
      const group=[first];let text=first.text,next=first.block.nextElementSibling;
      // Join only adjacent fragments in this message/list item/quote. A new
      // branch, heading, rule or different numeric condition ends the group.
      for(let count=0;next&&count<3;count++){
        const fragment=byBlock.get(next as HTMLElement);if(!fragment||/^(?:H[1-6]|PRE|TD|TH)$/u.test(fragment.block.tagName))break;
        if(/^(?:如果|若|当|假如|假设|否则|反之|(?:if|else)\b)/iu.test(fragment.text.trim()))break;
        const conditions=evidenceConditions(fragment.text);
        if(conditions.length&&!evidenceConditionsMatch(conditions,texts[0]))break;
        if(text.length+fragment.text.length>600)break;
        group.push(fragment);text+="\n"+fragment.text;
        const score=scorePassage(text);
        if(score){
          const range=first.block.ownerDocument.createRange(),last=fragment.nodes.at(-1)!;
          range.setStart(first.nodes[0],0);range.setEnd(last,last.length);
          scored.push({range,score,block:first.block,start:0,end:text.length,blocks:group.map(item=>item.block)});
        }
        next=fragment.block.nextElementSibling;
      }
    }
  }
  const selected:typeof scored=[];
  for(const item of scored.sort((a,b)=>b.score-a.score||(a.end-a.start)-(b.end-b.start))){
    if(selected.some(other=>item.blocks||other.blocks?(item.blocks??[item.block]).some(block=>(other.blocks??[other.block]).includes(block)):other.block===item.block&&other.start<item.end&&item.start<other.end))continue;
    selected.push(item);if(selected.length>=limit)break;
  }
  return selected.map(item=>item.range);
}

/** For a passage known to be the source: the strict match first, then the looser one, so a cited original whose words
 * were reworded or summarised still shows where the conclusion came from. */
export function derivedSentenceRanges(root: HTMLElement | null, texts: Array<string | undefined>, limit = 2): Range[] {
  const wanted = [...new Set(texts.filter((text): text is string => Boolean(text?.trim())))];
  const strict = similarSentenceRanges(root, wanted, limit, "strict", true);
  return strict.length ? strict : similarSentenceRanges(root, wanted, limit, "loose", true);
}

/** Scrolls the nearest scrolling ancestor so the range sits a third of the way down, when it is not already in view. */
export function revealRange(range: Range): void {
  const rect = range.getBoundingClientRect?.();
  let host = range.startContainer.parentElement;
  while (host && !(host.scrollHeight > host.clientHeight && /auto|scroll/u.test(getComputedStyle(host).overflowY))) host = host.parentElement;
  if (!rect || !host || !rect.height) return;
  const view = host.getBoundingClientRect();
  if (rect.top >= view.top + 60 && rect.bottom <= view.bottom - 40) return;
  host.scrollBy?.({ top: rect.top - view.top - view.height / 3, behavior: "smooth" });
}

type HighlightRegistry = { set(name: string, value: unknown): void; delete(name: string): void };
export function paintClaimHighlights(root: HTMLElement | null, keys: string[], phrasesOf: (key: string) => string[] = () => [], extra: Range[] = []): Range[] {
  if (!root) return [];
  root.querySelectorAll("[data-claim-highlighted]").forEach(node => node.removeAttribute("data-claim-highlighted"));
  const markers = keys.flatMap(key => { const marker = root.querySelector<HTMLElement>(`[data-claim-key=${JSON.stringify(key)}]`); return marker ? [marker] : []; });
  markers.forEach(marker => marker.setAttribute("data-claim-highlighted", "true"));
  const placed = new Set(markers.map(marker => marker.dataset.claimKey));
  const ranges = [...markers.flatMap(marker => {
    const phrases = phrasesOf(marker.dataset.claimKey!);
    const block = marker.closest<HTMLElement>("p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6") ?? marker.parentElement;
    // The marker can follow an entire compound sentence. Its last semicolon
    // clause is not necessarily the claim linked to the selected original.
    const range = phrases.length ? block ? phraseRange(block, phrases, marker) : undefined : claimRange(marker);
    return range ? [range] : [];
  }), ...keys.filter(key => !placed.has(key)).flatMap(key => { const range = phraseRange(root, phrasesOf(key)); return range ? [range] : []; }), ...extra];
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights, Paint = (globalThis as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;
  if (registry && Paint) { if (ranges.length) registry.set(NAME, new Paint(...ranges)); else registry.delete(NAME); }
  return ranges;
}

const HOLDERS = ["decided", "open", "earlier", "user", "material"] as const;
/** With holder marks shown, the text each mark covers (back to the previous mark in its paragraph) is tinted in the
 * mark's colour, so whose a sentence is reads at a glance instead of by finding its mark. Painted under the claim
 * highlight of evidence checking; cleared when the marks are hidden. Returns how many runs were tinted. */
export function paintHolderRuns(root: HTMLElement | null, shown: boolean): number {
  const registry = (globalThis as { CSS?: { highlights?: HighlightRegistry } }).CSS?.highlights, Paint = (globalThis as { Highlight?: new (...ranges: Range[]) => { priority?: number } }).Highlight;
  if (!registry || !Paint) return 0;
  for (const holder of HOLDERS) registry.delete(`atlas-holder-${holder}`);
  if (!root || !shown) return 0;
  const runs = new Map<string, Range[]>(HOLDERS.map(holder => [holder, []]));
  for (const block of root.querySelectorAll<HTMLElement>("p, li")) {
    const markers = [...block.querySelectorAll<HTMLElement>("button.wiki-claim-marker.is-holder")].filter(marker => marker.closest("p, li") === block);
    let start: { node: Node; offset: number } = { node: block, offset: 0 };
    for (const marker of markers) {
      const holder = HOLDERS.find(name => marker.classList.contains(`is-holder-${name}`));
      const range = block.ownerDocument.createRange();
      range.setStart(start.node, start.offset); range.setEndBefore(marker);
      if (holder && range.toString().trim()) runs.get(holder)!.push(range);
      start = { node: marker.parentNode!, offset: [...marker.parentNode!.childNodes].indexOf(marker) + 1 };
    }
  }
  let count = 0;
  for (const [holder, ranges] of runs) if (ranges.length) { const paint = new Paint(...ranges); paint.priority = -1; registry.set(`atlas-holder-${holder}`, paint); count += ranges.length; }
  return count;
}
