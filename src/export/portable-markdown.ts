import {unified} from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import type {RootContent} from "mdast";

const parser=unified().use(remarkParse).use(remarkGfm);
const textOf=(node:RootContent):string=>"value" in node?node.value:"children" in node?node.children.map(child=>textOf(child as RootContent)).join(""):"";
const at=(node:RootContent)=>({start:node.position!.start.offset!,end:node.position!.end.offset!});
type Edit={start:number;end:number;text:string};
const apply=(body:string,edits:Edit[])=>edits.sort((a,b)=>b.start-a.start).reduce((value,edit)=>value.slice(0,edit.start)+edit.text+value.slice(edit.end),body);
/** Common heading-link convention. Count duplicates across all visible headings. */
export const markdownHeadingSlug=(title:string)=>title.toLowerCase().replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,"").replace(/\s/gu,"-");

/** Export projection only: remove application HTML scaffolding, never HTML examples
 * or arbitrary authored markup. Keep literal source blocks byte-for-byte. */
export function portableMarkdown(body:string):string {
 const afterBlank=(end:number)=>end+(body.slice(end).match(/^\r?\n(?:\r?\n)?/u)?.[0].length??0);
 let depth=2;
 const stack:Array<{owned:boolean;depth:number;base?:number}>=[],edits:Edit[]=[];
 const sourceNodes=parser.parse(body).children;
 for(const [index,node] of sourceNodes.entries()){
  if(node.type==="heading"){
   const group=stack.at(-1);
   if(group?.owned&&group.base!==undefined)edits.push({...at(node),text:`${"#".repeat(Math.min(6,group.depth+1+Math.max(0,node.depth-group.base)))} ${body.slice(node.children[0].position!.start.offset!,at(node).end)}`});
   else depth=node.depth;
   continue;
  }
  if(node.type!=="html")continue;
  const value=node.value.trim();
  const owned=/^<details data-atlas="atlas-wiki-supplement">\s*<summary>([^<>\n]+)<\/summary>$/u.exec(value);
  if(owned){
   const next=sourceNodes[index+1],examples=/^(?:原文与示例|Originals and examples|参考示例 · \d+ 项|Reference examples · \d+ items)/u.test(owned[1]);
   // A disclosure that already opens with its own real section needs no second heading.
   const titled=next?.type==="heading"&&!examples;
   const groupDepth=Math.min(5,depth+1);
   stack.push({owned:true,depth:groupDepth,...(examples&&next?.type==="heading"?{base:next.depth}:{})});
   edits.push({...at(node),text:titled?"":`${"#".repeat(groupDepth)} ${owned[1]}`});
  }else if(/^<details\b/u.test(value))stack.push({owned:false,depth});
  else if(/^<\/details>$/u.test(value)&&stack.pop()?.owned)edits.push({start:at(node).start,end:afterBlank(at(node).end),text:""});
 }
 body=apply(body,edits);
 const nodes=parser.parse(body).children,targets=new Map<string,string>(),used=new Set<string>(),headings=new Map<number,string>();
 for(const [index,node] of nodes.entries())if(node.type==="heading"){
  const base=markdownHeadingSlug(textOf(node));let slug=base,suffix=0;
  while(used.has(slug))slug=`${base}-${++suffix}`;
  used.add(slug);headings.set(index,slug);
 }
 const anchors:Edit[]=[];
 const findAnchors=(node:RootContent)=>{
  if(node.type==="html"){
   const start=at(node).start;
   const match=/^<a id="((?:atlas-wiki-|chapter-)\d+|S-\d+-[a-z0-9]+)"><\/a>(?=\r?\n|$)/u.exec(body.slice(start));
   if(match&&(start===0||body[start-1]==="\n")){
    const end=start+match[0].length,next=nodes.findIndex(item=>at(item).start>=end);
    anchors.push({start,end:afterBlank(end),text:""});
    targets.set(match[1],match[1].startsWith("S-")?"":headings.get(next)??"");
   }
  }
  if("children" in node)for(const child of node.children)findAnchors(child as RootContent);
 };
 for(const node of nodes)findAnchors(node);
 const visit=(node:RootContent)=>{
  if(node.type==="link"&&node.url.startsWith("#")&&targets.has(node.url.slice(1))){
   const target=targets.get(node.url.slice(1))!;
   const raw=body.slice(at(node).start,at(node).end),label=raw.slice(0,raw.lastIndexOf("](")+1);
   anchors.push({...at(node),text:target?`${label}(#${target})`:label});
   return;
  }
  if("children" in node)for(const child of node.children)visit(child as RootContent);
 };
 for(const node of nodes)visit(node);
 return apply(body,anchors);
}
