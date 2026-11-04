import { sourceQuoteProjection, sourceQuoteText } from "../shared/source-quote-text";
import type { EvidenceHighlight } from "../shared/original-evidence-highlights";

/** Build the rendered-text map once per message, without rewriting React nodes. */
export function evidenceTextLocator(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const positions: Array<{node:Text;start:number;end:number}>=[];
  let text="";
  while(walker.nextNode()){
    const node=walker.currentNode as Text;
    if(node.parentElement?.closest('button,style,script,template,[hidden],.katex-mathml,[aria-hidden="true"]'))continue;
    let offset=0;
    for(const char of node.data){
      const normalized=char.normalize("NFKC");
      for(const part of normalized){if(!/\s/u.test(part)){text+=part;for(let i=0;i<part.length;i++)positions.push({node,start:offset,end:offset+char.length});}}
      offset+=char.length;
    }
  }
  const at = (start:number,end:number):Range|undefined => {
    const first=positions[start],last=positions[end-1];if(!first||!last||end<=start)return;
    const range=document.createRange();range.setStart(first.node,first.start);range.setEnd(last.node,last.end);return range;
  };
  const locate = (quote: string, occurrence = 0): Range | undefined => {
  if (!quote.trim()) return;
  const unclosed=quote.replace(/^(?:\*\*|__)(?!\s)|(?:\*\*|__)$/gu, "");
  for(const value of [quote,sourceQuoteText(quote),...(unclosed!==quote?[sourceQuoteText(unclosed)]:[])]){
    const needle=value.normalize("NFKC").replace(/\s/gu,"");if(!needle)continue;
    let start=text.indexOf(needle);
    for(let index=0;index<occurrence&&start>=0;index++)start=text.indexOf(needle,start+needle.length);
    if(start<0)continue;
    return at(start,start+needle.length);
  }
  };
  return Object.assign(locate,{text,at});
}

export function evidenceTextRange(root: HTMLElement, quote: string, occurrence = 0): Range | undefined {
  return evidenceTextLocator(root)(quote, occurrence);
}

export function evidenceTextRanges(root: HTMLElement, quotes: string[]): Range[] {
  if (!quotes.length) return [];
  const locate = evidenceTextLocator(root);
  return quotes.flatMap(quote => { const range = locate(quote); return range ? [range] : []; });
}

/** Locate only inside the source block owning these offsets. Refuse an ambiguous
 * rendering rather than silently painting an earlier, identical sentence. */
export function evidenceSourceRanges(root:HTMLElement,content:string,highlights:EvidenceHighlight[]):Array<{range:Range;highlight:EvidenceHighlight}>{
  const normalize=(text:string)=>text.normalize("NFKC").replace(/\s/gu,"");
  const blocks=[...root.querySelectorAll<HTMLElement>("[data-reader-source-start][data-reader-source-end]")].map(element=>({element,start:Number(element.dataset.readerSourceStart),end:Number(element.dataset.readerSourceEnd)})).filter(block=>Number.isInteger(block.start)&&Number.isInteger(block.end)&&block.start>=0&&block.end<=content.length&&block.start<block.end);
  const fullProjection=sourceQuoteProjection(content);
  const result:Array<{range:Range;highlight:EvidenceHighlight}>=[];
  for(const highlight of highlights){
    if(highlight.start<0||highlight.end>content.length||highlight.end<=highlight.start)continue;
    const cuts=[...new Set([highlight.start,highlight.end,...blocks.flatMap(block=>[block.start,block.end]).filter(at=>at>highlight.start&&at<highlight.end)])].sort((a,b)=>a-b);
    for(let i=0;i<cuts.length-1;i++){
      const start=cuts[i],end=cuts[i+1];
      const block=blocks.filter(block=>block.start<=start&&end<=block.end).sort((a,b)=>(a.end-a.start)-(b.end-b.start))[0];
      // A gap between annotated blocks is whitespace or unsupported markup.
      if(!block&&blocks.length)continue;
      const element=block?.element??root,base=block?.start??0,limit=block?.end??content.length;
      const locate=evidenceTextLocator(element),dom=locate.text;
      const raw=content.slice(base,limit),literal=!block&&dom===normalize(raw);
      if(literal){
        const from=normalize(raw.slice(0,start-base)).length,to=normalize(raw.slice(0,end-base)).length;
        const range=locate.at(from,to);if(range)result.push({range,highlight});continue;
      }
      // Use the message AST first: a nested code block's raw slice may omit its
      // first quote/list prefix while later lines still contain those prefixes.
      const projection=fullProjection??sourceQuoteProjection(raw),offset=fullProjection?0:base;
      if(!projection)continue;
      const blockFrom=projection.ends.findIndex(at=>at>base-offset);if(blockFrom<0)continue;
      let blockTo=blockFrom;while(blockTo<projection.starts.length&&projection.starts[blockTo]<limit-offset)blockTo++;
      if(projection.text.slice(blockFrom,blockTo)!==dom)continue;
      const from=projection.ends.findIndex(at=>at>start-offset);
      if(from<0)continue;
      let to=from;while(to<projection.starts.length&&projection.starts[to]<end-offset)to++;
      const range=locate.at(from-blockFrom,to-blockFrom);if(range)result.push({range,highlight});
    }
  }
  return result;
}
