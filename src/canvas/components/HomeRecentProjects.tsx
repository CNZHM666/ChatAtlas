import { useState } from "react";
import { FolderGit2, Search } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import { groupFocusVersions } from "../focus-versions";
import { relativeDay } from "../relative-day";
import { FocusVersions } from "./FocusVersions";
import "../project-knowledge-links.css";

/** How many projects the home shows before 查看全部, and from how many a search box helps find one. */
const SHOWN = 4, SEARCH_FROM = 7;

export function HomeRecentProjects({sessions,zh,onOpen}:{sessions:FocusSession[];zh:boolean;onOpen:(id:string)=>void}) {
  const [all,setAll]=useState(false),[query,setQuery]=useState(""),groups=groupFocusVersions(sessions.filter(session=>session.mode==="work"));
  if(!groups.length)return null;
  const words=query.trim().toLowerCase();
  const shown=all?groups.filter(group=>!words||group.versions.some(session=>`${session.title} ${session.goal}`.toLowerCase().includes(words))):groups.slice(0,SHOWN);
  return <section className="home-section home-recent-projects" aria-label={zh?"最近项目":"Recent projects"}>
    <header className="home-list-header"><h2>{zh?"最近项目":"Recent projects"}</h2><span className="home-list-count">{groups.length}</span>
      {groups.length>SHOWN?<button type="button" className="home-list-toggle" onClick={()=>{setAll(!all);setQuery("");}}>{all?zh?"收起":"Show less":zh?`查看全部 ${groups.length} 个项目`:`View all ${groups.length} projects`}</button>:null}</header>
    {all&&groups.length>=SEARCH_FROM?<label className="home-list-search"><Search size={14} aria-hidden="true"/><span className="sr-only">{zh?"搜索项目":"Search projects"}</span><input type="search" value={query} onChange={event=>setQuery(event.target.value)} placeholder={zh?"按名称查找项目":"Find a project by name"}/></label>:null}
    <div className={`home-list${all?" is-all":""}`}>
      {shown.map(group=>{const session=group.latest,updated=Math.max(...group.versions.map(item=>item.updatedAt));return <div key={group.id} className={`home-list-item${group.versions.length>1?" has-history":""}`}>
        <button type="button" className="home-list-row" onClick={()=>onOpen(session.id)}><FolderGit2 size={16} aria-hidden="true"/><strong title={session.title}>{session.title}</strong>
          <span className="home-list-meta">{session.status==="preview"?<small className="home-list-state is-pending">{zh?"待确认预览":"Preview to review"}</small>:null}<small className="home-list-time" title={new Date(updated).toLocaleString(zh?"zh-CN":"en")}>{relativeDay(updated,zh)}</small></span></button>
        <FocusVersions compact group={group} zh={zh} onOpen={onOpen}/></div>;})}
      {all&&!shown.length?<p className="home-list-empty">{zh?"没有名称包含这些字的项目。":"No project name contains that."}</p>:null}
    </div>
  </section>;
}
