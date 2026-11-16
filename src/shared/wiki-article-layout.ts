import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {Paragraph,RootContent} from "mdast";

const parser=unified().use(remarkParse).use(remarkGfm);
const textOf=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>textOf(child as RootContent)).join(""):"";
const offset=(node:RootContent)=>({start:node.position!.start.offset!,end:node.position!.end.offset!});

/** Only explicit, sequential enumerations after a named checklist intro. Never infer a list from quantities. */
export function wikiInlineChecklist(raw:string):string|undefined {
 const intro=/(?:验收场景|测试场景|验收条件|检查项|检查清单|acceptance scenarios|test cases|acceptance criteria|checklist)\s*[：:]\s*/iu.exec(raw);
 if(!intro)return;
 const quoted=/`+[^`\n]*`+|“[^”]*”|「[^」]*」|『[^』]*』|"[^"\n]*"|\[[^\]\n]*\]\([^\n]*?\)/gu;
 if([...raw.matchAll(quoted)].some(match=>match.index!<=intro.index&&match.index!+match[0].length>intro.index))return;
 const start=intro.index+intro[0].length,tail=raw.slice(start);
 // Inline code, quotes and parentheses can contain semicolons/numbers of their own.
 let depth=0,quote="",code=false;
 const markers:Array<{at:number;end:number;n:number}>=[];
 for(let at=0;at<tail.length;at++){
  const ch=tail[at];
  if(ch==='`'){code=!code;continue;}
  if(code)continue;
  if(quote){if(ch===quote)quote="";continue;}
  if(/[“「『]/u.test(ch)){quote=ch==='“'?'”':ch==='「'?'」':'』';continue;}
  if(/[（([]/u.test(ch)){depth++;continue;}
  if(/[）)\]]/u.test(ch)){depth=Math.max(0,depth-1);continue;}
  if(depth||at>0&&!/[；;]\s*$/u.test(tail.slice(0,at)))continue;
  const match=/^(\d{1,2})[.)、](?!\d)\s*/u.exec(tail.slice(at));
  if(match)markers.push({at,end:at+match[0].length,n:Number(match[1])});
 }
 if(code||quote||depth||markers.length<3||markers[0].at!==0||markers.some((m,i)=>m.n!==i+1))return;
 const items=markers.map((m,i)=>tail.slice(m.end,markers[i+1]?.at).trim());
 if(items.some(item=>!item)||items.at(-1)!.includes("\n\n"))return;
 return raw.slice(0,start).trimEnd()+"\n\n"+items.map((item,i)=>`${i+1}. ${item}`).join("\n");
}

/** Lossless reading projection shared by Wiki/MD. Does not reorder facts or touch original examples. */
export function wikiArticleLayout(body:string):string {
 const nodes=parser.parse(body).children,edits:Array<{start:number;end:number;text:string}>=[];
 let details=0;
 const raw=(node:RootContent)=>body.slice(offset(node).start,offset(node).end);
 for(let at=0;at<nodes.length;at++){
  const node=nodes[at];
  if(node.type==="html"){
   details+= (node.value.match(/<details\b/gu)??[]).length-(node.value.match(/<\/details>/gu)??[]).length;
   continue;
  }
  if(details>0)continue;
  // Compact previously exported category + singleton-list runs without guessing from arbitrary prose.
  const pairs:Array<[string,string]>=[];let end=at,partialEnd:number|undefined;
  while(end+1<nodes.length){
   const label=nodes[end],list=nodes[end+1];
   if(label.type!=="paragraph"||label.children.length!==1||label.children[0].type!=="strong"||list.type!=="list"||list.ordered)break;
   const item=list.children[0];
   if(item.checked!=null||item.children.length!==1||item.children[0].type!=="paragraph")break;
   const name=textOf(label),value=raw(item.children[0]);
   if(name.length>32||value.length>100||/[|\n。！？!?]/u.test(name+value))break;
   if(list.children.length>1){
    const next=list.children[1].children[0];
    if(next.type!=="paragraph"||next.children[0]?.type!=="strong"||next.children[1]?.type!=="text"||!/^[:：]/u.test(next.children[1].value))break;
    // Markdown joins the following labelled list to the final category's singleton.
    partialEnd=offset(item).end;
   }
   pairs.push([name,value]);end+=2;
   if(partialEnd!==undefined)break;
  }
  if(pairs.length>=3){
   const zh=/\p{Script=Han}/u.test(pairs.flat().join(""));
   edits.push({start:offset(node).start,end:partialEnd??offset(nodes[end-1]).end,text:[zh?"| 分类 | 内容 |":"| Category | Content |","| --- | --- |",...pairs.map(([k,v])=>`| ${k} | ${v} |`)].join("\n")});
   if(partialEnd!==undefined){
    const list=nodes[end-1];
    if(list.type==="list")for(const item of list.children.slice(1)){
     const paragraph=item.children[0],label=paragraph.type==="paragraph"?paragraph.children[0]:undefined;
     if(label?.type==="strong")edits.push({...offset(label),text:raw(label).slice(2,-2)});
    }
   }
   at=end-1;continue;
  }
  if(node.type==="paragraph"){
   const split=wikiInlineChecklist(raw(node));
   if(split)edits.push({...offset(node),text:split});
  }
  if(node.type==="list"&&!node.ordered){
   const paragraphs=node.children.map(item=>item.children.length===1&&item.children[0].type==="paragraph"?item.children[0] as Paragraph:undefined);
   const labels=paragraphs.map(p=>p?.children[0]?.type==="strong"&&p.children[1]?.type==="text"&&/^[：:]/u.test(p.children[1].value)?p.children[0]:undefined);
   // A compact field list may have labels. Mixed or explanatory lists use ordinary text throughout.
   const compact=paragraphs.length<=5&&paragraphs.every((p,i)=>p&&labels[i]&&textOf(p).length<=64);
   if(!compact)for(const label of labels)if(label)edits.push({...offset(label),text:raw(label).slice(2,-2)});
  }
 }
 for(const edit of edits.sort((a,b)=>b.start-a.start))body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 return body;
}
