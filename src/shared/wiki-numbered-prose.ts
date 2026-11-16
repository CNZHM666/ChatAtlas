import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {wikiSupplementRanges} from "./wiki-source-supplements";
const overallOutcome=/(?<=。)\s*(?=(?:最终|整体)?(?:完成|验收)标准(?:为|是|[：:]))/u;

/** Turn a declared run-in checklist into blocks without guessing missing cases.
 * An explicitly introduced overall conclusion belongs outside the final case. */
export function wikiNumberedCases(text:string):string|undefined{
 const header=/^(.*?(\d{1,2})\s*个[^\n：:]{0,24}[：:])\s*1[.、)]\s*/u.exec(text);
 if(!header)return;
 const joined=`1. ${text.slice(header[0].length)}`,count=Number(header[2]);
 const entries=[...joined.matchAll(/(?:^|[；;]\s*)(\d{1,2})[.、)]\s*/gu)];
 if(count<2||count>30||entries.length!==count||entries.some((match,index)=>Number(match[1])!==index+1))return;
 const items=entries.map((match,index)=>joined.slice(match.index!+match[0].length,entries[index+1]?.index??joined.length).trim());
 if(items.some(item=>!item))return;
 const last=items.at(-1)!,boundary=last.search(overallOutcome);
 const conclusion=boundary>0?`\n\n${last.slice(boundary).trim()}`:"";
 if(conclusion)items[items.length-1]=last.slice(0,boundary);
 return `${header[1]}\n\n${items.map((item,index)=>`${index+1}. ${item}`).join("\n")}${conclusion}`;
}

/** Recover a generated run-in numbered list only when it declares an exact
 * item count and contains every consecutive ordinal. Never guess missing items. */
export function wikiNumberedProse(body:string):string{
 const blocks=wikiDocumentBlocks(body),ranges=wikiSupplementRanges(body),edits:Array<{start:number;end:number;text:string}>=[];
 for(let at=0;at<blocks.length;at++){
  const block=blocks[at];if(ranges.some(([start,end])=>block.start>=start&&block.end<=end))continue;
  if(block.kind==="list"&&/(?:验收场景|验收用例|验收项)[：:]$/u.test(blocks[at-1]?.text??"")){
   const lines=block.text.split("\n");
   if(lines.length>1&&lines.every((line,index)=>Number(/^(\d+)\.\s/u.exec(line)?.[1])===index+1)){
    const last=lines.at(-1)!,cut=last.search(overallOutcome);
    if(cut>0)edits.push({start:block.start,end:block.end,text:[...lines.slice(0,-1),last.slice(0,cut),"",last.slice(cut).trimStart()].join("\n")});
   }
   continue;
  }
  if(block.kind!=="paragraph")continue;
  let input=block.text,end=block.end;
  const next=blocks[at+1];
  if(/[：:]\s*1[.、)]\s*$/u.test(input)&&next?.kind==="paragraph"&&!ranges.some(([start,finish])=>next.start>=start&&next.end<=finish)){
   input+=` ${next.text}`;end=next.end;
  }
  const text=wikiNumberedCases(input);
  if(!text)continue;
  edits.push({start:block.start,end,text});
  if(end!==block.end)at++;
 }
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return body;
}
