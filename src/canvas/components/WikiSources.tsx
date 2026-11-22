import { useState } from "react";
import { Link2 } from "lucide-react";
import type { FocusSection, FocusSession } from "../../shared/focus-session";
import { ChapterSources } from "./ChapterSources";
import { WorkspaceDisclosureTitle } from "./WorkspaceDisclosureTitle";
// Where a chapter comes from: the conversation turns it cites, one row each. Each claim is checked from the
// header's evidence review and its markers in the prose, so no second list or count of claims is shown here.
export function WikiSources({section,session,zh,onLocate}:{section:FocusSection;session:FocusSession;zh:boolean;onLocate:(ref:FocusSession["evidence"][number])=>void}){
 const [open,setOpen]=useState(false);
 const ids=new Set([...section.evidenceIds,...(section.claims??[]).flatMap(claim=>claim.evidenceIds)]),refs=session.evidence.filter(ref=>ids.has(ref.id)&&ref.conversationId&&ref.messageId);
 if(!refs.length)return ids.size?<p className="muted wiki-source-unavailable">{zh?"已保存的历史来源暂不可定位。":"Saved historical sources cannot currently be located."}</p>:null;
 return <details className="wiki-sources-unified wiki-chapter-supplement" onToggle={event=>setOpen(event.currentTarget.open)}>
  <WorkspaceDisclosureTitle icon={Link2} label={zh?"来源与原始讨论":"Sources and original discussions"}/>
  {open?<div className="wiki-supplement-content">
   {section.userEdited||section.origin?<small className="muted">{zh?"历史参考，不作为个人改写的直接证明。":"Historical reference, not proof of personal edits."}</small>:null}
   <ChapterSources compact session={session} refs={refs} conversations={[]} zh={zh} onLocate={onLocate}/>
  </div>:null}
 </details>;
}
