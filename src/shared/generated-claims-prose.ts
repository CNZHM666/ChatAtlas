import {unified} from "unified";
import remarkParse from "remark-parse";
import type {RootContent} from "mdast";

const parser=unified().use(remarkParse);
const nodeText=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>nodeText(child as RootContent)).join(""):"";
const example=/示例|字段说明|接口定义|数据格式|\bschema\b|\bexample\b|\bfield definitions?\b/iu;

/** Recognize the complete leaked wire row, including the common non-YAML
 * `text: "..." quote: "..." evidenceIds: ["..."]` form. Never eval model text. */
function claimRow(input:string):boolean {
 const text=input.replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u,"").trim();
 let at=0;
 const skip=()=>{while(/[\s,]/u.test(text[at]??"")&&at<text.length)at++;};
 const string=():string|undefined=>{
  const mark=text[at];if(mark!=="\""&&mark!=="'")return;
  const start=at++;
  while(at<text.length){
   if(mark==='"'&&text[at]==="\\"){at+=2;continue;}
   if(text[at]===mark){if(mark==="'"&&text[at+1]==="'"){at+=2;continue;}at++;try{return mark==='"'?JSON.parse(text.slice(start,at)) as string:text.slice(start+1,at-1).replace(/''/gu,"'");}catch{return;}}
   at++;
  }
 };
 const fields=new Map<string,string|string[]>();
 while(at<text.length){
  skip();if(at===text.length)break;
  const field=text.slice(at).match(/^(text|quote|evidenceIds)\s*:\s*/u);if(!field||fields.has(field[1]))return false;at+=field[0].length;
  if(field[1]!=="evidenceIds"){
   const quoted=text[at]==="\""||text[at]==="'";let value=string();
   if(value===undefined&&!quoted){
    // The observed writer also emits YAML-like unquoted text followed by
    // quote/evidenceIds fields. A complete labelled wire row is still required.
    const next=text.slice(at).search(/(?:\s+|(?<=[。.!?]))(?:text|quote|evidenceIds)\s*:/u);
    if(next<1)return false;
    value=text.slice(at,at+next).trim();at+=next;
   }
   if(!value?.trim())return false;fields.set(field[1],value);
  }
  else{
   if(text[at++]!=="[")return false;
   const ids:string[]=[];
   while(at<text.length){skip();if(text[at]==="]"){at++;break;}const value=string();if(!value?.trim())return false;ids.push(value);skip();if(text[at]!=="]"&&text[at]!=="\""&&text[at]!=="'")return false;}
   if(!ids.length||text[at-1]!=="]")return false;fields.set(field[1],ids);
  }
 }
 return fields.size===3;
}

/** Generated-body projection only. Require a Claims label AND complete rows;
 * never touch arbitrary fields, code, quotes, authored examples or originals. */
export function withoutGeneratedClaims(body:string,originalTexts:string[]=[]):{body:string;removedBlocks:number}{
 if(!/claims/iu.test(body))return {body,removedBlocks:0};
 const nodes=parser.parse(body).children,ranges:Array<{start:number;end:number}>=[];
 for(let index=0;index<nodes.length-1;index++){
  const label=nodes[index],list=nodes[index+1];
  if(!["heading","paragraph"].includes(label.type)||!/^Claims\s*[:：]?$/iu.test(nodeText(label).trim())||list.type!=="list")continue;
  const previous=nodes[index-1],introduction=previous?nodeText(previous):"";
  if(example.test(introduction))continue;
  let end:number|undefined;
  for(const item of list.children){const row=body.slice(item.position!.start.offset!,item.position!.end.offset!);if(!claimRow(row))break;end=item.position!.end.offset!;}
  if(end===undefined)continue;
  const start=label.position!.start.offset!;
  if(!originalTexts.some(original=>original.includes(body.slice(start,end).trim())))ranges.push({start,end});
 }
 for(const range of ranges.reverse())body=body.slice(0,range.start)+body.slice(range.end);
 return {body:ranges.length?body.trim():body,removedBlocks:ranges.length};
}
