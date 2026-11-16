/** Keep real headings stable in navigation and exports, irrespective of section length. */
export function wikiReadingLayout(body:string,_originalTexts:string[]=[]):string {
 void _originalTexts; // Retained for callers supplying source text; heading structure no longer depends on it.
 return openNotesLayout(body);
}

/** One side of an open note, labelled by who holds it: 「你提议……」 is the user's, 「AI 建议……」 the assistant's. */
const noteSide=(text:string)=>{
 const side=text.trim().replace(/[。.]$/u,"");
 const mine=side.match(/^你(?:提议|提出|希望|认为)[：:，,]?\s*(.+)$/u);
 if(mine)return `**你的提议**：${mine[1]}`;
 const theirs=side.match(/^AI\s*(?:的)?建议(?!见)[：:，,]?\s*(.+)$/u);
 return theirs?`**AI 的建议**：${theirs[1]}`:side;
};

/** Reading/export only: a 「版本未定」 or 「范围有分歧」 note is one generated line, its topic and each version run
 * together (「首页中央按钮的用法：你提议……；AI 建议……（另有 2 条类似建议）。」) and read as one block of text. Its label
 * and topic become the note's title and each version a line of its own, labelled by who holds it. The saved line is
 * left as written: the checks and the export's overview read it there. */
export function openNotesLayout(body:string):string {
 return body.replace(/^> (版本未定|范围有分歧)[：:](.+)$/gmu,(_line,label:string,rest:string)=>{
  const colon=rest.search(/[：:]/u),topic=colon>0&&colon<=24?rest.slice(0,colon).trim():"";
  const sides=(topic?rest.slice(colon+1):rest).split("；").map(side=>side.trim()).filter(Boolean);
  if(sides.length<2)return `> **${label}**：${rest.trim()}`;
  return [`> **${label}${topic?` · ${topic}`:""}**`,">",...sides.map(side=>`> - ${noteSide(side)}`)].join("\n");
 });
}
