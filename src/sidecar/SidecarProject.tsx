import {useCallback,useEffect,useRef,useState} from "react";
import {MessageSquare,RefreshCw,Download,X} from "lucide-react";
import {SidecarHeader} from "./SidecarHeader";
import {SidecarMemory,type MemoryView} from "./SidecarMemory";
import {SidecarLibraryFooter} from "./SidecarLibraryFooter";
import {SidecarProjectLinker} from "./SidecarProjectLinker";
import {sendSidecarMessage} from "./host";
import type {FocusSession} from "../shared/focus-session";
import type {Conversation,ConversationMessage} from "../shared/types";
import type {AtlasMessage,CaptureCommandResponse,NavigationResponse} from "../shared/messages";
import type {MessageSourceRange,ReaderSearchContext} from "../shared/message-location";
import {getDatabase} from "../storage/db";
import {listFocusSessions} from "../storage/focus-sessions";
import {linkSidecarProject,unlinkSidecarProject} from "../storage/sidecar-links";
import {savedSidecarProjects} from "./project-model";
import {isCurrentHydrationComplete} from "../sync/import-state";
import {observeMessageSearchEvents} from "../search/message-search-events";
import {WEB_CAPTURE_PLATFORMS} from "../shared/web-capture";
import {platformName} from "../shared/platforms";
import {sourceChange} from "../canvas/source-freshness";
export function SidecarProject({conversationId,conversationTitle="",zh,platformLabel,onToggleLanguage,canInsert=false}: {conversationId:string;conversationTitle?:string;zh:boolean;canInsert?:boolean;platformLabel?:string;onToggleLanguage?:()=>void}) {
 const [projects,setProjects]=useState<FocusSession[]>([]),[conversations,setConversations]=useState<Conversation[]>([]),[selected,setSelected]=useState<string>(),[loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(""),[status,setStatus]=useState(""),[view,setView]=useState<MemoryView>("home");
 const alive=useRef(true),sending=useRef(false),currentConversationId=useRef(conversationId);currentConversationId.current=conversationId;
 const label=(cn:string,en:string)=>zh?cn:en;
 useEffect(()=>observeMessageSearchEvents(),[]);
 useEffect(()=>{setStatus("");setError("");setSelected(undefined);},[conversationId]);
 // A confirmation is read once: it fades after a few seconds and can be dismissed at once.
 useEffect(()=>{if(!status)return;const timer=window.setTimeout(()=>setStatus(""),5000);return()=>window.clearTimeout(timer);},[status]);
 const current=conversations.find(item=>item.id===conversationId),currentImported=Boolean(current&&isCurrentHydrationComplete(current));
 const pageCapture=WEB_CAPTURE_PLATFORMS.some(site=>conversationId.startsWith(`${site.id}:`));
 const title=current?.title||conversationTitle||label("当前 AI 对话","Current AI conversation");
 const isLinked=(session:FocusSession)=>Boolean(conversationId&&(session.sourceConversationIds.includes(conversationId)||session.sidecarConversationIds?.includes(conversationId)));
 const project=projects.find(item=>item.id===selected),related=projects.filter(isLinked);
 // The one bridge back to the workspace: this chat holds material the linked document has not organized yet.
 const [pending,setPending]=useState<{sessionId:string;count:number}>();
 useEffect(()=>{
  let live=true;setPending(undefined);
  if(!project||!conversationId||!isLinked(project))return;
  if(!project.sourceConversationIds.includes(conversationId)){setPending({sessionId:project.id,count:-1});return;}
  void getDatabase().then(db=>db.getAllFromIndex("messages","by-conversation",conversationId)).then(messages=>{
   const change=sourceChange(project,conversationId,messages),count=change.unknown?0:change.added+change.changed;
   if(live&&count)setPending({sessionId:project.id,count});
  }).catch(()=>undefined);
  return()=>{live=false;};
 // Conversations reload after every sync, so the count follows new captures.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[project,conversationId,conversations]);
 const organize=async(sessionId:string)=>{setError("");try{const result=await sendSidecarMessage({type:"ATLAS_OPEN_REVIEW",sessionId}) as NavigationResponse;if(!result?.ok)throw new Error();}catch{setError(label("无法打开工作台，请重试。","Could not open the workspace. Try again."));}};
  const refresh = useCallback(async () => {
    const db = await getDatabase();
    const [sessions, sources] = await Promise.all([listFocusSessions(), db.getAll("conversations")]);
    if (!alive.current || currentConversationId.current !== conversationId) return;
    const saved = savedSidecarProjects(sessions); setProjects(saved); setConversations(sources); setLoaded(true);
    setSelected(previous => previous ?? saved.find(item => item.sourceConversationIds.includes(conversationId) || item.sidecarConversationIds?.includes(conversationId))?.id ?? "");
  }, [conversationId]);
  useEffect(() => {
    alive.current = true;
    const reload = () => { if (!document.hidden) void refresh().catch(() => { if (alive.current) { setLoaded(true); setError(label("项目读取失败，请重试。", "Could not load projects. Try again.")); } }); };
    reload(); const timer = window.setInterval(reload, 8000);
    window.addEventListener("focus", reload); document.addEventListener("visibilitychange", reload);
    const saved = (message: AtlasMessage) => { if (message.type === "ATLAS_CAPTURE_SAVED") reload(); };
    chrome.runtime.onMessage.addListener(saved);
    return () => { alive.current = false;  clearInterval(timer); window.removeEventListener("focus", reload); document.removeEventListener("visibilitychange", reload); chrome.runtime.onMessage.removeListener(saved); };
  // Locale is stable for this isolated frame.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh, zh]);
  const open = async (source?: Conversation, message?: ConversationMessage, sourceRange?: MessageSourceRange, search?: ReaderSearchContext) => {
    setError("");
    try { const result = await sendSidecarMessage(source ? { type: "ATLAS_OPEN_CONVERSATION", conversationId: source.id, ...(message ? { messageId: message.id, sourceRange, ...(search ? { search } : {}) } : {}) } : { type: "ATLAS_OPEN" }) as NavigationResponse; if (!result?.ok) throw new Error(label("无法打开 ChatAtlas，请重试。", "Unable to open ChatAtlas. Try again.")); }
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
        if (alive.current && currentConversationId.current === conversationId) setStatus(pageCapture?label("已保存当前网页加载的消息，更早内容可在原网站加载后补充。","Loaded page messages saved. Load earlier messages on the website to add them."):currentImported ? label("当前对话已更新，可在工作台和对话库中查看。", "Conversation updated in the workbench and library.") : label("当前对话已导入，可在工作台和对话库中查看。", "Current conversation imported into the workbench and library."));
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
      if (alive.current && currentConversationId.current === conversationId) { setSelected(sessionId); setStatus(label("已关联，整理时再确认项目更新", "Linked. Confirm project changes when organizing.")); await refresh(); }
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
      if (alive.current && currentConversationId.current === conversationId) { if (selected === item.id) setSelected(undefined); setStatus(label(`已取消与「${item.title}」的关联`, `Unlinked from “${item.title}”`)); await refresh(); }
      return true;
    } finally { sending.current = false; if (alive.current) setBusy(false); }
  };
  return <main className="sidecar-project" onKeyDown={event=>{if(event.key!=="Escape")return;if(view!=="home")setView("home");else if(parent!==window)parent.postMessage({type:"ATLAS_SIDECAR_COLLAPSE"},"https://chatgpt.com");}}>
    {conversationId?<section className="sidecar-current sidecar-current-bar" aria-label={label("当前对话", "Current conversation")}>
      <div className="sidecar-current-title"><MessageSquare size={16}/><div className="sidecar-current-copy">{current?<button className="sidecar-current-name" title={title} aria-label={label("阅读当前对话","Read current conversation")} onClick={()=>void open(current)}><strong>{title}</strong></button>:<strong title={title}>{title}</strong>}<small>{platformLabel||(current?platformName(current.platform,zh?"zh-CN":"en"):"")||(conversationId?"ChatGPT":label("未识别当前对话","No conversation detected"))}{conversationId?` · ${currentImported?label("已导入","Imported"):label("未同步","Not synced")}`:""}</small></div><button className={`sidecar-update-button${currentImported?" is-imported":""}`} aria-busy={busy} aria-label={busy?label("正在同步对话","Syncing conversation"):currentImported?label("更新对话","Update chat"):label("导入当前对话","Import this chat")} title={currentImported?label("更新对话","Update chat"):label("导入当前对话","Import this chat")} disabled={busy||!loaded||!conversationId} onClick={()=>void updateConversation()}>{currentImported?<RefreshCw size={15}/>:<Download size={15}/>}</button>{onToggleLanguage?<SidecarHeader zh={zh} onToggleLanguage={onToggleLanguage} showBrand={false}/>:null}</div>
      {pending&&project?<p className="sidecar-pending-update" role="status"><span>{pending.count<0?label(`已关联「${project.title}」，尚未整理进文档`,`Linked to "${project.title}", not organized yet`):label(`「${project.title}」有 ${pending.count} 条新消息未整理`,`"${project.title}" has ${pending.count} new messages to organize`)}</span><button type="button" className="sidecar-text-button" onClick={()=>void organize(pending.sessionId)}>{label("去整理","Organize")}</button></p>:null}
      <div className="sidecar-project-association" hidden={!projects.length}><SidecarProjectLinker key={conversationId} zh={zh} projects={projects} linkedIds={related.map(item=>item.id)} organizedIds={related.filter(item=>item.sourceConversationIds.includes(conversationId)).map(item=>item.id)} onUnlink={unlink} selectedId={selected} disabled={busy||!loaded||!conversationId} onChoose={async item=>{if(isLinked(item)){setSelected(item.id);return true;}return link(item.id);}}/></div>
    </section>:null}
 <div className="sidecar-project-body">{!loaded?<p role="status">{label("读取本地知识…","Loading local knowledge…")}</p>:null}<SidecarMemory conversations={conversations} conversationId={conversationId} zh={zh} view={view} onView={setView} projects={projects} projectId={project?.id} canInsert={canInsert} onOpen={(source,message,range,search)=>void open(source,message,range,search)} projectConversationIds={project?[...new Set([...project.sourceConversationIds,...project.sidecarConversationIds??[]])]:[]} toolbarActions={!conversationId&&onToggleLanguage?<SidecarHeader zh={zh} onToggleLanguage={onToggleLanguage} showBrand={false}/>:undefined}/>{error?<p role="alert" className="sidecar-project-error">{error}</p>:null}{status?<p role="status" className="sidecar-project-status"><span>{status}</span><button type="button" aria-label={label("关闭提示","Dismiss")} onClick={()=>setStatus("")}><X size={14} aria-hidden="true"/></button></p>:null}</div><SidecarLibraryFooter zh={zh} count={conversations.filter(item=>isCurrentHydrationComplete(item)).length} onOpen={()=>void open()}/></main>;
}
