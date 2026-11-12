import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent} from "mdast";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
// "AI建议" is the actor label for proposals only. Before an act that is not a
// proposal ("AI建议发现了…", "AI建议对…进行了评估") it reads as broken Chinese.
const NOT_PROPOSAL=/AI\s*建议(?=(?:\*\*|__)?(?:发现|指出|认为|评估|起草|强调|分析|解释|警告|筛选|提出|对[^。！？\n]{0,60}(?:进行了|进行|做了)))/gu;
/** Restore a plain actor ("AI发现了", "AI提出了…") where "AI建议" precedes a non-proposal act. */
function actorVerbs(text:string,quoted:(at:number)=>boolean):string{
 return text
  .replace(/AI\s*建议了/gu,(match,at:number)=>quoted(at)?match:"AI提出了")
  .replace(NOT_PROPOSAL,(match,at:number)=>quoted(at)?match:"AI");
}
/** Generated narration only. Stored originals, quotations and code are not renamed. */
export function aiAdvicePresentation(body:string,originalTexts:string[]=[]):string{
 if(!/助手|AI\s*建议/u.test(body))return body;
 const quotations=[...body.matchAll(/“[^”]*”|「[^」]*」|『[^』]*』|"(?:[^"\\]|\\.)*"/gu)].map(match=>({start:match.index!,end:match.index!+match[0].length}));
 const changes:Array<{start:number;end:number;text:string}>=[];
 const visit=(node:RootContent)=>{
  if(["blockquote","code","inlineCode","html","link","image"].includes(node.type))return;
  if(node.type==="paragraph"&&originalTexts.some(text=>text.includes(body.slice(node.position!.start.offset!,node.position!.end.offset!))))return;
  if(node.type==="text"&&node.position){
   const start=node.position.start.offset!,end=node.position.end.offset!,raw=body.slice(start,end);
   const text=raw.replace(/(?:AI\s*|人工智能)?助手[ \t]*|AI[ \t]+(?=(?:\*\*|__)?建议|$)/gu,(match,offset:number)=>{
    const at=start+offset;if(quotations.some(range=>at>=range.start&&at<range.end))return match;
    // A product called 智能助手/客服助手 is not a narrator role.
    if(match.trim()==="助手"&&/(?:智能|客服|语音|编程|代码|学习|教学|小)$/u.test(body.slice(0,at)))return match;
    // So is a product named with a dash ("克己-戒色助手", which read 克己-戒色AI), or a bold item label ending in 助手.
    if(match.trim()==="助手"&&(/[-－—·][\p{L}\p{N}]{0,8}$/u.test(body.slice(0,at))||/\*\*[^*\n]{1,20}$/u.test(body.slice(0,at))&&body.slice(at+match.length).startsWith("**")))return match;
    const following=body.slice(at+match.length,at+match.length+30).replace(/^(?:\s|\*|_)+/u,"");
    return /^(?:(?:的)?(?:建议|方案|分析)|[：:]|推荐|认为|提出|解释|说明|指出|强调|回答|回复|补充|总结|给出|表示|提到|将其|据此|随后|进一步|把|对|在|曾|明确|提醒|评估|承认|修正|确认|基于|不建议|也|还|则|最终|后来|搜集|收集|举例|审阅|审查|支持|同时|反对|列出|比较|对比|分析了|生成了|评价|澄清|研究|的明确)/u.test(following)?"AI":match;
   });
   const actor=actorVerbs(text,at=>quotations.some(range=>start+at>=range.start&&start+at<range.end));
   if(actor!==raw)changes.push({start,end,text:actor});
  }else if("children" in node)for(const child of node.children)visit(child as RootContent);
 };
 for(const node of parser.parse(body).children)visit(node);
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
 return body;
}
