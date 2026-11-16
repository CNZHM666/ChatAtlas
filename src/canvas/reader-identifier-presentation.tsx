import {createElement,type ReactNode} from "react";
import type {Root,RootContent,PhrasingContent} from "mdast";
import type {Components} from "react-markdown";
const TOKEN=/[A-Za-z_$][A-Za-z0-9_$]*(?:[./][A-Za-z_$][A-Za-z0-9_$]*)*(?:=(?:true|false|null|\d+))?/gu;
function parts(value:string):PhrasingContent[]{
 const pieces:PhrasingContent[]=[];let start=0;
 for(let at=1;at<value.length;at++)if(value[at-1]==="/"||/[._=]/u.test(value[at])||value.length>=20&&/[a-z0-9]/u.test(value[at-1])&&/[A-Z]/u.test(value[at])){
  pieces.push({type:"text",value:value.slice(start,at)},{type:"emphasis",data:{hName:"atlas-word-break"},children:[]});start=at;
 }
 pieces.push({type:"text",value:value.slice(start)});return pieces;
}
const breakable=(value:string)=>value.includes("/")||value.length>=20&&/[a-z][A-Z]|[._=]/u.test(value);
/** Discretionary breaks have no text content: copying a technical identifier keeps every original character. */
export function readerIdentifierPresentation(){return(tree:Root)=>{
 const visit=(node:RootContent|Root)=>{
  if(node.type==="code"||node.type==="link"||node.type==="image"||node.type==="html"||node.data?.hName==="atlas-supplement")return;
  if(!("children" in node))return;
  const children=node.children as RootContent[];
  for(let at=0;at<children.length;at++){
   const child=children[at];
   if(child.type==="inlineCode"&&breakable(child.value))children[at]={type:"emphasis",data:{hName:"atlas-code-token"},children:parts(child.value)} as RootContent;
   else if(child.type==="text"){
    const replacement:PhrasingContent[]=[];let end=0;
    for(const match of child.value.matchAll(TOKEN)){
     if(!breakable(match[0]))continue;
     if(match.index!>end)replacement.push({type:"text",value:child.value.slice(end,match.index)});
     replacement.push({type:"emphasis",data:{hName:"atlas-token"},children:parts(match[0])});end=match.index!+match[0].length;
    }
    if(!replacement.length)continue;
    if(end<child.value.length)replacement.push({type:"text",value:child.value.slice(end)});
    children.splice(at,1,...replacement as RootContent[]);at+=replacement.length-1;
   }else visit(child);
  }
 };
 visit(tree);
};}
export const readerIdentifierComponents={
 "atlas-token":({children}:{children?:ReactNode})=>createElement("span",{className:"reader-token"},children),
 "atlas-code-token":({children}:{children?:ReactNode})=>createElement("code",{className:"reader-token"},children),
 "atlas-word-break":()=>createElement("wbr"),
} as unknown as Components;
