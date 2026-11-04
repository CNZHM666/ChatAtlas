import {useState} from "react";
import {Check,MessagesSquare,MessageSquare,FolderOpen,Search} from "lucide-react";
import type {Conversation} from "../shared/types";
import {SidecarSheet} from "./SidecarSheet";

export function SidecarScopePicker({zh,source,conversationId,conversations,hasProject,onChoose,onClose}:{zh:boolean;source:string;conversationId:string;conversations:Conversation[];hasProject:boolean;onChoose:(source:string)=>void;onClose:()=>void}){
 const [filter,setFilter]=useState("");const l=(cn:string,en:string)=>zh?cn:en;
 const choose=(id:string,label:string,Icon:typeof Check,description?:string)=><button type="button" key={id} role="option" aria-selected={source===id} onClick={()=>onChoose(id)}><Icon size={16}/><span><strong>{label}</strong>{description?<small>{description}</small>:null}</span>{source===id?<Check size={15}/>:null}</button>;
 const current=conversations.find(item=>item.id===conversationId);
 const matches=conversations.filter(item=>item.id!==conversationId&&item.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()));
 return <SidecarSheet title={l("资料范围","Material scope")} zh={zh} onClose={onClose} variant="menu"><div className="memory-scope-picker" onKeyDown={event=>{
  if(!(event.target instanceof HTMLElement)||event.target.getAttribute("role")!=="option"||!["ArrowDown","ArrowUp","Home","End"].includes(event.key))return;
  event.preventDefault();const options=Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')),index=options.indexOf(event.target as HTMLButtonElement);
  const next=event.key==="Home"?0:event.key==="End"?options.length-1:(index+(event.key==="ArrowDown"?1:-1)+options.length)%options.length;
  options[next]?.focus();
 }}>
  <div role="listbox" aria-label={l("查找范围","Search scope")}>
   {choose("",l("全部已导入对话","Imported chats"),MessagesSquare)}
   {current?choose(current.id,l("当前对话","Current chat"),MessageSquare,current.title):null}
   {hasProject?choose("@project",l("当前项目","Current project"),FolderOpen):null}
  </div>
  {conversations.some(item=>item.id!==conversationId)?<><label className="memory-scope-search"><Search size={14}/><input type="search" aria-label={l("筛选对话","Filter conversations")} placeholder={l("搜索对话…","Search chats…")} value={filter} onChange={event=>setFilter(event.target.value)}/></label><div role="listbox" aria-label={l("指定对话","Choose conversation")}>{matches.map(item=>choose(item.id,item.title,MessageSquare))}{!matches.length?<p>{l("没有匹配的对话","No matching chats")}</p>:null}</div></>:null}
 </div></SidecarSheet>;
}
