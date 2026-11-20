import {useEffect,useState,type RefObject} from "react";
import {WikiSectionLocator} from "./WikiSectionLocator";
import type {WikiHeading} from "../wiki-document";

const headingSelector=".wiki-chapter-preview-heading h2";

/** Follow the chapters actually visible in changes-only and full previews. */
export function PreviewChapterLocator({contentRef,zh}:{contentRef:RefObject<HTMLDivElement|null>;zh:boolean}){
 const [headings,setHeadings]=useState<WikiHeading[]>([]);
 useEffect(()=>{
  const root=contentRef.current;if(!root)return;
  const update=()=>{
   const next=[...root.querySelectorAll<HTMLElement>(headingSelector)].map((node,headingIndex)=>({title:node.textContent??"",depth:2,headingIndex}));
   setHeadings(previous => previous.length===next.length && previous.every((heading,index)=>heading.title===next[index].title)?previous:next);
  };
  update();
  const observer=new MutationObserver(records=>{
   if(records.some(({target,addedNodes,removedNodes})=>{
    const element=target instanceof Element?target:target.parentElement;
    if(element?.closest(".preview-content"))return false;
    return Boolean(element?.closest(headingSelector)) || [...addedNodes,...removedNodes].some(node=>
     node instanceof Element && (node.matches(headingSelector) || node.querySelector(".wiki-chapter-preview-heading")));
   }))update();
  });
  observer.observe(root,{childList:true,subtree:true,characterData:true});
  return()=>observer.disconnect();
 },[contentRef]);
 return <WikiSectionLocator contentRef={contentRef} scrollRef={contentRef} headings={headings} zh={zh} selector={headingSelector} observeMutations={false} label={zh?"预览章节切换":"Preview chapters"}/>;
}
