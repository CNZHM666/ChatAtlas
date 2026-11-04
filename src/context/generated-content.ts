import {withoutGeneratedClaims} from "../shared/generated-claims-prose";
/** Export projection only. Originals, personal prose and code remain untouched. */
export function generatedContextContent(text:string,originalTexts:string[]=[]):string {
 text=withoutGeneratedClaims(text,originalTexts).body;
 let fence="";
 return text.split("\n").filter(line=>{
  const delimiter=line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
  if(delimiter){if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence="";return true;}
  return Boolean(fence)||!/^\s*(?:Claims\s*[:：]|数据\s*[:：]?|关键约束\s*[:：]|(?:claims|evidenceIds|verification)\s*[:：]\s*\[?\s*\]?)\s*$/iu.test(line.replace(/\*\*|__/gu,""));
 }).join("\n").trim();
}

export function historicalMarketJudgment(text:string,zh:boolean,context=""):string {
 if(/竞品|竞争产品|对标产品|\bcompetitor|competing product/iu.test(context+"\n"+text)&&/缺乏|不支持|仅|只能|没有|未能|领先|唯一|\black|\bonly\b/iu.test(text)&&!/当前未核实|历史判断|unverified historical/iu.test(text))return (zh?"历史讨论中的竞品判断（当前未核实）：\n\n":"Unverified historical competitor judgment:\n\n")+text;
 return text;
}

export function nestedWikiHeadings(text:string):string {
 let fence="";
 return text.split("\n").map(line=>{
  const delimiter=line.trimStart().match(/^(`{3,}|~{3,})/u)?.[1];
  if(delimiter){if(!fence)fence=delimiter;else if(delimiter[0]===fence[0]&&delimiter.length>=fence.length)fence="";return line;}
  return fence?line:line.replace(/^(#{1,6})(\s+)/u,(_,marks:string,space:string)=>"#".repeat(Math.min(6,marks.length+3))+space);
 }).join("\n");
}
