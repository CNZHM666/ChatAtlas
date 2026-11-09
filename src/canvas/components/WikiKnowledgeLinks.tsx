import { useContext, useId, useState } from "react";
import { ArrowUpRight, Link2 } from "lucide-react";
import type { FocusSection, FocusSession } from "../../shared/focus-session";
import { linkedMatterKnowledge, linkMatterKnowledge, setRelatedKnowledge, unlinkMatterKnowledge, matterIdentity, matterKnowledgeSignature } from "../../shared/project-knowledge-links";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { matterReadingSummary, matterReadingTitle } from "../matter-reading";
import { RecordDetailActions, RecordDetailDrawer } from "./RecordDetailDrawer";
import { WorkspaceMoreMenu } from "./WorkspaceMoreMenu";
import { generatedProse } from "../../shared/generated-structure-prose";
import { evidencePresentation } from "../evidence-presentation";
import "../project-knowledge-links.css";

export function WikiKnowledgeLinks({session,section,zh,editing=false}:{session:FocusSession;section:FocusSection;zh:boolean;editing?:boolean}) {
  const editorFormId=useId();
  const actions=useContext(ProjectKnowledgeActions),[mode,setMode]=useState<"chapters"|"unlink"|"sync">(),[selected,setSelected]=useState(""),[ids,setIds]=useState<string[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const records=linkedMatterKnowledge(session,section).filter(item=>editing||item.matter),related=(section.relatedKnowledgeIds??[]).map(id=>session.sections.find(item=>item.id===id)).filter(item=>editing||item),record=records.find(item=>matterIdentity(item.link)===selected);
  const l=(cn:string,en:string)=>zh?cn:en;
  const start=(next:typeof mode,id="")=>{setMode(next);setSelected(id);setError("");if(next==="chapters")setIds(section.relatedKnowledgeIds??[]);};
  const save=async(update:(current:FocusSession)=>FocusSession)=>{if(!actions)return;setBusy(true);setError("");try{await actions.save(update);setMode(undefined);}catch(failure){setError(failure instanceof Error?failure.message:l("保存失败，请重试。","Save failed; retry."));}finally{setBusy(false);}};
  if(!records.length&&!related.length&&!editing)return null;
  return <div className="wiki-knowledge-links">
    {records.length?<section><header><h2>{l("相关知识","Related knowledge")}</h2><small>{records.length} {l("条","items")}</small></header>{records.map(item=>{
      const prose=section.userEdited||section.origin?section.body:evidencePresentation(generatedProse(section.body,session.evidence.filter(ref=>section.evidenceIds.includes(ref.id)).map(ref=>ref.excerpt)).body);
      const summary=item.matter?matterReadingSummary(item.matter,prose,zh):undefined;
      return <div className="wiki-linked-conclusion" key={matterIdentity(item.link)}><h3>{item.matter?matterReadingTitle(item.matter):l("事项暂不可用","Matter unavailable")}</h3>
        {item.current?summary&&!summary.inBody?<p>{summary.text}</p>:null:<p className="muted">{l("事项已变化、重开或移除；关联结论待同步核对。","Matter changed, reopened or removed; review this conclusion link.")}</p>}
        <footer><small><Link2 size={14} aria-hidden="true"/>{item.current?l("已关联项目事项","Linked project matter"):l("待同步","Needs review")}</small>{actions?<div>{item.matter?<button type="button" onClick={()=>actions.matter(item.link)}>{l("查看依据","View evidence")}<ArrowUpRight size={14} aria-hidden="true"/></button>:null}
          {editing?<WorkspaceMoreMenu label={l("事项关联操作","Matter link actions")}>{!item.current&&item.matter?.status==="resolved"&&item.matter.resolution?<button type="button" onClick={event=>{event.currentTarget.closest("details")!.open=false;start("sync",matterIdentity(item.link));}}>{l("核对最新结论","Review latest conclusion")}</button>:null}<button type="button" onClick={event=>{event.currentTarget.closest("details")!.open=false;start("unlink",matterIdentity(item.link));}}>{l("移除关联","Remove link")}</button></WorkspaceMoreMenu>:null}
        </div>:null}</footer></div>;
    })}</section>:null}
    {related.length?<section><header>{!records.length?<h2>{l("相关知识","Related knowledge")}</h2>:null}</header>{related.length?<ul>{related.map((item,index)=><li key={item?.id??`missing:${index}`}>{item?<button type="button" onClick={()=>actions?.read(item.id)}><Link2 size={15} aria-hidden="true"/>{item.wikiDisplayTitle||item.title}</button>:<small>{l("关联章节暂不可用","Linked chapter unavailable")}</small>}</li>)}</ul>:null}</section>:null}
    {mode?<RecordDetailDrawer session={session} title={mode==="chapters"?l("关联章节","Link chapters"):mode==="unlink"?l("移除事项关联","Remove matter link"):l("核对最新结论","Review latest conclusion")} label={l("知识维护","Knowledge maintenance")} zh={zh} locked={busy||mode==="chapters"} onClose={()=>setMode(undefined)}>
      {error?<p role="alert">{error}</p>:null}
      {mode==="chapters"?<form id={editorFormId} className="project-record-editor" onSubmit={event=>{event.preventDefault();void save(current=>setRelatedKnowledge(current,section.id,ids));}}>{session.sections.filter(item=>item.id!==section.id).map(item=><label key={item.id}><input type="checkbox" checked={ids.includes(item.id)} disabled={busy} onChange={event=>setIds(event.target.checked?[...ids,item.id]:ids.filter(id=>id!==item.id))}/>{item.title}</label>)}<RecordDetailActions><button form={editorFormId} type="submit" disabled={busy}>{l("保存关联","Save links")}</button><button type="button" disabled={busy} onClick={()=>setMode(undefined)}>{l("取消","Cancel")}</button></RecordDetailActions></form>:record?<>
        <h3>{record.matter?matterReadingTitle(record.matter):l("事项暂不可用","Matter unavailable")}</h3>
        {mode==="sync"?<><h3>{l("原始事项","Original matter")}</h3><p>{record.matter?.text}</p><h3>{l("最新结论","Latest conclusion")}</h3><p>{record.matter?.resolution}</p>{record.matter?.resolutionReason?<p>{record.matter.resolutionReason}</p>:null}<p className="muted">{l("同步仅更新事项关联，不改写 Wiki 正文；历史消息不自动证明个人结论。","Sync updates the link, not the article. Historical messages do not automatically prove a personal conclusion.")}</p></>:<p>{l("只解除本章节与事项的关联，保留 Wiki 正文、事项结论和历史来源。","Only remove this chapter’s matter link. Article prose, conclusions and historical sources stay intact.")}</p>}
        <RecordDetailActions><button type="button" disabled={busy} onClick={()=>void save(current=>mode==="unlink"?unlinkMatterKnowledge(current,record.link,section.id):linkMatterKnowledge(current,record.link,section.id,matterKnowledgeSignature(record.matter!)))}>{mode==="unlink"?l("确认移除关联","Confirm removal"):l("确认同步最新结论","Confirm latest conclusion")}</button><button type="button" disabled={busy} onClick={()=>setMode(undefined)}>{l("取消","Cancel")}</button></RecordDetailActions>
      </>:<p>{l("事项已变化，请关闭后重试。","Matter changed; close and retry.")}</p>}
    </RecordDetailDrawer>:null}
  </div>;
}
