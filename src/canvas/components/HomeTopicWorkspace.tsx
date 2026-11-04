import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FolderGit2, GraduationCap, History } from "lucide-react";
import type { Conversation, ConversationMessage } from "../../shared/types";
import type { HistoryCandidate } from "../../search/home-history";
import type { HistoryDiscoveryProgress } from "../../ai/history-discovery";
import type { HomeTaskPlan } from "../../ai/home-task";
import { currentHomeDiscoveries, readHomeDiscoveries, saveHomeDiscoveries } from "../../storage/home-discovery";
import { getDatabase } from "../../storage/db";
import { getAISettings } from "../../storage/knowledge-graph";
import { effectiveAISettings, hasAIConnection } from "../../ai/ai-mode";
import { hasProviderPermission } from "../../ai/provider";
import { AIQuickSelect } from "./AIQuickSelect";
import { ReaderBackButton } from "./ReaderBackButton";
import { HistoryDiscoveryEvidence } from "./HistoryDiscoveryEvidence";
import { saveHomeResult, type HomeActivity } from "../../storage/home-results";

export function HomeTopicWorkspace({goal,poolIds,conversations,zh,onBack,onRequest,onSelectedIds,onConfigureAI,onRead,initialActivity,onHistory,readOnly=false}:{
 goal:string;poolIds:string[];conversations:Conversation[];zh:boolean;onBack:(goal:string)=>void;
 onRequest:(goal:string,ids?:string[],action?:HomeTaskPlan["action"])=>void;onSelectedIds:(ids:Set<string>)=>void;
 onConfigureAI?:()=>void;onRead?:(id:string,message?:ConversationMessage)=>void;
 readOnly?:boolean; initialActivity?:HomeActivity;onHistory?:(record:HomeActivity)=>void;
}){
 const poolKey=JSON.stringify(poolIds);
 const discoveryPool=useMemo(()=>conversations.filter(source=>(JSON.parse(poolKey) as string[]).includes(source.id)),[conversations,poolKey]);
 const revision=JSON.stringify(discoveryPool.map(source=>[source.id,source.title,source.updatedAt,source.rawRevision,source.sourceRevision,source.hydrationState,source.importState]));
 const selectedIds=new Set(poolIds);
 const [category,setCategory]=useState<HistoryCandidate["kind"]|"all">("all"),[error,setError]=useState("");
 const [aiReady,setAIReady]=useState(false),[retry,setRetry]=useState(0),[switchingAI,setSwitchingAI]=useState(false);
 const [aiCandidates,setAICandidates]=useState<HistoryCandidate[]>(),[discovering,setDiscovering]=useState(false);
 const [discoveryProgress,setDiscoveryProgress]=useState<HistoryDiscoveryProgress>(),[evidenceCandidate,setEvidenceCandidate]=useState<HistoryCandidate>();
 const recommendation=useRef<AbortController>(),recommending=useRef(false);
 const activity=useRef<HomeActivity>(initialActivity??{id:`history-discovery-${crypto.randomUUID()}`,kind:"discovery",question:goal,topicGoal:goal,poolIds:[...poolIds],createdAt:Date.now(),status:"started"}),activitySave=useRef<Promise<void>>();
 const [saveError,setSaveError]=useState(false);
 const persistActivity=(update:Partial<HomeActivity>)=>{activity.current={...activity.current,...update};const record={...activity.current};activitySave.current=(activitySave.current??Promise.resolve()).then(()=>saveHomeResult(record)).catch(()=>setSaveError(true));};
 useEffect(()=>{if(!readOnly&&!initialActivity){const record=activity.current;activitySave.current=saveHomeResult(record).catch(()=>setSaveError(true));}},[initialActivity,readOnly]);
 const candidates=(aiCandidates??[]).filter(item=>item.basis==="recommendation"&&item.sourceIds.every(id=>discoveryPool.some(source=>source.id===id)));
 const onSources=()=>onBack(goal);
  const recommend = async () => {
    if (readOnly || recommending.current) return;
    setCategory("all"); setError("");
    persistActivity({status:"started"});
    if (discoveryPool.length < 2 || discoveryPool.length !== poolIds.length) { setError(zh ? "部分来源不可用，请返回调整材料。至少需要两条对话。" : "Some sources are unavailable. Adjust sources; at least two conversations are required."); return; }
    const controller = new AbortController(); recommendation.current?.abort(); recommendation.current = controller;
    recommending.current = true; setDiscovering(true); setAICandidates([]); setDiscoveryProgress(undefined);
    try {
      const settings = effectiveAISettings(await getAISettings());
      if (controller.signal.aborted) return;
      if (!hasAIConnection(settings) || !await hasProviderPermission(settings.baseUrl)) { if (onConfigureAI) onConfigureAI(); else setError(zh ? "请先连接 AI。" : "Connect AI first."); setAICandidates(undefined); return; }
      if (controller.signal.aborted) return;
      const [{ createAtlasAI }, { recommendHistory }] = await Promise.all([import("../../ai/atlas-ai"), import("../../ai/history-discovery")]);
      const profiles = await getDatabase().then(db=>db.getAll("semanticProfiles")).catch(()=>[]);
      if (controller.signal.aborted) return;
      const found = await recommendHistory(createAtlasAI(settings, controller.signal, crypto.randomUUID()), discoveryPool, profiles, zh, controller.signal, progress=>{ if (!controller.signal.aborted) { setDiscoveryProgress(progress); setAICandidates(progress.candidates); } },goal);
      if (!controller.signal.aborted) {setAICandidates(found);persistActivity({status:"completed",candidates:found});void saveHomeDiscoveries(discoveryPool,found,zh,goal).catch(()=>undefined);}
    } catch { if (!controller.signal.aborted) { persistActivity({status:"failed"});setError(zh ? "暂时无法完成主题分析，请重试。" : "Topic discovery failed. Try again."); setAICandidates(current=>current?.length?current:undefined); } }
    finally { if (recommendation.current === controller) { recommending.current = false; setDiscovering(false); } }
  };
  const previewCandidate = async (candidate: HistoryCandidate) => {
    try { if(!(await currentHomeDiscoveries(discoveryPool,[candidate])).length){setError(zh?"推荐来源已变化，请重新发现。":"Recommendation sources changed; refresh discovery.");setAICandidates(rows=>rows?.filter(row=>row!==candidate));return;} } catch {setError(zh?"来源核对失败，请重试。":"Could not check sources; retry.");return;}
    const value = zh ? `${candidate.kind === "project" ? "帮我整理成一个项目" : "帮我复习"}：${candidate.title}` : `${candidate.kind === "project" ? "Create a project about" : "Review"} ${candidate.title}`;
    onSelectedIds?.(new Set(candidate.sourceIds));
    setCategory("all"); onRequest(value, candidate.sourceIds, candidate.kind === "project" ? "project" : "review");
  };
  const discoveryContent = (candidates.length || discovering || aiCandidates !== undefined) ? <section className="history-discovery home-section">
    <header><h2>{zh ? "为你发现" : "Discover for you"}</h2>
      {discovering ? <button type="button" onClick={()=>{recommendation.current?.abort();recommendation.current=undefined;recommending.current=false;setDiscovering(false);setError(zh?"已停止发现":"Discovery stopped");setAICandidates(current=>current?.length?current:undefined);}}>{zh?"停止":"Stop"}</button>
        : !readOnly?<button type="button" disabled={switchingAI} onClick={()=>void recommend()}>{aiCandidates ? zh?"重新发现":"Discover again" : zh?"发现主题":"Discover topics"}<ArrowRight size={14}/></button>:null}
    </header>
    {discovering ? <p role="status" className="history-hint">{discoveryProgress?.phase==="checking" ? zh?`核对主题 ${discoveryProgress.done}/${discoveryProgress.total}`:`Checking topics ${discoveryProgress.done}/${discoveryProgress.total}` : zh?"正在发现共同主题…":"Finding shared topics…"}</p>
      : aiCandidates === undefined ? <p className="history-hint">{zh ? selectedIds?.size ? `使用已选 ${Math.min(discoveryPool.length,80)} 条对话${discoveryPool.length>80?"（最近）":""}` : `使用最近 ${Math.min(discoveryPool.length,80)} 条已导入对话` : `Using ${Math.min(discoveryPool.length,80)} ${selectedIds?.size ? "selected":"recent imported"} conversations`}</p> : null}
    {candidates.some(candidate=>candidate.kind==="project") && candidates.some(candidate=>candidate.kind==="review") ? <div className="history-discovery-filters" role="group" aria-label={zh?"主题类型":"Topic types"}>{(["all","project","review"] as const).map(kind=><button type="button" key={kind} aria-pressed={category===kind} onClick={()=>setCategory(kind)}>{kind==="all"?zh?"全部":"All":kind==="project"?zh?"项目":"Projects":zh?"复习":"Review"}</button>)}</div>:null}
    {candidates.length ? <div className="history-candidates">{candidates.filter(item=>category==="all"||item.kind===category).map(candidate=><div className="history-candidate-entry" key={`${candidate.kind}:${candidate.title}`}><button type="button" onClick={()=>void previewCandidate(candidate)}>
      {candidate.kind==="project"?<FolderGit2 size={18}/>:<GraduationCap size={18}/>}<span><strong>{candidate.title}</strong><small>{zh?`${candidate.sourceIds.length} 条对话 · ${candidate.kind==="project"?"项目":"复习"}`:`${candidate.sourceIds.length} conversations · ${candidate.kind}`}</small>{candidate.reason?<small className="history-candidate-reason">{candidate.reason}</small>:null}</span><span>{candidate.kind==="project"?zh?"整理项目":"Create project":zh?"开始复习":"Review"}<ArrowRight size={14}/></span>
    </button><button type="button" className="history-candidate-sources" onClick={()=>setEvidenceCandidate(candidate)}>{zh?`查看 ${candidate.sourceIds.length} 条来源`: `Review ${candidate.sourceIds.length} sources`}</button></div>)}</div> : aiCandidates && !discovering ? <p className="history-hint">{zh?"暂未发现有充分依据的共同主题。":"No sufficiently supported shared topics found."}</p>:null}
    {!discovering && discoveryProgress?.pendingSources ? <button type="button" className="history-discovery-retry" onClick={onSources}>{zh?`${discoveryProgress.pendingSources} 条候选对话待同步`:`${discoveryProgress.pendingSources} candidate conversations need sync`}</button>:null}
    {!discovering && discoveryProgress?.failedGroups ? <p className="history-hint">{zh?"部分主题未完成，已完成结果可用。":"Some topics could not be checked; completed results remain available."}</p>:null}
  </section> : null;

 useEffect(()=>{
  setAICandidates(undefined);setDiscoveryProgress(undefined);setError("");setDiscovering(false);
  if(initialActivity&&retry===0){let alive=true;void currentHomeDiscoveries(discoveryPool,initialActivity.candidates??[]).then(rows=>{if(alive){setAICandidates(rows);if(rows.length!==(initialActivity.candidates?.length??0))setError(zh?"部分主题来源已变化，请重新发现。":"Some topic sources changed. Discover again.");}}).catch(()=>{if(alive)setError(zh?"历史来源暂时无法核对，请重试。":"Could not check saved sources. Try again.");});return()=>{alive=false;};}
  if(readOnly||!aiReady||switchingAI)return;
  let alive=true;
  void (async()=>{const cached=retry===0?await readHomeDiscoveries(discoveryPool,zh,goal).catch(()=>[]):[];if(!alive)return;if(cached.length){setAICandidates(cached);persistActivity({status:"completed",candidates:cached});}else await recommend();})();
  return()=>{alive=false;recommendation.current?.abort();recommendation.current=undefined;recommending.current=false;};
  // Source identity and the user's goal bound this task, not callback identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
 },[aiReady,switchingAI,revision,goal,retry,zh,initialActivity,readOnly]);

 return <main className="home-task-workspace home-topic-workspace"><header className="home-task-header"><div className="home-task-navigation"><ReaderBackButton onClick={()=>onBack(goal)} label={zh?"返回":"Back"}/><h1>{zh?"发现整理主题":"Discover topics"}</h1></div><div className="home-task-tools">{onHistory?<button onClick={async()=>{recommendation.current?.abort();if(discovering)persistActivity({candidates:aiCandidates??[]});await activitySave.current;onHistory(activity.current);}}><History size={15}/>{zh?"历史记录":"History"}</button>:null}{!readOnly?<AIQuickSelect zh={zh} configureLabel={zh?"配置模型":"Configure model"} onConfigure={onConfigureAI} onReady={setAIReady} onBusy={setSwitchingAI}/>:null}</div></header><div className="home-task-body"><div className="home-task-content history-workbench"><header className="home-task-goal-heading"><h2 className="home-task-goal">{goal}</h2></header>{initialActivity&&!readOnly&&retry===0?<p className="home-recall-limit">{zh?"已保存的主题记录，不会自动重新分析。":"Saved topic record; no automatic analysis."}</p>:null}{readOnly?<p className="home-recall-limit">{zh?"已保存的主题记录，仅供查看；该功能暂未开放。":"Saved topic record, available for reading only. This feature is not currently open."}</p>:null}{!readOnly&&!aiReady?<p className="home-task-connect-hint">{zh?"主题分析需要模型，请先配置模型。":"Configure a model to analyze topics."}</p>:null}{error?<section className="home-task-panel"><p role="alert">{error}</p><div className="home-task-actions">{!readOnly?<button type="button" disabled={!aiReady||discovering} onClick={()=>{setError("");setRetry(value=>value+1);}}>{zh?"重试":"Retry"}</button>:null}<button type="button" onClick={()=>onBack(goal)}>{zh?"调整目标与材料":"Adjust goal and sources"}</button></div></section>:null}{saveError?<p className="home-recall-limit" role="alert">{zh?"历史记录保存失败。":"Could not save history."}<button onClick={()=>{setSaveError(false);persistActivity({});}}>{zh?"重新保存":"Save again"}</button></p>:null}{discoveryContent}{evidenceCandidate?<HistoryDiscoveryEvidence candidate={evidenceCandidate} zh={zh} onRead={onRead} onClose={()=>setEvidenceCandidate(undefined)}/>:null}</div></div></main>;
}

