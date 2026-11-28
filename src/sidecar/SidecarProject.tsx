import {useCallback,useEffect,useRef,useState} from "react";
import {MessageSquare,RefreshCw,Download,X} from "lucide-react";
import {SidecarHeader} from "./SidecarHeader";
import {SidecarLibraryFooter} from "./SidecarLibraryFooter";
import {SidecarProjectLinker} from "./SidecarProjectLinker";
import {SidecarProjectWiki} from "./SidecarProjectWiki";
import {sendSidecarMessage} from "./host";
import type {FocusSession} from "../shared/focus-session";
import type {Conversation} from "../shared/types";
import type {AtlasMessage,CaptureCommandResponse,NavigationResponse} from "../shared/messages";
import {getDatabase} from "../storage/db";
import {listFocusSessions} from "../storage/focus-sessions";
import {linkSidecarProject,unlinkSidecarProject} from "../storage/sidecar-links";
import {savedFocusProjects} from "../canvas/focus-versions";
import {isCurrentHydrationComplete} from "../sync/import-state";
import {WEB_CAPTURE_PLATFORMS} from "../shared/web-capture";
import {conversationDisplayTitle,platformName} from "../shared/platforms";
import {useNoticeDismissal} from "../shared/use-notice-dismissal";
import {currentSourceChange,hasSourceChange,sourceChangeLabels,type SourceChange} from "../canvas/source-freshness";

const updateNoticeKey=(projectId:string|undefined,conversationId:string)=>`atlas-sidecar-update:${JSON.stringify([projectId,conversationId])}`;

