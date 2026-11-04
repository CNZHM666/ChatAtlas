import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent,TableCell} from "mdast";
import type {WikiClaim} from "./wiki-claims";
import {factTextKey} from "./project-fact-state";
import {sourceQuoteText} from "./source-quote-text";
import {generatedCitationPresentation} from "./generated-citation-presentation";
import {aiAdvicePresentation} from "./ai-advice-presentation";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
const value=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>value(child as RootContent)).join(""):"";
const completion=/(?:已(?:经)?(?:全部|正式|基本)?(?:实现|完成|通过|发布|上线|接入|定型)|完成了|实现了|建立了|现(?:已)?拆分为|(?:Milestone\s*\d+|M\d+)\s*的完成|\b(?:implemented|completed|tests? passed|released|established|shipped)\b)/iu;
// A clause that negates, requires, contrasts ("计划完成 ≠ 实际完成") or discusses completion
// as a category does not assert delivery, so it keeps its own wording without the unconfirmed wrapper.
const qualified=/≠|!=|建议|计划|应当|必须|需要|验收|目标|尚未|未完成|待完成|假如|如果|示例|此前(?:的阶段)?记录|原记录|尚待统一|完成情况.{0,5}(?:未知|未确认)|没有|未能|未被|未经|并未|并非|不是|不等于|不代表|不能|不要|不得|不应|无法|尚无|未显示|未提供|缺少|缺乏|要求|禁止|避免|确保|是否|能否|区分|分清|标注|标记|声称|宣称|冒充|假装|模拟|\b(?:propos|suggest|plan|must|should|if|example|unconfirmed|earlier record)|\b(?:not|never|without|whether|avoid|require[sd]?|distinguish|claim(?:s|ed)?|pretend(?:s|ed)?)\b/iu;
type Reading=(claim:WikiClaim,formulation?:string)=>{reported:boolean;text?:string}|undefined;
/** A completion claim the sources only report. Short qualifiers instead of quoting the whole sentence. */
export const UNVERIFIED=/(?:（未核实）|\(unverified\))[。.!]?$/u;
// "用户确认 M2 已完成" already names who said it; "据讨论，" in front would only repeat that.
const ATTRIBUTED=/^(?:用户(?:报告|指出|表示|反馈|称|提到|说明|确认|展示|告知|声称|认为|回复|补充|演示)|讨论(?:记录|中)?(?:称|提及|显示)|(?:当前|本次)?材料(?:中|显示|记录|提到)|据|According to|The user (?:reported|said|noted|confirmed|showed|stated)|Reportedly)/iu;
// Citation markers left over from the previous sentence stay where they were.
const LEADING_CITATIONS=/^(?:\s*(?:<\/?e\d+(?::\d+)?>|\[\^?e\d+(?::\d+)?\]|【e\d+(?::\d+)?】))+\s*/iu;
function unverifiedCompletion(sentence:string,zh:boolean):string {
 const text=sentence.trim(),markers=text.match(LEADING_CITATIONS)?.[0]??"";
 const core=text.slice(markers.length).trim().replace(zh?/[。.!]+$/u:/[.!]+$/u,"");
 const attributed=ATTRIBUTED.test(core);
 if(zh)return `${markers.trim()}${attributed?"":"据讨论，"}${core}（未核实）。`;
 return `${markers.trim()}${markers?" ":""}${attributed?core:`According to the discussion, ${/^[A-Z][a-z]/u.test(core)?core[0].toLowerCase()+core.slice(1):core}`} (unverified).`;
}
const proseKey=(text:string)=>factTextKey(sourceQuoteText(generatedCitationPresentation(text)));
export function wikiClaimFormulation(claim:WikiClaim,text:string){return [claim.text,...claim.formulations??[]].some(form=>proseKey(form)===proseKey(text));}

function withoutRatings(text:string){
 return text
  .replace(/(?:最终)?(?:评估|评价)?(?:UI|界面|产品|版本)?(?:成熟度|美观度|完成度|综合评分|主观评分)(?:评估|评价|评分|得分)?(?:约|大约|达到|达|为|是|：|:)?\s*\d+(?:\.\d+)?\s*\/\s*10\s*分?[，,。.!]?\s*/giu,"")
  .replace(/(?:subjective|UI maturity|design maturity)\s*(?:rating|score)?\s*(?:of|:|is)?\s*\d+(?:\.\d+)?\s*\/\s*10[,.]?\s*/giu,"");
}
function subjectiveSentence(text:string){
 if(/测试|通过率|正确率|阈值|验收|\b(?:test|pass rate|threshold)\b/iu.test(text))return false;
 return /(?:界面|视觉|产品|版本|UI|美观|成熟度).{0,70}(?:评分|评估|得分|成熟度).{0,18}\d+(?:\.\d+)?\s*\/\s*10/iu.test(text);
}

/** Local presentation, never a repository audit or a rewrite of authored text.
 * Original quotations, fenced/inline code and actual test metrics are retained. */
