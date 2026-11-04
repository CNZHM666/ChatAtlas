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
 return body;
}
