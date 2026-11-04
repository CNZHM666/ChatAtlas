/** Conservative export-only redundancy detection. Shared evidence alone is not
 * equivalence: differing numbers, negation, versions or unique clauses survive. */
const plain=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/^### [^\n]+\n\n/u,"").replace(/[\s*`，,。；;：:！!？?（）()、]/gu,"");
const conditions=(text:string)=>text.split(/[。；;！!？?\n]/u).filter(clause=>/\d|不|未|无|没|非|仅|只|必须|禁止|→|->|\b(?:not|never|only|must)\b/iu.test(clause)).map(plain).sort().join("|");
// Normalize a few editorial frames, not substantive entity/action order. High
// lexical overlap by itself is unsafe (A reads B and B reads A may look alike).
const substance=(text:string)=>plain(text).replace(/这款工具|这个工具|本项目|该项目|主要|核心|(?:目标|目的)(?:是|为)/gu,"");
export function equivalentContextText(a:string,b:string){
 if(plain(a)===plain(b))return true;
 if(/```|~~~/u.test(a+b)||conditions(a)!==conditions(b))return false;
 const shingles=(text:string)=>{const value=plain(text);return new Set(Array.from({length:Math.max(0,value.length-2)},(_,index)=>value.slice(index,index+3)));};
 const left=shingles(a),right=shingles(b);if(Math.min(left.size,right.size)<12)return false;
 const common=[...left].filter(item=>right.has(item)).length;
 // Bidirectional coverage prevents a shorter summary from swallowing details.
 return common/left.size>=.82&&common/right.size>=.82&&substance(a)===substance(b);
}