export function knowledgeBodyPresentation(body:string,claims:WikiClaim[]=[],zh=true,reading?:Reading):string {
 const changes:Array<{start:number;end:number;text:string}>=[];
 // A document whose claims carry holder marks says status once, in the mark: no "据讨论，…（未核实）" or "用户报告："
 // around a sentence ("……已完成事项及决策变化是技术难度最高的部分" was wrapped for naming completion as a topic).
 const marked=claims.some(claim=>claim.holder);
 const cellMarkdown=(cell:TableCell)=>cell.children.length?body.slice(cell.children[0].position!.start.offset!,cell.children.at(-1)!.position!.end.offset!).trim():"";
 const transform=(raw:string,table=false,rowText?:string)=>{
  if(marked)return withoutRatings(raw);
  const complete=claims.find(claim=>wikiClaimFormulation(claim,raw));
  const whole=complete&&reading?.(complete,raw);
  if(whole?.text)return whole.text;
  const literals:string[]=[];
  let output=raw.replace(/(`+)[^\n]*?\1|\$[^$\n]+\$/gu,match=>{literals.push(match);return `\uE000LITERAL${literals.length-1}\uE001`;});
  output=output.split(/(?<=[。！？!?])\s*|(?<=\.)\s+(?=[A-Z])/u).map(sentence=>{
   const text=sentence.trim();if(!text)return "";
   const readable=text.replace(/\uE000LITERAL(\d+)\uE001/gu,(_,index)=>literals[Number(index)]);
   const unprefixed=readable.replace(/^(?:用户报告|User reported)[：:]\s*/iu, "");
   const claim=claims.find(claim=>wikiClaimFormulation(claim,unprefixed)||Boolean(rowText&&wikiClaimFormulation(claim,rowText)));
   const source=claim&&reading?.(claim,readable);
   if(source?.text)return source.text;
   if(source?.reported)return /用户(?:报告|反馈)|\buser reported/iu.test(readable)?sentence:(zh?"用户报告：":"User reported: ")+sentence;
   if(subjectiveSentence(text)){
    const score=text.match(/\d+(?:\.\d+)?\s*\/\s*10\s*分?[，,。.!]?\s*/u);
    const tail=score?text.slice(score.index!+score[0].length):"";
    return /^(?:建议|计划|应当|recommend|plan)/iu.test(tail)?tail:"";
   }
   // "AI建议并已实施" contradicts itself; the delivery half is only reported.
   const clean=withoutRatings(sentence).replace(/((?:AI\s?)?建议)并(?:且)?已(实施|实现|采用|落地|完成)/gu,"$1并据称已$2");
   if(!clean.trim())return "";
   if(UNVERIFIED.test(clean.trim())||/^讨论记录提及“[\s\S]*”，完成情况尚未确认[。.!]?$/u.test(clean)||/^The discussion describes “[\s\S]*”; completion is unconfirmed\.$/u.test(clean))return clean;
   // Completion words inside a quotation (an example message, a product's slogan) are not a delivery claim.
   const unquoted=clean.replace(/“[^”]*”|「[^」]*」|"[^"\n]*"/gu,"");
   if(!completion.test(unquoted)||unquoted.split(/[，,；;]/u).filter(clause=>completion.test(clause)).every(clause=>qualified.test(clause))){
    if(table&&/^(?:冻结|frozen)$/iu.test(clean.trim()))return zh?"曾建议冻结":"Previously proposed freeze";
    if(table&&/^(?:开发中|in.progress)$/iu.test(clean.trim()))return zh?"讨论描述开发中":"Described as in progress";
    if(table&&/^(?:completed|complete|passed|done)$/iu.test(clean.trim()))return zh?"讨论称已完成":"Reported in discussion";
    return clean;
   }
   if(table)return (zh?"讨论称：":"Discussion reports: ")+clean;
   return unverifiedCompletion(clean,zh);
  }).join(zh?"":" ");
  return output.replace(/\uE000LITERAL(\d+)\uE001/gu,(_,index)=>literals[Number(index)]);
 };
 const visit=(node:RootContent)=>{
  if(node.type==="code"||node.type==="blockquote"||node.type==="heading")return;
  if(node.type==="table"){
   const headers=node.children[0].children.map(cell=>value(cell).trim());
   const estimate=new Set(headers.flatMap((header,index)=>/^(?:完成度估计|成熟度(?:评分)?|主观评分|maturity(?: score)?|estimated completion)$/iu.test(header)?[index]:[]));
   if(headers.length-estimate.size<2)estimate.clear();
   const rows=node.children.map((row,rowIndex)=>{
    const context=row.children.map(cell=>value(cell)).join("");
    return row.children.flatMap((cell,index)=>estimate.has(index)?[]:[rowIndex===0?cellMarkdown(cell):transform(cellMarkdown(cell),true,index===row.children.length-1?context:undefined)]);
   });
   const table=[rows[0],rows[0].map(()=>"---"),...rows.slice(1)].map(row=>"| "+row.join(" | ")+" |").join("\n");
   const changed=estimate.size||node.children.slice(1).some(row=>row.children.some((cell,index)=>transform(cellMarkdown(cell),true,index===row.children.length-1?row.children.map(cell=>value(cell)).join(""):undefined)!==cellMarkdown(cell)));
   if(changed)changes.push({start:node.position!.start.offset!,end:node.position!.end.offset!,text:table});
   return;
  }
  if(node.type==="paragraph"){
   // A bold label line ("**已完成阶段：**") introduces a list; it asserts nothing itself.
   if(node.children.length===1&&node.children[0].type==="strong")return;
   const raw=body.slice(node.position!.start.offset!,node.position!.end.offset!);
   const output=transform(raw);
   if(output!==raw)changes.push({start:node.position!.start.offset!,end:node.position!.end.offset!,text:output});
   return;
  }
  if("children" in node)for(const child of node.children)visit(child as RootContent);
 };
 for(const node of parser.parse(body).children)visit(node);
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.text+body.slice(change.end);
 return aiAdvicePresentation(body);
}
