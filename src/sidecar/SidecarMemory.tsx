import {platformName} from "../shared/platforms";
import {useEffect,useRef,useState,type ReactNode} from "react";
import {ArrowUp,History,Search,X,SlidersHorizontal,ChevronDown,ChevronRight,MoreHorizontal,MessagesSquare,MessageSquare,FolderOpen} from "lucide-react";
import type {Conversation,ConversationMessage} from "../shared/types";
import type {FocusSession} from "../shared/focus-session";
import type {MessageSourceRange,ReaderSearchContext} from "../shared/message-location";
import type {SidecarSearch} from "../storage/context-favorites";
import {rememberSidecarSearch} from "../storage/context-favorites";
import {getDatabase} from "../storage/db";
import {searchMemory,type MemoryHit} from "./context-engine";
import type {SemanticMemoryReport} from "./semantic-memory";
import {SidecarSearchResults} from "./SidecarSearchResults";
import {SidecarKnowledgeResults} from "./SidecarKnowledgeResults";
import {searchKnowledge,type KnowledgeHit} from "./knowledge-search";
import {SidecarSheet} from "./SidecarSheet";
import {SidecarScopePicker} from "./SidecarScopePicker";
interface SearchFilters {platform:string;source:string;from:string;to:string}
const emptyFilters=():SearchFilters=>({platform:"",source:"",from:"",to:""});
export type MemoryView="home"|"recent";

/** Sidebar search: local only. Saved Wiki knowledge comes first, then the original
 * messages; both open in the workspace. No model answers here; semantic matching
 * stays an opt-in advanced setting that only embeds the query. */
