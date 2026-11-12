import {focusTaskResult} from "../../shared/focus-task-result";
import {isPendingOrganizationTask} from "./task-sidebar-visibility";
import {experimentalHomeGoal} from "../../shared/home-experiments";
import { HomeRecentProjects } from "./HomeRecentProjects";
import { ChevronDown, History, Search, FolderGit2, Copy, BookOpen, CircleAlert, RotateCw } from "lucide-react";
import { relativeDay } from "../relative-day";
import type { AtlasCanvas, Conversation, ImportJob, OrganizationRun } from "../../shared/types";
import type { FocusMode, FocusScope, FocusSession } from "../../shared/focus-session";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import type { HomeTaskPlan } from "../../ai/home-task";
import { HomeResultHistory } from "./HomeResultHistory";
import type { HomeActivity, HomeAnswerResult } from "../../storage/home-results";
import { HomeTaskWorkspace } from "./HomeTaskWorkspace";
import { HomeTopicWorkspace } from "./HomeTopicWorkspace";
import { HistoryWorkbench } from "./HistoryWorkbench";
import { WorkbenchSyncPanel } from "./WorkbenchSyncPanel";
import { linkConversationsToProject } from "../../storage/sidecar-links";
import { usePreferences } from "../preferences";
import { useEffect, useMemo, useRef, useState } from "react";
import { groupFocusVersions } from "../focus-versions";
import { resumeContext } from "../review-presentation";
import { FocusVersions } from "./FocusVersions";
import { useStableCallback } from "../hooks/useStableCallback";
import type { FocusGenerationTask } from "../../storage/focus-generation-tasks";
import { WorkspaceLayoutExample } from "./WorkspaceLayoutExample";
import { platformName } from "../../shared/platforms";
import "../workbench-home.css";

/** How many rows 继续上次 shows before 查看全部. */
const CONTINUE_SHOWN = 4;

