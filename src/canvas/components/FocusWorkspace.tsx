import { projectKnowledgeReading, projectKnowledgeReadingContext } from "../../shared/project-knowledge-view";
import { prepareEditableChapterBody } from "../../shared/chapter-editable-prose";
import { PreviewContent } from "./PreviewContent";
import {recordUiFailure} from "../ui-failure";
import {remapWikiSectionReferences} from "../../shared/wiki-topic-merge";
import {ProjectReadingCacheContext,useProjectReadingCache} from "../project-reading-cache";
import {createProjectReadingCache,sameProjectReadingInputs} from "../../shared/project-reading-cache";
import { refreshWikiReading } from "../wiki-reading-background";
import type { WikiReadingProjection } from "../wiki-reading-worker";
import type {ComponentProps} from "react";
import { ChapterTextEditor } from "./ChapterTextEditor";
import { ChevronDown, BookMarked, Download, RefreshCw, Save, Pencil, ListTree, GitCompareArrows, ScrollText, SlidersHorizontal, Languages } from "lucide-react";
import { ProjectVersionPicker } from "./ProjectVersionPicker";
import { generationFailureReason, wikiPreviewQuality } from "../generation-notice";
import {savedWikiProjectBoundary,wikiProjectTitleSuggestion} from "../../shared/wiki-project-boundary";
import { restoreWikiSourceNegation } from "../../shared/wiki-source-negation";
import {WikiChapterBody} from "./WikiChapterOverview";
import {editableWikiTopic} from "../../shared/wiki-directory";
import { PreviewChapterLocator } from "./PreviewChapterLocator";
import { markAIFirstReadable, measureAILocalStep } from "../../ai/pipeline-timing";
import { chapterEvidence } from "../../shared/evidence-identity";
import type { EvidencePoint, WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import type { WikiHolder } from "../../shared/wiki-holder";
import type { ReaderEvidenceSteps } from "./OriginalReader";
import { DocumentOverview } from "./DocumentOverview";
import { projectMatters } from "../../shared/project-matters";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";
import { ChapterSources } from "./ChapterSources";
import { WikiChapterPreview } from "./WikiChapterPreview";
import { wikiCategory, createWikiGroup, placeWikiPage } from "../../shared/wiki-navigation";
import { saveManualWikiChapter } from "../../storage/sidecar-projects";
import { WikiDocument } from "./WikiDocument";
import { warmWikiChapterCache } from "../wiki-chapter-warm";
import { ProjectSourcePicker } from "./ProjectSourcePicker";
import { ProjectWikiNavigation } from "./ProjectWikiNavigation";
import { useWikiReadingPosition } from "../hooks/useWikiReadingPosition";
import { useWikiPageReading } from "../hooks/useWikiPageReading";
import { ReaderBackButton } from "./ReaderBackButton";
import { lazy, Suspense, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { carryReviewNotes } from "../review-notes";
import { hasSourceChange, sourceChanges, type SourceChange } from "../source-freshness";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
import { LayoutDashboard, FileText, Plus, X } from "lucide-react";
import { ProjectSourceList } from "./ProjectSourceList";
import type { AtlasCanvas, Conversation } from "../../shared/types";
import type { FocusEvidence, FocusMode, FocusScope, FocusSession, FocusSection } from "../../shared/focus-session";
import { DemoApiError } from "../../ai/demo-api";
import { getAISettings } from "../../storage/knowledge-graph";
import { hasAIConnection, effectiveAISettings } from "../../ai/ai-mode";
import { AILocalInputError, createAtlasAI } from "../../ai/atlas-ai";
import {WikiRewriteBudgetError} from "../../ai/wiki-section-rewrite";
import {FocusOperationNotice} from "./FocusOperationNotice";
import { rewriteWikiSection } from "../../ai/wiki-section-rewrite";
import { keepWikiDraft, wikiEditorialSignature } from "../../shared/wiki-review";
import { WikiRewritePreview } from "./WikiRewritePreview";
import { readSessionSource } from "../../storage/source-versions";
import { ledgerDecisionsPending, withDecision } from "../../ai/wiki-key-decisions";
import { ledgerGenerationRetryNeeded } from "../../ai/wiki-draft-fit";
import { ProjectNavigationLayout, ProjectNavigationOpen, useProjectNavigationLayout } from "./ProjectNavigationLayout";
import { DecisionSteps } from "./DecisionSteps";
import { WikiWritingModePicker } from "./WikiWritingModePicker";
import { wikiNamedProjects } from "../../ai/wiki-writing-questions";
import { wikiPrewritingProjectQuestions } from "../../ai/wiki-project-decisions";
import { documentEvidenceReview } from "../document-review";
import { wikiBlockIssues } from "../../shared/wiki-explanations";
/** How long the step before writing waits for a first answer before writing goes on without one. */
const DECISION_GATE_WAIT_MS = 3 * 60_000;
import { KnowledgeLedger } from "./KnowledgeLedger";
import type { WikiKnowledgeLedger, WikiWritingMode } from "../../shared/wiki-knowledge";
import { AIProviderHttpError, AIProviderResponseError, AIProviderValidationError, requestProviderPermission } from "../../ai/provider";
import { attachFocusSession, renameFocusProject, wikiPublishBasis } from "../../storage/focus-sessions";
import { usePreferences } from "../preferences";
import { FocusDiscussion } from "./FocusDiscussion";
import { FocusUpdatePreview, type ChapterChange } from "./FocusUpdatePreview";
import { ChapterDiff } from "./ChapterDiff";
import { readingTitle } from "../../shared/reading-title";
import {reviseWikiChapters} from "../../ai/wiki-revision";
import {refreshWikiBrief} from "../../ai/wiki-manual-review";
import { FocusFollowUp, type RevisionScope } from "./FocusFollowUp";
const ProjectExportDialog = lazy(() => import("./ProjectExportDialog").then(module => ({ default: module.ProjectExportDialog })));
import { ReaderMoreMenu } from "./ReaderMoreMenu";
import { currentDecisions, replaceableContinuation } from "../../shared/project-continuation";
import {workspaceFocusVersions} from "../focus-versions";
import { excludeWikiChapter } from "../../shared/wiki-scope-review";
import { ReaderGuide } from "./ReaderGuide";
import "../project-outcome.css";
import { useFocusSave } from "../hooks/useFocusSave";
import { FocusGenerationProgress } from "./FocusGenerationProgress";
import { FocusGenerationErrorCard } from "./FocusGenerationErrorCard";
import { GenerationLogButton, WorkbenchGenerationLog } from "./WorkbenchGenerationLog";
import { ProjectVersionComparison } from "./ProjectVersionComparison";
import { ChapterRewriteDialog, ProjectReorganizeDialog } from "./WikiReorganizeDialogs";
import { applySelectiveUpdatePreview, updatePreview } from "../update-preview";
import { keepWorkbenchRunActivity } from "../../ai/workbench-run-activity";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import { FocusScopePicker } from "./FocusScopePicker";
import { WIKI_OPEN_CHAPTER_EVENT } from "../../shared/wiki-chapter-links";
import { beginFocusGenerationTask, updateFocusGenerationTask } from "../../storage/focus-generation-tasks";
import { projectIdentity } from "../../shared/project-continuation";
import { useFirstWikiDraft } from "../../sidecar/first-wiki-client";
import { FirstWikiPanel } from "../../sidecar/FirstWikiPanel";
const FocusSourceReader = lazy(() => import("./FocusSourceReader").then((module) => ({ default: module.FocusSourceReader })));

type LegacyScopeChoice = { includeKeys: string[]; excludeKeys: string[]; ignoredKeys: string[] };

export interface GoalRequest { id: string; goal: string; mode: FocusMode; sourceIds?: string[]; sourcePoolIds?: string[]; scopeCanvasId?: string; scope?: FocusScope; runId?: string; writingMode?: WikiWritingMode; organizationInstruction?: string }

function ReaderProgress({ zh, completed, total, work }: { zh: boolean; completed: number; total: number; work: boolean }) {
  const label = work ? zh ? "已核对" : "Checked" : zh ? "已理解" : "Understood";
  return <section className="focus-reader-progress" aria-label={zh ? "阅读进度" : "Reading progress"}><div><span>{label}</span><strong>{completed}/{total}</strong></div><progress value={completed} max={Math.max(total, 1)} aria-label={label} /><small>{zh ? `还剩 ${Math.max(0, total - completed)} 节` : `${Math.max(0, total - completed)} sections remaining`}</small></section>;
}

export function FocusWorkspace(props:ComponentProps<typeof FocusWorkspaceContent>){
 const cache=useRef<ReturnType<typeof createProjectReadingCache>>();
 if(!cache.current)cache.current=createProjectReadingCache();
 return <ProjectReadingCacheContext.Provider value={cache.current}><FocusWorkspaceContent {...props}/></ProjectReadingCacheContext.Provider>;
}

function FocusWorkspaceContent({ request, initialSession, searchTarget, revisionRequest, conversations, canvases, projectSessions = [], availableSessions, onOpenSession, onDeleteVersion, onDeleteProject, settingsRevision, onClose, onReturnToWorkbench, onSettings, onSaved, headerProgressTarget }: {
  request?: GoalRequest; initialSession?: FocusSession; searchTarget?: { sectionId: string; note: boolean; nonce: number }; conversations: Conversation[]; canvases: AtlasCanvas[]; settingsRevision: number;
  onClose: () => void; onReturnToWorkbench: (goal: string, sourceIds: string[], mode?: FocusMode) => void; onSettings: () => void; onSaved: (session: FocusSession) => void;
  projectSessions?: FocusSession[]; availableSessions?:FocusSession[]; onOpenSession?: (id: string, sectionId?: string, note?: boolean) => void;
  /** Both move to Trash, where they can be restored. */
  onDeleteVersion?: (id: string) => void | Promise<void>; onDeleteProject?: (canvasId: string) => void | Promise<void>;
  revisionRequest?: {instruction: string; nonce: number};
  headerProgressTarget?: HTMLElement | null;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [session, setSession] = useState(initialSession?.status === "preview" ? undefined : initialSession);
  const deferredSession = useDeferredValue(session);
  const [readingRefresh, setReadingRefresh] = useState<{ basis: FocusSession } & ({ previous: FocusSession; projection?: never } | { previous?: never; projection: WikiReadingProjection })>();
  const readingRefreshAbort = useRef<AbortController>();
  useEffect(() => () => readingRefreshAbort.current?.abort(), []);
  const [phase, setPhase] = useState<"sources" | "scope" | "generating" | "preview" | "reading" | "error">(initialSession ? initialSession.status === "preview" ? "preview" : "reading" : request?.sourceIds?.length ? request.scope ? "generating" : "scope" : "sources");
  const confirmedScope = useRef<FocusScope | undefined>(initialSession?.scope ?? request?.scope);
  const confirmedMode = useRef<FocusMode>(initialSession?.mode ?? request?.mode ?? "work");
  const [proposal, setProposal] = useState<FocusSession | undefined>(initialSession?.status === "preview" ? initialSession : undefined);
  const firstWikiDraft = useFirstWikiDraft(session?.mode === "work" && !session.sections.length ? projectIdentity(session) : undefined);
  useEffect(()=>{if(phase==="preview"&&!proposal&&!session)recordUiFailure(new Error("preview-state-unavailable"),"preview-state");},[phase,proposal,session]);
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  const wikiActionPending = useRef(false);
  const [previewInstructions, setPreviewInstructions] = useState<Record<string, string>>({});
  const [wikiActionChapterId, setWikiActionChapterId] = useState<string>();
  const [wikiFeedback, setWikiFeedback] = useState<{error?: string; status?: string}>({});
  const [wikiRewrite, setWikiRewrite] = useState<{sessionId: string; original: FocusSection; signature: string; candidate: FocusSection}>();
  const [chapterRewriteTarget, setChapterRewriteTarget] = useState<{ section: FocusSection; prompt: string }>();
  const [reorganizeConfirmOpen, setReorganizeConfirmOpen] = useState(false);
  const [selectedUpdateIds, setSelectedUpdateIds] = useState<Set<string>>();
  const previewDelta = useMemo(
    () => (phase === "preview" && session && proposal ? updatePreview(session, proposal) : undefined),
    [phase, session, proposal],
  );
  useEffect(() => {
    if (!previewDelta) { setSelectedUpdateIds(undefined); return; }
    setSelectedUpdateIds(new Set([
      ...previewDelta.changed.map((section) => section.id),
      ...previewDelta.removed.map((section) => section.id),
    ]));
  }, [previewDelta]);
  const [error, setError] = useState("");
  const [revisionFailure,setRevisionFailure]=useState<{message:string;budget?:WikiRewriteBudgetError;ids:string[];instruction:string}>();
  const [projectSaveError, setProjectSaveError] = useState("");
  const [errorInfo, setErrorInfo] = useState<{ code: string; requestId?: string; fields?:string[]; output?: AIProviderResponseError["outputDiagnostics"] }>();
  const [status, setStatus] = useState("");
  const [instruction, setInstruction] = useState("");
  const [revisionScope, setRevisionScope] = useState<RevisionScope>("section");
  const [editing, setEditing] = useState(false);
  // Where editing opens: the sentence chosen to rewrite, or the paragraph the reader was on.
  const [editTarget, setEditTarget] = useState<string>();
  const startEditing = (target?: string) => { setEditTarget(target); setEditing(true); };
  const [mobileNavigation,setMobileNavigation]=useState(false);
  const [wikiHeadingTarget,setWikiHeadingTarget]=useState<{id:string;title:string;revision:number}>();
  // The knowledge ledger is a page of its own beside the document overview, reached from the sidebar.
  const [ledgerPage, setLedgerPage] = useState(false);
  const [overview, setOverview] = useState(Boolean(initialSession && (initialSession.mode === "work" || !initialSession.activeSectionId)));
  const wikiPages = useWikiPageReading(
    phase === "preview" ? proposal : phase === "reading" ? session : undefined,
    zh, phase === "preview" ? "preview" : "pages",
  );
  const readingCache = useProjectReadingCache();
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [revisionIds,setRevisionIds]=useState<string[]>([]);
  // Generation paused after the directory is planned, waiting on the user's verdicts before anything is written.
  const [docReview,setDocReview]=useState<{kind:"issues";index:number}|{kind:"evidence";sectionId:string;revision:number;opened?:boolean}>();
  // Another wiki or version (chapter ids repeat across versions) starts without a pending review or an open source.
  const shownSessionId=session?.id;
  useEffect(()=>{setDocReview(undefined);setFocusedEvidence(undefined);setSourceSelection(undefined);},[shownSessionId]);
  const [decisionGate,setDecisionGate]=useState<{ledger:WikiKnowledgeLedger;original:WikiKnowledgeLedger;resolve:(ledger:WikiKnowledgeLedger)=>void;touched?:boolean;chooseMode?:boolean}>();
  const [writingChoice,setWritingChoice]=useState<{current:WikiWritingMode;resolve:(mode:WikiWritingMode)=>void}>();
  const [writingSwitch,setWritingSwitch]=useState(false);
  // Nobody answering for a few minutes (away, or the computer asleep) does not hold the document: writing goes on with
  // the answers given so far. Once the user answers anything, the step waits for them.
  useEffect(()=>{
    if(!decisionGate||decisionGate.touched)return;
    const timer=window.setTimeout(()=>decisionGate.resolve(decisionGate.ledger),DECISION_GATE_WAIT_MS);
    return()=>window.clearTimeout(timer);
  },[decisionGate]);
  const [wikiRevisionProgress,setWikiRevisionProgress]=useState<{done:number;total:number;stage?:"preparing"|"planning"|"writing"|"checking";cached?:number}>();
  const [openSourceId, setOpenSourceId] = useState<string>();
  const [sourcePickerOpen, setSourcePickerOpen] = useState(false);
  const [scopeUpdateIds, setScopeUpdateIds] = useState<string[]>();
  const [navigationTab, setNavigationTab] = useState<"chapters" | "sources">("chapters");
  const [wikiAdjusting, setWikiAdjusting] = useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  const [versionComparison, setVersionComparison] = useState(false);
  async function exportProject(){
    try{await saves.flush();setExportOpen(true);}
    catch{setError(zh?"保存失败，请重试后导出。":"Save failed. Retry before exporting.");}
  }
  const readingBaseRef = useRef<HTMLDivElement>(null);
  const sourceOverlayRef = useRef<HTMLDivElement>(null);
  const previewBaseRef = useRef<HTMLDivElement>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const projectSavePending = useRef(false);
  const [savedProjectName, setSavedProjectName] = useState<{ canvasId: string; name: string }>();
  const space = session?.canvasId ? canvases.find(item => item.id === session.canvasId) : undefined;
  const spaceTitle = space?.title?.trim() || space?.name;
  const optimisticName = savedProjectName && savedProjectName.canvasId === session?.canvasId ? savedProjectName.name : undefined;
  useEffect(() => {
    if (spaceTitle) setSavedProjectName(previous => previous?.canvasId === space?.id ? undefined : previous);
  }, [space?.id, spaceTitle]);
  const projectName = optimisticName || spaceTitle || session?.title || "";
  const [spaceName, setSpaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerUrl, setProviderUrl] = useState("");
  const [confirmed, setConfirmed] = useState<{ goal: string; ids: string[] } | undefined>(initialSession ? { goal: initialSession.goal, ids: initialSession.scope?.sourceConversationIds ?? initialSession.sourceConversationIds } : undefined);
  const [retrying, setRetrying] = useState(false);
  const [focusedEvidence, setFocusedEvidence] = useState<FocusEvidence>();
  const [updateSummaryHost,setUpdateSummaryHost]=useState<HTMLDivElement|null>(null);
  const [fullSourceReader, setFullSourceReader] = useState(false);
  const [sourceSelection, setSourceSelection] = useState<WorkspaceEvidenceOptions>();
  useLayoutEffect(() => {
    const previewPanel = phase === "preview" && proposal?.mode === "work";
    const open = Boolean(openSourceId || focusedEvidence && (!previewPanel && phase !== "reading" || phase === "reading" && session?.mode !== "work" || fullSourceReader));
    const base = readingBaseRef.current ?? previewBaseRef.current;
    if (base) base.inert = open || exportOpen || sourcePickerOpen || Boolean(focusedEvidence && phase === "reading" && session?.mode === "work" && (base?.parentElement?.getBoundingClientRect().width ?? window.innerWidth) < 940);
    if (!open) return;
    const positions = [...(base?.querySelectorAll<HTMLElement>(".focus-reading-body, .reading-outline") ?? [])].map(element => ({ element, top: element.scrollTop, left: element.scrollLeft }));
    const previous = document.activeElement as HTMLElement | null;
    sourceOverlayRef.current?.focus({ preventScroll: true });
    return () => {
      if (base) base.inert = false;
      if (previous?.isConnected) previous.focus({ preventScroll: true });
      for (const { element, top, left } of positions) if (element.isConnected) { element.scrollTop = top; element.scrollLeft = left; }
    };
  }, [openSourceId, focusedEvidence, exportOpen, sourcePickerOpen, fullSourceReader, phase, session?.mode, proposal?.mode]);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const sourcesCloseRef = useRef<HTMLButtonElement>(null);
  // In-text chapter links ("这部分已在「…」中说明") open that chapter like the sidebar does.
  const openChapterRef = useRef<(id: string) => void>(undefined);
  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (typeof id === "string") openChapterRef.current?.(id); };
    window.addEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
    return () => window.removeEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
  }, []);
  useEffect(() => {
    if (!sourcesOpen) return;
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest(".reader-more")?.querySelector<HTMLElement>("summary") ?? active;
    sourcesCloseRef.current?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [sourcesOpen]);
  const [partialPreview,setPartialPreview]=useState<FocusSession>();
  // The chapter the reader asked for first; the writing queue takes it next.
  const priorityOwner=useRef<string>(),[prioritized,setPrioritized]=useState<string>();
  const [analysisProgress, setAnalysisProgress] = useState<FocusAnalysisProgress>();
  const [resumedAfterConfirmation, setResumedAfterConfirmation] = useState(false);
  const navigationLayout = useProjectNavigationLayout();
  const [freshness, setFreshness] = useState<{sessionId:string;items:SourceChange[]}>();
  const changes = freshness?.sessionId===session?.id ? freshness?.items??[] : [];
  const checkingSources=useRef(false);
  const generationRun = useRef<string>();
  const trace = useRef<{ runId: string; release: () => void }>();
  const [logOpen, setLogOpen] = useState(false);
  const activeGenerationTask = useRef<string>();
  const freshnessRevision = useMemo(() => JSON.stringify(conversations.filter(item=>session?.sourceConversationIds.includes(item.id)).map(item=>[item.id,item.rawRevision??item.updatedAt,item.hydrationState,item.sourceUpdatedAt,item.hydratedSourceUpdatedAt])), [conversations, session?.sourceConversationIds]);
  // Progressively warm chapter caches during idle time so clicking between chapters is instant.
  useEffect(() => {
    if (phase !== "reading" || !session || session.mode !== "work" || !session.sections.length) return;
    let cancelled = false, cursor = 0, handle = 0;
    const schedule = (fn: () => void) => {
      if (typeof window.requestIdleCallback === "function") handle = window.requestIdleCallback(fn, { timeout: 240 });
      else handle = window.setTimeout(fn, 24);
    };
    const cancel = () => {
      if (typeof window.cancelIdleCallback === "function") window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
    const step = () => {
      if (cancelled) return;
      while (cursor < session.sections.length) {
        const chapter = session.sections[cursor++];
        if (!readingCache.has(session, `chapter-points:${chapter.id}:${zh}`)) {
          warmWikiChapterCache(readingCache, session, chapter, zh);
          break;
        }
      }
      if (cursor < session.sections.length) schedule(step);
    };
    schedule(step);
    return () => { cancelled = true; cancel(); };
  }, [phase, session, readingCache, zh]);
  const prefetchChapter = useCallback((id: string) => {
    const current = sessionRef.current;
    if (!current || current.mode !== "work") return;
    const chapter = current.sections.find(item => item.id === id);
    if (chapter) warmWikiChapterCache(readingCache, current, chapter, zh);
  }, [readingCache, zh]);
  useEffect(() => {
    const saved=sessionRef.current;
    if(!saved)return;
    let live=true;
    void sourceChanges(saved).then(items=>{if(live)setFreshness({sessionId:saved.id,items});}).catch(()=>undefined);
    return()=>{live=false;};
  },[session?.id,session?.sourceSignatures,session?.sourceOutlines,session?.sourceVersionIds,freshnessRevision]);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const activeId = session?.activeSectionId;
  useEffect(() => { setFollowUpOpen(false); setInstruction(""); setRevisionScope("section"); setSourcesOpen(false); }, [activeId]);
  useEffect(() => {
    if (!revisionRequest) return;
    setInstruction(revisionRequest.instruction); setRevisionScope("whole"); setFollowUpOpen(true);
  }, [revisionRequest]);
  const groups = useMemo(() => {
    const section = session?.sections.find((item) => item.id === activeId) ?? session?.sections[0];
    const ids = new Set(section?.evidenceIds ?? []);
    const grouped = new Map<string, FocusEvidence[]>();
    for (const item of session?.evidence ?? []) if (ids.has(item.id)) { const group = grouped.get(item.conversationId) ?? []; group.push(item); grouped.set(item.conversationId, group); }
    return [...grouped.values()];
  }, [session?.sections, session?.evidence, activeId]);
  const controller = useRef<AbortController>();
  const lastGeneration = useRef({ revise: false, expansion: undefined as string | undefined, complete: false, scope: undefined as "section" | "whole" | undefined, scopeChoice:undefined as LegacyScopeChoice|undefined, writingMode: undefined as WikiWritingMode | undefined, initialWritingMode: undefined as WikiWritingMode | undefined, organizationInstruction: undefined as string | undefined, reorganize: false });
  const saves = useFocusSave(onSaved, (state) => setStatus(state === "saving" || state === "saved" ? "" : zh ? "保存失败，请点击重试保存。" : "Save failed. Retry saving."), initialSession);
  const saveSearchPosition = saves.save;
  const storedMode = initialSession?.sidecarWritingMode;
  const storedLinks = initialSession?.sidecarConversationIds;
  const storedSessionId = initialSession?.id;
  useEffect(() => {
    const current = sessionRef.current;
    if (!current || current.id !== storedSessionId
      || current.sidecarWritingMode === storedMode && current.sidecarConversationIds === storedLinks) return;
    const next = { ...current, sidecarWritingMode: storedMode, sidecarConversationIds: storedLinks };
    sessionRef.current = next;
    setSession(next);
  }, [storedSessionId, storedMode, storedLinks]);
  useEffect(() => {
    const current = sessionRef.current;
    if (!searchTarget || !current?.sections.some((item) => item.id === (current.wikiSectionAliases?.[searchTarget.sectionId]??searchTarget.sectionId))) return;
    const next = { ...current, activeSectionId: current.wikiSectionAliases?.[searchTarget.sectionId]??searchTarget.sectionId, updatedAt: Date.now() };
    sessionRef.current = next; setSession(next); setOverview(false); setFocusedEvidence(undefined);
    void saveSearchPosition(next).catch(() => undefined);
  }, [searchTarget, saveSearchPosition]);
  const bodyRef = useRef<HTMLElement>(null);
  const [navigationRevision, setNavigationRevision] = useState(0);
  // Reset the committed view before paint. Scrolling the previous chapter can
  // anchor the new chapter halfway down or scroll the outer application shell.
  useLayoutEffect(() => {
    if (phase === "reading" && bodyRef.current && (session?.mode !== "work" || overview)) {
      bodyRef.current.scrollTop = 0;
      bodyRef.current.scrollLeft = 0;
    }
  }, [phase, activeId, overview, navigationRevision, session?.mode]);
  useWikiReadingPosition(bodyRef, session?.rootSessionId ?? session?.id, activeId, session?.mode === "work" && phase === "reading" && !overview);
  useEffect(() => () => { controller.current?.abort(); trace.current?.release(); if (activeGenerationTask.current) void updateFocusGenerationTask(activeGenerationTask.current, { status: "paused" }).catch(() => undefined); }, []);
  useEffect(() => { let live = true; void getAISettings().then((settings) => { if (live) setProviderUrl(settings?.mode !== "demo" ? settings?.baseUrl ?? "" : ""); }).catch(() => undefined); return () => { live = false; }; }, [settingsRevision]);

  const persist = (next: FocusSession) => {
    sessionRef.current = next; setSession(next);
    return saves.save(next, true);
  };
  const persistRoute = async (next: FocusSession) => {
    const stored = await saves.save(next, true) ?? next;
    sessionRef.current = stored; setSession(stored);
  };
  const saveWikiPage = async (id: string, title: string, group: string, displayTitle?: string) => {
    const current = sessionRef.current;
    if (!current || busy) throw new Error("Project is busy");
    await persistRoute({ ...current, sections: current.sections.map(item => item.id === id ? { ...item, title, wikiDisplayTitle: displayTitle?.trim() || undefined, wikiOriginalTitle: item.wikiOriginalTitle ?? item.title, wikiGroup: group || undefined, wikiGroupEdited: true } : item), wikiCollapsedGroups: { ...current.wikiCollapsedGroups, [group]: false }, updatedAt: Date.now() });
  };
  const saveWikiGroup = async (name: string) => {
    const current = sessionRef.current;
    if (!current || busy) throw new Error("Project is busy");
    await persistRoute(createWikiGroup(current, name));
  };
  const dropWikiPage = async (id: string, group: string, before?: string) => {
    const current = sessionRef.current;
    if (!current || busy) throw new Error("Project is busy");
    await persistRoute(placeWikiPage(current, id, group, before));
  };
  const saveWikiOrder = async (wikiOrder: string[]) => {
    const current = sessionRef.current;
    if (!current || busy) throw new Error("Project is busy");
    await persistRoute({ ...current, wikiOrder, updatedAt: Date.now() });
  };
  const savePreview = async (next: FocusSession) => {
    await saves.save(next, true);
    if (activeGenerationTask.current) await updateFocusGenerationTask(activeGenerationTask.current, { status: "preview", sessionId: next.id }).catch(() => undefined);
  };
  const update = (patch: Partial<FocusSession>) => {
    if (!sessionRef.current || busy) return;
    const next = { ...sessionRef.current, ...patch, updatedAt: Date.now() };
    sessionRef.current = next;
    setSession(next);
    void saves.save(next).catch(() => undefined);
    return next;
  };
  // The open editor holds a draft: these save it, and say whether leaving would drop it.
  const editorSave = useRef<(() => Promise<void>) | undefined>(undefined), editorDirty = useRef(false);
  const markEditorDirty = useCallback((dirty: boolean) => { editorDirty.current = dirty; }, []);
  const finishChapterEdit = async () => { if (editorSave.current) await editorSave.current(); else setEditing(false); };
  /** Writes an edited chapter once, on save: only then is it the reader's own text. */
  const saveChapterText = async (id: string, title: string, body: string) => {
    const current = sessionRef.current;
    if (!current) return;
    const next = { ...current, sections: current.sections.map(item => item.id === id ? { ...item, title, body, userEdited: true } : item), updatedAt: Date.now() };
    const stored = await saves.save(next, true) ?? next;
    sessionRef.current = stored; setSession(stored); editorDirty.current = false; setEditing(false);
  };
  const saveFirstChapter = async (title: string, body: string) => {
    const current = sessionRef.current;
    if (!current || current.sections.length) throw new Error("Project changed");
    await saves.flush();
    const next = await saveManualWikiChapter(current, undefined, title, body, zh);
    saves.adoptPersisted(next);
    sessionRef.current = next; setSession(next); onSaved(next);
    editorDirty.current = false; setEditing(false); setOverview(false);
  };
  /** Leaving the editor by another way than its own buttons asks first when there is a draft. */
  const leaveEditor = () => !editing || !editorDirty.current || window.confirm(zh ? "本章有未保存的修改，离开将放弃这些修改。确定离开？" : "This chapter has unsaved changes. Leave and discard them?");
  const generate = async (goal: string, ids: string[], revise = false, expansion?: string, complete = false, scope?: "section" | "whole", retry = false, scopeChoice?:LegacyScopeChoice, writingMode?:WikiWritingMode, reorganize = false, initialWritingMode?:WikiWritingMode, organizationInstruction?: string, syncChangedSources = false) => {
    const scopeBase=scopeChoice?(proposal??session):undefined;
    const writingBase = writingMode ? proposal ?? session : undefined;
    const previousPhase = writingBase?.status === "preview" ? "preview" : session ? "reading" : "error";
    try { if (!hasAIConnection(await getAISettings())) { lastGeneration.current = { revise, expansion, complete, scope, scopeChoice, writingMode, reorganize, initialWritingMode, organizationInstruction }; setConfirmed({ goal, ids }); setError(zh ? "请先连接自己的 AI。" : "Connect your AI API first."); setPhase(previousPhase); onSettings(); return; } }
    catch { setError(zh ? "读取 AI 配置失败，请重新打开 AI 设置。" : "Could not read AI settings. Reopen AI settings."); return; }
    const discussionScope = scopeBase?.scope ?? (revise ? session?.scope : confirmedScope.current);
    lastGeneration.current = { revise, expansion, complete, scope, scopeChoice, writingMode, reorganize, initialWritingMode, organizationInstruction };
    if (!retry || !generationRun.current) generationRun.current = !generationRun.current && !revise && !complete && request ? request.runId ?? request.id : `focus-${crypto.randomUUID()}`;
    controller.current?.abort();
    if (trace.current?.runId !== generationRun.current) {
      trace.current?.release();
      trace.current = { runId: generationRun.current, release: keepWorkbenchRunActivity(generationRun.current) };
    }
    const abort = new AbortController(); controller.current = abort;
    setRevisionFailure(undefined);setPartialPreview(undefined);priorityOwner.current=undefined;setPrioritized(undefined);setAnalysisProgress(undefined);setResumedAfterConfirmation(false); setRetrying(false); setConfirmed({ goal, ids }); setError(""); setErrorInfo(undefined); setStatus(zh ? "正在准备已确认的来源…" : "Preparing confirmed sources…"); setPhase("generating");
    try {
      await saves.flush();
      const sources = ids.map((id) => conversations.find((item) => item.id === id));
      if (sources.some((source) => !source)) throw new Error(zh ? "部分来源已被移除，请重新选择。" : "Some sources were removed. Select sources again.");
      if (request && !revise && !complete && !writingMode) {
        await beginFocusGenerationTask({ id: request.id, runId: generationRun.current!, goal, mode: confirmedMode.current, sourceIds: ids, scope: discussionScope, scopeCanvasId: request.scopeCanvasId, ...(initialWritingMode ? { writingMode: initialWritingMode } : {}), ...(organizationInstruction ? { organizationInstruction } : {}) });
        activeGenerationTask.current = request.id;
      }
      const sectionRevision = (scope ?? (expansion ? "section" : revisionScope)) === "section";
      const { generateFocusSession } = await import("../../ai/focus-session");
      const priorWiki = writingBase ?? (session?.mode === "work" ? { ...session, title: projectName } : proposal?.mode === "work" ? proposal : undefined);
      const incremental = (complete && Boolean(session) || Boolean(writingBase)) && !revise;
      const chooseWritingMode = !incremental && !revise && !initialWritingMode;
      const onKeyDecisions = revise ? undefined : (ledger: WikiKnowledgeLedger) => {
        if (abort.signal.aborted || !wikiPrewritingProjectQuestions(ledger, zh).length && !wikiNamedProjects(ledger).length) return Promise.resolve(ledger);
        return new Promise<WikiKnowledgeLedger>(resolve => {
          const done = (next: WikiKnowledgeLedger) => { setDecisionGate(undefined); resolve(next); };
          setDecisionGate({ ledger, original: ledger, chooseMode: chooseWritingMode && ledger.documentType !== "learning", resolve: done });
          abort.signal.addEventListener("abort", () => done(ledger), { once: true });
        });
      };
      const onWritingMode = chooseWritingMode ? (current: WikiWritingMode) => {
        if (abort.signal.aborted) return Promise.resolve(current);
        return new Promise<WikiWritingMode>(resolve => {
          const done = (next: WikiWritingMode) => { setWritingChoice(undefined); resolve(next); };
          setWritingChoice({ current, resolve: done });
          abort.signal.addEventListener("abort", () => done(current), { once: true });
        });
      } : undefined;
      const execute: typeof generateFocusSession = incremental ? async (...args) => {
        const { generateFocusUpdate } = await import("../../ai/focus-update");
        const scope = !writingMode && !reorganize && discussionScope !== session?.scope ? discussionScope : undefined;
        return generateFocusUpdate(priorWiki ?? session!, args[2], args[3], args[4], args[6], args[7], args[8], {
          ...args[9],
          scope,
          writingMode,
          reorganize,
          ...(syncChangedSources ? { syncChangedSources: true } : {}),
          ...(reorganize && organizationInstruction?.trim() ? { reorganizeInstruction: organizationInstruction.trim() } : {}),
        });
      } : generateFocusSession;
      abort.signal.throwIfAborted();
      let result = await execute(goal, revise ? session?.mode ?? confirmedMode.current : confirmedMode.current, sources as Conversation[], locale, abort.signal, revise && session ? { instruction: expansion ?? instruction, sections: session.sections, evidence: session.evidence, sectionId: sectionRevision ? session.activeSectionId : undefined, title: session.title, completedSectionIds: session.completedSectionIds, locale: session.locale } : undefined, (state) => {
        if (abort.signal.aborted) return;
        setRetrying(state === "retrying");
      }, generationRun.current, (completed, total, stage, detail) => {
        if (!abort.signal.aborted) {
          const progress = detail ?? { completed, total, stage, final: stage === "synthesis", round: 1, completedSourceIds: [], totalSources: ids.length, processedSegments: 0, totalSegments: 0, elapsedMs: 0 };
          setAnalysisProgress(previous => previous?.ledger?.coverage && progress.ledger && !progress.ledger.coverage
            ? { ...progress, ledger: { ...progress.ledger, coverage: previous.ledger.coverage } } : progress);
          if (activeGenerationTask.current && !writingMode) void updateFocusGenerationTask(activeGenerationTask.current, { progress }).catch(() => undefined);
        }
      }, {
        firstDocument: !priorWiki && !incremental && !revise && !scopeBase,
        ...(priorWiki ? { wikiProjectBoundary: savedWikiProjectBoundary(priorWiki), wikiPreviousLedger: priorWiki.wikiKnowledge } : {}),
        wikiScopeIncludeKeys: scopeChoice?.includeKeys ?? session?.wikiScopeReview?.includeKeys ?? proposal?.wikiScopeReview?.includeKeys,
        wikiScopeExcludeKeys: scopeChoice?.excludeKeys ?? session?.wikiScopeReview?.excludeKeys ?? proposal?.wikiScopeReview?.excludeKeys,
        wikiScopeIgnoredKeys: scopeChoice?.ignoredKeys ?? session?.wikiScopeReview?.ignoredKeys ?? proposal?.wikiScopeReview?.ignoredKeys,
        ...(complete ? { complete: true } : discussionScope ? { scope: discussionScope } : {}),
        priorityOwner: () => priorityOwner.current,
        initialWritingMode, ...(organizationInstruction ? { organizationInstruction } : {}), onKeyDecisions, onWritingMode,
        onPartial: partial => {
          if (abort.signal.aborted || controller.current !== abort) return;
          setPartialPreview(partial);
          if (generationRun.current && partial.sections.some(section => !section.wikiOutline && section.reviewIssue !== "draft" && section.body.trim()))
            void markAIFirstReadable(generationRun.current);
        },
      });
      if (abort.signal.aborted) return;
      if (scopeBase && (reorganize || scopeBase.sections.some(chapter=>!editableWikiTopic(chapter)))) {
        const [{mergeFocusUpdate},{getMessagesForConversation},{verifyFocusSources}]=await Promise.all([import("../../ai/focus-update"),import("../../storage/messages"),import("../../ai/focus-source-check")]);
        const messages=(await Promise.all(ids.map(id=>getMessagesForConversation(id)))).flat();
        abort.signal.throwIfAborted();
        // Full reorganization may replace AI-only notes. Personal text and confirmed decisions stay protected.
        const basis = reorganize ? { ...scopeBase, sections: scopeBase.sections.map(chapter =>
          replaceableContinuation(chapter) && !currentDecisions(chapter).length ? { ...chapter, continuation: undefined } : chapter) } : scopeBase;
        result=mergeFocusUpdate(basis,result,{fallback:true,changed:true,reorganize,affectedSectionIds:scopeBase.sections.map(chapter=>chapter.id),scope:discussionScope??{kind:"all"},removedKeys:[]},messages,locale);
        await verifyFocusSources(result,abort.signal);
      }
      if(abort.signal.aborted)return;
      // A revision becomes a separate reviewable result. The original and user edits remain saved.
      const previous = writingBase?.previousSessionId && session ? session : writingBase ?? session ?? proposal;
      const nextProposal: FocusSession = { ...result, status: "preview", scope: incremental ? result.scope ?? previous?.scope : complete ? { kind: "all" } : discussionScope ?? result.scope, ...(previous ? { rootSessionId: previous.rootSessionId ?? previous.id, previousSessionId: previous.id } : {}), sourceOutlines: revise ? session?.sourceOutlines : result.sourceOutlines, brief: revise && sectionRevision ? session?.brief : result.brief, coverage: revise && sectionRevision ? session?.coverage : result.coverage, ...(incremental ? {} : previous ? carryReviewNotes(previous, result, revise && sectionRevision) : { notes: "" }), visitedSectionIds: incremental ? result.visitedSectionIds : revise && sectionRevision ? session?.visitedSectionIds : undefined, sourceSignatures: revise && sectionRevision ? session?.sourceSignatures : result.sourceSignatures, sourceMessageOrder: revise && sectionRevision ? session?.sourceMessageOrder : result.sourceMessageOrder, sourceRoles: revise && sectionRevision ? session?.sourceRoles : result.sourceRoles, canvasId: session?.canvasId ?? proposal?.canvasId ?? request?.scopeCanvasId,
        ...(previous?.mode === "work" ? { wikiPublishBasis: previous.status === "preview" ? previous.wikiPublishBasis : wikiPublishBasis(previous) } : {}),
        ...(previous?.livingProject ? { livingProject: true, title: projectName,
          sidecarWritingMode: writingMode ?? previous.sidecarWritingMode, sidecarConversationIds: previous.sidecarConversationIds } : {}),
      };
      setProposal(nextProposal); setStatus(""); setPhase("preview");
      // Saving a completed preview never replaces the original accepted result.
      try {
        await savePreview(nextProposal);
      } catch { /* Keep the generated text and offer a save-only retry. */ }
    } catch (failure) {
      if (activeGenerationTask.current && !writingMode) await updateFocusGenerationTask(activeGenerationTask.current, { status: abort.signal.aborted ? "paused" : "failed", errorCode: failure instanceof DemoApiError || failure instanceof AIProviderHttpError || failure instanceof AIProviderResponseError || failure instanceof AIProviderValidationError ? failure.code : undefined }).catch(() => undefined);
      if (!abort.signal.aborted) { setStatus(""); setError(failure instanceof Error ? failure.message : String(failure)); setErrorInfo(failure instanceof DemoApiError || failure instanceof AIProviderHttpError || failure instanceof AIProviderResponseError || failure instanceof AIProviderValidationError ? { code: failure.code, requestId: failure.requestId, ...(failure instanceof AIProviderValidationError?{fields:failure.fieldPaths?.filter(path=>/^[a-zA-Z.[\]0-9_]{1,100}$/u.test(path)).slice(0,8)}:{}), ...(failure instanceof AIProviderResponseError ? { output: failure.outputDiagnostics } : {}) } : undefined); setPhase(previousPhase); }
    }
  };
  useEffect(() => {
    if (initialSession || !request?.scope || !request.sourceIds?.length) return;
    // Defer until the mount commits; StrictMode's discarded mount never starts AI.
    const timer = window.setTimeout(() => { void generate(request.goal, request.sourceIds!, false, undefined, false, undefined, false, undefined, undefined, false, request.writingMode, request.organizationInstruction); }, 0);
    return () => window.clearTimeout(timer);
    // Each request has a new workspace key; subsequent edits use explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  const reviseProjectWiki = async (onlyChapter?: FocusSection) => {
    const base=sessionRef.current;
    if(!base||busy||wikiActionPending.current)return;
    const revisionInstruction = onlyChapter ? "" : instruction;
    const selected=base.sections.filter(chapter=>!chapter.origin&&!chapter.userEdited&&(onlyChapter ? chapter.id === onlyChapter.id :
      revisionScope==="whole"||revisionScope==="section"&&chapter.id===base.activeSectionId||revisionScope==="selected"&&revisionIds.includes(chapter.id)));
    if(!selected.length){setError(zh?"请选择可调整的章节。":"Select available chapters.");return;}
    wikiActionPending.current=true;setBusy(true);setError("");setErrorInfo(undefined);setRevisionFailure(undefined);
    const abort=new AbortController();controller.current=abort;setWikiRevisionProgress({done:0,total:selected.length});
    try {
      await saves.flush();
      const settings=await getAISettings();
      if(!settings||!hasAIConnection(settings)){onSettings();throw new Error(zh?"请先连接自己的 AI，然后重试。":"Connect your AI, then retry.");}
      if((await sourceChanges(base)).some(change=>change.added||change.changed||change.removed||change.reordered))throw new Error(zh?"来源已变化，请先更新材料。":"Sources changed. Update materials first.");
      const refIds=new Set(selected.flatMap(chapter=>chapter.evidenceIds));
      const sources=[...new Set(base.evidence.filter(ref=>refIds.has(ref.id)).map(ref=>ref.conversationId))];
      const originals=(await Promise.all(sources.map(id=>readSessionSource(base,id)))).flat();
      const revised=await reviseWikiChapters(base,selected.map(chapter=>chapter.id),originals,revisionInstruction,createAtlasAI(settings,abort.signal,base.runId??base.id),abort.signal,(done,total,detail)=>{if(!abort.signal.aborted)setWikiRevisionProgress({done,total,...detail});},base.runId??base.id);
      const current=sessionRef.current;
      if(!current||current.id!==base.id||selected.some(chapter=>{const latest=current.sections.find(item=>item.id===chapter.id);return !latest||wikiBasis(current,latest)!==wikiBasis(base,chapter);})||(await sourceChanges(base)).some(change=>change.added||change.changed||change.removed||change.reordered))throw new Error(zh?"正文或来源已变化，当前内容已保留，请重新调整。":"Text or sources changed. Current content is retained; revise again.");
      abort.signal.throwIfAborted();
      const sections=current.sections.flatMap(chapter=>{if(!selected.some(item=>item.id===chapter.id))return [chapter];const next=revised.sections.find(item=>item.id===chapter.id);return next?[next]:[];});
      const aliases=new Map(selected.filter(chapter=>!sections.some(item=>item.id===chapter.id)).map(chapter=>[chapter.id,revised.wikiSectionAliases![chapter.id]]));
      const remapped=aliases.size?remapWikiSectionReferences(current,sections,aliases):{...current,sections};
      const publishBasis = current.status === "preview" ? current.wikiPublishBasis : wikiPublishBasis(current);
      const next=refreshWikiBrief({...remapped,wikiPublishBasis:publishBasis,wikiRevisionReceipt:revised.wikiRevisionReceipt,wikiContentReview:revised.wikiContentReview,knowledgeViewVersion:revised.knowledgeViewVersion,wikiTitleReview:revised.wikiTitleReview,semanticOverview:undefined,id:crypto.randomUUID(),rootSessionId:current.rootSessionId??current.id,previousSessionId:current.id,status:"preview",createdAt:Date.now(),updatedAt:Date.now()});
      setProposal(next);setPhase("preview");setStatus("");
      try{await savePreview(next);}catch{/* Keep candidate available for save-only retry. */}
    }catch(failure){if(!abort.signal.aborted){
      const message=failure instanceof Error?failure.message:String(failure);setError(message);
      setRevisionFailure({message,budget:failure instanceof WikiRewriteBudgetError?failure:undefined,ids:selected.map(chapter=>chapter.id),instruction:revisionInstruction});
      setErrorInfo(failure instanceof AIProviderHttpError||failure instanceof AIProviderResponseError||failure instanceof AIProviderValidationError||failure instanceof DemoApiError?{code:failure.code,requestId:failure.requestId}:failure instanceof AILocalInputError?{code:failure.code}:undefined);
    }}
    finally{wikiActionPending.current=false;setBusy(false);setWikiRevisionProgress(undefined);}
  };
  const accept = async () => {
    if (!proposal || busy || wikiActionPending.current) return;
    wikiActionPending.current = true; setBusy(true); setError(""); setStatus(zh ? "保存中…" : "Saving…");
    try {
      const previewBase = session && proposal ? applySelectiveUpdatePreview(session, proposal, selectedUpdateIds ?? new Set([...updatePreview(session, proposal).changed.map(item => item.id), ...updatePreview(session, proposal).removed.map(item => item.id)])) : proposal;
      if ((await sourceChanges(previewBase)).some(change => change.added || change.changed || change.removed || change.reordered)) throw new Error("Sources changed");
      // Saving prose is not approval of its facts, architecture or decisions.
      const next: FocusSession = { ...previewBase, status: "ready", updatedAt: Date.now() };
      const saved = await saves.save(next, true) ?? { ...next, wikiPublishBasis: undefined };
      sessionRef.current = saved; setSession(saved); confirmedScope.current = proposal.scope;
      if (session?.mode !== "work" || !lastGeneration.current.complete) setOverview(true);
      setProposal(undefined); setWikiRewrite(undefined); setPhase("reading"); setInstruction(""); setStatus("");
    } catch (failure) {
      setStatus("");
      const stale = (failure as { code?: string } | undefined)?.code === "WIKI_PREVIEW_STALE";
      setError(stale ? zh ? "项目已更新。草稿已保留，从最新版重新整理即可。" : "The project changed. The draft is retained. Regenerate from the latest version."
        : failure instanceof Error && failure.message === "Sources changed" ? zh ? "来源已有变化，请重新生成更新预览。" : "Sources changed. Regenerate the update preview."
        : zh ? "结果未能保存，草稿已保留，请重试。" : "Could not save this result. Your draft is retained; retry.");
    } finally { wikiActionPending.current = false; setBusy(false); }
  };
  const wikiBasis = (base: FocusSession, chapter: FocusSection) => JSON.stringify([wikiEditorialSignature(chapter), base.scope, base.evidence.filter(ref => chapter.evidenceIds.includes(ref.id)), base.sourceVersionIds]);
  const saveWikiChange = async (base: FocusSession, chapter: FocusSection) => {
    const next = { ...base, sections: base.sections.map(item => item.id === chapter.id ? chapter : item), updatedAt: Date.now() };
    if (proposalRef.current) { await savePreview(next); setProposal(next); } else await persistRoute(next);
  };
  /** Leaves a chapter out before saving: no model request, recorded as a scope exclusion. */
  const excludeChapter = async (chapter: FocusSection) => {
    const base = proposalRef.current;
    if (!base || busy || wikiActionPending.current) return;
    const next = excludeWikiChapter(base, chapter.id, zh);
    if (next === base) return;
    wikiActionPending.current = true; setBusy(true);
    try { await savePreview(next); setProposal(next); setStatus(zh ? `「${chapter.title}」不纳入本项目，可在上方“已不纳入”里重新纳入。` : `Left out "${chapter.title}". Include it again from Left out above.`); }
    catch { setStatus(zh ? "未能保存选择，章节仍保留，请重试。" : "Could not save your choice. The chapter is retained; retry."); }
    finally { wikiActionPending.current = false; setBusy(false); }
  };
  const keepChapter = async (chapter: FocusSection) => {
    const base = proposalRef.current ?? sessionRef.current;
    if (!base || busy || wikiActionPending.current) return;
    setWikiActionChapterId(chapter.id);
    wikiActionPending.current = true; setBusy(true); setWikiFeedback({ status: zh ? "保存选择…" : "Saving choice…" });
    try { await saveWikiChange(base, keepWikiDraft(chapter)); setWikiFeedback({status: zh ? "已保留现稿，事实状态未改变。" : "Draft kept. Fact status is unchanged."}); }
    catch { setWikiFeedback({error: zh ? "未能保存选择，原稿已保留，请重试。" : "Could not save your choice. The draft is retained; retry."}); }
    finally { wikiActionPending.current = false; setBusy(false); }
  };
  const rewriteChapter = async (chapter: FocusSection, editorialRequest: string) => {
    const base = proposalRef.current ?? sessionRef.current;
    if (!base || busy || wikiActionPending.current) return;
    setWikiActionChapterId(chapter.id);
    if (wikiRewrite) { setWikiFeedback({error: zh ? "请先采用或保留当前整理预览。" : "Apply or discard the current rewrite first."}); return; }
    wikiActionPending.current = true; setBusy(true); setWikiFeedback({status: zh ? "正在整理本章，原稿保留中…" : "Rewriting this chapter; the original is retained…"});
    const abort = new AbortController(); controller.current = abort;
    try {
      const settings = effectiveAISettings(await getAISettings());
      if (!hasAIConnection(settings)) throw new Error(zh ? "请先连接 AI 后重试。" : "Connect your AI, then retry.");
      if ((await sourceChanges(base)).some(change => change.added || change.changed || change.removed || change.reordered)) throw new Error(zh ? "来源已变化，请先更新材料。" : "Sources changed. Update materials first.");
      const ids = [...new Set(base.evidence.filter(ref => chapter.evidenceIds.includes(ref.id)).map(ref => ref.conversationId))];
      const originals = (await Promise.all(ids.map(id => readSessionSource(base, id)))).flat();
      const candidate = await rewriteWikiSection(
        base,
        chapter,
        originals,
        editorialRequest,
        createAtlasAI(settings, abort.signal, base.runId ?? base.id),
        abort.signal,
        base.runId ?? base.id,
        chapter.origin || chapter.userEdited ? { allowUserEditedCandidate: true } : undefined,
      );
      const current = proposalRef.current ?? sessionRef.current, currentChapter = current?.sections.find(item => item.id === chapter.id);
      if (!current || current.id !== base.id || !currentChapter || wikiBasis(current, currentChapter) !== wikiBasis(base, chapter) || (await sourceChanges(base)).some(change => change.added || change.changed || change.removed || change.reordered)) throw new Error(zh ? "正文或来源已变化，保留当前内容，请重新整理。" : "The text or sources changed. Current content is retained; rewrite again.");
      abort.signal.throwIfAborted();
      setWikiRewrite({sessionId: base.id, original: chapter, signature: wikiBasis(base, chapter), candidate});
      setWikiFeedback({status: zh ? "新稿已就绪，采用后才会替换原稿。" : "Candidate ready. The original changes only when you apply it."});
    } catch (failure) { if (!abort.signal.aborted) setWikiFeedback({error: failure instanceof Error ? failure.message : String(failure)}); }
    finally { wikiActionPending.current = false; setBusy(false); }
  };
  const applyChapterRewrite = async () => {
    const base = proposalRef.current ?? sessionRef.current;
    if (!base || !wikiRewrite || busy || wikiActionPending.current) return;
    wikiActionPending.current = true; setBusy(true);
    try {
      const chapter = base.sections.find(item => item.id === wikiRewrite.original.id);
      if (base.id !== wikiRewrite.sessionId || !chapter || wikiBasis(base, chapter) !== wikiRewrite.signature || (await sourceChanges(base)).some(change => change.added || change.changed || change.removed || change.reordered)) throw new Error(zh ? "正文或来源已变化，不能覆盖当前内容。" : "The text or sources changed. Current content cannot be overwritten.");
      await saveWikiChange(base, wikiRewrite.candidate); setWikiRewrite(undefined);
      setWikiFeedback({status: zh ? "已替换本章，其他章节保持原样。" : "This chapter was replaced; other chapters are retained."});
    } catch (failure) { setWikiFeedback({error: failure instanceof Error ? failure.message : zh ? "保存失败，预览已保留，请重试。" : "Save failed. The preview is retained; retry."}); }
    finally { wikiActionPending.current = false; setBusy(false); }
  };
  const reviewSources = (chapter: FocusSection) => {
    const base = proposalRef.current ?? sessionRef.current;
    const references=base?chapterEvidence(base,chapter):[];
    const ref = references[0];
    setWikiActionChapterId(chapter.id);
    if (ref) { setFullSourceReader(false); setSourceSelection({references,sectionId:chapter.id}); setFocusedEvidence(ref); }
    else setWikiFeedback({error: zh ? "本章没有可用来源，请补充原文。" : "No sources are available for this chapter. Add originals first."});
  };
  const wikiFeedbackView = <div className="wiki-action-feedback" aria-live="polite">{wikiFeedback.error ? <p role="alert">{wikiFeedback.error}</p> : wikiFeedback.status ? <p role="status">{wikiFeedback.status}</p> : null}</div>;
  const wikiRewriteView = wikiRewrite ? <WikiRewritePreview previous={wikiRewrite.original} next={wikiRewrite.candidate} zh={zh} busy={busy} onApply={() => void applyChapterRewrite()} onDiscard={() => { setWikiRewrite(undefined); setWikiFeedback({status: zh ? "已保留原稿。" : "Original retained."}); }} onRetry={phase === "reading" ? () => { const original = wikiRewrite.original; setWikiRewrite(undefined); setChapterRewriteTarget({ section: original, prompt: chapterRewriteTarget?.prompt ?? "" }); } : undefined} /> : null;
  const attach = async () => {
    if (!sessionRef.current || busy || projectSavePending.current) return;
    projectSavePending.current = true; setBusy(true); setProjectSaveError("");
    try {
      await saves.flush();
      const current = sessionRef.current!;
      const sourceName=conversations.find(item=>item.id===current.sourceConversationIds[0])?.title.trim();
      const name=(current.mode==="work"?current.title.trim()||sourceName:sourceName||current.title.trim())||(zh?"未命名项目":"Untitled project");
      const next = await attachFocusSession(current, current.canvasId ? { canvasId: current.canvasId } : { name });
      if (!current.canvasId && next.canvasId) setSavedProjectName({ canvasId: next.canvasId, name });
      saves.adoptPersisted(next);
      sessionRef.current = next; setSession(next); onSaved(next); setStatus("");
    } catch (failure) { setProjectSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { projectSavePending.current = false; setBusy(false); }
  };
  const renameProject = async () => {
    const current = sessionRef.current, name = spaceName.trim();
    if (!current || !name || busy || projectSavePending.current) return;
    projectSavePending.current = true; setBusy(true); setProjectSaveError("");
    try {
      await saves.flush();
      const next = await renameFocusProject(sessionRef.current!, name);
      saves.adoptPersisted(next);
      if (next.canvasId) setSavedProjectName({ canvasId: next.canvasId, name });
      sessionRef.current = next;
      setSession(next);
      setRenamingProject(false);
      onSaved(next);
    } catch (failure) { setProjectSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { projectSavePending.current = false; setBusy(false); }
  };
  const authorize = () => { void requestProviderPermission(providerUrl).then((allowed) => setStatus(allowed ? zh ? "已授权，请重试生成。" : "Authorized. Retry generation." : zh ? "未获得连接权限。" : "Connection permission denied.")).catch((failure) => setError(String(failure))); };

  const retryGeneration = () => { if (confirmed) void generate(confirmed.goal, confirmed.ids, lastGeneration.current.revise, lastGeneration.current.expansion, lastGeneration.current.complete, lastGeneration.current.scope, true, lastGeneration.current.scopeChoice, lastGeneration.current.writingMode, lastGeneration.current.reorganize, lastGeneration.current.initialWritingMode, lastGeneration.current.organizationInstruction); };
  const retainedProgress = analysisProgress?.processedSegments ? <p className="muted">{analysisProgress.processedSegments === analysisProgress.totalSegments ? zh ? `材料分析已完成（${analysisProgress.totalSegments} 段）；重试将复用分析结果，重新汇总预览。` : `Material analysis complete (${analysisProgress.totalSegments} passages). Retry reuses the analysis to compose the preview.` : zh ? `已处理 ${analysisProgress.processedSegments}/${analysisProgress.totalSegments} 段；重试只补未完成的分析或汇总。` : `${analysisProgress.processedSegments}/${analysisProgress.totalSegments} passages processed. Retry resumes unfinished analysis or composition.`}</p> : null;
  const errorDetails = errorInfo ? <details><summary>{zh ? "诊断信息" : "Diagnostic details"}<ChevronDown size={14}/></summary><p>{error}</p><p>{errorInfo.code}</p>{errorInfo.fields?.length?<p style={{overflowWrap:"anywhere"}}>{zh?"校验位置":"Validation fields"}: {errorInfo.fields.join(", ")}</p>:null}{errorInfo.requestId ? <p style={{ overflowWrap: "anywhere" }}>{errorInfo.requestId}</p> : null}{errorInfo.output ? <p>{zh ? "输出额度" : "Output limit"}: {errorInfo.output.outputTokenLimit} token · {zh ? "返回内容" : "Returned content"}: {errorInfo.output.receivedCharacters} {zh ? "字符" : "characters"}{errorInfo.output.reasoningTokens !== undefined ? ` · ${zh ? "思考" : "Reasoning"}: ${errorInfo.output.reasoningTokens} token` : (errorInfo.output.reasoningCharacters ?? 0) > 0 ? ` · ${zh ? "思考" : "Reasoning"}: ${errorInfo.output.reasoningCharacters} ${zh ? "字符" : "characters"}` : ""}</p> : null}</details> : null;
  const needsConnectionPermission = Boolean(providerUrl && /授权 AI 连接|Authorize the AI connection/u.test(error));
  const failedRevision=revisionFailure?.message===error?revisionFailure:undefined;
  const budgetFailure=failedRevision?.budget;
  // Name which limit stopped the revision: a local pre-send limit or the shared quota.
  const quotaFailure=Boolean(failedRevision&&/^DEMO_(?:BUDGET|QUOTA)_EXHAUSTED$/u.test(errorInfo?.code??"")),localLimit=Boolean(failedRevision&&errorInfo?.code?.startsWith("LOCAL_INPUT_"));
  const reopenRevision=()=>{
    if(!failedRevision)return;
    setInstruction(failedRevision.instruction);
    setRevisionScope("selected");setRevisionIds(failedRevision.ids.filter(id=>id!==budgetFailure?.sectionId));
    setFollowUpOpen(true);
  };
  const errorPanel = error ? <FocusOperationNotice zh={zh}
    title={budgetFailure?zh?"本章材料较长，暂未调整":"This chapter needs a smaller revision":quotaFailure?zh?"共享 AI 额度不足":"Shared AI quota is insufficient":localLimit?zh?"超过本地输入上限，未发送":"Over the local input limit; nothing sent":failedRevision?zh?"内容调整未完成":"Revision not completed":zh?"操作未完成":"Operation not completed"}
    message={generationFailureReason(error,errorInfo?.code,zh)}
    action={needsConnectionPermission?{label:zh?"授权 AI 连接":"Authorize AI connection",run:authorize}:failedRevision?{label:budgetFailure?zh?"重新选择章节":"Choose chapters":zh?"重新调整":"Revise again",run:reopenRevision,disabled:busy}:confirmed?{label:zh?"重试生成":"Retry generation",run:retryGeneration,disabled:busy}:undefined}
    onSettings={budgetFailure?undefined:onSettings}
    note={failedRevision?null:retainedProgress}
    onDismiss={()=>{setError("");setErrorInfo(undefined);setRevisionFailure(undefined);}}>
    {generationRun.current && <GenerationLogButton zh={zh} onClick={() => setLogOpen(true)}/>}
    {errorDetails}
    {budgetFailure?<details><summary>{zh?"查看原因":"Why this happened"}<ChevronDown size={14}/></summary><p>{zh?`预计输入 ${budgetFailure.inputTokens.toLocaleString()} Token，当前单次调整上限 ${budgetFailure.maxInputTokens.toLocaleString()} Token；包含 ${budgetFailure.sourceMessages} 条关联原始消息。不是服务商额度不足，原样重试不会缩小材料。可先选择其他章节调整。`:`Estimated input: ${budgetFailure.inputTokens.toLocaleString()} tokens; local revision limit: ${budgetFailure.maxInputTokens.toLocaleString()} tokens, including ${budgetFailure.sourceMessages} original messages. This is not a provider quota error. Retrying unchanged input will not reduce it; you can revise other chapters first.`}</p></details>:null}
  </FocusOperationNotice> : null;
  // Reads only what changed in the sources, rewrites the chapters it touches and opens the result as a preview.
  const updateProject = async () => {
    if (!session || busy || checkingSources.current) return;
    if (session.sidecarConversationIds?.some(id=>!session.sourceConversationIds.includes(id))) {
      if (leaveEditor()) setSourcePickerOpen(true);
      return;
    }
    checkingSources.current=true;
    try {
      const items=await sourceChanges(session);
      if(sessionRef.current!==session)return;
      setFreshness({sessionId:session.id,items});
      if (conversations.some(source=>session.sourceConversationIds.includes(source.id)&&!isCurrentHydrationComplete(source))) {
        setStatus(zh ? "来源正在同步，稍后再检查。" : "Sources are syncing. Check again shortly.");
      } else if (items.some(item=>hasSourceChange(item)||item.unknown) && session.scope?.kind === "goal") {
        if (!leaveEditor()) return;
        setScopeUpdateIds(session.scope.sourceConversationIds ?? session.sourceConversationIds);
        setPhase("scope");
      } else if (!items.some(item=>hasSourceChange(item)||item.unknown) && !ledgerGenerationRetryNeeded(session.wikiKnowledge) && !ledgerDecisionsPending(session.wikiKnowledge, session.sections)) {
        setStatus(zh ? "文档已是最新。" : "The document is up to date.");
      } else if (leaveEditor()) await generate(session.goal, session.sourceConversationIds, false, undefined, true);
    } catch { setStatus(zh?"暂时无法检查来源，请重试。":"Could not check sources. Try again."); }
    finally { checkingSources.current=false; }
  };
  const openReorganizeDialog = () => {
    if (!session || busy || checkingSources.current || !leaveEditor()) return;
    setReorganizeConfirmOpen(true);
  };
  const reorganizeProject = async (options?: { syncChangedSources?: boolean; instruction?: string }) => {
    if (!session || busy || checkingSources.current || !leaveEditor()) return;
    setReorganizeConfirmOpen(false);
    const syncChangedSources = Boolean(options?.syncChangedSources && session.wikiKnowledge);
    const reorganizeNote = options?.instruction?.trim() || undefined;
    checkingSources.current = true;
    try {
      const items = await sourceChanges(session);
      if (sessionRef.current !== session) return;
      const syncing = conversations.some(source => session.sourceConversationIds.includes(source.id) && !isCurrentHydrationComplete(source));
      if (syncing || (!syncChangedSources && items.some(item => hasSourceChange(item) || item.unknown))) {
        setFreshness({ sessionId: session.id, items });
        setStatus(zh ? "请先更新或完成同步来源，再重整全部章节。" : "Update or finish syncing sources before reorganizing all chapters.");
        return;
      }
      if (session.wikiKnowledge) {
        await generate(session.goal, session.sourceConversationIds, false, undefined, true, undefined, false, undefined, undefined, true, undefined, reorganizeNote, syncChangedSources);
      } else {
        await generate(session.goal, session.sourceConversationIds, false, undefined, false, undefined, false, {
          includeKeys: [...session.wikiScopeReview?.includeKeys ?? []],
          excludeKeys: [...session.wikiScopeReview?.excludeKeys ?? []],
          ignoredKeys: [...session.wikiScopeReview?.ignoredKeys ?? []],
        }, undefined, true, undefined, reorganizeNote);
      }
    } catch { setStatus(zh ? "暂时无法检查来源，请重试。" : "Could not check sources. Try again."); }
    finally { checkingSources.current = false; }
  };

  const adjustSources = () => { void saves.flush().catch(() => undefined); onReturnToWorkbench((session && !session.sections.length ? revisionRequest?.instruction : undefined) ?? confirmed?.goal ?? session?.goal ?? request?.goal ?? "", confirmed?.ids ?? session?.scope?.sourceConversationIds ?? session?.sourceConversationIds ?? request?.sourceIds ?? [], session?.mode ?? confirmedMode.current); };

  const currentVersion=phase==="preview"?proposal:session;
  const logRunId = generationRun.current ?? currentVersion?.runId;
  const openLog = logRunId ? () => setLogOpen(true) : undefined;
  const generationLog = logOpen && logRunId ? <WorkbenchGenerationLog key={logRunId} runId={logRunId} zh={zh}
    running={phase === "generating"} retrying={phase === "generating" && retrying} awaitingConfirmation={phase === "generating" && Boolean(decisionGate || writingChoice)}
    progress={analysisProgress} failed={Boolean(error)} errorCode={errorInfo?.code} chapterEvents={currentVersion?.sidecarGenerationLog} onClose={() => setLogOpen(false)}/> : null;
  const versions=currentVersion?workspaceFocusVersions(availableSessions??projectSessions,currentVersion):[];
  const previousVersion = versions.find(version => version.id === currentVersion?.previousSessionId && version.status !== "preview");
  const latestSaved = versions.find(version => version.mode === "work" && version.status !== "preview" && !version.ledgerTest);
  const sidecarVersion = latestSaved?.continuationUpdate && latestSaved.id !== currentVersion?.id ? latestSaved : undefined;
  const projectPicker=versions.length>0&&onOpenSession&&currentVersion?<ProjectVersionPicker versions={versions} currentId={currentVersion.id} zh={zh} disabled={busy||editing||Boolean(wikiRewrite)} onSelect={async id=>{try{await saves.flush();onOpenSession(id);}catch{setStatus(zh?"保存失败，请重试后切换版本。":"Save failed. Retry before switching versions.");}}} onDelete={onDeleteVersion?async id=>{try{await saves.flush();await onDeleteVersion(id);}catch{setStatus(zh?"保存失败，版本已保留，请重试。":"Save failed. The version was retained; retry.");}}:undefined}/>:null;
  if (phase === "scope") {
    const ids = scopeUpdateIds ?? confirmedScope.current?.sourceConversationIds ?? confirmed?.ids ?? request?.sourceIds ?? session?.sourceConversationIds ?? [];
    const goal = confirmed?.goal ?? session?.goal ?? request?.goal ?? "";
    const scopeSources = ids.flatMap((id) => { const source = conversations.find((item) => item.id === id); return source ? [source] : []; });
    return <FocusScopePicker goal={goal} mode={confirmedMode.current} sources={scopeSources} zh={zh} returningToReading={Boolean(session || proposal)} initialScope={confirmedScope.current} updating={Boolean(scopeUpdateIds)} onConfigureAI={onSettings} onBack={session || proposal ? () => { setScopeUpdateIds(undefined); const previous = proposal ?? session!; confirmedScope.current = previous.scope; confirmedMode.current = previous.mode; setPhase(proposal ? "preview" : "reading"); } : (nextGoal, nextMode) => { void saves.flush().catch(() => undefined); onReturnToWorkbench(nextGoal, ids, nextMode); }} onConfirm={(scope, nextGoal, nextMode, initialWritingMode) => { setScopeUpdateIds(undefined); confirmedScope.current = scopeUpdateIds ? { ...scope, documentType: session?.scope?.documentType } : scope; confirmedMode.current = nextMode; const included = scope.kind === "goal" ? ids.filter((id) => scope.blocks?.some((block) => block.conversationId === id)) : ids; void generate(nextGoal, included, false, undefined, Boolean(scopeUpdateIds), undefined, false, undefined, undefined, false, initialWritingMode ?? request?.writingMode, request?.organizationInstruction); }} />;
  }

  if (phase === "sources") return <main className="focus-error-screen"><section className="focus-error-card"><h1>{zh ? "请先确认来源材料" : "Confirm sources first"}</h1><p>{zh ? "在工作台选择已同步的对话，再生成阅读预览。" : "Choose synced conversations on the Workbench before creating a preview."}</p><div className="focus-error-actions"><button className="primary" onClick={adjustSources}>{zh ? "返回工作台" : "Back to Workbench"}</button></div></section></main>;
  if (phase === "error") return <main className="focus-error-screen"><FocusGenerationErrorCard zh={zh} message={error} code={errorInfo?.code} progress={analysisProgress} diagnostics={errorDetails} logAction={openLog && <GenerationLogButton zh={zh} onClick={openLog}/>} onRetry={confirmed ? retryGeneration : undefined} onSources={adjustSources} onSettings={onSettings} onAuthorize={needsConnectionPermission ? authorize : undefined} status={status} />{generationLog}</main>;
  if (phase === "generating") {
    const dockProgress = Boolean(partialPreview || decisionGate || writingChoice || resumedAfterConfirmation);
    const progress = <FocusGenerationProgress compact={dockProgress} awaitingConfirmation={Boolean(decisionGate || writingChoice)} zh={zh} mode={session?.mode ?? confirmedMode.current} scopeKind={confirmedScope.current?.kind ?? (lastGeneration.current?.complete ? "all" : undefined)} detail={analysisProgress} sourceCount={analysisProgress?.totalSources ?? confirmed?.ids.length ?? request?.sourceIds?.length ?? 0} retrying={retrying} runId={logRunId} onLog={openLog} onCancel={() => { controller.current?.abort(); setStatus(""); if (lastGeneration.current.writingMode && proposal) setPhase("preview"); else if (session) setPhase("reading"); else adjustSources(); }} />;
    const partialDoneCount = partialPreview ? partialPreview.sections.filter(section => !section.wikiOutline && section.body.trim().length > 0).length : 0;
    const partialIsRough = Boolean(partialPreview?.sections.every(section => section.id.startsWith("rough:")));
    return <main className={`focus-wait${dockProgress ? " is-progress-docked" : ""}`}>
      {dockProgress ? headerProgressTarget ? createPortal(progress, headerProgressTarget) : <div className="focus-progress-fallback">{progress}</div> : <div className="focus-generation-panel">{progress}</div>}
      {generationLog}
      {decisionGate ? <div className="focus-decision-gate"><DecisionSteps ledger={decisionGate.original} zh={zh} chooseMode={decisionGate.chooseMode} onInteract={()=>setDecisionGate(gate=>gate&&!gate.touched?{...gate,touched:true}:gate)} onDone={(counts, apply)=>{if(generationRun.current)void measureAILocalStep(generationRun.current,"wiki","wiki:decision-questions-interaction",()=>undefined,()=>counts);setResumedAfterConfirmation(true);decisionGate.resolve(apply(decisionGate.ledger));}}/></div> : null}
      {writingChoice ? <div className="focus-decision-gate"><WikiWritingModePicker current={writingChoice.current} zh={zh} onChoose={mode=>{setResumedAfterConfirmation(true);writingChoice.resolve(mode);}}/></div> : null}
      {partialPreview ? <section className="focus-partial-preview" aria-label={zh ? "章节草稿预览" : "Chapter draft preview"}>
        {partialPreview.sections.some(section=>section.wikiOutline)?<p className="focus-partial-note" role="status">{partialIsRough?zh?"还在读取对话：这是目前读到的主要主题，整理后会变成正式目录。":"Still reading: these are the main topics so far; they become the directory once organized.":partialPreview.sections.some(section=>section.wikiOutline&&section.wikiOwnerId)?zh?"目录和要点已就绪，正文正在逐章写入；想先看哪一章，可以让它先写。":"The outline and key points are ready; chapters are being written one by one. Choose one to write first.":zh?"目录已就绪，正文正在逐章写入。":"The directory is ready; chapters are being written."}</p>:null}
        {partialPreview.sections.map((section, idx) => <article key={section.id} id={`partial-chapter-${idx}`} className={section.wikiOutline?"is-outline":undefined}><h2>{section.title}</h2>{section.wikiOutline?<div className="focus-partial-outline-status"><span>{zh?"要点 · 正文生成中":"Key points · being written"}</span>{section.wikiOwnerId?<button type="button" disabled={prioritized===section.wikiOwnerId} onClick={()=>{priorityOwner.current=section.wikiOwnerId;setPrioritized(section.wikiOwnerId);}}>{prioritized===section.wikiOwnerId?zh?"已排到最前":"Next in line":zh?"先写这一章":"Write this first"}</button>:null}</div>:section.reviewIssue?<p className="focus-partial-note">{zh?"草稿 · 待核验":"Draft · awaiting review"}</p>:null}<PreviewContent raw={section.body} zh={zh}><ReaderGuide content={section.body} zh={zh} complete hideEvidenceMarkers /></PreviewContent></article>)}
        {partialPreview.sections.length > 1 ? <div className="focus-partial-queue" aria-label={zh ? "章节生成进度" : "Chapter writing queue"}>
          <span className="focus-partial-dock-count" aria-hidden="true">{partialIsRough ? zh ? `${partialPreview.sections.length} 主题` : `${partialPreview.sections.length} topics` : `${partialDoneCount}/${partialPreview.sections.length}`}</span>
          <div className="focus-partial-dock-list">
            {partialPreview.sections.map((section, idx) => {
              const done = !section.wikiOutline && section.body.trim().length > 0;
              const queuedNext = Boolean(section.wikiOutline && section.wikiOwnerId && prioritized === section.wikiOwnerId);
              return <button key={section.id} type="button" className={`focus-partial-pill${done ? " is-done" : queuedNext ? " is-next" : " is-outline"}`}
                onClick={() => document.getElementById(`partial-chapter-${idx}`)?.scrollIntoView?.({ behavior: "smooth", block: "start" })}>
                <span className="focus-partial-pill-dot" aria-hidden="true">{done ? "✓" : idx + 1}</span>
                <span>{section.title}</span>
              </button>;
            })}
          </div>
        </div> : null}
      </section> : null}
    </main>;
  }
  if (phase === "preview" && proposal) {
    const projectPreview = proposal.mode === "work";
    const quality = wikiPreviewQuality(proposal.wikiKnowledge, zh);
    const totalUpdateChanges = previewDelta ? previewDelta.changed.length + previewDelta.removed.length : 0;
    const selectedUpdateCount = previewDelta && selectedUpdateIds
      ? [...previewDelta.changed.map((item) => item.id), ...previewDelta.removed.map((item) => item.id)].filter((id) => selectedUpdateIds.has(id)).length
      : totalUpdateChanges;
    const selectiveEnabled = Boolean(projectPreview && session && previewDelta && selectedUpdateIds && totalUpdateChanges > 1);
    const toggleSelectedChapter = (id: string) => {
      setSelectedUpdateIds((current) => {
        const nextSet = new Set(current ?? []);
        if (nextSet.has(id)) nextSet.delete(id);
        else nextSet.add(id);
        return nextSet;
      });
    };
    const renderChapter = (chapter: FocusSection, content: ReactNode, change?: ChapterChange) => projectPreview ? <WikiChapterPreview
      number={proposal.sections.indexOf(chapter)+1} section={chapter} zh={zh} busy={busy} change={change} instruction={previewInstructions[chapter.id] ?? ""}
      selectable={selectiveEnabled && Boolean(change?.kind)}
      selected={selectedUpdateIds ? selectedUpdateIds.has(chapter.id) : true}
      onToggleSelect={() => toggleSelectedChapter(chapter.id)}
      onInstruction={text => setPreviewInstructions(previous => ({...previous, [chapter.id]: text}))}
      onSources={() => reviewSources(chapter)} onKeep={() => void keepChapter(chapter)}
      onExclude={chapter.wikiMaterialKeys?.length && proposal.sections.length > 1 && !chapter.userEdited && !chapter.origin ? () => void excludeChapter(chapter) : undefined} onRewrite={() => void rewriteChapter(chapter, previewInstructions[chapter.id] ?? "")}
      feedback={wikiActionChapterId === chapter.id ? wikiFeedbackView : undefined}
      candidate={wikiRewrite?.original.id === chapter.id ? wikiRewriteView : undefined}
    ><PreviewContent raw={chapter.body} zh={zh} reserveSpace>{content}</PreviewContent></WikiChapterPreview> : <><h2>{chapter.title}</h2>{change?.renamedFrom ? <p className="muted">{zh ? "原名：" : "Previously: "}{change.renamedFrom}</p> : null}{change?.previousBody !== undefined ? <details className="update-old-text"><summary>{zh ? "和旧版对比" : "Compare with earlier"}</summary><ChapterDiff before={change.previousBody} after={chapter.body} zh={zh}/></details> : null}{content}</>;
    const noSelectedChanges = selectiveEnabled && selectedUpdateCount === 0;
    return <main className={`focus-preview${projectPreview ? " is-project-preview" : ""}${focusedEvidence ? " has-original-panel" : ""}`}>
      <div className="focus-preview-shell">
        <div className="focus-preview-banner">
          <div className="focus-preview-banner-meta">
            <span className="focus-preview-badge">{session ? (zh ? "更新草稿" : "Update draft") : (zh ? "未保存草稿" : "Draft")}</span>
            <span className="focus-preview-banner-count">
              {selectiveEnabled && selectedUpdateCount < totalUpdateChanges
                ? (zh ? `已选采纳 ${selectedUpdateCount} / ${totalUpdateChanges} 项变更 · 未选章节保留旧版` : `Accepting ${selectedUpdateCount} of ${totalUpdateChanges} changes · others kept`)
                : (zh ? `共 ${proposal.sections.length} 章 · 确认后保存` : `${proposal.sections.length} chapters · Save to apply`)}
            </span>
          </div>
          <div className="focus-preview-actions">{onDeleteVersion && !session ? <button className="focus-preview-delete" disabled={busy} onClick={() => { controller.current?.abort(); void saves.flush().catch(() => undefined).then(() => { onDeleteVersion(proposal.id); onClose(); }); }}>{zh ? "删除此预览" : "Delete this preview"}</button> : null}<button disabled={busy} onClick={adjustSources}>{zh ? "调整来源" : "Change sources"}</button>{projectPreview&&proposal.wikiKnowledge?.organization?<button type="button" disabled={busy||Boolean(wikiRewrite)} onClick={()=>setWritingSwitch(true)}>{zh?"切换写作模式":"Change writing mode"}</button>:null}<button className="primary" disabled={busy || Boolean(wikiRewrite) || noSelectedChanges} title={noSelectedChanges ? (zh ? "请至少勾选一项要采纳的变更" : "Select at least one change to accept") : undefined} onClick={() => void accept()}>{busy ? zh ? "处理中…" : "Working…" : projectPreview ? zh ? "保存并查看" : "Save and view" : zh ? "确认并开始" : "Confirm and start"}</button></div>
        </div>
        <div className="focus-preview-scroll" ref={previewBaseRef}>
          <div className="focus-preview-inner">
            <div className="focus-preview-heading"><div className="focus-preview-title-row"><h1>{proposal.title}</h1>
              {projectPreview && session && lastGeneration.current.reorganize && <button type="button" className="generation-log-trigger" onClick={() => setVersionComparison(true)}><GitCompareArrows size={15} aria-hidden="true"/>{zh ? "对比当前文档" : "Compare with saved document"}</button>}
              {openLog && <GenerationLogButton zh={zh} onClick={openLog}/>}</div></div>
            {projectPreview && quality.length ? <p className="focus-partial-note" role="status">{quality.join(" · ")}</p> : null}
            {projectPreview&&session?<div ref={setUpdateSummaryHost} className="focus-update-summary-slot"/>:null}
            {projectPreview ? <PreviewContent raw={proposal.brief?.summary??proposal.title} zh={zh}><DocumentOverview session={proposal} zh={zh} preview pageReading={wikiPages} onRead={() => undefined} onLocate={(ref,options)=>{setSourceSelection(options);setFocusedEvidence(ref);}} /></PreviewContent> : null}
            {session ? <FocusUpdatePreview summaryHost={projectPreview?updateSummaryHost:undefined} previous={session} next={proposal} zh={zh} renderSection={renderChapter} pendingSectionId={wikiRewrite?.original.id} selectedIds={selectiveEnabled ? selectedUpdateIds : undefined} onToggleSelect={selectiveEnabled ? toggleSelectedChapter : undefined} onSelectIds={selectiveEnabled ? setSelectedUpdateIds : undefined}/> : <ol>{proposal.sections.map(chapter => <li key={chapter.id}>{renderChapter(chapter, <>{projectPreview?<WikiChapterBody section={chapter} zh={zh} statusInHeading/>:<ReaderGuide content={chapter.body} zh={zh} complete hideEvidenceMarkers/>}</>)}</li>)}</ol>}
            <div className="preview-action-feedback" aria-live="polite">{error ? <p role="alert">{generationFailureReason(error,errorInfo?.code,zh)}</p> : null}{status ? <><p role="status">{generationFailureReason(status,undefined,zh)}</p>{status.includes("失败") || status.startsWith("Save failed") ? <button disabled={busy} onClick={() => void savePreview(proposal).catch(() => undefined)}>{zh ? "重试保存" : "Retry save"}</button> : null}</> : null}</div>
          </div>
        </div>
      </div>
      {writingSwitch ? <WikiWritingModePicker current={proposal.wikiKnowledge?.draft?.writingMode} zh={zh} onCancel={()=>setWritingSwitch(false)} onChoose={mode=>{setWritingSwitch(false);void generate(proposal.goal,proposal.sourceConversationIds,false,undefined,false,undefined,false,undefined,mode);}}/> : null}
      {projectPreview ? <PreviewChapterLocator contentRef={previewBaseRef} zh={zh}/> : null}
      {generationLog}
      {versionComparison && session && <ProjectVersionComparison previous={session} current={proposal} preview zh={zh} onClose={() => setVersionComparison(false)}/>}
      {projectPreview && focusedEvidence ? <WorkspaceSourcePanel session={proposal} reference={focusedEvidence} references={sourceSelection?.references} sectionId={sourceSelection?.sectionId} quote={sourceSelection?.quote} sourcePassages={sourceSelection?.sourcePassages} tableTarget={sourceSelection?.tableTarget} claim={sourceSelection?.claim} conversationTitle={conversations.find(source => source.id === focusedEvidence.conversationId)?.title} zh={zh} onSelect={ref=>{setFocusedEvidence(ref);}} onClose={() => {setFocusedEvidence(undefined);setSourceSelection(undefined);}}/> : focusedEvidence ? <div ref={sourceOverlayRef} tabIndex={-1} className="project-source-reader" role="region" aria-label={zh ? "预览来源" : "Preview source"} onKeyDown={event => {if(event.key === "Escape"){setFocusedEvidence(undefined);event.stopPropagation();}}}><Suspense fallback={<p role="status">{zh ? "读取对话…" : "Loading conversation…"}</p>}>{conversations.find(source => source.id === focusedEvidence.conversationId) ? <FocusSourceReader conversation={conversations.find(source => source.id === focusedEvidence.conversationId)!} session={proposal} zh={zh} targetMessageId={focusedEvidence.messageId} targetExcerpt={focusedEvidence.excerpt} sourceVersionId={focusedEvidence.sourceVersionId} onBack={() => setFocusedEvidence(undefined)}/> : <><ReaderBackButton onClick={() => setFocusedEvidence(undefined)} label={zh ? "返回预览" : "Back to preview"}/><blockquote>{focusedEvidence.excerpt}</blockquote></>}</Suspense></div> : null}
    </main>;
  }
  if (!session) return <main className="focus-error-screen"><section className="focus-error-card" role="alert"><h1>{zh?"预览暂未就绪":"Preview is not ready"}</h1><p>{zh?"请返回工作台重新打开已保存的草稿。":"Return to the Workbench and reopen the saved draft."}</p><button type="button" onClick={()=>{recordUiFailure(new Error("preview-state-unavailable"),"preview-state");onClose();}}>{zh?"返回工作台":"Back to Workbench"}</button></section></main>;
  const suggestedProjectName = wikiProjectTitleSuggestion(session, projectName);
  const projectNameActions = session.mode === "work" || session.canvasId ? [{
    label: zh ? "修改标题" : "Rename project", disabled: busy || renamingProject, icon: Pencil,
    run: () => { setSpaceName(projectName); setRenamingProject(true); },
  }] : [];
  const projectRenameForm = renamingProject ? <form className="focus-project-rename" onSubmit={event => { event.preventDefault(); void renameProject(); }}><input autoFocus aria-label={zh ? "项目标题" : "Project title"} value={spaceName} maxLength={200} onChange={event => setSpaceName(event.target.value)} /><button className="primary" disabled={busy || !spaceName.trim()}>{zh ? "保存" : "Save"}</button><button type="button" disabled={busy} onClick={() => setRenamingProject(false)}>{zh ? "取消" : "Cancel"}</button>{suggestedProjectName ? <div className="project-rename-suggestion"><span>{zh ? "建议名称：" : "Suggested name:"}</span><button type="button" disabled={busy} aria-label={zh ? "采用建议名称" : "Use suggested name"} onClick={() => setSpaceName(suggestedProjectName.slice(0,200))}>{suggestedProjectName}</button></div> : null}</form> : null;
  // Deleting moves to Trash. A project's only version is deleted with the project.
  const deleteActions = [
    // A result not saved into a project has no project to delete with it; it can still be deleted on its own.
    ...(onDeleteVersion && (!session.canvasId || versions.length > 1 && versions.some(item => item.id === session.id)) ? [{ label: !session.canvasId ? zh ? "删除此结果" : "Delete this result" : zh ? "删除此版本" : "Delete this version", disabled: busy, run: () => { void saves.flush().catch(() => undefined).then(() => onDeleteVersion(session.id)); } }] : []),
    ...(onDeleteProject && session.canvasId ? [{ label: zh ? "删除项目" : "Delete project", disabled: busy, run: () => { void saves.flush().catch(() => undefined).then(() => onDeleteProject(session.canvasId!)); } }] : []),
  ];
  const section = session.sections.find((item) => item.id === session.activeSectionId) ?? session.sections.at(0);
  const position = section ? session.sections.indexOf(section) : 0;
  const selectFirstSources = () => {
    if (session.mode === "work" && conversations.length) setSourcePickerOpen(true);
    else adjustSources();
  };

  // Sent from the overview: the pending problems one after another, or evidence checking in the first chapter that needs it.
  // Worked out only while the reader steps through problems; saved records, local and quick.
  const reviewIssues=docReview?.kind==="issues"&&session.mode==="work"?wikiBlockIssues(session):[];
  const reviewChapters = () => readingCache.get(session, `evidence-review:${zh}`, () => documentEvidenceReview(session, zh));
  const startReview=(kind:"issues"|"evidence")=>{
    const first=kind==="issues"?wikiBlockIssues(session)[0]:reviewChapters()[0];
    if(!first)return;
    setDocReview(kind==="issues"?{kind,index:0}:{kind,sectionId:first.sectionId,revision:performance.now()});move(first.sectionId);
  };
  const stepIssue=(delta:number)=>{if(docReview?.kind!=="issues")return;const index=Math.max(0,Math.min(reviewIssues.length-1,docReview.index+delta)),next=reviewIssues[index];if(!next)return;setDocReview({kind:"issues",index});if(next.sectionId!==section?.id)move(next.sectionId);};
  const currentIssue=docReview?.kind==="issues"?reviewIssues[Math.min(docReview.index,reviewIssues.length-1)]:undefined;
  const move = (requestedId: string,heading?:string) => { if(!leaveEditor())return; const id=session.wikiSectionAliases?.[requestedId]??requestedId; setWikiHeadingTarget(heading?{id,title:heading,revision:performance.now()}:undefined); setOverview(false); const page = session.sections.find(item => item.id === id); const group = page ? wikiCategory(page) ?? "" : ""; update({ activeSectionId: id, ...(session.mode === "work" ? { wikiCollapsedGroups: { ...sessionRef.current?.wikiCollapsedGroups, [group]: false } } : {}), visitedSectionIds: [...new Set([...(session.visitedSectionIds ?? []), id])] }); setEditing(false); setFocusedEvidence(undefined); setNavigationRevision(value => value + 1); };
  openChapterRef.current = id => move(id);
  const complete = () => { if (!section) return; const needs = { ...session.reviewNeeds }; delete needs[section.id]; update({ completedSectionIds: [...new Set([...session.completedSectionIds, section.id])], reviewNeeds: needs, visitedSectionIds: [...new Set([...(session.visitedSectionIds ?? []), section.id])] }); };
  const sources = groups.flat();
  const translate = () => { const prompt = zh ? "仅将整个回顾的标题、目录、导读、过渡和项目概况翻译为简体中文。保留原有事实、章节顺序、来源引用及用户的修改，不增加建议或重新整理。代码、公式、专有名词及原文引用保持原样。" : "Translate only the result title, section titles, guides, transitions and project brief into English. Preserve all facts, section order, citations and user edits. Do not add proposals or reorganize. Keep code, formulas, proper names and source quotations unchanged."; setRevisionScope("whole"); setInstruction(prompt); void generate(session.goal, session.sourceConversationIds, true, prompt, false, "whole"); };
  const differentLanguage = Boolean(session.locale && session.locale !== locale) || zh && [session.title, ...session.sections.map((item) => item.title)].some((text) => !/\p{Script=Han}/u.test(text) && (text.match(/[a-zA-Z]{2,}/gu)?.length ?? 0) >= 3);
  const sourceConversation = conversations.find(item => item.id === (focusedEvidence?.conversationId ?? openSourceId));
  const sourceReadingOpen = Boolean(openSourceId || focusedEvidence && (session.mode !== "work" || fullSourceReader));
  const closeSourceReading = () => { if (fullSourceReader && session.mode === "work" && focusedEvidence && !sourceSelection?.reader) { setFullSourceReader(false); return; } setOpenSourceId(undefined); setFocusedEvidence(undefined); setFullSourceReader(false); };
  const openEvidence = (ref:FocusEvidence, options?:WorkspaceEvidenceOptions) => { if(session.mode!=="work"){setFocusedEvidence(ref);return;} const top=bodyRef.current?.scrollTop; setFullSourceReader(Boolean(options?.reader)); setOpenSourceId(undefined); setSourcesOpen(false); setMobileNavigation(false); const chapter=!overview?session.sections.find(item=>item.id===session.activeSectionId):undefined; setSourceSelection(chapter?{...options,sectionId:options?.sectionId??chapter.id,references:options?.references??chapterEvidence(session,chapter)}:options); setFocusedEvidence(ref); window.requestAnimationFrame(()=>{if(bodyRef.current&&top!==undefined)bodyRef.current.scrollTop=top;}); };
  const originalPanelOpen = Boolean(focusedEvidence && session.mode === "work" && !sourceReadingOpen);
  const closeEvidence = () => {
    setFocusedEvidence(undefined);
    setSourceSelection(undefined);
    setDocReview(value=>value?.kind==="evidence"?undefined:value);
  };
  // Let the sidebar acknowledge a verdict before rebuilding the reading projection.
  const prepared = readingRefresh && sameProjectReadingInputs(readingRefresh.basis, session) ? readingRefresh : undefined;
  const readingSession = prepared ? prepared.projection ? session : prepared.previous
    : originalPanelOpen && deferredSession?.id === session.id && deferredSession.activeSectionId === session.activeSectionId ? deferredSession : session;
  const readingSection = section && (readingSession === session ? section : readingSession.sections.find(item => item.id === section.id) ?? section);
  const editableChapterBody = (() => {
    if (!section || !editing) return "";
    if (section.userEdited || section.origin || session.mode !== "work") return section.body;
    const projected = prepared?.projection?.chapter?.id === section.id
      ? prepared.projection.chapter
      : readingCache.get(readingSession, `chapter:${section.id}`, () => {
          const context = readingCache.get(readingSession, "chapter-context", () => prepared?.projection?.context ?? projectKnowledgeReadingContext(readingSession));
          return projectKnowledgeReading(context.chapters.find(chapter => chapter.id === section.id) ?? section, readingSession, context.view, context.chapters, true);
        });
    return prepareEditableChapterBody(readingSession, section, projected?.body ?? section.body);
  })();
  const chapterEditor = section && editing ? <ChapterTextEditor key={section.id} title={section.title} body={editableChapterBody} target={editTarget} zh={zh} saveRef={editorSave} onDirty={markEditorDirty} onSave={(title, body) => saveChapterText(section.id, title, body)} onCancel={() => { editorDirty.current = false; setEditing(false); }} /> : undefined;
  // A workspace check started from the overview goes on to the next chapter with points to look at.
  const nextReviewChapter = (() => {
    if (!section || docReview?.kind !== "evidence" || docReview.sectionId !== section.id) return undefined;
    const chapters = reviewChapters().filter(item=>item.sectionId!==section.id);
    const following = chapters[0];
    if (!following) return undefined;
    const page = session.sections.find(item => item.id === following.sectionId);
    return { label: zh ? `下一章：${page?.wikiDisplayTitle || page?.title || ""}（还有 ${chapters.length} 章）` : `Next chapter: ${page?.wikiDisplayTitle || page?.title || ""} (${chapters.length} left)`,
      onNext: () => { setDocReview({ kind: "evidence", sectionId: following.sectionId, revision: performance.now() }); move(following.sectionId); } };
  })();
  const switchHolder = (point: EvidencePoint, holder: WikiHolder|undefined) => {
    const current = sessionRef.current;
    if (!current || busy) return false;
    const sectionId = sourceSelection?.sectionId ?? point.key.slice(0, point.key.lastIndexOf(":"));
    const savedPage = current.sections.find(item => item.id === sectionId);
    if(!savedPage||savedPage.userEdited||savedPage.origin)return false;
    const refs=new Set(point.references.map(ref=>ref.id));
    const exactOf=(page:FocusSection)=>page.claims?.filter(claim=>(point.claimId && claim.id === point.claimId) || (claim.text===point.claim||claim.formulations?.includes(point.claim))&&claim.evidenceIds.some(id=>refs.has(id)))??[];
    const page=exactOf(savedPage).length?savedPage:restoreWikiSourceNegation(savedPage,current);
    const exact=exactOf(page);
    const bound=exact.length?[]:page.claims?.filter(claim=>claim.unitIds?.length&&claim.unitIds.length===point.unitIds?.length
      && claim.unitIds.every(id=>point.unitIds!.includes(id))&&claim.evidenceIds.some(id=>refs.has(id)))??[];
    const sameQuote=exact.length||bound.length?[]:page.claims?.filter(claim=>claim.quote===point.quote&&claim.evidenceIds.some(id=>refs.has(id)))??[];
    const matching=exact.length?exact:bound.length===1?bound:sameQuote.length===1?sameQuote:[];
    const evidenceIds=current.evidence.filter(ref=>refs.has(ref.id)).map(ref=>ref.id);
    if(!matching.length&&!evidenceIds.length)return false;
    const verdict = holder === "decided" ? "confirmed" as const : holder === "open" ? "open" as const : holder === "earlier" ? "rejected" as const : undefined;
    const changed=holder!==undefined&&(holder!==point.holder||matching.some(claim=>claim.holder!==holder));
    const unitIds = [...new Set(matching.flatMap(claim => claim.unitIds ?? []))];
    const answer={holder,holderMark:Boolean(holder),userDecided:holder==="decided",checked:true};
    const claims=matching.length?page.claims?.map(claim=>matching.includes(claim)?{...claim,...(changed?answer:{checked:true})}:claim)
      : [...page.claims??[],{text:point.claim,quote:point.quote??point.reference.excerpt,evidenceIds,...answer}];
    const next = update({ sections: current.sections.map(item => item.id !== page.id ? item : { ...page, claims }),
      ...(changed&&unitIds.length&&current.wikiKnowledge ? { wikiKnowledge: withDecision(current.wikiKnowledge, unitIds, verdict, undefined, [point.claim], { locallyApplied: true }) } : {}) });
    setSourceSelection(value => value && { ...value, points: value.points?.map(item => item.key === point.key ? { ...item, ...(holder === undefined ? {} : { holder, holderMark: true }), checked: true } : item) });
    if (next?.wikiKnowledge?.draft) {
      readingRefreshAbort.current?.abort();
      const abort = new AbortController();
      readingRefreshAbort.current = abort;
      setReadingRefresh({basis:next,previous:readingSession});
      const timer=window.setTimeout(()=>{
        if(abort.signal.aborted)return;
        const pending=refreshWikiReading(next,abort.signal);
        if(!pending){setReadingRefresh(undefined);return;}
        void pending.then(projection=>{if(!abort.signal.aborted)setReadingRefresh(projection?{basis:next,projection}:undefined);});
      },60);
      abort.signal.addEventListener("abort",()=>window.clearTimeout(timer),{once:true});
    }
    return Boolean(next);
  };
  const moveEvidencePoint = (index: number) => {
    const point = sourceSelection?.points?.[index];
    if (!point) return;
    setFocusedEvidence(point.reference);
    setSourceSelection(current => current && { ...current, references: point.references, quote: point.quote, claim: point.claim, pointIndex: index });
  };
  // The full Reader keeps the chapter's evidence order: previous / next evidence, then back to the chapter.
  const readerEvidenceSteps = ((): ReaderEvidenceSteps | undefined => {
    if (!sourceReadingOpen || !focusedEvidence) return undefined;
    const onChapter = () => { setOpenSourceId(undefined); setFocusedEvidence(undefined); setSourceSelection(undefined); setFullSourceReader(false); };
    const chapterLabel = zh ? "返回章节" : "Back to chapter";
    const points = sourceSelection?.points, pointIndex = sourceSelection?.pointIndex;
    if (points && pointIndex !== undefined && points.length > 1) {
      const step = (index: number) => { const point = points[index]; if (!point) return; openEvidence(point.reference, { references: point.references, quote: point.quote, claim: point.claim, points, pointIndex: index }); if (session.mode === "work") setFullSourceReader(true); };
      return { index: pointIndex, total: points.length, onPrevious: () => step(pointIndex - 1), onNext: () => step(pointIndex + 1), onChapter, chapterLabel };
    }
    const refs = sourceSelection?.references, index = refs?.findIndex(ref => ref.id === focusedEvidence.id) ?? -1;
    if (!refs || refs.length < 2 || index < 0) return undefined;
    return { index, total: refs.length, onPrevious: () => { if (refs[index - 1]) setFocusedEvidence(refs[index - 1]); }, onNext: () => { if (refs[index + 1]) setFocusedEvidence(refs[index + 1]); }, onChapter, chapterLabel };
  })();
  return <ProjectKnowledgeActions.Provider value={session.mode==="work"?{save:async update=>{const current=sessionRef.current;if(!current||current.id!==session.id)throw new Error("Project changed");await persistRoute(update(current));},read:move,matter:ref=>{const source=projectMatters(session).find(item=>item.id===ref.id&&item.type===ref.type)?.sources[0];if(source)openEvidence(source);else setSourcesOpen(true);}}:undefined}><WorkspaceEvidenceContext.Provider value={session.mode === "work" ? {open:openEvidence,close:()=>{closeEvidence();setSourcesOpen(false);},active:originalPanelOpen?{...sourceSelection,shown:focusedEvidence}:undefined} : undefined}><div className={`focus-workspace${originalPanelOpen?" has-original-panel":""}`} data-project-navigation-collapsed={navigationLayout.collapsed || undefined} style={navigationLayout.style}><div ref={readingBaseRef} className="project-reading-base" aria-hidden={sourceReadingOpen || undefined}><ProjectNavigationOpen layout={navigationLayout} zh={zh} navigationId="project-workspace-navigation" /><nav id="project-workspace-navigation" hidden={navigationLayout.collapsed && !mobileNavigation} className={`reading-outline${mobileNavigation?" is-mobile-open":""}`} aria-label={zh ? "对话章节" : "Conversation chapters"} onClick={event=>{if((event.target as HTMLElement).closest(".outline-item"))setMobileNavigation(false);}} onKeyDown={event=>{if(event.key==="Escape" && window.innerWidth<=760){setMobileNavigation(false);requestAnimationFrame(() => document.getElementById("project-workspace-navigation-open")?.focus());}}}>
    <ProjectNavigationLayout layout={navigationLayout} zh={zh} navigationId="project-workspace-navigation" onCloseMobile={() => setMobileNavigation(false)}>
      <ReaderBackButton onClick={() => { if (!leaveEditor()) return; void saves.flush().catch(() => undefined); onClose(); }} label={zh ? "返回工作台" : "Back to Workbench"} />
    </ProjectNavigationLayout>
    <h2 title={projectName}>{readingTitle(projectName, 40)}</h2>{projectPicker}
    <button className="outline-item" aria-current={overview && !ledgerPage ? "page" : undefined} onClick={() => { if (!leaveEditor()) return; setEditing(false); setLedgerPage(false); setOverview(true); bodyRef.current?.scrollTo?.({ top: 0 }); }}><LayoutDashboard size={17} aria-hidden="true" /><strong>{session.mode === "work" ? zh ? "文档总览" : "Document overview" : zh ? "阅读总览" : "Reading overview"}</strong></button>
    {session.mode === "work" && session.wikiKnowledge?.organization ? <button className="outline-item" aria-current={overview && ledgerPage ? "page" : undefined} onClick={() => { if (!leaveEditor()) return; setEditing(false); closeEvidence(); setLedgerPage(true); setOverview(true); bodyRef.current?.scrollTo?.({ top: 0 }); }}><BookMarked size={17} aria-hidden="true" /><strong>{zh ? "知识点账本" : "Knowledge ledger"}</strong></button> : null}
    <div className="project-navigation-tabs" role="tablist" aria-label={zh ? "项目目录" : "Project navigation"} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "chapters" : event.key === "End" ? "sources" : navigationTab === "chapters" ? "sources" : "chapters"; setNavigationTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#project-${next}-tab`)?.focus(); }}>
      <button type="button" role="tab" id="project-chapters-tab" tabIndex={navigationTab === "chapters" ? 0 : -1} aria-controls="project-navigation-list" aria-selected={navigationTab === "chapters"} onClick={() => setNavigationTab("chapters")}>{zh ? "章节" : "Chapters"}</button>
      <button type="button" role="tab" id="project-sources-tab" tabIndex={navigationTab === "sources" ? 0 : -1} aria-controls="project-navigation-list" aria-selected={navigationTab === "sources"} onClick={() => setNavigationTab("sources")}>{zh ? "来源" : "Sources"}<small>{session.sourceConversationIds.length}</small></button>
    </div>
    <div id="project-navigation-list" role="tabpanel" aria-labelledby={navigationTab === "chapters" ? "project-chapters-tab" : "project-sources-tab"} className="project-navigation-list">
      {navigationTab === "chapters" ? session.mode === "work" ? <ProjectWikiNavigation key={session.id} session={readingSession} activeId={!overview ? section?.id : undefined} zh={zh} onRead={move} onPrefetch={prefetchChapter} adjusting={wikiAdjusting} onDone={() => setWikiAdjusting(false)} onCollapse={(group, collapsed) => update({ wikiCollapsedGroups: { ...sessionRef.current?.wikiCollapsedGroups, [group]: collapsed } })} onEdit={saveWikiPage} onMove={saveWikiOrder} onCreateGroup={saveWikiGroup} disabled={busy||editing} onDropPage={dropWikiPage} /> : session.sections.map((item, index) => <button key={item.id} className="outline-item" aria-current={!overview && item.id === section?.id ? "step" : undefined} onClick={() => move(item.id)}><span>{session.mode === "work" ? index + 1 : session.completedSectionIds.includes(item.id) ? "✓" : session.reviewNeeds?.[item.id] ? "?" : index + 1}</span><strong>{item.title}{session.mode !== "work" && session.reviewNeeds?.[item.id] ? <small className="outline-review-need">{zh ? "待复习" : "Revisit"} · {session.reviewNeeds[item.id]}</small> : null}</strong></button>) : <ProjectSourceList ids={session.sourceConversationIds} conversations={conversations} fallbackTitle={id => session.evidence.find(item => item.conversationId === id)?.title} zh={zh} onOpen={id => { void saves.flush().catch(() => undefined); setOpenSourceId(id); }} />}
    </div>
    {navigationTab === "sources" && session.mode === "work" && session.scope?.kind!=="goal" ? <div className="project-source-management"><button type="button" className="outline-item project-add-source-button" disabled={busy} onClick={() => setSourcePickerOpen(true)}><Plus size={15} aria-hidden="true" /><strong>{zh ? "添加对话" : "Add conversations"}</strong></button></div> : null}
    {session.mode !== "work" ? <ReaderProgress zh={zh} completed={session.completedSectionIds.length} total={session.sections.length} work={false} /> : null}
    </nav>
    <div className={`focus-reader-main${sourcesOpen ? " has-utility-panel" : ""}`}>
    <div className="focus-reader-toolbar"><ProjectNavigationOpen layout={navigationLayout} zh={zh} navigationId="project-workspace-navigation" mobile onOpenMobile={() => setMobileNavigation(true)} /><div className="focus-reader-location">{renamingProject ? projectRenameForm : <><span>{(space || optimisticName || session.mode === "work" ? projectName : zh ? session.sourceConversationIds.length > 1 ? "跨对话回顾" : "对话回顾" : session.sourceConversationIds.length > 1 ? "Cross-conversation review" : "Conversation review")}</span>{session.mode === "work" ? <span className="focus-reader-crumb" aria-hidden="true">/</span> : null}{session.mode === "work" ? <small className="focus-reader-subpage">{overview ? ledgerPage ? (zh ? "知识点账本" : "Knowledge ledger") : (zh ? "文档总览" : "Overview") : section?.wikiDisplayTitle || section?.title || ""}</small> : null}</>}{section && !overview && session.mode !== "work" ? <small>{zh ? `第 ${position + 1}/${session.sections.length} 节 · 待理解 ${Math.max(0, session.sections.length - session.completedSectionIds.length)} 节` : `Section ${position + 1}/${session.sections.length} · ${Math.max(0, session.sections.length - session.completedSectionIds.length)} left to understand`}</small> : null}</div><div className={`focus-reader-toolbar-actions${session.mode === "work" ? " project-document-actions" : ""}`}>{section && !overview && session.mode !== "work" ? <button type="button" disabled={busy || session.completedSectionIds.includes(section.id)} onClick={complete}>{session.completedSectionIds.includes(section.id) ? zh ? "已理解" : "Reviewed" : zh ? "标记已理解" : "Mark understood"}</button> : null}{!renamingProject && !session.canvasId ? <button type="button" className="primary" disabled={busy} onClick={() => void attach()}><Save size={15} aria-hidden="true" /><span>{zh ? "保存项目" : "Save project"}</span></button> : null}{section && session.mode === "work" && session.canvasId ? <button type="button" className={changes.some(hasSourceChange) || session.sidecarConversationIds?.some(id => !session.sourceConversationIds.includes(id)) ? "has-pending-update" : undefined} disabled={busy} title={zh ? "纳入来源变化或已保存的决定，先预览受影响的章节" : "Apply changed sources or saved decisions and preview affected chapters"} onClick={updateProject} aria-label={zh ? "增量更新" : "Update"}><RefreshCw size={15} aria-hidden="true" /><span>{zh ? "更新" : "Update"}</span></button> : null}{session.mode === "work" ? <button type="button" disabled={busy || editing && !section} onClick={() => void exportProject()} title={zh ? "导出项目" : "Export project"} aria-label={zh ? "导出" : "Export"}><Download size={15} aria-hidden="true" /><span>{zh ? "导出" : "Export"}</span></button> : null}<ReaderMoreMenu iconOnly={session.mode==="work"} flat={session.mode==="work"} zh={zh} sourcesLabel={zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"} onSources={session.mode==="work"?undefined:() => setSourcesOpen(true)} edits={[
      ...projectNameActions,
      ...(section && session.mode === "work" ? [{ label: zh ? "调整目录" : "Edit directory", icon: ListTree, title: zh ? "在本地调整章节顺序、标题与分组，不调用模型" : "Reorder, rename and group chapters locally, without model calls", disabled: busy, run: () => { setNavigationTab("chapters"); setWikiAdjusting(true); navigationLayout.update({ collapsed: false }); setMobileNavigation(true); } }] : []),
      ...(session.mode!=="work" && !overview ? [{ label: editing ? zh ? "完成编辑" : "Done editing" : zh ? "编辑本节" : "Edit this section", disabled: busy, run: () => { if(editing)void finishChapterEdit();else startEditing(); } }] : []),
      ...(section && session.mode!=="review"&&session.mode!=="work"?[{ label: zh ? "AI 调整内容" : "Revise with AI", disabled: busy, run: () => { setRevisionScope(overview ? "whole" : "section"); setRevisionIds([section.id]); setRevisionFailure(undefined); setFollowUpOpen(true); } }]:[]),
      ...(differentLanguage && session.mode!=="review" && session.mode!=="work" ? [{ label: zh ? "转换为中文 · 先预览" : "Translate to English · Preview", disabled: busy, run: translate }] : []),
    ]} checks={[
      ...(session.mode === "work" && previousVersion ? [{ label: zh ? "和上一版对比" : "Compare with previous version", icon: GitCompareArrows, disabled: busy || editing, run: () => setVersionComparison(true) }] : []),
      ...(session.mode === "work" && openLog ? [{ label: zh ? "生成日志" : "Generation log", icon: ScrollText, run: openLog }] : []),
    ]} maintenance={[
      ...(session.mode==="work"&&session.wikiKnowledge?.draft&&session.wikiKnowledge.organization&&session.wikiKnowledge.documentType!=="learning"?[{label:zh?"切换写作模式":"Change writing mode",icon:SlidersHorizontal,disabled:busy,run:()=>{if(leaveEditor())setWritingSwitch(true);}}]:[]),
      ...(session.mode === "work" && section && !overview ? [{
        label: zh ? "重整本章" : "Reorganize this chapter", icon: RefreshCw,
        title: section.origin || section.userEdited
          ? (zh ? "结合你的手稿与原文生成改写建议，采用前不覆盖" : "Generate a non-destructive rewrite suggestion using your edits and bound originals")
          : (zh ? "只改写当前章节，可指定要求并先预览再采用" : "Rewrite only this chapter with optional guidance and preview before applying"),
        disabled: busy || editing, run: () => { setWikiFeedback({}); setChapterRewriteTarget({ section, prompt: "" }); },
      }] : []),
      ...(section && session.mode === "work" ? [{ label: zh ? "重整全部章节" : "Reorganize all chapters", icon: BookMarked,
        title: zh ? "重新规划目录和 AI 正文，先预览再采用" : "Replan the directory and AI-authored chapters, then preview",
        disabled: busy, run: openReorganizeDialog }] : []),
      ...(differentLanguage && session.mode === "work" ? [{ label: zh ? "转换为中文 · 先预览" : "Translate to English · Preview", icon: Languages, disabled: busy, run: translate }] : []),
      // Only after writing: a saved project, never while it is generated.
      ...(session.mode!=="work"?[{ label: zh ? "调整项目材料" : "Change project materials", disabled: busy, run: adjustSources }]:[]),
    ]} danger={deleteActions} /></div></div>
    <main className={`focus-reading-body${section && !overview ? " is-chapter-view" : ""}`} ref={bodyRef}><div className="reader-content">
      <div className="project-reading-document">
      {wikiRevisionProgress?<div className="project-analysis-running" role="status"><span>{zh?`${wikiRevisionProgress.stage==="preparing"?"正在准备完整材料":wikiRevisionProgress.stage==="planning"?"正在规划章节归属":wikiRevisionProgress.stage==="checking"?"正在核对修改预览":"正在调整内容"} · ${wikiRevisionProgress.done}/${wikiRevisionProgress.total}${wikiRevisionProgress.cached?` · 复用 ${wikiRevisionProgress.cached} 批缓存`:""}`:`${wikiRevisionProgress.stage==="preparing"?"Preparing complete material":wikiRevisionProgress.stage==="planning"?"Planning chapter ownership":wikiRevisionProgress.stage==="checking"?"Checking revision preview":"Revising content"} · ${wikiRevisionProgress.done}/${wikiRevisionProgress.total}${wikiRevisionProgress.cached?` · ${wikiRevisionProgress.cached} batches reused`:""}`}</span><button type="button" onClick={()=>controller.current?.abort()}>{zh?"取消":"Cancel"}</button></div>:null}
      {errorPanel}
      {projectSaveError ? <p className="project-save-error" role="alert">{projectSaveError} <button type="button" disabled={busy} onClick={() => void (renamingProject ? renameProject() : attach())}>{zh ? "重试保存" : "Retry save"}</button></p> : null}
      {sidecarVersion && onOpenSession ? <div className="project-analysis-running">
        <span role="status">{zh ? "侧边栏已保存新版本" : "The sidebar saved a new version"}</span>
        <button type="button" disabled={busy||editing||Boolean(wikiRewrite)} onClick={async () => {
          try {
            await saves.flush();
            const sameChapter = !overview && section && sidecarVersion.sections.find(item => item.id === section.id);
            onOpenSession(sidecarVersion.id, sameChapter ? sameChapter.id : undefined, sameChapter ? Boolean(sameChapter.continuationLoose) : false);
          } catch { setStatus(zh ? "保存失败，请重试后切换版本。" : "Save failed. Retry before switching versions."); }
        }}>{zh ? "查看最新版" : "Open latest version"}</button>
      </div> : session.mode!=="review"?<SourceUpdateNotice session={session} changes={changes} conversations={conversations} zh={zh} onUpdate={updateProject} disabled={busy} overview={overview && session.mode==="work" && (!ledgerPage || !session.wikiKnowledge?.organization)} />:null}


      {!section || !readingSection ? <article className="document-overview" aria-label={zh ? "文档总览" : "Document overview"}>
        <header className="document-overview-heading wiki-document-heading">
          <div className="wiki-document-location"><span>{zh ? "文档总览" : "Overview"}</span></div>
          <h1>{projectName}</h1>
        </header>
        {editing && session.mode === "work"
          ? <ChapterTextEditor title="" body="" zh={zh} saveRef={editorSave} onDirty={markEditorDirty} onSave={saveFirstChapter}
              onCancel={() => { editorDirty.current = false; setEditing(false); }} />
          : firstWikiDraft ? <FirstWikiPanel key={firstWikiDraft.id} draft={firstWikiDraft} zh={zh} onSettings={onSettings} onSaved={saved => {
            onSaved(saved);
            setEditing(false); setDocReview(undefined); setLedgerPage(false); setOverview(true);
            if (onOpenSession) onOpenSession(saved.id);
            else { sessionRef.current = saved; setSession(saved); }
          }}/>
          : <section className="project-empty-state">
              <span className="project-empty-icon"><FileText size={21} aria-hidden="true" /></span>
              <div className="project-empty-copy">
                <h2>{zh ? "文档还没有章节" : "No chapters yet"}</h2>
                <p>{session.mode === "work" ? zh ? "手动写下第一章，或从已有对话生成。" : "Write the first chapter or generate it from your conversations." : zh ? "选择对话材料，开始整理内容。" : "Choose conversations to start organizing this document."}</p>
              </div>
              <div className="project-empty-actions">
                <button type="button" disabled={busy} onClick={selectFirstSources}>{zh ? "从材料生成" : "Organize sources"}</button>
                {session.mode === "work" && <button type="button" className="primary" disabled={busy} onClick={() => startEditing()}><Plus size={15} aria-hidden="true" />{zh ? "新建章节" : "New chapter"}</button>}
              </div>
            </section>}
      </article> : overview ? ledgerPage && session.mode === "work" && session.wikiKnowledge?.organization ? <KnowledgeLedger session={session} pageReading={wikiPages} zh={zh} onLocate={openEvidence}/> : <DocumentOverview reviewSession={session} onReview={session.mode === "work" ? startReview : undefined} onRename={name=>{setSpaceName(name);setRenamingProject(true);}} title={projectName} key={session.id} session={wikiPages === undefined ? readingSession : session} pageReading={wikiPages} zh={zh} onLocate={openEvidence} onRead={move} onBeginEdit={closeEvidence} onMaintain={session.mode === "work" ? async projectMaintenance => { const current = sessionRef.current; if (current) await persistRoute({ ...current, projectMaintenance, updatedAt: Date.now() }); } : undefined}/> : <>
      {!overview && section && wikiActionChapterId === section.id && (wikiFeedback?.status || wikiFeedback?.error) && !wikiRewrite ? (
        <div className="wiki-action-feedback project-chapter-rewrite-feedback">
          <p role={wikiFeedback.error ? "alert" : "status"}>{wikiFeedback.error ?? wikiFeedback.status}</p>
        </div>
      ) : null}
      {!overview && section && wikiRewrite?.original.id === section.id ? wikiRewriteView : null}
      <WikiDocument scrollRef={bodyRef} issue={currentIssue&&currentIssue.sectionId===section.id?{issue:currentIssue,index:reviewIssues.indexOf(currentIssue),total:reviewIssues.length}:undefined} onIssueStep={stepIssue} onIssueClose={()=>setDocReview(undefined)} autoReview={docReview?.kind==="evidence"&&docReview.sectionId===section.id&&!docReview.opened?docReview.revision:undefined} onAutoReviewed={()=>setDocReview(value=>value?.kind==="evidence"?{...value,opened:true}:value)} headingTarget={wikiHeadingTarget?.id===section.id?wikiHeadingTarget:undefined} section={readingSection} session={readingSession} readingProjection={prepared?.projection} zh={zh} updatedConversationIds={changes.filter(change => change.added || change.changed || change.removed || change.reordered).map(change => change.conversationId)} editor={chapterEditor} onEdit={target=>{setFocusedEvidence(undefined);setSourceSelection(undefined);startEditing(target);}} onLocate={openEvidence} onCurrent={() => setOverview(true)} />


      {session.mode !== "work" && session.completedSectionIds.length === session.sections.length ? <section className="focus-completed"><strong>{zh ? "本次阅读已完成" : "Review complete"}</strong></section> : null}
      </>}

      {status ? <div className="reader-save-status"><small role="status">{generationFailureReason(status,undefined,zh)}</small>{status.includes("失败") || status.startsWith("Save failed") ? <button onClick={() => void persist(session).catch(() => undefined)}>{zh ? "重试保存" : "Retry save"}</button> : null}</div> : null}
      </div>
    </div></main>
    {sourcesOpen ? <aside className="reader-utility-panel" aria-label={zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"} onKeyDown={event => { if (event.key === "Escape") { setSourcesOpen(false); event.stopPropagation(); } }}>
      <header><h2>{zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"}</h2><button ref={sourcesCloseRef} type="button" aria-label={zh ? "关闭来源" : "Close sources"} onClick={() => setSourcesOpen(false)}><X size={18} /></button></header>
      <ChapterSources session={session} refs={overview ? session.evidence : sources} conversations={conversations} zh={zh} onLocate={openEvidence} />
    </aside> : null}
    </div>
    {followUpOpen && section ? <FocusFollowUp zh={zh} title={revisionScope === "whole" ? session.title : section.title} instruction={instruction} scope={revisionScope} chapters={session.mode==="work"?session.sections.map(chapter=>({id:chapter.id,title:chapter.wikiDisplayTitle||chapter.title,disabled:Boolean(chapter.origin||chapter.userEdited)})):undefined} currentId={section.id} selectedIds={revisionIds} onSelection={setRevisionIds} onInstruction={setInstruction} onScope={setRevisionScope} onClose={() => setFollowUpOpen(false)} onSubmit={() => { setFollowUpOpen(false); if(session.mode==="work")void reviseProjectWiki();else void generate(session.goal, session.sourceConversationIds, true); }}  /> : null}
    </div>
    {exportOpen ? <Suspense fallback={null}><ProjectExportDialog session={projectName === session.title ? session : { ...session, title: projectName }} zh={zh} onClose={()=>setExportOpen(false)}/></Suspense> : null}
    {versionComparison && previousVersion && <ProjectVersionComparison previous={previousVersion} current={session} zh={zh} onClose={() => setVersionComparison(false)}/>}
    {chapterRewriteTarget ? (
      <ChapterRewriteDialog
        chapterTitle={chapterRewriteTarget.section.wikiDisplayTitle || chapterRewriteTarget.section.title}
        initialPrompt={chapterRewriteTarget.prompt}
        isUserEdited={Boolean(chapterRewriteTarget.section.origin || chapterRewriteTarget.section.userEdited)}
        zh={zh}
        busy={busy}
        onClose={() => setChapterRewriteTarget(undefined)}
        onSubmit={(prompt) => {
          const targetSection = chapterRewriteTarget.section;
          setChapterRewriteTarget(undefined);
          void rewriteChapter(targetSection, prompt);
        }}
      />
    ) : null}
    {reorganizeConfirmOpen ? (
      <ProjectReorganizeDialog
        projectTitle={projectName}
        aiChapterCount={session.sections.filter(chapter => !chapter.origin && !chapter.userEdited).length}
        manualChapterCount={session.sections.filter(chapter => chapter.origin || chapter.userEdited).length}
        hasSourceChanges={changes.some(item => hasSourceChange(item) || item.unknown)}
        sourcesSyncing={conversations.some(source => session.sourceConversationIds.includes(source.id) && !isCurrentHydrationComplete(source))}
        canSyncWithReorganize={Boolean(session.wikiKnowledge)}
        zh={zh}
        busy={busy}
        onClose={() => setReorganizeConfirmOpen(false)}
        onUpdateSources={() => { setReorganizeConfirmOpen(false); void updateProject(); }}
        onConfirm={(options) => void reorganizeProject(options)}
      />
    ) : null}
    {generationLog}
    {writingSwitch ? <WikiWritingModePicker current={session.wikiKnowledge?.draft?.writingMode} zh={zh} onCancel={()=>setWritingSwitch(false)} onChoose={mode=>{setWritingSwitch(false);void generate(session.goal,session.sourceConversationIds,false,undefined,false,undefined,false,undefined,mode);}}/> : null}
    {sourcePickerOpen ? <ProjectSourcePicker conversations={conversations} existingIds={section ? session.sourceConversationIds : []}
      suggestedIds={section ? session.sidecarConversationIds : [...new Set([...session.sourceConversationIds, ...session.sidecarConversationIds ?? []])]}
      zh={zh} onSync={() => {
        setSourcePickerOpen(false);
        void saves.flush().then(() => onReturnToWorkbench(session.goal,[...new Set([...session.sourceConversationIds,...session.sidecarConversationIds ?? []])],session.mode))
          .catch(() => setError(zh ? "保存失败，请重试。" : "Save failed; retry."));
      }} onClose={() => setSourcePickerOpen(false)} onConfirm={ids => {
        setSourcePickerOpen(false);
        const sourceIds = section ? [...session.sourceConversationIds, ...ids] : ids;
        if (session.scope?.kind === "goal") { setScopeUpdateIds(sourceIds); setPhase("scope"); }
        else if (!section) void generate(session.goal.trim() || projectName, sourceIds, false, undefined, false, undefined, false, undefined, undefined, false, session.sidecarWritingMode);
        else void generate(session.goal, sourceIds, false, undefined, true);
      }} /> : null}
    {originalPanelOpen && focusedEvidence ? <WorkspaceSourcePanel conversationTitle={sourceConversation?.title} session={readingSession} reference={focusedEvidence} references={sourceSelection?.references} sectionId={sourceSelection?.sectionId} quote={sourceSelection?.quote} sourcePassages={sourceSelection?.sourcePassages} tableTarget={sourceSelection?.tableTarget} claim={sourceSelection?.claim} points={sourceSelection?.points} pointIndex={sourceSelection?.pointIndex} onPoint={moveEvidencePoint} zh={zh} onSelect={ref=>{setFocusedEvidence(ref);}} onClose={closeEvidence} onReader={()=>setFullSourceReader(true)} onHolder={overview?undefined:switchHolder} next={nextReviewChapter} mode={sourceSelection?.mode} locationRevision={sourceSelection?.locationRevision} onEditClaim={point=>{setFocusedEvidence(undefined);setSourceSelection(undefined);startEditing(point.attention?.claimExcerpt??point.claim);}} /> : null}
    
    {sourceReadingOpen && sourceConversation ? <div ref={sourceOverlayRef} tabIndex={-1} className="project-source-reader" role="region" aria-label={zh ? "原文阅读" : "Original discussion reader"} onKeyDown={event => { if (event.key === "Escape") { closeSourceReading(); event.stopPropagation(); } }}><Suspense fallback={<p role="status">{zh ? "读取对话…" : "Loading conversation…"}</p>}><FocusSourceReader key={sourceConversation.id} conversation={sourceConversation} session={session} zh={zh} targetMessageId={focusedEvidence?.messageId} targetExcerpt={focusedEvidence?.excerpt} sourceVersionId={focusedEvidence?.sourceVersionId} onBack={closeSourceReading} evidenceSteps={readerEvidenceSteps} /></Suspense></div> : null}
    {sourceReadingOpen && !sourceConversation ? <div ref={sourceOverlayRef} tabIndex={-1} role="complementary" onKeyDown={event => { if (event.key === "Escape") { closeSourceReading(); event.stopPropagation(); } }} className="focus-context-panel" aria-label={zh ? "当时的问题与上下文" : "Original question and context"}><div className="focus-context-header"><ReaderBackButton onClick={closeSourceReading} label={zh ? "返回阅读原位置" : "Back to Brief / reading"} /><strong>{focusedEvidence?.title}</strong></div>{focusedEvidence ? <FocusDiscussion key={focusedEvidence.id} evidence={[focusedEvidence]} focusMessageId={focusedEvidence.messageId} focusExcerpt={focusedEvidence.excerpt} zh={zh} /> : <p>{zh ? "该来源已不在本地。" : "This source is no longer available locally."}</p>}</div> : null}
  </div></WorkspaceEvidenceContext.Provider></ProjectKnowledgeActions.Provider>;
}
