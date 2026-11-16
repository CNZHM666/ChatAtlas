import {Children,isValidElement,useState,type ReactNode} from "react";
/** Closed source attachments retain their literal input without mounting costly
 * code previews, diagrams or interactive examples until the reader opens them. */
export function ReaderSourceSupplement({children}:{children?:ReactNode}){
 const [open,setOpen]=useState(false);
 const [title,...rest]=Children.toArray(children).filter(child=>typeof child!=="string"||child.trim());
 const label=isValidElement<{children?:ReactNode}>(title)?title.props.children:title;
 return <details className="reader-supplement wiki-source-supplement" onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span>{label}</span><span className="wiki-supplement-chevron" aria-hidden="true" /></summary>
  {open&&<div className="wiki-supplement-content">{rest}</div>}
 </details>;
}