export function ReviewHome({ onOpenChapter, sessions, projectsReady = true, experimentalActions = false, conversations, organizationRuns = [], focusTasks = [], onContinueTask, onTask, importJob, importSource, selectedIds, onSelectedIds, syncSelectedIds, onSyncSelectedIds, onPrioritize, draft, onDraft, recentReading, onStart, onContinueProject, resumeTask, onSession, onResume, onScan, onHydrate, onZip, onPause, onResumeImport, onConnect, onConfigureAI, onDiscover, onReadConversation, onProjectsChanged, sourcesRequest }: {
  /** Changes whenever the conversation list is asked for: the source materials open and come into view. */
  sourcesRequest?: number;
  /** Called after selected conversations joined a project from the source list. */
  onProjectsChanged?: () => Promise<void> | void;
  projectsReady?: boolean; experimentalActions?:boolean;
  canvases: AtlasCanvas[]; sessions: FocusSession[]; conversations: Conversation[];
  organizationRuns?: OrganizationRun[]; onTaskHistory?: () => void;
  focusTasks?: FocusGenerationTask[]; onContinueTask?: (task: FocusGenerationTask) => void; onTask?: (id: string) => void;
  importJob: ImportJob | null; importSource: "web" | "zip";
  syncSelectedIds?: Set<string>; onSyncSelectedIds?: (ids: Set<string>) => void;
  selectedIds: Set<string>; onSelectedIds: (ids: Set<string>) => void; onPrioritize: (id: string) => void | Promise<boolean>;
  draft?: { goal: string; mode: FocusMode }; onDraft?: (draft: { goal: string; mode: FocusMode }) => void;
  recentReading: Array<{ canvasId: string; cardId: string; messageId?: string; title: string; spaceTitle: string }>;
  onContinueProject?: (session: FocusSession, goal: string, poolIds: string[]) => void; resumeTask?: FocusGenerationTask;
  onStart: (goal: string, mode: FocusMode, sourceIds: string[], scope?: FocusScope, poolIds?: string[]) => void; onSession: (id: string) => void; /** Opens one chapter of a saved project, from a search result. */ onOpenChapter?: (sessionId: string, sectionId: string) => void;
  onResume: (entry: { canvasId: string; cardId: string; messageId?: string }) => void;
  onSpace: (id: string) => void; onScan: () => void; onHydrate: (ids: string[], force?: boolean) => void | Promise<boolean>;
  onZip: (file: File) => void; onPause: () => void; onResumeImport?: () => void; onConnect: () => void; onDiscover: () => void;
  onConfigureAI?: () => void;
  onReadConversation?: (id: string, message?: import("../../shared/types").ConversationMessage, sourceRange?: import("../../shared/message-location").MessageSourceRange, search?:import("../../shared/message-location").ReaderSearchContext) => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [task, setTask] = useState<{goal: string; poolIds: string[]; discovery?: boolean; action?: HomeTaskPlan["action"]; localSearch?: boolean; record?: HomeAnswerResult; activity?: HomeActivity; draft?: string; paused?: boolean}>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [allSessions, setAllSessions] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<{ goal: string; mode: FocusMode }>(() => draft ?? { goal: "", mode: "work" });
  useEffect(() => { if (draft) setCurrentDraft(draft); }, [draft]);
  const [layoutExample, setLayoutExample] = useState(false);
  const [materialActions,setMaterialActions]=useState<HTMLElement|null>(null);
  const [materialStatus,setMaterialStatus]=useState<HTMLElement|null>(null);
  const [materialsOpen, setMaterialsOpen] = useState<boolean | null>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const recentProjectsRef = useRef<HTMLDivElement>(null);
  const continuedRef = useRef<HTMLElement>(null);
  const readyCount = conversations.filter(isCurrentHydrationComplete).length;
  const importFirst = readyCount === 0;
  const initiallyOpenMaterials = useRef(conversations.some((source) => selectedIds.has(source.id) && !isCurrentHydrationComplete(source)));
  const updateDraft = (next: { goal: string; mode: FocusMode }) => { setCurrentDraft(next); onDraft?.(next); };
  const changeGoal = useStableCallback((goal: string) => updateDraft({ ...currentDraft, goal }));
  const sessionGroups = useMemo(() => groupFocusVersions(sessions), [sessions]);
  const pendingFocus = projectsReady ? focusTasks.filter(task => task.mode!=="review" && task.status !== "preview" && !focusTaskResult(task,sessions)) : [];
  const pendingOrganization = organizationRuns.filter(isPendingOrganizationTask);
  const readingGroups=sessionGroups.filter(group=>group.latest.mode!=="work");
  const showContinue=Boolean(onContinueTask&&pendingFocus.length||onTask&&pendingOrganization.length||readingGroups.length||recentReading.length);

  const materialsExpanded = importFirst || (materialsOpen ?? initiallyOpenMaterials.current);
  const showSources = () => { setMaterialsOpen(true); window.requestAnimationFrame(() => sourcesRef.current?.scrollIntoView({ behavior: "auto", block: "start" })); };
  const showRequested = useStableCallback(showSources);
  useEffect(() => { if (sourcesRequest) showRequested(); }, [sourcesRequest, showRequested]);
  const requestTask = (goal: string, ids?: string[], action?: HomeTaskPlan["action"], localSearch?: boolean) => {
    if (!experimentalActions && experimentalHomeGoal(goal) && action !== "project") return;
    if (!ids && resumeTask && resumeTask.mode!=="review" && resumeTask.sourceIds.every(id => selectedIds.has(id)) && (!resumeTask.goal.trim() || resumeTask.goal.trim() === goal.trim())) {
      onStart(goal, resumeTask.mode, resumeTask.sourceIds, resumeTask.scope ?? { kind: "all", sourceConversationIds: resumeTask.sourceIds }, [...selectedIds]); return;
    }
    setTask({ goal, poolIds: ids ?? [...selectedIds], action, localSearch });
  };
  if (historyOpen) return <HomeResultHistory sessions={sessions} zh={zh} onBack={() => setHistoryOpen(false)} onSession={onSession} onResult={record => { setHistoryOpen(false); setTask("answer" in record ? {goal:record.question,poolIds:record.poolIds,action:"answer",record} : {goal:record.question,poolIds:record.poolIds,discovery:record.kind==="discovery",localSearch:record.kind==="search",action:record.kind==="search"?"answer":undefined,activity:record}); }} />;
  if(task?.discovery)return <HomeTopicWorkspace readOnly={!experimentalActions} initialActivity={task.activity} onHistory={activity=>{setTask({...task,activity});setHistoryOpen(true);}} goal={task.goal} poolIds={task.poolIds} conversations={conversations} zh={zh} onRead={onReadConversation} onConfigureAI={onConfigureAI} onSelectedIds={onSelectedIds} onRequest={requestTask} onBack={goal=>{changeGoal(goal);setTask(undefined);}}/>;
  if (task) return <HomeTaskWorkspace readOnly={!experimentalActions&&Boolean(task.record)&&(experimentalHomeGoal(task.record!.topicGoal)||experimentalHomeGoal(task.record!.question))} localSearch={task.localSearch} initialRecord={task.record} initialActivity={task.activity} initialDraft={task.draft} initialPaused={task.paused} onHistory={(record, goal, draft, activity) => { setTask({ ...task, record, activity: activity ?? task.activity, goal: record?.question ?? goal ?? task.goal, draft, paused: !record }); setHistoryOpen(true); }} requestedAction={task.action} onRead={onReadConversation} goal={task.goal} poolIds={task.poolIds} conversations={conversations} sessions={sessions} projectsReady={projectsReady} zh={zh} onStart={(goal, mode, ids, scope) => onStart(goal, mode, ids, scope, task.poolIds)} onContinue={onContinueProject} onOpenChapter={onOpenChapter} onHydrate={onHydrate} onConfigureAI={onConfigureAI} onBack={goal => { changeGoal(goal); setTask(undefined); }} />;
  return <><main className={`review-home${importFirst ? " is-import-first" : ""}`} hidden={layoutExample}><div className="review-home-inner">
    <nav className="review-home-utility" aria-label={zh?"工作台辅助导航":"Workbench secondary navigation"}><div className="review-home-links"><button type="button" className="review-home-help" onClick={() => setHistoryOpen(true)}><History size={16} aria-hidden="true"/>{zh ? "历史记录" : "History"}</button><button type="button" className="review-home-help" onClick={() => setLayoutExample(true)}><FolderGit2 size={16} aria-hidden="true"/>{zh ? "示例项目" : "Example project"}</button></div></nav>
    <div className="review-home-fixed">
      <header><div className="review-home-title"><h1>{importFirst ? zh ? "让过去的 AI 对话，重新发挥价值" : "Make past AI conversations useful again" : zh ? "今天想找回或继续什么？" : "What would you like to find or continue?"}</h1></div><p className="review-home-subtitle">{importFirst ? zh ? "先导入历史对话。" : "Import your past conversations first." : zh ? "" : ""}</p></header>
      <div ref={goalRef} hidden={importFirst}><HistoryWorkbench experimentalActions={experimentalActions} selectedIds={selectedIds} onSelectedIds={onSelectedIds} conversations={conversations} goal={currentDraft.goal} onGoal={changeGoal} onRequest={requestTask} onDiscoverGoal={(goal,poolIds)=>{if(experimentalActions)setTask({goal,poolIds,discovery:true});}} onSources={showSources} onRead={onReadConversation} onHydrate={onHydrate} onDiscover={onDiscover} onConfigureAI={onConfigureAI} /></div>
    </div>
    <div className="review-home-content">
    <div className="review-home-content-inner">
    <div ref={recentProjectsRef}><HomeRecentProjects sessions={sessions} zh={zh} onOpen={onSession}/></div>
    <div ref={sourcesRef} className="home-section home-materials">
      <header><div className="home-materials-heading"><h2>{importFirst ? zh ? "导入你的第一批对话" : "Import your first conversations" : <button type="button" className="home-materials-toggle" aria-expanded={materialsExpanded} aria-controls="home-source-materials" onClick={() => { const opening = !materialsExpanded; setMaterialsOpen(opening);
        // Collapsing from inside the list would leave the reader below where the section now ends: bring its heading back.
        if (!opening) window.setTimeout(() => { const box = sourcesRef.current; if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: "start" }); }, 0); }}><span>{zh ? "来源材料与同步" : "Source materials and sync"}</span><ChevronDown size={16} aria-hidden="true" /></button>}</h2>
        {importFirst && conversations.length ? <p className="home-import-pending">{zh ? `已发现 ${conversations.length} 条对话，同步正文后即可全文搜索。` : `${conversations.length} conversations found. Sync messages to search the full text.`}</p> : !importFirst ? <p className="home-source-inventory">{zh ? `${conversations.length} 条对话${conversations.length>readyCount?` · ${conversations.length-readyCount} 条待同步`:""}${materialsExpanded?"":` · ${[...new Set(conversations.map(source=>platformName(source.platform,"zh-CN")))].join(" / ")}`}` : `${conversations.length} conversations`}</p> : null}
      </div>{conversations.length?<span className="home-materials-actions" ref={setMaterialActions}/>:null}</header>
      {importFirst && conversations.length ? <div className="home-import-meta" ref={setMaterialStatus}/> : null}
      <div id="home-source-materials" className="workbench-materials"><WorkbenchSyncPanel controlsHost={conversations.length?materialActions:null} statusHost={importFirst&&conversations.length?materialStatus:null} initialImport={importFirst} expanded={materialsExpanded} compact conversations={conversations} importJob={importJob} importSource={importSource} selectedIds={syncSelectedIds ?? selectedIds} onSelectedIds={onSyncSelectedIds ?? onSelectedIds} onUseSources={ids => { onSelectedIds(new Set([...selectedIds, ...ids])); goalRef.current?.scrollIntoView?.({ block: "center" }); }} onPrioritize={onPrioritize} onScan={onScan} onHydrate={onHydrate} onZip={onZip} onPause={onPause} onResume={onResumeImport} onConnect={onConnect} sessions={sessions} onOpen={onReadConversation ? (id, message, sourceRange) => onReadConversation(id, message, sourceRange) : undefined} onOpenProject={onSession} onLinkProject={async (projectId, ids) => { await linkConversationsToProject(projectId, ids); await onProjectsChanged?.(); }} /></div>
      {importFirst ? <p className="home-import-privacy">{zh ? "对话保存在本地。" : "Conversations stay local."}</p> : null}
    </div>
    {importFirst ? <div className="home-value-path"><p>{zh ? "导入后，你可以：" : "After importing:"}</p><ul><li><Search size={18} /><span>{zh ? "找回历史讨论" : "Search past discussions"}</span></li><li><FolderGit2 size={18} /><span>{zh ? "整理为项目文档" : "Organize into a project"}</span></li><li><Copy size={18} /><span>{zh ? "导出文档，在其他 AI 中继续" : "Export and continue in another AI"}</span></li></ul></div> : null}
    {showContinue ? (() => {
      // One list, unfinished work first: each row names what it is, where it stands, and when it was last touched.
      const rows = [
        ...(onContinueTask ? pendingFocus.map(task => { const failed = task.status === "failed"; return <div key={`task:${task.id}`} className="home-list-item"><button type="button" className="home-list-row is-task" onClick={() => onContinueTask(task)}>{failed ? <CircleAlert size={16} aria-hidden="true" /> : <RotateCw size={16} aria-hidden="true" />}<strong title={task.goal}>{task.goal || (zh ? "未完成整理" : "Unfinished organization")}</strong><span className="home-list-meta"><small className={`home-list-state ${failed ? "is-failed" : "is-pending"}`}>{task.needsConfirmation ? zh ? "需确认需求与来源" : "Confirm goal and sources" : failed ? zh ? "生成失败" : "Generation failed" : zh ? "生成未完成" : "Generation unfinished"}{task.progress ? ` · ${task.progress.processedSegments}/${task.progress.totalSegments}` : ""}</small><small className="home-list-action">{task.needsConfirmation ? zh ? "继续" : "Continue" : zh ? "继续生成" : "Continue generation"}</small></span></button></div>; }) : []),
        ...(onTask ? pendingOrganization.map(run => { const failed = run.status === "failed"; return <div key={`run:${run.id}`} className="home-list-item"><button type="button" className="home-list-row is-task" onClick={() => onTask(run.id)}>{failed ? <CircleAlert size={16} aria-hidden="true" /> : <RotateCw size={16} aria-hidden="true" />}<strong title={run.title}>{run.title}</strong><span className="home-list-meta"><small className={`home-list-state ${failed ? "is-failed" : "is-pending"}`}>{run.status === "waiting_review" ? zh ? "待确认预览" : "Preview ready" : failed ? zh ? "生成失败" : "Generation failed" : zh ? "生成未完成" : "Generation unfinished"}</small><small className="home-list-action">{zh ? "继续" : "Continue"}</small></span></button></div>; }) : []),
        ...readingGroups.map((group) => {
          const session = group.latest, resume = resumeContext(session), updated = Math.max(...group.versions.map(item => item.updatedAt));
          const lastChapter = session.status !== "preview" ? resume.section?.title : undefined, total = session.sections.length, done = session.completedSectionIds.length;
          return <div key={group.id} className={`home-list-item${group.versions.length > 1 ? " has-history" : ""}`}>
            <button type="button" className="home-list-row" onClick={() => onSession(session.id)}>{session.mode === "answer" ? <Search size={16} aria-hidden="true" /> : <BookOpen size={16} aria-hidden="true" />}<strong title={session.title}>{session.title}</strong>
              <span className="home-list-meta">{lastChapter ? <small className="home-list-place" title={`${zh ? "上次读到：" : "Last chapter: "}${lastChapter}`}>{lastChapter}</small> : null}{session.status === "preview" ? <small className="home-list-state is-pending">{zh ? "待确认" : "Preview ready"}</small> : total ? <small className="home-list-progress" title={zh ? `已读 ${done}/${total} 章` : `${done} of ${total} chapters read`}><i aria-hidden="true"><span style={{ width: `${Math.round(done / total * 100)}%` }} /></i>{done}/{total}</small> : null}<small className="home-list-time" title={new Date(updated).toLocaleString(zh ? "zh-CN" : "en")}>{relativeDay(updated, zh)}</small></span></button>
            <FocusVersions compact group={group} zh={zh} onOpen={onSession} />
          </div>;
        }),
        ...recentReading.slice(0, 3).map((entry) => <div key={`card:${entry.canvasId}:${entry.cardId}`} className="home-list-item"><button type="button" className="home-list-row" onClick={() => onResume(entry)}><BookOpen size={16} aria-hidden="true" /><strong title={entry.title}>{entry.title}</strong><span className="home-list-meta"><small className="home-list-place">{entry.spaceTitle}</small></span></button></div>),
      ];
      return <section ref={continuedRef} className="home-section home-continue">
        <header className="home-list-header"><h2>{zh ? "继续上次" : "Continue where you left off"}</h2><span className="home-list-count">{rows.length}</span>
          {rows.length > CONTINUE_SHOWN ? <button type="button" className="home-list-toggle" onClick={() => setAllSessions(!allSessions)}>{allSessions ? zh ? "收起" : "Show less" : zh ? `查看全部 ${rows.length} 条` : `View all ${rows.length}`}</button> : null}</header>
        <div className={`home-list${allSessions ? " is-all" : ""}`}>{allSessions ? rows : rows.slice(0, CONTINUE_SHOWN)}</div>
      </section>;
    })() : null}
    </div>
    </div>
  </div></main>{layoutExample ? <WorkspaceLayoutExample zh={zh} onClose={() => setLayoutExample(false)} /> : null}</>;
}
