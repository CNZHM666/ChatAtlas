import { useState } from "react";
import { ArrowRight, FolderGit2 } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import { groupFocusVersions } from "../focus-versions";
import { FocusVersions } from "./FocusVersions";
import "../project-knowledge-links.css";
export function HomeRecentProjects({sessions,zh,onOpen}:{sessions:FocusSession[];zh:boolean;onOpen:(id:string)=>void}) {
  const [all,setAll]=useState(false),groups=groupFocusVersions(sessions.filter(session=>session.mode==="work"));
  if(!groups.length)return null;
  return <section className="home-section home-recent-projects" aria-label={zh?"最近项目":"Recent projects"}><header><h2>{zh?"最近项目":"Recent projects"}</h2>{groups.length>3?<button type="button" onClick={()=>setAll(!all)}>{all?zh?"收起":"Show less":zh?`查看全部 ${groups.length} 个项目`:`View all ${groups.length} projects`}</button>:null}</header><div className="reading-list">{groups.slice(0,all?undefined:3).map(group=>{const session=group.latest;return <div key={group.id} className="focus-result-group"><button type="button" onClick={()=>onOpen(session.id)}><FolderGit2 size={19} aria-hidden="true"/><span><strong>{session.title}</strong><small><span>{session.status==="preview"?zh?"待确认预览":"Preview to review":zh?"已保存文档":"Saved document"}</span> · {zh?"最近维护":"Updated"} {new Date(session.updatedAt).toLocaleDateString(zh?"zh-CN":"en")}</small></span><ArrowRight size={16} aria-hidden="true"/></button><FocusVersions compact group={group} zh={zh} onOpen={onOpen}/></div>;})}</div></section>;
}
