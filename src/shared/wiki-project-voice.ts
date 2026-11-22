import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {RootContent} from "mdast";
const parser=unified().use(remarkParse).use(remarkGfm);
export function wikiProjectDecisionVoice(text:string) {
 return text.replace(/我(?:想|希望)(?:让|由)用户自己(?:接入?|配置|提供)\s*API(?:\s*Key|密钥)?[，,]\s*我(?:不想|不希望)(?:让)?(?:别人|其他用户)(?:用|使用)我自己的(?:\s*API(?:\s*Key|密钥)?|密钥)?(?=[。.!！\s]|$)/giu,
  "项目发起人希望用户自行接入 API，避免共用其个人密钥");
}
/** Only generated project narration. Literal UI copy, quotations and authored
 * chapters keep their voice; product users are never globally renamed. */
export function wikiProjectVoice(body:string):string{
 const edits:Array<{start:number;end:number;text:string}>=[];
 const visit=(node:RootContent)=>{
  if(["code","inlineCode","blockquote","html","link","image"].includes(node.type))return;
  if(node.type==="text"&&node.position){
   const start=node.position.start.offset!,end=node.position.end.offset!,raw=body.slice(start,end);
   const text=raw.split(/(“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*")/gu).map((part,index)=>index%2?part:wikiProjectDecisionVoice(part)
    .replace(/〔你(?=〕| ·)/gu,"〔发起人")
    .replace(/你(?=曾?(?:认为|担心|提议|提出|计划|希望|否定|要求|确认|报告|决定|提供|写的|的看法))/gu,"项目发起人")
    .replace(/用户认为(?=[^。\n]*。\s*〔(?:你|发起人)〕)/gu,"项目发起人认为")
    .replace(/你(?=(?:还|在回答中|也)?(?:提到|否定|确认|提供))/gu,"项目发起人")
    .replace(/你的\s*AI(?=\s*$|[，。；：:])/gu,"项目中的 AI")
    .replace(/用户在整理时确认/gu,"发起人在整理时确认")).join("");
   if(text!==raw)edits.push({start,end,text});
  }else if("children" in node)for(const child of node.children)visit(child as RootContent);
 };
 for(const node of parser.parse(body).children)visit(node);
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return body;
}
