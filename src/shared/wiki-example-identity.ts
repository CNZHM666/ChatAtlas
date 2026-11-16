import { knowledgeStage } from "./knowledge-subject";

/** Presentation equivalence only. Payloads are never rewritten. Indentation is
 * significant for executable languages unless token boundaries prove otherwise. */
export function wikiExampleKey(code:{language:string;text:string}):string {
 const language=code.language.toLowerCase().replace(/^typescript$/u,"ts").replace(/^javascript$/u,"js");
 const text=code.text.replace(/\r\n/gu,"\n").trimEnd();
 if(/^(?:ts|js|tsx|jsx|json)$/u.test(language)){
  // Strings, templates, comments and operators keep their complete spelling.
  // Token arrays distinguish `a b` from `ab`, and `+ +` from `++`.
  const tokens=text.match(/"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`|\/\*[\s\S]*?\*\/|\/\/[^\n]*|[\p{L}\p{N}_$]+|===|!==|>>>|=>|==|!=|<=|>=|\+\+|--|&&|\|\||\?\?|\?\.|\*\*|<<|>>|[^\s]/gu)??[];
  // A slash may begin a regular expression; whitespace inside its pattern is
  // meaningful. Conservatively require exact text for these programs.
  if(!tokens.some(token=>/^["'`]$/u.test(token)||token==="/")) {
   // JavaScript line breaks can affect automatic semicolon insertion.
   return JSON.stringify([language,tokens,language==="json"?undefined:tokenBreaks(text,tokens)]);
  }
 }
 if(/^(?:text|txt|plain|plaintext)?$/u.test(language)){
  const lines=text.split("\n"),levels=[...new Set(lines.filter(line=>line.trim()).map(line=>line.match(/^[ \t]*/u)![0].replace(/\t/gu,"    ").length))].sort((a,b)=>a-b);
  // Keep relative nesting and quoted content. Retain the first complete
  // original as the representative when only display spacing differs.
  const content=(line:string)=>line.trim().split(/("(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|`(?:\\[\s\S]|[^`\\])*`)/u).map((part,index)=>index%2?part:part.replace(/(?<=[A-Za-z0-9_$])[ \t]+(?=[A-Za-z0-9_$])/gu,"\u0000").replace(/[ \t]+/gu,"").replaceAll("\u0000"," ")).join("");
  return JSON.stringify(["text",lines.filter(line=>line.trim()).map(line=>`${levels.indexOf(line.match(/^[ \t]*/u)![0].replace(/\t/gu,"    ").length)}:${content(line)}`)]);
 }
 return JSON.stringify([language,text]);
}

function tokenBreaks(text:string,tokens:string[]):boolean[] {
 let offset=0;
 return tokens.map(token=>{
  const at=text.indexOf(token,offset);
  const startsNewLine=offset>0&&text.slice(offset,at).includes("\n");
  offset=at+token.length;
  return startsNewLine;
 });
}

const laterDecision=/(?:；你随后的决定优先：|; your later decision takes precedence: | · 以你后来的决定为准：| · your later decision holds: ).*$/isu;

export function wikiExampleStage(...labels:string[]):string {
 return labels.map(label=>knowledgeStage(label.replace(laterDecision,""))).find(Boolean)??"";
}

export function wikiExampleStanding(label:string):string {
 const caption=label.replace(laterDecision,"");
 if(/已被替换|已替换|superseded|since replaced/iu.test(caption))return "history";
 if(/(?:项目发起人|发起人|你)确认|confirmed by you/iu.test(caption))return "confirmed";
 if(/(?:项目发起人|发起人|你)提供|provided by you/iu.test(caption))return "material";
 return "discussion";
}

export function wikiExampleDisplayKey(code:{language:string;text:string},stage:string,standing:string):string {
 return JSON.stringify([wikiExampleKey(code),stage,standing]);
}
