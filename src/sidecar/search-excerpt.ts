/** The whole query, then its words of two or more characters, longest first, as one case-insensitive pattern. */
export function queryPattern(query:string):RegExp|undefined{
  const terms=[...new Set([query.trim(),...query.split(/[\s,，、。；;:：!?！？]+/u)])].filter(term=>Array.from(term).length>=2).sort((a,b)=>b.length-a.length);
  return terms.length?new RegExp(`(${terms.map(term=>term.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&")).join("|")})`,"giu"):undefined;
}

/** A conversation's other matches show two narrow lines: the excerpt opens 50 characters before its match, which
 *  there left the searched words out of sight, so it opens a few characters before them instead. */
export function nearMatch(text:string,query:string,lead=12,length=90):string{
  const plain=text.replace(/^…/u,""),pattern=queryPattern(query);
  const found=pattern?plain.search(new RegExp(pattern.source,"iu")):-1;
  const start=found>lead?found-lead:0,clipped=start>0||text.startsWith("…");
  const body=plain.slice(start,start+length);
  return `${clipped?"…":""}${body}${plain.length>start+length&&!body.endsWith("…")?"…":""}`;
}