export function SidecarMemory({active=true,conversations,conversationId,zh,view,onView,onOpen,projects=[],projectId,canInsert=false,projectConversationIds=[],onFeedback,toolbarActions}: {
 active?:boolean;conversations:Conversation[];conversationId:string;zh:boolean;view:MemoryView;onView:(view:MemoryView)=>void;
 onOpen:(conversation:Conversation,message?:ConversationMessage,range?:MessageSourceRange,search?:ReaderSearchContext)=>void;
 projects?:FocusSession[];projectId?:string;canInsert?:boolean;
 projectConversationIds?:string[];onFeedback?:(message:string)=>void;
 toolbarActions?:ReactNode;
}) {
 const l=(cn:string,en:string)=>zh?cn:en;
 const [query,setQuery]=useState(""),[hits,setHits]=useState<MemoryHit[]>(),[knowledge,setKnowledge]=useState<KnowledgeHit[]>([]);
 const [recent,setRecent]=useState<SidecarSearch[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(""),[progress,setProgress]=useState("");
 const [appliedFilters,setAppliedFilters]=useState<SearchFilters>(emptyFilters),[filterDraft,setFilterDraft]=useState<SearchFilters>(emptyFilters);
 const {platform,source,from,to}=appliedFilters;
 const [panel,setPanel]=useState<"filters"|"settings"|"more"|"scope">(),[order,setOrder]=useState<"relevance"|"newest"|"oldest">("relevance");
 const openFilters=()=>{setFilterDraft({...appliedFilters});setPanel("filters");};
 const validDates=!filterDraft.from||!filterDraft.to||filterDraft.from<=filterDraft.to;
 const filtersChanged=Object.keys(filterDraft).some(key=>filterDraft[key as keyof SearchFilters]!==appliedFilters[key as keyof SearchFilters]);
 const controller=useRef<AbortController|null>(null),live=useRef(true),lastSearch=useRef("");
 const [semantic,setSemantic]=useState(()=>localStorage.getItem("atlas-sidecar-semantic")==="on");
 const [semanticReport,setSemanticReport]=useState<SemanticMemoryReport>(),[vectorCoverage,setVectorCoverage]=useState<{indexed:number;total:number;remaining:number}>();
 const reload=async()=>{const db=await getDatabase(),rows=await db.getAll("sidecarSearches");if(live.current)setRecent(rows.sort((a,b)=>b.updatedAt-a.updatedAt));};
 useEffect(()=>{live.current=true;return()=>{live.current=false;controller.current?.abort();};},[]);
 useEffect(()=>{if(active)void reload().catch(()=>{if(live.current)setError(zh?"本地记录读取失败，请重试。":"Could not load recent searches.");});},[active,view,zh]);
 const cancelSearch=()=>{controller.current?.abort();setBusy(false);setProgress("");};
  const run = async (operation: (signal: AbortSignal) => Promise<void>) => {
    controller.current?.abort(); const current = new AbortController(); controller.current = current;
    setBusy(true); setError(""); setProgress("");
    try { await operation(current.signal); } catch (failure) { if (live.current && !current.signal.aborted) {const message=failure instanceof Error?failure.message:String(failure);setError(message);onFeedback?.(message);} }
    finally { if (live.current && controller.current === current) setBusy(false); }
  };
  const filters = (values=appliedFilters) => ({ ...(values.platform ? { platforms: [values.platform] } : {}), ...(values.source ? { conversationIds: values.source === "@project" ? projectConversationIds : [values.source] } : {}), ...(values.from ? { from: new Date(`${values.from}T00:00:00`).getTime() } : {}), ...(values.to ? { to: new Date(`${values.to}T23:59:59.999`).getTime() } : {}) });
  // Knowledge follows the scope: the current project only, all projects, or none for a single chat.
  const knowledgeProjects=(values=appliedFilters)=>values.source==="@project"?projects.filter(item=>item.id===projectId):values.source?[]:projects;
  useEffect(()=>setVectorCoverage(undefined),[platform,source,from,to]);
  const search = (value = query,remember=true,scope=appliedFilters) => {
    if (!value.trim()) return;
    const enhance=semantic&&remember;
    lastSearch.current=value;setQuery(value);setSemanticReport(undefined);onView("home");
    setKnowledge(searchKnowledge(value,knowledgeProjects(scope),zh));
    void run(async signal => {
      const result = await searchMemory(value.trim(), conversations, signal, { semantic:enhance,onLocal:rows=>{if(!signal.aborted){setHits(rows);if(enhance)setProgress(l("本地结果已显示，正在语义检索…","Local matches shown; checking semantic matches…"));}}, ...filters(scope) }); signal.throwIfAborted();
      setHits(result.hits);setSemanticReport(result.semantic);
      if(remember){await rememberSidecarSearch(value);await reload();}
    });
  };
  const applyFilters=(values:SearchFilters)=>{
    controller.current?.abort();setBusy(false);
    setAppliedFilters({...values});setPanel(undefined);
    // Applying a range refreshes local matches only; semantic requests remain explicit.
    if(query.trim())search(query,false,values);else{setHits(undefined);setKnowledge([]);setSemanticReport(undefined);}
  };
  const scopeTitle=source==="@project"?l("当前项目","Current project"):source?(conversations.find(item=>item.id===source)?.title??l("所选对话","Selected chat")):platform?platformName(platform,zh?"zh-CN":"en"):l("全部资料","All history");
  const scopeLabel=source===conversationId&&source?l("当前对话","Current chat"):scopeTitle;
  const ScopeIcon=source==="@project"?FolderOpen:source?MessageSquare:MessagesSquare;
  const hasFilters=Boolean(platform||from||to);
  const scopeSummary=[source&&platform?platformName(platform,zh?"zh-CN":"en"):"",scopeTitle,from||to?[from||"…",to||"…"].join(" – "):""].filter(Boolean).join(" · ");
  const prepareVectors = () => void run(async signal => {
    try {
      const scope=conversations.filter(item=>(!platform||item.platform===platform)&&(!source||(source==="@project"?projectConversationIds.includes(item.id):item.id===source)));
      const module=await import("../search/semantic-index");
      const coverage=await module.prepareMessageVectors(scope.map(item=>item.id),{...filters(),signal,onProgress:(done,total)=>setProgress(l(`正在建立语义索引 ${done} / ${total}`,`Indexing semantic passages ${done} / ${total}`))});
      signal.throwIfAborted();setVectorCoverage(coverage);setSemantic(true);localStorage.setItem("atlas-sidecar-semantic","on");
      if(query.trim()&&coverage.indexed){const result=await searchMemory(query,conversations,signal,{...filters(),semantic:true,onLocal:setHits});signal.throwIfAborted();setHits(result.hits);setSemanticReport(result.semantic);}
    }catch(failure){signal.throwIfAborted();const detail=failure instanceof Error?failure.message:"";throw Error(detail==="EMBEDDING_NOT_CONFIGURED"?l("请先在 AI 设置中配置向量模型和连接。","Configure an embedding model and connection in AI settings first."):detail==="EMBEDDING_PERMISSION_REQUIRED"?l("向量服务尚未授权，请在 AI 设置中检查连接权限。","Grant the embedding service access in AI settings."):/dimensions/i.test(detail)?l("向量模型与旧索引不兼容，请检查模型配置。","Embedding dimensions differ from the saved index. Check the model configuration."):l("语义索引未完成，已保存部分会复用，可重试。","Semantic indexing incomplete. Saved progress will be reused on retry."));}
  });
  const semanticNotice=semanticReport?semanticReport.status==="exact"?l("引号内按原文精确查找，不调用向量服务。","Quoted text uses exact matching without the embedding service."):semanticReport.status==="ready"?l("语义检索已完成，结果已与本地匹配合并。","Semantic search complete. Results are combined with local matches."):semanticReport.status==="no-index"?l("当前范围尚无有效正文向量，请在搜索设置中建立语义索引。","No current text vectors in this scope. Build the semantic index in Search settings."):semanticReport.status==="unconfigured"?l("当前使用本地匹配；AI 设置中尚未配置可用的向量模型。","Using local matches. Configure a supported embedding model in AI settings."):semanticReport.status==="permission"?l("向量服务尚未授权，已保留本地匹配。","Embedding service access is not granted. Local matches are retained."):semanticReport.status==="timeout"?l("向量服务响应超时，已保留本地匹配。","Semantic service timed out. Local matches are retained."):l("语义检索未完成，请检查向量连接；本地匹配仍可使用。","Semantic lookup failed. Check the embedding connection; local results remain available."):"";
  const searchRef=useRef(search);searchRef.current=search;
  // A search outlives switching tabs (the workbench, another chat, the chat a result opened): only a search scoped to
  // the chat that was open follows to the one open now and runs again; on a page with no chat it stays as it was.
  const previousConversation=useRef(conversationId);
  useEffect(()=>{
    const previous=previousConversation.current;previousConversation.current=conversationId;
    if(!previous||!conversationId||previous===conversationId||appliedFilters.source!==previous)return;
    const next={...appliedFilters,source:conversationId};setAppliedFilters(next);
    if(lastSearch.current.trim())searchRef.current(lastSearch.current,false,next);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the open chat changes, with the filters then.
  },[conversationId]);
  useEffect(()=>{if(view!=="home"||query.trim().length<2)return;const timer=setTimeout(()=>{if(lastSearch.current!==query)searchRef.current(query,false);},300);return()=>clearTimeout(timer);},[query,view]);
 return <section className="sidecar-memory">
 {toolbarActions?<nav className="memory-toolbar" aria-label={l("侧栏功能","Sidebar navigation")}><div>{toolbarActions}</div></nav>:null}
 <div className="memory-home">      <h1 className="sr-only">{l("查找历史", "Find history")}</h1>
      <form className="memory-search memory-intent-search" onSubmit={event => { event.preventDefault(); search(); }}><textarea rows={2} maxLength={1200} role="searchbox" aria-label={l("搜索历史对话", "Search past conversations")} placeholder={l("查找已整理的知识和历史对话…", "Search organized knowledge and past chats…")} value={query} onChange={event => {controller.current?.abort();lastSearch.current="";setBusy(false);setProgress("");setQuery(event.target.value);if(!event.target.value.trim()){setHits(undefined);setKnowledge([]);}}} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); search(); } }}/>
      <div className="memory-input-actions">
       <div className="memory-composer-tools"><button className="memory-scope-button" data-scope={source} type="button" aria-label={l("资料范围","Material scope")} aria-haspopup="dialog" aria-expanded={panel==="scope"} title={scopeTitle} onClick={()=>setPanel("scope")}><ScopeIcon size={14}/><span>{scopeLabel}</span><ChevronDown size={12}/></button><button className="memory-tool-button" type="button" aria-label={l("更多操作","More actions")} aria-haspopup="dialog" title={l("更多操作","More actions")} onClick={()=>setPanel("more")}><MoreHorizontal size={17}/></button></div>
       <div className="memory-send-tools"><button className="memory-send-button" aria-label={l("查找历史", "Find history")} disabled={busy || !query.trim()}><ArrowUp size={18}/></button></div>
      </div></form>
      {hasFilters?<div className="memory-search-utilities"><button className="memory-scope-trigger" type="button" aria-label={l("搜索范围与筛选","Search scope and filters")} title={scopeSummary} onClick={openFilters}>{scopeSummary}</button><button type="button" aria-label={l("清除搜索筛选","Clear search filters")} onClick={()=>applyFilters(emptyFilters())}><X size={14}/></button></div>:null}
      {/* Everything found scrolls in one area above the search box, which stays in view. */}
      <div className="memory-found">
       {semanticNotice&&!busy?<p className="memory-semantic-feedback" role="status">{semanticNotice}</p>:null}
       {knowledge.length&&query.trim()?<SidecarKnowledgeResults hits={knowledge} projects={projects} conversationId={conversationId} canInsert={canInsert} zh={zh}/>:null}
       {hits&&query.trim()? <SidecarSearchResults key={JSON.stringify([query,appliedFilters])} hits={hits} conversationId={conversationId} zh={zh} onOpen={onOpen} order={order} query={query} compact/> : null}
       {!query.trim()&&recent.length?<div className="memory-recent-list"><header><small>{l("最近查找","Recent searches")}</small><button type="button" className="sidecar-text-button" onClick={()=>void getDatabase().then(db=>db.clear("sidecarSearches")).then(reload).catch(failure=>setError(String(failure)))}>{l("清空","Clear")}</button></header>{recent.slice(0,6).map(item=><button type="button" key={item.id} onClick={()=>search(item.query)}><History size={14} aria-hidden="true"/><span>{item.query}</span></button>)}</div>:null}
      </div>
