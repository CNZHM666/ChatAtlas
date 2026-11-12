import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import { GFM_OPTIONS } from "./markdown-gfm";
import type {RootContent} from "mdast";
import {evidencePresentation} from "./evidence-presentation";
import {generatedCitationPresentation} from "./generated-citation-presentation";

const parser=unified().use(remarkParse).use(remarkGfm, GFM_OPTIONS);
/** A row may hold fewer cells than its header: the missing cell reads empty. */
const text=(node:RootContent|undefined):string=>!node?"":"value" in node?node.value:"children" in node?node.children.map(child=>text(child as RootContent)).join(""):"";
const reference=/^(?:\s*\[?e\d+(?::\d+)?\]?\s*[,，、;；]?)+$/iu;
const states:Record<string,string>={proposal:"讨论提出以下设计：",proposed:"讨论提出以下设计：",planned:"以下为计划内容：",uncertain:"以下内容尚未确定：",documented:"以下为讨论记录："};

/** Exact repeats within the same subject only. Versioned headings, literal
 * quotations, code and source excerpts must not be deduplicated by similarity. */
function withoutRepeatedBlocks(body:string,originalTexts:string[]):string {
 const seen=new Set<string>(),headings:string[]=[];
 const ranges:Array<{start:number;end:number}>=[];
 for(const node of parser.parse(body).children){
  if(node.type==="heading"){headings.length=node.depth-1;headings[node.depth-1]=text(node);continue;}
  // A converted deep heading is a standalone bold label. It still starts a
  // separate scope; an identical condition in another scope must survive.
  if(node.type==="paragraph"&&node.children.length===1&&node.children[0].type==="strong"){seen.clear();continue;}
  if(node.type!=="paragraph"&&node.type!=="table")continue;
  const start=node.position!.start.offset!,end=node.position!.end.offset!,raw=body.slice(start,end).trim();
  if(raw.length<60||originalTexts.some(original=>original.includes(raw)))continue;
  const key=JSON.stringify([headings,raw]);
  if(seen.has(key))ranges.push({start,end});else seen.add(key);
 }
 for(const range of ranges.reverse())body=body.slice(0,range.start)+body.slice(range.end);
 return body;
}

/** A display/export projection for generated articles only. Original Markdown,
 * personal edits, business states, quotes and executable code remain intact. */
export function knowledgeArticlePresentation(body:string,zh=true,originalTexts:string[]=[]):string {
 const changes:Array<{start:number;end:number;value:string}>=[];
 for(const node of parser.parse(body).children){
  const start=node.position!.start.offset!,end=node.position!.end.offset!;
  if(originalTexts.some(original=>original.includes(body.slice(start,end))))continue;
  if(node.type==="heading"&&node.depth>=4){
   changes.push({start,end,value:`**${body.slice(start,end).replace(/^#{1,6}\s+/u,"").replace(/\s+#+\s*$/u,"")}**`});
  }
  if(node.type==="table"){
   const headers=node.children[0].children.map(cell=>text(cell).trim().toLowerCase()),remove=new Set<number>();let introduction="",mixedIndex=-1;
   for(const [index,header] of headers.entries()){
    const values=node.children.slice(1).map(row=>text(row.children[index]).trim());
    if(/^(?:证据(?:来源|编号|索引|\s*ids?)?|来源(?:依据|编号|索引|\s*ids?)?|引用(?:来源|依据|编号|\s*ids?)?|参考来源|原文依据|evidence(?:\s*(?:source|ids?))?|sources?(?:\s*ids?)?|references?|citations?)$/u.test(header)&&values.length&&values.every(value=>reference.test(value)))remove.add(index);
    if(/^(?:状态|status)$/u.test(header)&&values.length&&values.every(value=>states[value.toLowerCase()])){
     remove.add(index);
     if(values.every(value=>value.toLowerCase()===values[0].toLowerCase()))introduction=zh?states[values[0].toLowerCase()]:`The following is ${values[0].toLowerCase()} material:`;
     else mixedIndex=index;
    }
   }
   if(remove.size&&headers.length-remove.size>=1){
    const description=headers.findIndex((header,index)=>!remove.has(index)&&/^(?:描述|说明|内容|description|details|content)$/u.test(header));
    const qualifierColumn=description>=0?description:headers.findIndex((_,index)=>!remove.has(index));
    const rows=node.children.map((row,rowIndex)=>row.children.flatMap((cell,index)=>{
     if(remove.has(index))return [];
     let value=cell.children.length?evidencePresentation(body.slice(cell.children[0].position!.start.offset!,cell.children.at(-1)!.position!.end.offset!)).trim():"";
     if(rowIndex&&mixedIndex>=0&&index===qualifierColumn){const state=text(row.children[mixedIndex]).trim().toLowerCase();value=(zh?states[state]:`${state} in discussion: `)+value;}
     return [value];
    }));
    const table=[rows[0].map(value=>` ${value} `).join("|"),rows[0].map(()=>" --- ").join("|"),...rows.slice(1).map(row=>row.map(value=>` ${value} `).join("|"))].map(row=>`|${row}|`).join("\n");
    const content=rows[0].length===1?`**${rows[0][0]}**\n\n`+rows.slice(1).map(row=>`- ${row[0]}`).join("\n"):table;
    changes.push({start,end,value:(introduction?introduction+"\n\n":"")+content});
   }
  }
  if(node.type==="code"&&node.value.trim().split("\n").length===1&&/^(?:[a-z_$][\w$]*\.)*[a-z_$][\w$]*\([^\n`]*\);?$/iu.test(node.value.trim())&&/^(?:ts|js|typescript|javascript|text)?$/iu.test(node.lang??""))changes.push({start,end,value:`\`${node.value.trim()}\``});
  if(node.type==="code"&&/^(?:text|plain|plaintext|ascii|diagram)?$/iu.test(node.lang??"")){
   const lines=node.value.trim().split("\n").map(line=>line.trim());
   const branch=lines.findIndex(line=>/^\/\s+\|\s+\\{1,2}$/u.test(line));
   if(branch>=3&&lines.length===branch+3&&/^↓\s+↓\s+↓$/u.test(lines[branch+1])){
    const steps=lines.slice(0,branch).filter(line=>line!=="↓"),outputs=lines[branch+2].split(/\s{2,}|\t+/u);
    if(steps.length>=2&&steps.every(line=>/^[\p{L}\p{N} _./-]+$/u.test(line))&&outputs.length===3&&outputs.every(line=>/^[\p{L}\p{N} _./-]+$/u.test(line)))changes.push({start,end,value:steps.join(" → ")+`\n\n${steps.at(-1)} → ${outputs.join(" / ")}`});
   }
  }
 }
 for(const change of changes.reverse())body=body.slice(0,change.start)+change.value+body.slice(change.end);
 return withoutRepeatedBlocks(generatedCitationPresentation(evidencePresentation(body),originalTexts),originalTexts);
}
