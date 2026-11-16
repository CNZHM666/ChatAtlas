import {Component,useEffect,useRef,useState,type ReactNode} from "react";
import {queueReaderRender} from "../reader-render-queue";
import {downloadUiFailures,recordUiFailure} from "../ui-failure";

class PreviewBoundary extends Component<{children:ReactNode;raw:string;zh:boolean},{failed:boolean;raw:boolean}>{
 state={failed:false,raw:false};
 static getDerivedStateFromError(){return {failed:true};}
 componentDidCatch(error:unknown){recordUiFailure(error,"preview-content");}
 render(){
  if(!this.state.failed)return this.props.children;
  const {zh,raw}=this.props;
  return <section className="preview-render-error" role="alert"><p>{zh?"这部分预览未能显示，草稿仍然保留。":"This preview could not be displayed. The draft is retained."}</p>
   <div><button onClick={()=>this.setState({failed:false,raw:false})}>{zh?"重试显示":"Retry view"}</button><button onClick={()=>this.setState({raw:!this.state.raw})}>{zh?"查看原始正文":"View raw text"}</button><button onClick={downloadUiFailures}>{zh?"导出诊断":"Export diagnostics"}</button></div>
   {this.state.raw?<pre className="preview-raw-text">{raw}</pre>:null}</section>;
 }
}
/** First paint contains the preview shell and chapter headings. Markdown work
 * starts in separate tasks only near the viewport; no offscreen full-document mount. */
export function PreviewContent({children,raw,zh}:{children:ReactNode;raw:string;zh:boolean}){
 const root=useRef<HTMLDivElement>(null),[ready,setReady]=useState(false);
 useEffect(()=>{
  let stopped=false,cancel:(()=>void)|undefined;
  const schedule=()=>{if(!cancel)cancel=queueReaderRender(()=>{if(!stopped)setReady(true);});};
  const observer=typeof IntersectionObserver==="undefined"?undefined:new IntersectionObserver(entries=>{if(entries.some(entry=>entry.isIntersecting)){schedule();observer?.disconnect();}},{rootMargin:"240px"});
  if(observer&&root.current)observer.observe(root.current);else schedule();
  return()=>{stopped=true;observer?.disconnect();cancel?.();};
 },[]);
 return <div ref={root} className="preview-content">
  {ready
   ? <PreviewBoundary key={raw} raw={raw} zh={zh}>{children}</PreviewBoundary>
   : <div className="preview-content-pending">
    <span role="status">{zh?"正在准备预览…":"Preparing preview…"}</span>
    <button type="button" onClick={()=>setReady(true)}>{zh?"立即查看":"Show now"}</button>
   </div>}
 </div>;
}