</div>
    {panel==="scope"?<SidecarScopePicker zh={zh} source={source} conversationId={conversationId} conversations={conversations} hasProject={Boolean(projectConversationIds.length)} onChoose={value=>applyFilters({...appliedFilters,source:value,platform:""})} onClose={()=>setPanel(undefined)}/>:null}
    {panel&&panel!=="scope"?<SidecarSheet variant={panel==="more"?"menu":undefined} title={panel==="more"?l("更多操作","More actions"):panel==="filters"?l("搜索筛选","Search filters"):l("搜索设置","Search settings")} zh={zh} onClose={()=>setPanel(undefined)} footer={panel==="filters"?<div className="memory-filter-actions"><button type="button" disabled={busy} onClick={()=>setFilterDraft(emptyFilters())}>{l("重置","Reset")}</button><button type="button" className="primary" disabled={busy||!validDates||!filtersChanged} onClick={()=>applyFilters(filterDraft)}>{l("应用筛选","Apply filters")}</button></div>:undefined}>
      {panel==="more"?<div className="memory-more-actions"><button type="button" aria-label={l("搜索范围与筛选","Search scope and filters")} onClick={openFilters}><SlidersHorizontal size={17} aria-hidden="true"/><span>{l("搜索筛选","Search filters")}</span><ChevronRight size={15} aria-hidden="true"/></button><button type="button" onClick={()=>setPanel("settings")}><Search size={17} aria-hidden="true"/><span>{l("搜索设置","Search settings")}</span><ChevronRight size={15} aria-hidden="true"/></button><label><span>{l("结果排序","Sort results")}</span><span className="memory-sort-control"><select aria-label={l("结果排序","Sort results")} value={order} onChange={event=>setOrder(event.target.value as typeof order)}><option value="relevance">{l("相关程度","Relevance")}</option><option value="newest">{l("时间从新到旧","Newest first")}</option><option value="oldest">{l("时间从旧到新","Oldest first")}</option></select><ChevronDown size={14} aria-hidden="true"/></span></label></div>:panel==="filters"?<div className="memory-filter-fields">
        <label className="memory-option-field"><span>{l("平台","Platform")}</span><select aria-label={l("筛选平台","Filter platform")} value={filterDraft.platform} onChange={event=>setFilterDraft(value=>({...value,platform:event.target.value}))}><option value="">{l("全部平台","All platforms")}</option>{[...new Set(conversations.map(item=>item.platform))].map(name=><option key={name} value={name}>{platformName(name,zh?"zh-CN":"en")}</option>)}</select></label>
        <div className="memory-date-fields"><label className="memory-option-field"><span>{l("开始日期","From")}</span><input aria-label={l("起始日期","From date")} type="date" value={filterDraft.from} onChange={event=>setFilterDraft(value=>({...value,from:event.target.value}))}/></label><label className="memory-option-field"><span>{l("结束日期","To")}</span><input aria-label={l("结束日期","To date")} type="date" value={filterDraft.to} onChange={event=>setFilterDraft(value=>({...value,to:event.target.value}))}/></label></div>
        {!validDates?<p role="alert">{l("结束日期不能早于开始日期。","End date must be on or after the start date.")}</p>:null}
      </div>:<><p className="memory-search-default">{l("只在本地查找已整理的知识和导入的对话，不调用模型。","Searches organized knowledge and imported chats locally, without a model.")}</p><details className="memory-advanced-settings"><summary>{l("高级设置","Advanced settings")}<ChevronDown size={14} aria-hidden="true"/></summary><div className="memory-semantic-setting"><label><input aria-label={l("使用已配置的向量服务","Use configured vector service")} type="checkbox" checked={semantic} onChange={event=>{setSemantic(event.target.checked);localStorage.setItem("atlas-sidecar-semantic",event.target.checked?"on":"off");}}/><span>{l("语义检索","Semantic search")}</span></label><small>{l("搜索时发送查询至向量服务。","Sends queries to your embedding service on search.")}</small>
        <details className="memory-index-settings"><summary>{l("索引管理","Manage index")}</summary><p>{l("当前范围：","Scope: ")}{scopeSummary}</p><small>{l("所选正文将发送至向量服务，已有索引复用。","Sends selected text to your embedding service; reuses existing vectors.")}</small><button className="memory-build-vectors" disabled={busy||!conversations.length} onClick={prepareVectors}>{l(vectorCoverage?.remaining?"继续建立语义索引":"建立语义索引",vectorCoverage?.remaining?"Continue semantic indexing":"Build semantic index")}</button>{vectorCoverage?<small>{vectorCoverage.total?l(`已建立 ${vectorCoverage.indexed} / ${vectorCoverage.total} 段${vectorCoverage.remaining?"，可继续补齐":""}`,`${vectorCoverage.indexed} / ${vectorCoverage.total} passages indexed${vectorCoverage.remaining?"; continue to cover the rest":""}`):l("当前范围没有可索引的正文，请先导入对话。","No text in this scope. Import conversations first.")}</small>:null}</details></div></details></>}
      {busy?<p role="status">{progress||l("处理中…","Working…")} <button type="button" onClick={cancelSearch}>{l("取消","Cancel")}</button></p>:null}{error?<p role="alert">{error}</p>:null}
    </SidecarSheet>:null}
    {busy&&!panel&&progress ? <p role="status">{progress} <button className="sidecar-text-button" onClick={cancelSearch}>{l("取消", "Cancel")}</button></p> : null}{error&&!panel ? <p className="sidecar-project-error" role="alert">{error}</p> : null}
  </section>;
}
