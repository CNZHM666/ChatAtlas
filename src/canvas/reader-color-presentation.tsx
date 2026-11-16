import {createElement,type ReactNode} from "react";
import type {Root,RootContent,PhrasingContent,Blockquote} from "mdast";
import type {Components} from "react-markdown";
const HEX="#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})";
const colorPair=new RegExp(`^${HEX}(?:\\s*\\/\\s*${HEX})+$`,"iu");
const colorValue=new RegExp(`^${HEX}$`,"iu");
const colors=new RegExp(`(?<![A-Za-z0-9_#])${HEX}(?![A-Za-z0-9_])`,"giu");
const identifierBefore=(value:string)=>/(?:\b(?:commit|issue|hash)|工单|编号|提交|哈希)\s*$/iu.test(value);
const CONTEXT=/颜色|色值|色号|配色|背景|边框|文字|字体|主题|色彩|前景|\b(?:colou?r|background|canvas|panel|border|text|muted|accent|fill|stroke|theme)\b/iu;
const text=(node:RootContent):string=>"value" in node?String(node.value):"children" in node?(node.children as RootContent[]).map(text).join(""):"";
const tagged=(hName:string,children:PhrasingContent[]):PhrasingContent=>({type:"emphasis",data:{hName},children});
function colorText(value:string):PhrasingContent[]{
 const children:PhrasingContent[]=[];let at=0;
 for(const match of value.matchAll(colors)){
  if(identifierBefore(value.slice(0,match.index)))continue;
  if(match.index!>at)children.push({type:"text",value:value.slice(at,match.index)});
  children.push(tagged("atlas-color",[{type:"text",value:match[0]}]));at=match.index!+match[0].length;
 }
 if(at<value.length)children.push({type:"text",value:value.slice(at)});
 return children;
}
/** Palette fields become a compact definition grid. Prose gains color swatches only in explicit color context. */
export function readerColorPresentation(options:{enabled?:boolean}={}){
 return (tree:Root)=>{
  if(!options.enabled)return;
  const visit=(node:RootContent|Root,context=false)=>{
   if(node.type==="code"||node.type==="link"||node.type==="image"||node.type==="html"||node.data?.hName==="atlas-supplement")return;
   if(node.type==="table"){
    const rows=node.children,values=rows.slice(1).map(row=>row.children[1]&&text(row.children[1]));
    const palette=rows[0]?.children.length===2&&(CONTEXT.test(text(rows[0]))||rows.slice(1).some(row=>CONTEXT.test(text(row.children[0]))))&&values.filter(value=>value&&new RegExp(HEX+"(?![A-Za-z0-9_])","iu").test(value)).length>=2&&values.every(value=>value&&value.length<80);
    if(palette){
     const entries:Blockquote["children"]=rows.map((row,index)=>({type:"blockquote",data:{hName:index?"atlas-palette-row":"atlas-palette-head"},children:row.children.map((cell,column)=>({type:"paragraph",data:{hName:column?"atlas-palette-value":"atlas-palette-name"},children:cell.children}))}));
     Object.assign(node,{type:"blockquote",data:{hName:"atlas-palette"},children:entries});
     for(const entry of entries)visit(entry,true);return;
    }
    for(const row of rows)for(const cell of row.children)visit(cell,CONTEXT.test(text(rows[0]))||CONTEXT.test(text(row)));return;
   }
   if(node.type==="inlineCode")return;
   if(!("children" in node))return;
   const inside=context||node.type==="paragraph"&&CONTEXT.test(text(node));
   const children=node.children as RootContent[];
   for(let at=0;at<children.length;at++){
    const child=children[at];
    if(child.type==="text"&&inside){const replacement=colorText(child.value);children.splice(at,1,...replacement as RootContent[]);at+=replacement.length-1;}
    else if(child.type==="inlineCode"&&inside&&!identifierBefore(at?text(children[at-1]):"")){
     if(colorValue.test(child.value))children[at]=tagged("atlas-color",[{type:"text",value:child.value}]) as RootContent;
     else if(colorPair.test(child.value))children[at]=tagged("atlas-colors",colorText(child.value)) as RootContent;
    }
    else visit(child,inside);
   }
  };
  visit(tree);
 };
}
export const readerColorComponents={
 "atlas-colors":({children}:{children?:ReactNode})=>createElement("span",{className:"reader-color-pair"},children),
 "atlas-color":({children}:{children?:ReactNode})=>{
  const value=typeof children==="string"?children:"";
  return createElement("code",{className:"reader-color-code"},colorValue.test(value)?createElement("span",{className:"reader-color-swatch",style:{backgroundColor:value},"aria-hidden":true}):null,children);
 },
 "atlas-palette":({children}:{children?:ReactNode})=>createElement("dl",{className:"reader-palette"},children),
 "atlas-palette-row":({children}:{children?:ReactNode})=>createElement("div",{className:"reader-palette-entry"},children),
 "atlas-palette-head":({children}:{children?:ReactNode})=>createElement("div",{className:"reader-palette-head"},children),
 "atlas-palette-name":({children}:{children?:ReactNode})=>createElement("dt",null,children),
 "atlas-palette-value":({children}:{children?:ReactNode})=>createElement("dd",null,children),
} as unknown as Components;
