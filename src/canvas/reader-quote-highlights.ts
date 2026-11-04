import type {Root,RootContent} from "mdast";
import type {VFile} from "vfile";

export interface QuoteHighlightRange {start:number;end:number}

/** Presentation only. Mark literal prose inside a retained quote without
 * inserting Markdown into code or changing the original's source positions. */
export function readerQuoteHighlights({ranges}:{ranges:QuoteHighlightRange[]}){
 return (tree:Root,file:VFile)=>{
  const source=String(file.value);
  const visit=(parent:{children:RootContent[]})=>{
   parent.children=parent.children.flatMap(node=>{
    if(node.type!=="text"){
     if("children" in node&&!["link","linkReference"].includes(node.type))visit(node as unknown as {children:RootContent[]});
     return [node];
    }
    const start=node.position?.start.offset,end=node.position?.end.offset;
    if(start===undefined||end===undefined||source.slice(start,end)!==node.value)return [node];
    const cuts=[...new Set([start,end,...ranges.flatMap(range=>[Math.max(start,range.start),Math.min(end,range.end)]).filter(at=>at>start&&at<end)])].sort((a,b)=>a-b);
    return cuts.slice(0,-1).map((from,index):RootContent=>{
     const to=cuts[index+1],text:RootContent={type:"text",value:source.slice(from,to)};
     return ranges.some(range=>range.start<=from&&to<=range.end)?{type:"emphasis",data:{hName:"mark"},children:[text]}:text;
    });
   });
  };
  visit(tree);
 };
}
