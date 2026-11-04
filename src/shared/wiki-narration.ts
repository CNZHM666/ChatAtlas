import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent} from "mdast";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
const QUOTED=/“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"/gu;
// "本批材料未提供……" reports what one writing batch lacked; other paragraphs may supply it.
const BATCH_NOTE=/(^|[。！？；]\s*)(?:本批|这批|该批|本组|这一批)材料[^。！？]*[。！？]?/gu;
const RULES:Array<[RegExp,string]>=[
 // "据讨论，…（未核实）" is the completion qualifier and stays; a bare lead-in only names the material.
 [/(^|[。！？；]\s*)据讨论[，,]\s*(?![^。！？]*（未核实）)/gu,"$1"],
 [/(^|[。！？；]\s*)(?:本次|当前)?材料(?:显示|表明|记录)[，,]\s*/gu,"$1"],
 // Mid-sentence too ("架构图生成方面，材料指出……", "后续材料指出……"); "材料未显示" stays a status phrase.
 [/(^|[。！？；，,：:]\s*|后续|此前|相关)(?:本次|当前)?材料(中)?(?=同时|明确|指出|提醒|强调|建议|还|也|记录了|未提供|未包含|提到|提出|推荐|将|给出|认为)/gu,"$1讨论$2"],
 // A reader of the saved document cannot place "本次"; the discussion's own moment is "当时".
 [/(^|[。！？；，]\s*)本次(?:是|为)/gu,"$1当时的任务是"],
 [/(^|[。！？；，]\s*)本次/gu,"$1当时"],
];

/** Generated narration that names the material ("据讨论，", "本次材料显示，")
 * instead of the knowledge. Quotations, code, links, blockquotes, tables and
 * headings are unchanged. */
export function wikiNarration(body:string):string {
 if(!/据讨论|材料|本次/u.test(body))return body;
 const changes:Array<{start:number;end:number;text:string}>=[];
 const visit=(node:RootContent)=>{
  if(["blockquote","code","inlineCode","html","link","image","heading","table"].includes(node.type))return;
  if(node.type==="text"&&node.position){
   const start=node.position.start.offset!,end=node.position.end.offset!,raw=body.slice(start,end);
   let text=raw.replace(BATCH_NOTE,"$1");
   for(const [pattern,replacement] of RULES){
    const quoted=[...text.matchAll(QUOTED)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
    text=text.replace(pattern,(match:string,...args:unknown[])=>{
     const at=args.at(-2) as number,groups=args.slice(0,-2) as Array<string|undefined>;
     return quoted.some(range=>at>=range.start&&at<range.end)?match:replacement.replace(/\$(\d)/gu,(_,index:string)=>groups[Number(index)-1]??"");
    });
   }
   if(text!==raw)changes.push({start,end,text});
  }else if("children" in node)for(const child of node.children)visit(child as RootContent);
 };
 for(const node of parser.parse(body).children)visit(node);
 if(!changes.length)return body;
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
 // A paragraph that was only a batch note leaves no blank run behind.
 return body.replace(/\n{3,}/gu,"\n\n");
}
