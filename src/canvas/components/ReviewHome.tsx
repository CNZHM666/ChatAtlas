import { DEFAULT_PROJECT_GOAL } from "../../shared/constants";
import type { WikiWritingMode } from "../../shared/wiki-knowledge";
import {focusTaskResult} from "../../shared/focus-task-result";
import {isPendingOrganizationTask} from "./task-sidebar-visibility";
import {experimentalHomeGoal} from "../../shared/home-experiments";
import { HomeRecentProjects } from "./HomeRecentProjects";
import { ArrowRight, ChevronDown, Search, BookOpen, CircleAlert, RotateCw, PanelRight, FileText, GitBranch } from "lucide-react";
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
import { platformName } from "../../shared/platforms";
import "../workbench-home.css";

/** How many rows 继续上次 shows before 查看全部. */
const CONTINUE_SHOWN = 4;
const WELCOME_COMPLETED_KEY = "atlas-workbench-welcome-completed";

/** Passive DOM page capture (e.g. deepseek_dom or untagged ChatGPT page capture) should not skip first-run welcome. */
const isExplicitImport = (conversation: Conversation) =>
  Boolean(conversation.nativeHistorySourceId) || Boolean(conversation.source && !/_dom$/u.test(conversation.source));

const readWelcomeDismissed = () => {
  try { return window.localStorage.getItem(WELCOME_COMPLETED_KEY) === "1"; }
  catch { return false; }
};

