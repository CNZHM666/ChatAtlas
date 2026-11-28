import {Children,isValidElement,useState,type ReactNode} from "react";
/** Closed source attachments retain their literal input without mounting costly
 * code previews, diagrams or interactive examples until the reader opens them. */
export function WikiDisclosure({label,children,className,name,defaultOpen=false}:{label:ReactNode;children?:ReactNode;className?:string;name?:string;defaultOpen?:boolean}){
 const [open,setOpen]=useState(defaultOpen);
 return <details className={["wiki-source-supplement",className].filter(Boolean).join(" ")} name={name} open={open} onToggle={event=>setOpen(event.currentTarget.open)}>
  <summary><span>{label}</span><span className="wiki-supplement-chevron" aria-hidden="true" /></summary>
  {open&&<div className="wiki-supplement-content">{children}</div>}
 </details>;
}

export function ReaderSourceSupplement({children}:{children?:ReactNode}){
 const [title,...rest]=Children.toArray(children).filter(child=>typeof child!=="string"||child.trim());
 const label=isValidElement<{children?:ReactNode}>(title)?title.props.children:title;
 return <WikiDisclosure label={label} className="reader-supplement">{rest}</WikiDisclosure>;
}
