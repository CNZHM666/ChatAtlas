const FENCE=/(^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[^\n]*$)/mu;
const BLOCK=/^[ \t]*(\\\[|\$\$)[ \t]*\n([\s\S]*?)\n[ \t]*(\\\]|\$\$)[ \t]*$/gmu;

/** A display formula written over several lines ("\[", "\text{价值}", "=", "\text{相关性}",
 * "\]") reads as a heading in Markdown: the lone "=" line underlines the line above it,
 * and the blank lines inside it split the formula into paragraphs. Generated prose keeps
 * the formula on one line between "$$" lines, which math rendering shows as a block and
 * plain Markdown leaves as a paragraph. Code blocks are unchanged. */
export function wikiDisplayMath(body:string):string {
 if(!/\\\[|\$\$/u.test(body))return body;
 return body.split(FENCE).map((part,index)=>index%2?part:part.replace(BLOCK,(match,open:string,inner:string,close:string)=>{
  if((open==="$$")!==(close==="$$"))return match;
  const formula=inner.split("\n").map(line=>line.trim()).filter(Boolean).join(" ");
  return formula?`$$\n${formula}\n$$`:match;
 })).join("");
}