export function ReviewHome({ projectFirst = false, libraryReady = true, onOpenChapter, sessions, projectsReady = true, experimentalActions = false, conversations, organizationRuns = [], focusTasks = [], onContinueTask, onTask, importJob, importSource, selectedIds, onSelectedIds, syncSelectedIds, onSyncSelectedIds, onPrioritize, draft, onDraft, recentReading, onStart, onContinueProject, resumeTask, onSession, onResume, onScan, onHydrate, onZip, onPause, onResumeImport, onConnect, onConfigureAI, onDiscover, onReadConversation, onProjectsChanged, sourcesRequest, historyOpen = false, homeRequest, onHistoryChange, onPreviewAction }: {
  projectFirst?: boolean;
  libraryReady?: boolean;
  /** Changes whenever the conversation list is asked for: the source materials open and come into view. */
  sourcesRequest?: number;
  onPreviewAction?: () => void;
  /** Called after selected conversations joined a project from the source list. */
  onProjectsChanged?: () => Promise<void> | void;
  projectsReady?: boolean; experimentalActions?:boolean;
  canvases: AtlasCanvas[]; sessions: FocusSession[]; conversations: Conversation[];
  organizationRuns?: OrganizationRun[];
  historyOpen?: boolean; homeRequest?: number; onHistoryChange: (open: boolean) => void;
  focusTasks?: FocusGenerationTask[]; onContinueTask?: (task: FocusGenerationTask) => void; onTask?: (id: string) => void;
  importJob: ImportJob | null; importSource: "web" | "zip";
  syncSelectedIds?: Set<string>; onSyncSelectedIds?: (ids: Set<string>) => void;
  selectedIds: Set<string>; onSelectedIds: (ids: Set<string>) => void; onPrioritize: (id: string) => void | Promise<boolean>;
  draft?: { goal: string; mode: FocusMode; writingMode?: WikiWritingMode }; onDraft?: (draft: { goal: string; mode: FocusMode; writingMode?: WikiWritingMode }) => void;
  recentReading: Array<{ canvasId: string; cardId: string; messageId?: string; title: string; spaceTitle: string }>;
  onContinueProject?: (session: FocusSession, goal: string, poolIds: string[]) => void; resumeTask?: FocusGenerationTask;
  onStart: (goal: string, mode: FocusMode, sourceIds: string[], scope?: FocusScope, poolIds?: string[], options?: { writingMode?: WikiWritingMode; organizationInstruction?: string }) => void; onSession: (id: string) => void; /** Opens one chapter of a saved project, from a search result. */ onOpenChapter?: (sessionId: string, sectionId: string) => void;
  onResume: (entry: { canvasId: string; cardId: string; messageId?: string }) => void;
  onSpace: (id: string) => void; onScan: () => void; onHydrate: (ids: string[], force?: boolean) => void | Promise<boolean>;
  onZip: (file: File) => void; onPause: () => void; onResumeImport?: () => void; onConnect: () => void; onDiscover: () => void;
  onConfigureAI?: () => void;
  onReadConversation?: (id: string, message?: import("../../shared/types").ConversationMessage, sourceRange?: import("../../shared/message-location").MessageSourceRange, search?:import("../../shared/message-location").ReaderSearchContext) => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [task, setTask] = useState<{goal: string; poolIds: string[]; discovery?: boolean; action?: HomeTaskPlan["action"]; localSearch?: boolean; record?: HomeAnswerResult; activity?: HomeActivity; draft?: string; paused?: boolean}>();
  useEffect(() => { setTask(undefined); }, [homeRequest]);
  const [allSessions, setAllSessions] = useState(false);
  const [currentDraft, setCurrentDraft] = useState<{ goal: string; mode: FocusMode; writingMode?: WikiWritingMode }>(() => draft ?? { goal: "", mode: "work", writingMode: "concise" });
  const localDrafts = useRef(new WeakSet<typeof currentDraft>());
  useEffect(() => {
    if (draft && !localDrafts.current.has(draft)) setCurrentDraft(draft);
  }, [draft]);
  const [materialActions,setMaterialActions]=useState<HTMLElement|null>(null);
  const [materialStatus,setMaterialStatus]=useState<HTMLElement|null>(null);
  const [materialsOpen, setMaterialsOpen] = useState<boolean | null>(null);
  const goalRef = useRef<HTMLDivElement>(null);
  const sourcesRef = useRef<HTMLDivElement>(null);
  const recentProjectsRef = useRef<HTMLDivElement>(null);
  const continuedRef = useRef<HTMLElement>(null);
  const [welcomeDismissed, setWelcomeDismissed] = useState(readWelcomeDismissed);
  const readyConversations = useMemo(() => conversations.filter(isCurrentHydrationComplete), [conversations]);
  const readyCount = readyConversations.length;
  const hasWorkProjects = sessions.some(item => item.mode === "work");
  const hasExplicitReady = useMemo(() => readyConversations.some(isExplicitImport), [readyConversations]);
  useEffect(() => {
    if (!projectFirst || (!hasWorkProjects && !hasExplicitReady) || welcomeDismissed) return;
    setWelcomeDismissed(true);
    try { window.localStorage.setItem(WELCOME_COMPLETED_KEY, "1"); } catch { /* Storage is optional. */ }
  }, [projectFirst, hasWorkProjects, hasExplicitReady, welcomeDismissed]);
  const importFirst = projectFirst
    ? libraryReady && projectsReady && !hasWorkProjects && (readyCount === 0 || (!welcomeDismissed && !hasExplicitReady))
    : readyCount === 0;
  const pendingCount = conversations.length - readyCount;
  const importJobRunning = Boolean(importJob && ["connecting", "discovering", "syncing", "reconciling", "paused"].includes(importJob.status));
  const passiveWelcome = importFirst && readyCount > 0 && pendingCount === 0 && !importJobRunning;
  const latestCapturedTitle = readyConversations[0]?.title?.trim();
  const enterWorkbenchFromWelcome = () => {
    setWelcomeDismissed(true);
    try { window.localStorage.setItem(WELCOME_COMPLETED_KEY, "1"); } catch { /* Storage is optional. */ }
    if (selectedIds.size === 0 && readyConversations.length > 0) {
      onSelectedIds(new Set(readyConversations.map(item => item.id)));
    }
  };
  const initiallyOpenMaterials = useRef(conversations.some((source) => selectedIds.has(source.id) && !isCurrentHydrationComplete(source)));
  const updateDraft = (next: typeof currentDraft) => {
    localDrafts.current.add(next);
    setCurrentDraft(next);
    onDraft?.(next);
  };
  const changeGoal = useStableCallback((goal: string) => updateDraft({ ...currentDraft, goal }));
  const changeWritingMode = useStableCallback((writingMode: WikiWritingMode) => updateDraft({ ...currentDraft, writingMode }));
  const directOrganize = useStableCallback(({ instruction, writingMode, sourceIds }: { instruction?: string; writingMode: WikiWritingMode; sourceIds: string[] }) => {
    if (onPreviewAction) { onPreviewAction(); return; }
    const goalText = instruction?.trim() || DEFAULT_PROJECT_GOAL[locale];
    onStart(goalText, "work", sourceIds, { kind: "all", sourceConversationIds: sourceIds }, sourceIds, {
      writingMode,
      organizationInstruction: instruction?.trim() || undefined,
    });
  });
  const sessionGroups = useMemo(() => groupFocusVersions(sessions), [sessions]);
  const pendingFocus = projectsReady ? focusTasks.filter(task => task.mode!=="review" && task.status !== "preview" && !focusTaskResult(task,sessions)) : [];
  const pendingOrganization = organizationRuns.filter(isPendingOrganizationTask);
  const readingGroups=sessionGroups.filter(group=>group.latest.mode!=="work");
  const showContinue=Boolean(onContinueTask&&pendingFocus.length||onTask&&pendingOrganization.length||readingGroups.length||recentReading.length);

  const materialsExpanded = importFirst || (materialsOpen ?? (!projectFirst && initiallyOpenMaterials.current));
  const showSources = () => { setMaterialsOpen(true); window.requestAnimationFrame(() => sourcesRef.current?.scrollIntoView?.({ behavior: "auto", block: "start" })); };
  const showRequested = useStableCallback(showSources);
  useEffect(() => { if (sourcesRequest) showRequested(); }, [sourcesRequest, showRequested]);
  const requestTask = (goal: string, ids?: string[], action?: HomeTaskPlan["action"], localSearch?: boolean) => {
    if (onPreviewAction) { onPreviewAction(); return; }
    if (!experimentalActions && experimentalHomeGoal(goal) && action !== "project" && !localSearch) return;
    if (!ids && resumeTask && resumeTask.mode!=="review" && resumeTask.sourceIds.every(id => selectedIds.has(id)) && (!resumeTask.goal.trim() || resumeTask.goal.trim() === goal.trim())) {
      onStart(goal, resumeTask.mode, resumeTask.sourceIds, resumeTask.scope ?? { kind: "all", sourceConversationIds: resumeTask.sourceIds }, [...selectedIds]); return;
    }
    setTask({ goal, poolIds: ids ?? [...selectedIds], action, localSearch });
  };
  const history = historyOpen ? <HomeResultHistory readOnly={Boolean(onPreviewAction)} sessions={sessions} zh={zh} onSession={onSession} onResult={record => { onHistoryChange(false); setTask("answer" in record ? {goal:record.question,poolIds:record.poolIds,action:"answer",record} : {goal:record.question,poolIds:record.poolIds,discovery:record.kind==="discovery",localSearch:record.kind==="search",action:record.kind==="search"?"answer":undefined,activity:record}); }} /> : null;
  if (task && history) return history;
  if (!import.meta.env.VITE_ATLAS_STATIC_DEMO && task?.discovery) return <HomeTopicWorkspace readOnly={!experimentalActions} initialActivity={task.activity} onHistory={activity=>{setTask({...task,activity});onHistoryChange(true);}} goal={task.goal} poolIds={task.poolIds} conversations={conversations} zh={zh} onRead={onReadConversation} onConfigureAI={onConfigureAI} onSelectedIds={onSelectedIds} onRequest={requestTask} onBack={goal=>{changeGoal(goal);setTask(undefined);}}/>;
  if (!import.meta.env.VITE_ATLAS_STATIC_DEMO && task) return <HomeTaskWorkspace readOnly={!experimentalActions&&Boolean(task.record)&&(experimentalHomeGoal(task.record!.topicGoal)||experimentalHomeGoal(task.record!.question))} localSearch={task.localSearch} initialRecord={task.record} initialActivity={task.activity} initialDraft={task.draft} initialPaused={task.paused} onHistory={(record, goal, draft, activity) => { setTask({ ...task, record, activity: activity ?? task.activity, goal: record?.question ?? goal ?? task.goal, draft, paused: !record }); onHistoryChange(true); }} requestedAction={task.action} onRead={onReadConversation} goal={task.goal} poolIds={task.poolIds} conversations={conversations} sessions={sessions} projectsReady={projectsReady} zh={zh} onStart={(goal, mode, ids, scope) => onStart(goal, mode, ids, scope, task.poolIds)} onContinue={onContinueProject} onOpenChapter={onOpenChapter} onHydrate={onHydrate} onConfigureAI={onConfigureAI} onBack={goal => { changeGoal(goal); setTask(undefined); }} />;
  return <><main className={`review-home${importFirst ? " is-import-first" : ""}`} hidden={historyOpen}><div className="review-home-inner">
    <div className="review-home-fixed">
      <header><div className="review-home-title"><h1>{importFirst ? zh ? "让过去的 AI 对话，重新发挥价值" : "Make past AI conversations useful again" : projectFirst ? zh ? "项目工作台" : "Project workbench" : zh ? "今天想找回或继续什么？" : "What would you like to find or continue?"}</h1></div>
        {!importFirst && projectFirst && !sessions.some(item => item.mode === "work") && projectsReady ? <p className="review-home-subtitle">{zh ? "在 AI 对话旁打开 ChatAtlas 侧栏，即可新建项目。" : "Open the ChatAtlas sidebar next to an AI chat to start a project."}</p> : null}
        {importFirst ? <p className="review-home-subtitle">{zh ? "把跨对话讨论整理成可核对、可续写的项目章节。先导入历史对话，或在 AI 网页打开侧栏边聊边收。" : "Turn past AI chats into verifiable, resumable project chapters. Import chats below or use the side panel while chatting."}</p> : null}</header>
      <div ref={goalRef} hidden={importFirst}><HistoryWorkbench projectOnly={projectFirst} writingMode={currentDraft.writingMode ?? "concise"} onWritingMode={changeWritingMode} onDirectOrganize={projectFirst ? directOrganize : undefined} readOnly={Boolean(onPreviewAction)} experimentalActions={experimentalActions} selectedIds={selectedIds} onSelectedIds={onSelectedIds} conversations={conversations} goal={currentDraft.goal} onGoal={changeGoal} onRequest={requestTask} onDiscoverGoal={(goal,poolIds)=>{if(experimentalActions)setTask({goal,poolIds,discovery:true});}} onSources={showSources} onRead={onReadConversation} onHydrate={onHydrate} onDiscover={onDiscover} onConfigureAI={onConfigureAI} /></div>
    </div>
    <div className="review-home-content">
    <div className="review-home-content-inner">
    <div ref={recentProjectsRef}><HomeRecentProjects sessions={sessions} zh={zh} onOpen={onSession}/></div>
    <div ref={sourcesRef} className="home-section home-materials">
      <header><div className="home-materials-heading"><h2>{importFirst ? zh ? "导入你的第一批对话" : "Import your first conversations" : <button type="button" className="home-materials-toggle" aria-expanded={materialsExpanded} aria-controls="home-source-materials" onClick={() => { const opening = !materialsExpanded; setMaterialsOpen(opening);
        // Collapsing from inside the list would leave the reader below where the section now ends: bring its heading back.
        if (!opening) window.setTimeout(() => { const box = sourcesRef.current; if (box && box.getBoundingClientRect().top < 0) box.scrollIntoView({ block: "start" }); }, 0); }}><span>{onPreviewAction ? (zh ? "来源材料" : "Source materials") : (zh ? "来源材料与同步" : "Source materials and sync")}</span><ChevronDown size={16} aria-hidden="true" /></button>}</h2>
        {importFirst && pendingCount > 0 ? <p className="home-import-pending">{zh ? `已发现 ${conversations.length} 条对话，同步正文后即可整理为项目章节、随时核对原话并跨 AI 续聊。` : `${conversations.length} conversations found. Sync messages to organize into project chapters, trace quotes, and continue across AIs.`}</p> : !importFirst ? <p className="home-source-inventory">
          <span>{zh ? `${conversations.length} 条对话` : `${conversations.length} conversations`}</span>
          {!onPreviewAction && pendingCount > 0 ? <span className="workbench-pending-dot">{zh ? `${pendingCount} 条待同步` : `${pendingCount} pending`}</span> : null}
          {!materialsExpanded && zh ? <span>{[...new Set(conversations.map(source => platformName(source.platform, "zh-CN")))].join(" / ")}</span> : null}
        </p> : null}
      </div>{conversations.length && !passiveWelcome ? <span className="home-materials-actions" ref={setMaterialActions}/> : null}</header>
      {passiveWelcome ? <div className="home-welcome-captured" role="region" aria-label={zh ? "已捕获的当前网页对话" : "Captured conversations"}>
        <div className="home-welcome-captured-copy">
          <strong>{zh ? `已自动捕获当前网页的 ${readyCount} 条对话` : `Captured ${readyCount} conversation${readyCount > 1 ? "s" : ""} from your open AI tab`}</strong>
          <span>{latestCapturedTitle
            ? zh ? `包含「${latestCapturedTitle}」${readyCount > 1 ? "等" : ""}，可直接进入工作台整理，或先批量导入更多历史对话。` : `Including "${latestCapturedTitle}". Jump straight into the workbench, or import more history below.`
            : zh ? "可直接进入工作台整理，或先批量导入更多历史对话。" : "Jump straight into the workbench, or import more history below."}</span>
        </div>
        <button type="button" className="primary" onClick={enterWorkbenchFromWelcome}>
          <span>{zh ? "直接进入工作台" : "Open workbench"}</span>
          <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div> : null}
      {importFirst && conversations.length && !passiveWelcome ? <div className="home-import-meta" ref={setMaterialStatus}/> : null}
      <div id="home-source-materials" className="workbench-materials"><WorkbenchSyncPanel titleOnly={projectFirst} forceIntroductory={passiveWelcome} onPreviewAction={onPreviewAction} controlsHost={conversations.length && !passiveWelcome ? materialActions : null} statusHost={importFirst && conversations.length && !passiveWelcome ? materialStatus : null} initialImport={importFirst} expanded={materialsExpanded} compact conversations={conversations} importJob={importJob} importSource={importSource} selectedIds={syncSelectedIds ?? selectedIds} onSelectedIds={onSyncSelectedIds ?? onSelectedIds} onUseSources={ids => { onSelectedIds(new Set([...selectedIds, ...ids])); goalRef.current?.scrollIntoView?.({ block: "center" }); }} onPrioritize={onPrioritize} onScan={onScan} onHydrate={onHydrate} onZip={onZip} onPause={onPause} onResume={onResumeImport} onConnect={onConnect} sessions={sessions} onOpen={onReadConversation ? (id, message, sourceRange) => onReadConversation(id, message, sourceRange) : undefined} onOpenProject={onSession} onLinkProject={onPreviewAction ? undefined : async (projectId, ids) => { await linkConversationsToProject(projectId, ids); await onProjectsChanged?.(); }} /></div>
    </div>
    {importFirst ? <div className="home-value-path">
      <p>{zh ? "三步开始使用" : "How it works"}</p>
      <div className="home-onboarding-steps">
        <div className="home-onboarding-step">
          <span className="home-onboarding-badge">01</span>
          <div className="home-onboarding-icon" aria-hidden="true"><PanelRight size={18} /></div>
          <strong>{zh ? "边聊边收，或批量导入" : "Capture live or import"}</strong>
          <small>{zh ? "在 AI 网页点右上角图标开侧栏沉淀，或在上方同步历史对话。" : "Open the side panel next to any AI chat, or sync past history above."}</small>
        </div>
        <div className="home-onboarding-step">
          <span className="home-onboarding-badge">02</span>
          <div className="home-onboarding-icon" aria-hidden="true"><FileText size={18} /></div>
          <strong>{zh ? "自动整理为结构化章节" : "Organize into chapters"}</strong>
          <small>{zh ? "按主题梳理结论、约束与待决问题，可选精简定稿或开发规格。" : "Group decisions, constraints, and open questions in your chosen style."}</small>
        </div>
        <div className="home-onboarding-step">
          <span className="home-onboarding-badge">03</span>
          <div className="home-onboarding-icon" aria-hidden="true"><GitBranch size={18} /></div>
          <strong>{zh ? "随时溯源原话并继续聊" : "Trace quotes and continue"}</strong>
          <small>{zh ? "每句结论一键定位原对话高亮，导出文档后换个 AI 也能无缝续写。" : "Jump to exact source highlights and carry context into your next AI session."}</small>
        </div>
      </div>
    </div> : null}
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
  </div></main>{history}</>;
}
