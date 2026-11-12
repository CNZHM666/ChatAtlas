import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);

/** Reading/export only: a small generated leaf need not become another table
 * of contents entry. Preserve order, wording, substantive branches, examples,
 * original headings and all saved bodies/claim bindings. */
export function wikiReadingLayout(body:string,originalTexts:string[]=[]):string {
 const nodes=parser.parse(body).children,changes:Array<{start:number;end:number;text:string}>=[];
 let parent=false;
 for(const [index,node] of nodes.entries()){
  if(node.type!=="heading")continue;
  if(node.depth<=2){parent=node.depth===2;continue;}
  if(node.depth!==3||!parent)continue;
  const next=nodes.findIndex((child,at)=>at>index&&child.type==="heading");
  if(next>=0&&nodes[next].type==="heading"&&nodes[next].depth>node.depth)continue;
  const content=nodes.slice(index+1,next<0?undefined:next);
  if(!content.length||content.length>2||content.some(child=>child.type!=="paragraph"||child.children.every(inline=>inline.type==="strong"||inline.type==="text"&&!inline.value.trim())))continue;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,raw=body.slice(start,end);
  const size=content.reduce((sum,child)=>sum+child.position!.end.offset!-child.position!.start.offset!,0);
  if(size>420||originalTexts.some(original=>original.includes(raw)))continue;
  const label=body.slice(node.children[0].position!.start.offset!,node.children.at(-1)!.position!.end.offset!);
  changes.push({start,end,text:`**${label}**`});
 }
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
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
