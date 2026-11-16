import {wikiDocumentBlocks} from "./wiki-document-blocks";
import {WIKI_SUPPLEMENT} from "./wiki-source-supplements";
import {codeRanges} from "./markdown-code-ranges";
export const wikiHistoricalHeading=(value:string)=>/^(?:早先版本|早期版本|此前版本|历史方案|Earlier versions?|Previous versions?|Historical (?:versions?|plans?))(?:\s*[（(][^）)]*[）)])?$/iu.test(value.replace(/^#{1,6}\s+/u,"").replace(/\n[=-]+$/u,"").trim());
/** Historical records read as consistent paragraphs. Their raw examples remain in the ledger and Reader. */
export function wikiHistoryLayout(body:string){
 const blocks=wikiDocumentBlocks(body),edits:Array<{start:number;end:number;text:string}>=[];let depth=0;
 for(let at=0;at<blocks.length;at++){
  const block=blocks[at];
  if(block.kind==="heading"){
   const here=block.text.match(/^#+/u)?.[0].length??2;
   if(depth&&here<=depth)depth=0;
   if(wikiHistoricalHeading(block.text))depth=here;
   continue;
  }
  if(!depth)continue;
  if(block.kind==="html"&&block.text.startsWith(`<details data-atlas="${WIKI_SUPPLEMENT}">`)){
   let end=at+1;while(end<blocks.length&&!(blocks[end].kind==="html"&&/^<\/details>\s*$/u.test(blocks[end].text)))end++;
   if(end<blocks.length){edits.push({start:block.start,end:blocks[end].end,text:""});at=end;}
  }
  if(block.kind!=="list"||!/^[-*+]\s/u.test(block.text)||/^\s{2,}(?:[-*+]\s|\d+[.)]\s)|[`~]{3}/mu.test(block.text))continue;
  const paragraphs=block.text.split(/\n(?=[-*+]\s)/u).map(item=>item.replace(/^[-*+]\s+/u,"").replace(/\n {2,3}(?=\S)/gu,"\n")).join("\n\n");
  edits.push({start:block.start,end:block.end,text:paragraphs});
 }
 for(const edit of edits.reverse())body=body.slice(0,edit.start)+edit.text+body.slice(edit.end);
 let cursor=0,compact="";
 for(const [start,end] of codeRanges(body)){compact+=body.slice(cursor,start).replace(/\n{3,}/gu,"\n\n")+body.slice(start,end);cursor=end;}
 return compact+body.slice(cursor).replace(/\n{3,}/gu,"\n\n");
}
