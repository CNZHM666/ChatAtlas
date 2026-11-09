import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
import {wikiCoverageMatcher,wikiExplanatorySentenceCount} from "./wiki-cross-duplicates";

const parser=unified().use(remarkParse);
/** In-document chapter link target; the Reader opens the chapter, export prints the title. */
export const WIKI_CHAPTER_LINK="#atlas-chapter-";
/** Window event the Reader dispatches for an in-text chapter link; the workspace opens it. */
export const WIKI_OPEN_CHAPTER_EVENT="atlas:open-chapter";
const MIN_REPEAT=60;
const claimIdentity=(claim:{quote:string;evidenceIds:string[]})=>JSON.stringify([claim.quote.normalize("NFKC").replace(/\s+/gu,""),[...claim.evidenceIds].sort()]);

const link=(chapter:Pick<FocusSection,"id"|"title">,zh:boolean)=>zh?`[「${chapter.title}」](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`:`[“${chapter.title}”](${WIKI_CHAPTER_LINK}${encodeURIComponent(chapter.id)})`;

/** Paragraphs an EARLIER chapter (reading order) already explains in full leave
 * this chapter. A subsection made only of such paragraphs from one chapter keeps
 * its heading and becomes one pointer to that chapter; otherwise its own content
 * stays and one "see also" line closes it, so a pointer never stands in front of
 * text that is new. Saved text, personal chapters, lists, code, quotations and a
 * claim found nowhere else in this chapter are unchanged. */
export function wikiChapterLinks(body:string,section:Pick<FocusSection,"id"|"claims"|"userEdited"|"origin">,chapters:Array<Pick<FocusSection,"id"|"title"|"body">&{claims?:FocusSection["claims"]}>,zh=true):string {
 if(section.userEdited||section.origin)return body;
 const index=chapters.findIndex(chapter=>chapter.id===section.id);
 const earlier=chapters.slice(0,index<0?0:index).map(chapter=>({chapter,covers:wikiCoverageMatcher(chapter.body,.9)}));
 if(!earlier.length)return body;
 const nodes=parser.parse(body).children,text=(node:typeof nodes[number])=>body.slice(node.position!.start.offset!,node.position!.end.offset!);
 const claims=(section.claims??[]).flatMap(claim=>[claim.text,...claim.formulations??[]]).filter(Boolean);
 const owner=new Map<number,Pick<FocusSection,"id"|"title">>();
 nodes.forEach((node,at)=>{
  if(node.type!=="paragraph")return;
  const value=text(node);
  if(value.length<MIN_REPEAT||!wikiExplanatorySentenceCount(value))return;
  // The line over a table or code block says whose it is: one run's "…; your later decision takes precedence: USD only"
  // read as told in an earlier chapter, and the AI's milestone table stood without it.
  const next=nodes[at+1];
  if(node.children.length===1&&node.children[0].type==="emphasis"&&(next?.type==="table"||next?.type==="code"||next?.type==="paragraph"&&text(next).startsWith("|")))return;
  const match=earlier.find(item=>item.covers(value)===1);
  // A claim stated only here is protected unless the explaining chapter already
  // carries the same claim (same original quote and evidence): then the pointer
  // loses nothing citable.
  const carried=(claim:string)=>Boolean(match&&(section.claims??[]).some(item=>[item.text,...item.formulations??[]].includes(claim)&&(match.chapter.claims??[]).some(other=>claimIdentity(other)===claimIdentity(item))));
  if(claims.some(claim=>value.includes(claim)&&!nodes.some((other,i)=>i!==at&&text(other).includes(claim))&&!carried(claim)))return;
  if(match)owner.set(at,match.chapter);
 });
 if(!owner.size)return body;
 // Subsections: the nodes after each heading (the lead before the first heading is one too).
 const groups:number[][]=[[]];
 nodes.forEach((node,at)=>{if(node.type==="heading")groups.push([]);else groups.at(-1)!.push(at);});
 const edits:Array<{start:number;end:number;text:string}>=[];
 for(const group of groups){
  const owned=group.filter(at=>owner.has(at));if(!owned.length)continue;
  const chapters=[...new Map(owned.map(at=>[owner.get(at)!.id,owner.get(at)!])).values()];
  const start=nodes[group[0]].position!.start.offset!,end=nodes[group.at(-1)!].position!.end.offset!;
  if(owned.length===group.length&&chapters.length===1){
   edits.push({start,end,text:zh?`> 这部分已在${link(chapters[0],zh)}中说明。`:`> Already explained in ${link(chapters[0],zh)}.`});
   continue;
  }
  for(const at of owned)edits.push({start:nodes[at].position!.start.offset!,end:nodes[at].position!.end.offset!,text:""});
  const also=chapters.map(chapter=>link(chapter,zh)).join(zh?"、":", ");
  edits.push({start:end,end,text:zh?`\n\n> 相关内容另见${also}。`:`\n\n> See also ${also}.`});
 }
 let next=body;
 for(const edit of edits.sort((a,b)=>b.start-a.start||b.end-a.end))next=next.slice(0,edit.start)+edit.text+next.slice(edit.end);
 return next.replace(/\n{3,}/gu,"\n\n").trim();
}

/** Export has no in-document navigation: chapter links print as titles. */
export function wikiChapterLinksAsText(body:string):string {
 return body.replace(/\[([「“][^\]]+[」”])\]\(#atlas-chapter-[^)]+\)/gu,"$1");
}
