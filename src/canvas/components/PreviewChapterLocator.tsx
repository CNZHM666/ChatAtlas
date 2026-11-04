import {useEffect,useState,type RefObject} from "react";
import {WikiSectionLocator} from "./WikiSectionLocator";
import type {WikiHeading} from "../wiki-document";

/** Follow the chapters actually visible in changes-only and full previews. */
export function PreviewChapterLocator({contentRef,zh}:{contentRef:RefObject<HTMLDivElement|null>;zh:boolean}){
 const [headings,setHeadings]=useState<WikiHeading[]>([]);
 useEffect(()=>{
  const root=contentRef.current;if(!root)return;
  const update=()=>{
   const next=[...root.querySelectorAll<HTMLElement>(".wiki-chapter-preview-heading h2")].map((node,headingIndex)=>({title:node.textContent??"",depth:2,headingIndex}));
   setHeadings(previous=>JSON.stringify(previous)===JSON.stringify(next)?previous:next);
  };
  update();const observer=new MutationObserver(update);observer.observe(root,{childList:true,subtree:true,characterData:true});return()=>observer.disconnect();
 },[contentRef]);
 return <WikiSectionLocator contentRef={contentRef} scrollRef={contentRef} headings={headings} zh={zh} selector=".wiki-chapter-preview-heading h2" label={zh?"预览章节切换":"Preview chapters"}/>;
}
