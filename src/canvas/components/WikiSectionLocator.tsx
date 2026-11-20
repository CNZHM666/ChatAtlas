import {useEffect,useMemo,useRef,useState,type RefObject} from "react";
import {createPortal} from "react-dom";
import {wikiOutline,type WikiHeading} from "../wiki-document";

/** The chapter's main reading sections share the quiet tick navigation used by
 * the Reader. Nested headings remain in the article, without another long tree. */
export function WikiSectionLocator({headings,contentRef,scrollRef,zh,selector=".chapter-guide :is(h1,h2,h3,h4,h5,h6)",label,observeMutations=true}:{
  headings:WikiHeading[];contentRef:RefObject<HTMLDivElement|null>;
  scrollRef?:RefObject<HTMLElement|null>;zh:boolean;selector?:string;label?:string;observeMutations?:boolean;
}) {
  const sections=useMemo(()=>wikiOutline(headings),[headings]);
  const [active,setActive]=useState(0),[expanded,setExpanded]=useState(false);
  const activeIndex=useRef(0);
  const [placement,setPlacement]=useState<{host:HTMLElement;top:number;right:number;height:number}>();
  const navigation=useRef<HTMLElement>(null);
  const targets=()=>[...contentRef.current?.querySelectorAll<HTMLElement>(selector)??[]];
  useEffect(()=>{
    const content=contentRef.current;
    const root=scrollRef?.current??content?.closest<HTMLElement>(".focus-reading-body")??content;
    const host=root?.parentElement;
    if(!content||!root||!host||sections.length<2){setPlacement(undefined);return;}
    let frame=0,layoutChanged=true;
    let offsets:number[]=[],height=0,end=0;
    const update=()=>{
      frame=0;
      const top=root.scrollTop;
      if(layoutChanged){
        layoutChanged=false;
        const bounds=root.getBoundingClientRect(),parent=host.getBoundingClientRect();
        height=root.clientHeight;
        end=root.scrollHeight-height;
        const nodes=[...content.querySelectorAll<HTMLElement>(selector)];
        offsets=sections.map(section=>{
          const node=nodes[section.headingIndex];
          return node?node.getBoundingClientRect().top-bounds.top+top:Infinity;
        });
        const next={host,top:bounds.top-parent.top+height/2,right:Math.max(8,parent.right-bounds.right+8),height:Math.max(80,height-48)};
        setPlacement(previous=>previous&&previous.host===host&&previous.top===next.top&&previous.right===next.right&&previous.height===next.height?previous:next);
      }
      const boundary=top+Math.min(160,height*.28);
      let current=0;
      offsets.forEach((offset,index)=>{if(offset<=boundary)current=index;});
      // A short final section cannot always reach the upper reading boundary.
      // At the end of the document it still owns the current reading position.
      if(end>1&&end-top<=2)current=sections.length-1;
      if(activeIndex.current!==current){activeIndex.current=current;setActive(current);}
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
    const remeasure=()=>{layoutChanged=true;schedule();};
    root.addEventListener("scroll",schedule,{passive:true});
    window.addEventListener("resize",remeasure);
    content.addEventListener("toggle",remeasure,true);
    const resize=typeof ResizeObserver==="undefined"?undefined:new ResizeObserver(remeasure);
    for(const element of new Set([root,host,content]))resize?.observe(element);
    if(content===root)for(const child of content.children)resize?.observe(child);
    const mutation=observeMutations?new MutationObserver(remeasure):undefined;
    mutation?.observe(content,{subtree:true,childList:true,characterData:true});
    setExpanded(false);update();
    return()=>{root.removeEventListener("scroll",schedule);window.removeEventListener("resize",remeasure);content.removeEventListener("toggle",remeasure,true);resize?.disconnect();mutation?.disconnect();if(frame)cancelAnimationFrame(frame);};
  },[sections,contentRef,scrollRef,selector,observeMutations]);
  if(!placement||sections.length<2)return null;
  const focusHeading=(index:number,scroll:boolean)=>{
    const heading=targets()[sections[index]?.headingIndex];if(!heading)return;
    if(scroll)heading.scrollIntoView?.({block:"start",behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"instant":"smooth"});
    heading.tabIndex=-1;heading.focus({preventScroll:true});setExpanded(false);
  };
  return createPortal(<nav ref={navigation} className={`wiki-section-locator${expanded?" is-expanded":""}`} aria-label={label??(zh?"本章快捷导航":"Chapter navigation")}
    style={{top:placement.top,right:placement.right,maxHeight:placement.height}}
    onPointerEnter={()=>setExpanded(true)} onPointerLeave={()=>{if(!navigation.current?.contains(document.activeElement))setExpanded(false);}}
    onFocus={()=>setExpanded(true)} onBlur={event=>{if(!event.currentTarget.contains(event.relatedTarget))setExpanded(false);}}
    onKeyDown={event=>{
      if(event.key==="Escape"){event.preventDefault();event.stopPropagation();focusHeading(active,false);return;}
      const buttons=[...event.currentTarget.querySelectorAll<HTMLButtonElement>("button")],index=buttons.indexOf(document.activeElement as HTMLButtonElement);
      const next=event.key==="ArrowDown"?(index+1)%buttons.length:event.key==="ArrowUp"?(index-1+buttons.length)%buttons.length:event.key==="Home"?0:event.key==="End"?buttons.length-1:-1;
      if(next>=0){event.preventDefault();buttons[next]?.focus();}
    }}>
    {sections.map((section,index)=><button type="button" key={section.headingIndex} title={section.title} aria-label={section.title} aria-current={index===active?"location":undefined} tabIndex={index===active?0:-1} onClick={()=>{activeIndex.current=index;setActive(index);focusHeading(index,true);}}>
      <span className="wiki-section-locator-label">{section.title}</span><span className="wiki-section-locator-tick" aria-hidden="true"/>
    </button>)}
  </nav>,placement.host);
}
