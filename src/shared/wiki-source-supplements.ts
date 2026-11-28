import {codeRanges} from "./markdown-code-ranges";
import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {wikiUiCopy} from "./wiki-ui-copy";
import {plainBlockLayout} from "./wiki-plain-block";
export const WIKI_SUPPLEMENT="atlas-wiki-supplement";
/** Application-owned source attachments are opaque to narration and emphasis.
 * The example compactor may coalesce equivalent displays, preserving literals
 * and source locators, with versions and confirmation status kept separate. */
export function wikiSupplementRanges(body:string):Array<[number,number]> {
 const blocks=wikiDocumentBlocks(body),ranges:Array<[number,number]>=[];
 for(let at=0;at<blocks.length;at++){
  const block=blocks[at];
  if(block.kind!=="html"||!block.text.startsWith(`<details data-atlas="${WIKI_SUPPLEMENT}">`))continue;
  const end=blocks.findIndex((next,index)=>index>at&&next.kind==="html"&&/^<\/details>\s*$/u.test(next.text));
  if(end<0){ranges.push([block.start,body.length]);break;}
  ranges.push([block.start,blocks[end].end]);at=end;
 }
 return ranges;
}

/** Upgrade only our old generated example captions, never headings or numbered lists inside fenced originals. */
export function normalizeWikiSupplementHeadings(body:string):string {
 const blocks=wikiDocumentBlocks(body),ranges=wikiSupplementRanges(body),edits:Array<{start:number;end:number;text:string}>=[];
 for(const [at,block] of blocks.entries()){
  if(!ranges.some(([start,end])=>block.start>start&&block.end<end)||!["paragraph","list","heading"].includes(block.kind))continue;
  if(!["code","table"].includes(blocks[at+1]?.kind))continue;
  const title=block.text.trim().replace(/^#{1,6}\s+/u,"").replace(/^\*\*([^\n]+)\*\*$/u,"$1").replace(/^(\d+\.\s+)\*\*(.*?)\*\*$/u,"$1$2");
  if(!/^\d+\.\s+(?:JSON 示例|数据结构|流程示例|界面草图|目录结构|代码示例|命令示例|原文示例|输入提示文案示例|操作文案示例|进度文案示例|JSON example|Data structure|Flow example|UI sketch|File layout|Code example|Command example|Source example|Input placeholder example|Action label examples|Progress copy examples)\s*·[^\n]*$/u.test(title))continue;
  edits.push({start:block.start,end:block.end,text:`#### ${title}`});
 }
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return body;
}
const clean=(value:string)=>value.replace(/[<>&\n]/gu," ").replace(/\*\*/gu,"").replace(/\s+/gu," ").trim();
const short=(value:string)=>{const text=clean(value);return text.length<=72?text:text.slice(0,72).replace(/\s+\S*$/u,"")+"…";};
const COMMAND_LANGUAGE=/^(?:bash|sh|shell|powershell|ps1|cmd|console)$/iu;

/** Title the example by what it illustrates. Only structured identifiers
 * (such as the name of a type) may be taken verbatim from its payload. */
export function wikiSupplementTitle(code:{language:string;text:string},caption:string,zh:boolean,topic=""){
 const lines=code.text.split(/\r?\n/u).map(line=>line.trim()).filter(Boolean);
 const directory=lines.filter(line=>/(?:^|[ ├└─])(?:[\w.@-]+\/|[\w.@-]+\.[a-z]{1,5}$)/iu.test(line)).length>=2;
 const declaration=/^\s*(?:export\s+)?(interface|type|class|enum)\s+([\w$]+)/mu.exec(code.text);
 const schema=/^\s*CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?([\w.-]+)[`"']?/imu.exec(code.text);
 const flow=plainBlockLayout(code.text)?.kind==="flow"||lines.some(line=>/^(?:↓|⬇|├─|└─)$|[┬┴┼]/u.test(line));
 const ui=wikiUiCopy(code);
 let title:string;
 if(directory)title=zh?"目录结构":"File layout";
 else if(declaration)title=zh?`${declaration[2]} ${declaration[1]==="interface"?"接口":"定义"}`:`${declaration[2]} ${declaration[1]}`;
 else if(schema)title=zh?`${schema[1]} 数据表结构`:`${schema[1]} schema`;
 else if(ui==="placeholder")title=zh?"输入提示文案":"Input placeholder";
 else if(ui==="actions")title=zh?"操作文案":"Action labels";
 else if(ui==="progress")title=zh?"进度文案":"Progress copy";
 else if(COMMAND_LANGUAGE.test(code.language))title=zh?"终端命令":"Terminal commands";
 else if(/json/iu.test(code.language))title=zh?"JSON 示例":"JSON example";
 else if(flow)title=zh?"流程示例":"Flow example";
 else if(/[┌┐└┘│┃]/u.test(code.text))title=zh?"界面草图":"UI sketch";
 else if(code.language&&!/^(?:text|txt|plaintext|md|markdown)$/iu.test(code.language))title=zh?"代码示例":"Code example";
 else title=zh?"参考示例":"Reference example";
 const subject=short(topic.replace(/^#{1,6}\s+/u,""));
 if(subject&&/^(?:参考示例|流程示例|界面草图|Reference example|Flow example|UI sketch)$/u.test(title)&&!subject.includes(title))
  title=zh?`${subject}的${title}`:`${title} for ${subject}`;
 const notes=caption.replace(/^\*+|\*+$/gu,"").split(/\s*·\s*/u).slice(1).filter(Boolean);
 // A diagram's explicit title identifies the example, not the release scope of
 // its surrounding article. Do not copy a different version onto its caption.
 const first=lines[0]??"";
 const originalVersion=flow&&/^(?:text|txt|plaintext)?$/iu.test(code.language)
  ?first.match(/\bv\d+(?:\.\d+)*(?:-[\w.-]+)?$/iu)?.[0].toLowerCase():undefined;
 if(originalVersion){
  const versionNote=notes.findIndex(note=>/^v\d+(?:\.\d+)*(?:-[\w.-]+)?$/iu.test(note));
  if(versionNote===-1)notes.unshift(zh?`原稿 ${originalVersion}`:`Source diagram ${originalVersion}`);
  else notes[versionNote]=notes[versionNote].toLowerCase()===originalVersion
   ?(zh?`原稿 ${originalVersion}`:`Source diagram ${originalVersion}`)
   :(zh?`原稿 ${originalVersion}，适用范围待核对`:`Source diagram ${originalVersion}, scope unverified`);
 }
 return [title,...notes.map(short)].join(" · ");
}

/** Group original examples at the end of their existing subsection. Never cross a heading or rewrite payloads. */
export function groupWikiSupplements(body:string,zh=true){
 const blocks=wikiDocumentBlocks(body),sections:Array<{start:number;end:number;parts:Array<{start:number;end:number;title:string;inner:string}>}>=[];
 let section={start:0,end:body.length,parts:[] as typeof sections[number]["parts"]};
 for(let at=0;at<blocks.length;at++){
  const block=blocks[at];
  if(block.kind==="heading") {section.end=block.start;sections.push(section);section={start:block.start,end:body.length,parts:[]};continue;}
  const open=block.kind==="html"?new RegExp(`^<details data-atlas="${WIKI_SUPPLEMENT}">\\s*<summary>([^<>\\n]{1,300})</summary>\\s*$`,"u").exec(block.text):undefined;
  if(!open)continue;
  let end=at+1;
  while(end<blocks.length&&!(blocks[end].kind==="html"&&/^<\/details>\s*$/u.test(blocks[end].text)))end++;
  if(end===blocks.length)continue;
  // Already grouped is an opaque literal boundary, including its internal example headings.
  if(!/^(?:补充资料|Additional details) · /u.test(open[1])) {at=end;continue;}
  const first=blocks[at+1];
  section.parts.push({start:block.start,end:blocks[end].end,title:open[1].replace(/^(?:补充资料|Additional details)\s*·\s*/u,""),inner:first?body.slice(first.start,blocks[end].start).trim():""});
  at=end;
 }
 sections.push(section);
 for(const part of sections.reverse()){
  if(!part.parts.length)continue;
  let text=body.slice(part.start,part.end);
  for(const source of [...part.parts].reverse())text=text.slice(0,source.start-part.start)+text.slice(source.end-part.start);
  const title=part.parts.length===1?part.parts[0].title:(zh?`参考示例 · ${part.parts.length} 项`:`Reference examples · ${part.parts.length} items`);
  const contents=part.parts.map((source,index)=>`${part.parts.length>1?`#### ${index+1}. ${source.title}\n\n`:""}${source.inner}`).join("\n\n");
  const grouped=`<details data-atlas="${WIKI_SUPPLEMENT}">\n<summary>${clean(title)}</summary>\n\n${contents}\n\n</details>`;
  // Only whitespace left by removed disclosures is compressed; source content remains untouched.
  const ranges=codeRanges(text);let cursor=0,compact="";
  for(const [start,end] of ranges){compact+=text.slice(cursor,start).replace(/\n{3,}/gu,"\n\n")+text.slice(start,end);cursor=end;}
  text=(compact+text.slice(cursor).replace(/\n{3,}/gu,"\n\n")).trimEnd();
  body=body.slice(0,part.start)+text+(text.trim()?"\n\n":"")+grouped+"\n\n"+body.slice(part.end);
 }
 return body.trim();
}