export function SidecarProject({conversationId,conversationTitle="",zh,platformLabel,onToggleLanguage}: {conversationId:string;conversationTitle?:string;zh:boolean;platformLabel?:string;onToggleLanguage?:()=>void}) {
 const [projects,setProjects]=useState<FocusSession[]>([]),[conversations,setConversations]=useState<Conversation[]>([]),[selected,setSelected]=useState<string>(),[loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState("");
 const alive=useRef(true),sending=useRef(false),openingProject=useRef(false),refreshRevision=useRef(0),currentConversationId=useRef(conversationId);currentConversationId.current=conversationId;
 const label=(cn:string,en:string)=>zh?cn:en;
 useEffect(()=>{setStatus("");setError("");setSelected(undefined);},[conversationId]);
 // A confirmation is read once: it fades after a few seconds and can be dismissed at once.
 useEffect(()=>{if(!status)return;const timer=window.setTimeout(()=>setStatus(""),5000);return()=>window.clearTimeout(timer);},[status]);
 const current=conversations.find(item=>item.id===conversationId),currentImported=Boolean(current&&isCurrentHydrationComplete(current));
 const pageCapture=WEB_CAPTURE_PLATFORMS.some(site=>conversationId.startsWith(`${site.id}:`));
 const currentPlatform=current?.platform??(platformLabel||(pageCapture?conversationId.split(":")[0]:"chatgpt"));
 const title=conversationDisplayTitle(current?.title||conversationTitle,currentPlatform)||label("当前 AI 对话","Current AI conversation");
 const isLinked=(session:FocusSession)=>Boolean(conversationId&&(session.sourceConversationIds.includes(conversationId)||session.sidecarConversationIds?.includes(conversationId)));
 const project=projects.find(item=>item.id===selected),related=projects.filter(isLinked);
 const projectRef=useRef(project);projectRef.current=project;
 const projectId=project?.id;
 const projectKey=project?.canvasId??project?.rootSessionId??projectId;
 const included=project?.sourceConversationIds.includes(conversationId)??false;
 const linked=Boolean(project&&isLinked(project));
 const [wikiSelection,setWikiSelection]=useState<{projectKey?:string;conversationId:string;chapterId:string}>();
 const selectedChapter=linked&&wikiSelection?.conversationId===conversationId&&wikiSelection.projectKey===projectKey?wikiSelection.chapterId:undefined;
 const chapterId=project?.sections.some(section=>section.id===selectedChapter&&section.body.trim())?selectedChapter:undefined;
 const readChapter=useCallback((id?:string)=>setWikiSelection(id?{projectKey,conversationId,chapterId:id}:undefined),[projectKey,conversationId]);
 const freshnessKey=JSON.stringify([projectId,conversationId]);
 const freshnessRevision=JSON.stringify([project?.updatedAt,current?.rawRevision??current?.updatedAt,current?.hydrationState,current?.hydratedSourceUpdatedAt]);
 // The one bridge back to the workspace: this chat holds material the linked document has not organized yet.
 const [checked,setChecked]=useState<{key:string;change:SourceChange}>();
 const {dismissedRevision,rememberDismissal}=useNoticeDismissal();
 const noticeKey=updateNoticeKey(projectKey,conversationId);
 useEffect(()=>{
  const saved=projectRef.current;
  if(!saved||!conversationId||!included||!currentImported)return;
  let live=true;
  void currentSourceChange(saved,conversationId).then(change=>{
   if(!live)return;
   setChecked({key:freshnessKey,change});
   if(!change.unknown&&!hasSourceChange(change))rememberDismissal(noticeKey);
  }).catch(()=>undefined);
  return()=>{live=false;};
 },[freshnessKey,freshnessRevision,conversationId,included,currentImported,noticeKey,rememberDismissal]);
 const change=currentImported&&checked?.key===freshnessKey?checked.change:undefined;
 const notice=linked&&(!included?"linked":change&&hasSourceChange(change)?change.fingerprint??sourceChangeLabels(change,false):undefined);
 const noticeRevision=notice?JSON.stringify([projectId,notice]):undefined;
 const savedDismissal=noticeRevision?dismissedRevision(noticeKey):undefined;
 const openProject=async(sessionId:string,sectionId?:string)=>{
  if(openingProject.current)return;
  openingProject.current=true;setError("");
  try{
   const result=await sendSidecarMessage({type:"ATLAS_OPEN_REVIEW",sessionId,...(sectionId?{sectionId}:{})}) as NavigationResponse;
   if(!result?.ok)throw new Error();
  }catch{
   if(alive.current&&currentConversationId.current===conversationId)setError(label("无法打开工作台，请重试。","Could not open the workspace. Try again."));
  }finally{openingProject.current=false;}
 };
  const refresh = useCallback(async () => {
    const revision=++refreshRevision.current;
    const db = await getDatabase();
    const [sessions, sources] = await Promise.all([listFocusSessions(), db.getAll("conversations")]);
    if (!alive.current || currentConversationId.current !== conversationId || revision!==refreshRevision.current) return;
    const saved = savedFocusProjects(sessions); setProjects(saved); setConversations(sources); setLoaded(true);
    setSelected(previous => {
      const matches=(item:FocusSession)=>item.sourceConversationIds.includes(conversationId)||item.sidecarConversationIds?.includes(conversationId);
      if(previous && saved.some(item=>item.id===previous&&matches(item)))return previous;
      const earlier=sessions.find(item=>item.id===previous);
      const sameProject=earlier&&saved.find(item=>matches(item)&&(item.canvasId&&item.canvasId===earlier.canvasId||(item.rootSessionId??item.id)===(earlier.rootSessionId??earlier.id)));
      return sameProject?.id??saved.find(matches)?.id??"";
    });
  }, [conversationId]);
  useEffect(() => {
    alive.current = true;
    const reload = () => { if (!document.hidden) void refresh().catch(() => { if (alive.current) { setLoaded(true); setError(label("项目读取失败，请重试。", "Could not load projects. Try again.")); } }); };
    reload(); const timer = window.setInterval(reload, 8000);
    window.addEventListener("focus", reload); document.addEventListener("visibilitychange", reload);
    const saved = (message: AtlasMessage) => { if (message.type === "ATLAS_CAPTURE_SAVED" && message.summary.conversationId === conversationId) reload(); };
    chrome.runtime.onMessage.addListener(saved);
    return () => { alive.current = false;  clearInterval(timer); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); chrome.runtime.onMessage.removeListener(saved); };
  // Locale is stable for this isolated frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, conversationId, zh]);
  const open = async (source?: Conversation) => {
    setError("");
    try { const result = await sendSidecarMessage(source ? { type: "ATLAS_OPEN_CONVERSATION", conversationId: source.id } : { type: "ATLAS_OPEN" }) as NavigationResponse; if (!result?.ok) throw new Error(label("无法打开 ChatAtlas，请重试。", "Unable to open ChatAtlas. Try again.")); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  const updateConversation = async () => {
    if (!loaded || !conversationId || sending.current) return;
    sending.current = true; setBusy(true); setError(""); setStatus("");
    try {
      const response = await sendSidecarMessage({ type: "ATLAS_SIDECAR_SYNC", conversationId } satisfies AtlasMessage) as CaptureCommandResponse;
      if (!response?.ok) throw new Error(response?.error || (currentImported ? label("更新失败，请重试。", "Could not update. Try again.") : label("导入失败，请重试。", "Could not import. Try again.")));
      if (alive.current && currentConversationId.current === conversationId) {
        await refresh();
        if (alive.current && currentConversationId.current === conversationId) {
          const change=response.summary?.change;
          setStatus(change==="unchanged"?label("已检查，没有发现新内容。","Checked. No new content.")
            : change==="imported"||!currentImported?label("当前对话已导入，可在工作台和对话库中查看。","Current conversation imported into the workbench and library.")
            : change==="updated"?pageCapture?label("已同步网页加载的新内容。","Newly loaded page content synced."):label("对话内容已更新。","Conversation content updated.")
            :label("已检查当前对话。","Conversation checked."));
        }
      }
    } catch (failure) { if (alive.current && currentConversationId.current === conversationId) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  const link = async (sessionId: string) => {
    if (sending.current || !conversationId) return false;
    sending.current = true; setBusy(true); setError(""); setStatus("");
    try {
      // Import this conversation first; DOM sources contain only loaded messages.
      if (!current || !isCurrentHydrationComplete(current)) {
        const response = await sendSidecarMessage({ type: "ATLAS_SIDECAR_SYNC", conversationId } satisfies AtlasMessage) as CaptureCommandResponse;
        if (!response?.ok) throw new Error(response?.error || label("当前对话导入失败，请重试。", "Could not import the current conversation. Retry."));
      }
      if (!alive.current || currentConversationId.current !== conversationId) return false;
      await linkSidecarProject(sessionId, conversationId);
      if (alive.current && currentConversationId.current === conversationId) {
        setSelected(sessionId);
        await refresh();
        if (alive.current && currentConversationId.current === conversationId) setStatus(label("已关联，整理时再确认项目更新", "Linked. Confirm project changes when organizing."));
      }
      return true;
    } catch (failure) { if (alive.current && currentConversationId.current === conversationId) setError(failure instanceof Error ? failure.message : String(failure)); return false; }
    finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  // A link made by mistake is undone here while the project has not organized the conversation.
  const unlink = async (item: FocusSession) => {
    if (sending.current || !conversationId) return false;
    sending.current = true; setBusy(true); setError(""); setStatus("");
    try {
      if (!await unlinkSidecarProject(item.id, conversationId)) return false;
      if (alive.current && currentConversationId.current === conversationId) {
        rememberDismissal(updateNoticeKey(item.canvasId??item.rootSessionId??item.id,conversationId));
        if (selected === item.id) setSelected(undefined);
        await refresh();
        if (alive.current && currentConversationId.current === conversationId) setStatus(label(`已取消与「${item.title}」的关联`, `Unlinked from “${item.title}”`));
      }
      return true;
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  const wiki=project&&linked&&project.sections.some(section=>section.body.trim())
    ? <SidecarProjectWiki key={projectKey} project={project} chapterId={chapterId} onRead={readChapter} zh={zh} onOpen={sectionId=>void openProject(project.id,sectionId)}/>
    : undefined;
  return <main className="sidecar-project" onKeyDown={event=>{if(event.key!=="Escape")return;if(chapterId)readChapter();else if(parent!==window)parent.postMessage({type:"ATLAS_SIDECAR_COLLAPSE"},"https://chatgpt.com");}}>
    {conversationId?<section className="sidecar-current sidecar-current-bar" aria-label={label("当前对话", "Current conversation")}>
      <div className="sidecar-current-title"><MessageSquare size={16}/><div className="sidecar-current-copy">{current?<button className="sidecar-current-name" title={title} aria-label={label("阅读当前对话","Read current conversation")} onClick={()=>void open(current)}><strong>{title}</strong></button>:<strong title={title}>{title}</strong>}<small>{platformLabel||(current?platformName(current.platform,zh?"zh-CN":"en"):"")||(conversationId?"ChatGPT":label("未识别当前对话","No conversation detected"))}{conversationId?` · ${currentImported?label("已导入","Imported"):label("未同步","Not synced")}`:""}</small></div><button className={`sidecar-update-button${currentImported?" is-imported":""}`} aria-busy={busy} aria-label={busy?label("正在同步对话","Syncing conversation"):currentImported?label("更新对话","Update chat"):label("导入当前对话","Import this chat")} title={currentImported?label("更新对话","Update chat"):label("导入当前对话","Import this chat")} disabled={busy||!loaded||!conversationId} onClick={()=>void updateConversation()}>{currentImported?<RefreshCw size={15}/>:<Download size={15}/>}</button>{onToggleLanguage?<SidecarHeader zh={zh} onToggleLanguage={onToggleLanguage} showBrand={false}/>:null}</div>
      {noticeRevision&&noticeRevision!==savedDismissal&&project?<div className="sidecar-pending-update">
        <span role="status">{included&&change?sourceChangeLabels(change,zh).join(" · "):label("已关联，待纳入项目 Wiki","Linked. Ready to add to the Wiki.")}</span>
        <div>
          <button type="button" className="sidecar-text-button" onClick={()=>void openProject(project.id)}>{label("查看更新","View update")}</button>
          <button type="button" className="sidecar-pending-dismiss" aria-label={label("关闭更新提醒","Dismiss source update")} title={label("关闭更新提醒","Dismiss source update")} onClick={()=>rememberDismissal(noticeKey,noticeRevision)}><X size={14} aria-hidden="true"/></button>
        </div>
      </div>:null}
      <div className="sidecar-project-association" hidden={!projects.length}><SidecarProjectLinker key={conversationId} zh={zh} projects={projects} linkedIds={related.map(item=>item.id)} organizedIds={related.filter(item=>item.sourceConversationIds.includes(conversationId)).map(item=>item.id)} onUnlink={unlink} selectedId={selected} disabled={busy||!loaded||!conversationId} onChoose={async item=>{if(isLinked(item)){setSelected(item.id);return true;}return link(item.id);}}/></div>
    </section>:null}
 <div className="sidecar-project-body">{!loaded?<p role="status">{label("读取本地知识…","Loading local knowledge…")}</p>:null}{!conversationId&&onToggleLanguage?<SidecarHeader zh={zh} onToggleLanguage={onToggleLanguage} showBrand={false}/>:null}{wiki}{error?<p role="alert" className="sidecar-project-error">{error}</p>:null}{status?<p role="status" className="sidecar-project-status"><span>{status}</span><button type="button" aria-label={label("关闭提示","Dismiss")} onClick={()=>setStatus("")}><X size={14} aria-hidden="true"/></button></p>:null}</div><SidecarLibraryFooter zh={zh} count={conversations.filter(item=>isCurrentHydrationComplete(item)).length} onOpen={()=>void open()}/></main>;
}
