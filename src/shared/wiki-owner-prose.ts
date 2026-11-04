import {unified} from "unified";
import remarkParse from "remark-parse";
import type {FocusSection} from "./focus-session";
const parser=unified().use(remarkParse);
const headingKey=(label:string)=>label.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu," ");
interface Scope {heading:string;depth:number;label?:boolean;items:Array<string|Scope>;children:Map<string,Scope>;seen:Set<string>}
const scope=(heading="",depth=0):Scope=>({heading,depth,items:[],children:new Map(),seen:new Set()});

/** Deduplicate at an exact heading path. A repeated nested heading must be
 * merged with its own children, never dropped and left under the last sibling. */
function append(target:Scope,markdown:string){
 const stack=[target];
 for(const node of parser.parse(markdown).children){
  const block=markdown.slice(node.position!.start.offset!,node.position!.end.offset!).trim();
  const label=node.type==="paragraph"&&node.children.length===1&&node.children[0].type==="strong";
  if(node.type==="heading"||label){
   const depth=node.type==="heading"?node.depth:7;
   while(stack.length>1&&stack.at(-1)!.depth>=depth)stack.pop();
   const parent=stack.at(-1)!,key=(label?"label:":"")+headingKey(block);
   let child=parent.children.get(key);
   if(!child){child={...scope(block,depth),...(label?{label:true}:{})};parent.children.set(key,child);parent.items.push(child);}
   stack.push(child);
  }else{
   const parent=stack.at(-1)!;
   if(!parent.seen.has(block)){parent.seen.add(block);parent.items.push(block);}
  }
 }
}
function render(target:Scope,shift=0):string {
 const content=target.items.map(item=>typeof item==="string"?item:render(item,shift)).filter(Boolean).join("\n\n");
 if(!content)return "";
 const heading=target.label?target.heading:target.heading?target.heading.replace(/^#{1,6}/u,"#".repeat(Math.min(6,target.depth+shift))):"";
 return [heading,content].filter(Boolean).join("\n\n");
}

/** Group already-owned fragments by real Markdown headings. Fence contents and
 * distinct conditions survive; no semantic deletion or cross-owner guessing. */
export function joinWikiOwnerProse(sections:FocusSection[]):string{
 const groups=new Map<string,{heading:string;parts:Map<string,Scope>}>();
 const mixedKinds=new Set(sections.map(section=>section.kind)).size>1;
 const mixedPhases=new Set(sections.map(section=>section.phase??"")).size>1;
 let hasOpening=false;
 for(const section of sections){
  let body=section.body;
  let nodes=parser.parse(body).children;
  const firstHeading=nodes.find(node=>node.type==="heading"&&node.depth===2);
  const prefix=firstHeading?nodes.filter(node=>node.position!.end.offset!<=firstHeading.position!.start.offset!):[];
  // A later chunk's chapter-relative preface belongs beside that chunk's
  // first topic. Retain its facts verbatim instead of piling every preface
  // into the chapter overview. Quotes/code/list introductions stay intact.
  if(hasOpening&&firstHeading&&prefix.length&&prefix.every(node=>node.type==="paragraph"&&/^(?:本章|本节|这一章|this chapter\b|this section\b)/iu.test(body.slice(node.position!.start.offset!,node.position!.end.offset!).trim()))){
   const at=firstHeading.position!.start.offset!,end=firstHeading.position!.end.offset!;
   body=body.slice(at,end)+"\n\n"+body.slice(0,at).trim()+"\n\n"+body.slice(end).trimStart();
   nodes=parser.parse(body).children;
  }else if(prefix.some(node=>node.type==="paragraph"))hasOpening=true;
  const headings=nodes.filter(node=>node.type==="heading"&&node.depth===2);
  const starts=[0,...headings.map(node=>node.position!.start.offset!).filter(offset=>offset>0)];
  starts.forEach((start,index)=>{
   const end=starts[index+1]??body.length,heading=headings.find(node=>node.position!.start.offset===start);
   const label=heading?body.slice(start,heading.position!.end.offset!):"";
   const text=body.slice(heading?.position?.end.offset??start,end).trim();if(!text)return;
   const key=headingKey(label);
   let group=groups.get(key);if(!group){group={heading:label,parts:new Map()};groups.set(key,group);}
   const zh=/\p{Script=Han}/u.test(section.body);
   const status=mixedKinds?(section.kind==="proposal"?(zh?"待确认建议":"Proposal"):section.kind==="open_question"?(zh?"待解决问题":"Open question"):""):"";
   const qualifier=[mixedPhases?section.phase:undefined,status].filter(Boolean).join(" · ");
   let part=group.parts.get(qualifier);if(!part){part=scope();group.parts.set(qualifier,part);}
   append(part,text);
  });
 }
 return [...groups.values()].map(group=>[group.heading,...[...group.parts].map(([qualifier,part])=>[qualifier?`### ${qualifier}`:"",render(part,qualifier?1:0)].filter(Boolean).join("\n\n"))].filter(Boolean).join("\n\n")).join("\n\n");
}
