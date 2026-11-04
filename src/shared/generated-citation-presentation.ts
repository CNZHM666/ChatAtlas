import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent} from "mdast";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);

/** Conservative generated-prose projection. Empty brackets at the end of a
 * Chinese assertion are citation debris; arrays, examples and literals are
 * not. No global bracket replacement, source mutation or invented citation. */
export function generatedCitationPresentation(body:string,originalTexts:string[]=[]):string {
 if(!/\[\s*\]/u.test(body))return body;
 const changes:Array<{start:number;end:number}>=[];
 const visit=(node:RootContent)=>{
  if(node.type==="paragraph"){
   const raw=body.slice(node.position!.start.offset!,node.position!.end.offset!);
   if(originalTexts.some(original=>original.includes(raw))||(raw.match(/\p{Script=Han}/gu)?.length??0)<12
    ||/数组|列表|集合|返回值|字面|语法|符号|括号|占位|\b(?:array|literal|syntax|brackets?|placeholder)\b|\$/iu.test(raw))return;
   const inline=(child:RootContent)=>{
    if(child.type==="text"){
     const start=child.position!.start.offset!,end=child.position!.end.offset!;
     // Escaped brackets stay literal. Offsets always refer to original Markdown.
     if(body.slice(start,end)!==child.value)return;
     for(const match of child.value.matchAll(/(?:\[\s*\])+(?=[。！？；，、.!?,;:]|$)/gu)){
      const offset=match.index!,previous=body[start+offset-1]??"";
      if(!/[\p{Script=Han}。！？）)」”’*]/u.test(previous))continue;
      changes.push({start:start+offset,end:start+offset+match[0].length});
     }
    }else if(child.type==="strong"||child.type==="emphasis")for(const item of child.children)inline(item as RootContent);
   };
   for(const child of node.children)inline(child as RootContent);
   return;
  }
  if(node.type==="list"||node.type==="listItem")for(const child of node.children)visit(child as RootContent);
 };
 for(const node of parser.parse(body).children)visit(node);
 for(const change of changes.reverse())body=body.slice(0,change.start)+body.slice(change.end);
 return body;
}
