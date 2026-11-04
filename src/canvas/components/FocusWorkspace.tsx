import {remapWikiSectionReferences} from "../../shared/wiki-topic-merge";
import { ChevronDown, BookMarked, Download, RefreshCw, Save } from "lucide-react";
import { ProjectVersionPicker } from "./ProjectVersionPicker";
import { generationFailureReason } from "../generation-notice";
import {savedWikiProjectBoundary} from "../../shared/wiki-project-boundary";
import {WikiChapterBody} from "./WikiChapterOverview";
import {WikiScopeNotice,type WikiScopeChoice} from "./WikiScopeNotice";
import {editableWikiTopic} from "../../shared/wiki-directory";
import { PreviewChapterLocator } from "./PreviewChapterLocator";
import { markAIFirstReadable } from "../../ai/pipeline-timing";
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
import { removeProjectUnderstandingCard } from "../project-understanding";
import { WikiDocument } from "./WikiDocument";
import { ProjectSourcePicker } from "./ProjectSourcePicker";
import { ProjectWikiNavigation } from "./ProjectWikiNavigation";
import { useWikiReadingPosition } from "../hooks/useWikiReadingPosition";
import { ReaderBackButton } from "./ReaderBackButton";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { carryReviewNotes } from "../review-notes";
import { sourceChanges, type SourceChange } from "../source-freshness";
import { SourceUpdateNotice } from "./SourceUpdateNotice";
import { LayoutDashboard, NotebookPen, FileText, X } from "lucide-react";
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
import { DecisionSteps } from "./DecisionSteps";
import { pendingWritingQuestions, wikiNamedProjects, withAnswersFrom } from "../../ai/wiki-writing-questions";
import { documentReview } from "../document-review";
import { wikiBlockIssues } from "../../shared/wiki-explanations";
/** How long the step before writing waits for a first answer before writing goes on without one. */
const DECISION_GATE_WAIT_MS = 3 * 60_000;
import { KnowledgeLedger } from "./KnowledgeLedger";
import type { WikiKnowledgeLedger, WikiWritingQuestion } from "../../shared/wiki-knowledge";
import { AIProviderHttpError, AIProviderResponseError, AIProviderValidationError, requestProviderPermission } from "../../ai/provider";
import { renameCanvas } from "../../storage/canvases";
import { attachFocusSession } from "../../storage/focus-sessions";
import { usePreferences } from "../preferences";
import { FocusDiscussion } from "./FocusDiscussion";
import { FocusBrief } from "./FocusBrief";
import { FocusNotes } from "./FocusNotes";
import { FocusUpdatePreview, type ChapterChange } from "./FocusUpdatePreview";
import { ChapterDiff } from "./ChapterDiff";
import { FocusOverview } from "./FocusOverview";
import { FocusUnderstandingPath, type RouteCardDraft } from "./FocusUnderstandingPath";
import { ProjectUnderstanding } from "./ProjectUnderstanding";
import { FocusChapterPath } from "./FocusChapterPath";
import { readingTitle } from "../../shared/reading-title";
import { reviewLead } from "../review-presentation";
import {reviseWikiChapters} from "../../ai/wiki-revision";
import {refreshWikiBrief} from "../../ai/wiki-manual-review";
import { FocusFollowUp, type RevisionScope } from "./FocusFollowUp";
const ProjectExportDialog = lazy(() => import("./ProjectExportDialog").then(module => ({ default: module.ProjectExportDialog })));
import { ReaderMoreMenu } from "./ReaderMoreMenu";
import {workspaceFocusVersions} from "../focus-versions";
import { excludeWikiChapter, applyWikiMembership } from "../../shared/wiki-scope-review";
import { moveRouteCard, saveRouteCard } from "../focus-route";
import { ReaderGuide } from "./ReaderGuide";
import { useUnderstandingAnalysis } from "../hooks/useUnderstandingAnalysis";
import "../project-outcome.css";
import { useFocusSave } from "../hooks/useFocusSave";
import { FocusGenerationProgress } from "./FocusGenerationProgress";
import { FocusGenerationErrorCard } from "./FocusGenerationErrorCard";
import type { FocusAnalysisProgress } from "../../shared/focus-progress";
import { FocusScopePicker } from "./FocusScopePicker";
import { WIKI_OPEN_CHAPTER_EVENT } from "../../shared/wiki-chapter-links";
import { beginFocusGenerationTask, updateFocusGenerationTask } from "../../storage/focus-generation-tasks";
const FocusSourceReader = lazy(() => import("./FocusSourceReader").then((module) => ({ default: module.FocusSourceReader })));

export interface GoalRequest { id: string; goal: string; mode: FocusMode; sourceIds?: string[]; sourcePoolIds?: string[]; scopeCanvasId?: string; scope?: FocusScope; runId?: string }

function ReaderProgress({ zh, completed, total, work }: { zh: boolean; completed: number; total: number; work: boolean }) {
  const label = work ? zh ? "已核对" : "Checked" : zh ? "已理解" : "Understood";
  return <section className="focus-reader-progress" aria-label={zh ? "阅读进度" : "Reading progress"}><div><span>{label}</span><strong>{completed}/{total}</strong></div><progress value={completed} max={Math.max(total, 1)} aria-label={label} /><small>{zh ? `还剩 ${Math.max(0, total - completed)} 节` : `${Math.max(0, total - completed)} sections remaining`}</small></section>;
}

export function FocusWorkspace({ request, initialSession, searchTarget, revisionRequest, conversations, canvases, projectSessions = [], availableSessions, onOpenSession, onDeleteVersion, onDeleteProject, settingsRevision, onClose, onReturnToWorkbench, onSettings, onSaved, headerProgressTarget }: {
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
  const [phase, setPhase] = useState<"sources" | "scope" | "generating" | "preview" | "reading" | "error">(initialSession ? initialSession.status === "preview" ? "preview" : "reading" : request?.sourceIds?.length ? request.scope ? "generating" : "scope" : "sources");
  const confirmedScope = useRef<FocusScope | undefined>(initialSession?.scope ?? request?.scope);
  const confirmedMode = useRef<FocusMode>(initialSession?.mode ?? request?.mode ?? "work");
  const [proposal, setProposal] = useState<FocusSession | undefined>(initialSession?.status === "preview" ? initialSession : undefined);
  const proposalRef = useRef(proposal); proposalRef.current = proposal;
  const wikiActionPending = useRef(false);
  const [previewInstructions, setPreviewInstructions] = useState<Record<string, string>>({});
  const [wikiActionChapterId, setWikiActionChapterId] = useState<string>();
  const [wikiFeedback, setWikiFeedback] = useState<{error?: string; status?: string}>({});
  const [wikiRewrite, setWikiRewrite] = useState<{sessionId: string; original: FocusSection; signature: string; candidate: FocusSection}>();
  const [error, setError] = useState("");
  const [revisionFailure,setRevisionFailure]=useState<{message:string;budget?:WikiRewriteBudgetError;ids:string[];instruction:string}>();
  const [projectSaveError, setProjectSaveError] = useState("");
  const [errorInfo, setErrorInfo] = useState<{ code: string; requestId?: string; fields?:string[]; output?: AIProviderResponseError["outputDiagnostics"] }>();
  const [status, setStatus] = useState("");
  const [instruction, setInstruction] = useState("");
  const [revisionScope, setRevisionScope] = useState<RevisionScope>("section");
  const [editing, setEditing] = useState(false);
  const [mobileNavigation,setMobileNavigation]=useState(false);
  const [wikiHeadingTarget,setWikiHeadingTarget]=useState<{id:string;title:string;revision:number}>();
  // The knowledge ledger is a page of its own beside the document overview, reached from the sidebar.
  const [ledgerPage, setLedgerPage] = useState(false);
  const [overview, setOverview] = useState(Boolean(initialSession && (initialSession.mode === "work" || !initialSession.activeSectionId)));
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [revisionIds,setRevisionIds]=useState<string[]>([]);
  // Generation paused after the directory is planned, waiting on the user's verdicts before anything is written.
  const [docReview,setDocReview]=useState<{kind:"issues";index:number}|{kind:"evidence";sectionId:string;revision:number}>();
  const [decisionGate,setDecisionGate]=useState<{ledger:WikiKnowledgeLedger;original:WikiKnowledgeLedger;resolve:(ledger:WikiKnowledgeLedger)=>void;touched?:boolean}>();
  // What a chapter's writer asks while the rest is written, answered beside the preview; the answers reach the paragraphs
  // they concern once the draft is written. settle: writing has finished and waits for the user to finish answering.
  const [writerAsk,setWriterAsk]=useState<{ledger:WikiKnowledgeLedger;questions:WikiWritingQuestion[];touched?:boolean;done?:boolean;settle?:()=>void}>();
  const writerAskRef=useRef(writerAsk);writerAskRef.current=writerAsk;
  useEffect(()=>{
    if(!writerAsk?.settle||writerAsk.touched)return;
    const timer=window.setTimeout(()=>writerAsk.settle?.(),DECISION_GATE_WAIT_MS);
    return()=>window.clearTimeout(timer);
  },[writerAsk]);
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
  const [navigationTab, setNavigationTab] = useState<"chapters" | "sources">("chapters");
  const [wikiAdjusting, setWikiAdjusting] = useState(false);
  const [exportOpen,setExportOpen]=useState(false);
  async function exportProject(){
    try{await saves.flush();setExportOpen(true);}
    catch{setError(zh?"保存失败，请重试后导出。":"Save failed. Retry before exporting.");}
  }
  const readingBaseRef = useRef<HTMLDivElement>(null);
  const sourceOverlayRef = useRef<HTMLDivElement>(null);
  const previewBaseRef = useRef<HTMLDivElement>(null);
  const [renamingProject, setRenamingProject] = useState(false);
  const projectSavePending = useRef(false);
  const [savedProjectName, setSavedProjectName] = useState("");
  const [spaceName, setSpaceName] = useState("");
  const [busy, setBusy] = useState(false);
  const [providerUrl, setProviderUrl] = useState("");
  const [confirmed, setConfirmed] = useState<{ goal: string; ids: string[] } | undefined>(initialSession ? { goal: initialSession.goal, ids: initialSession.scope?.sourceConversationIds ?? initialSession.sourceConversationIds } : undefined);
  const [retrying, setRetrying] = useState(false);
  const [focusedEvidence, setFocusedEvidence] = useState<FocusEvidence>();
  const [scopeReaderHost,setScopeReaderHost]=useState<HTMLElement|null>(null);
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
  const [notesOpen, setNotesOpen] = useState(false);
  const [notesHeaderActions, setNotesHeaderActions] = useState<HTMLDivElement | null>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const notesCloseRef = useRef<HTMLButtonElement>(null), sourcesCloseRef = useRef<HTMLButtonElement>(null);
  // In-text chapter links ("这部分已在「…」中说明") open that chapter like the sidebar does.
  const openChapterRef = useRef<(id: string) => void>(undefined);
  useEffect(() => {
    const open = (event: Event) => { const id = (event as CustomEvent<string>).detail; if (typeof id === "string") openChapterRef.current?.(id); };
    window.addEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
    return () => window.removeEventListener(WIKI_OPEN_CHAPTER_EVENT, open);
  }, []);
  useEffect(() => {
    if (!notesOpen && !sourcesOpen) return;
    const active = document.activeElement as HTMLElement | null;
    const previous = active?.closest(".reader-more")?.querySelector<HTMLElement>("summary") ?? active;
    const target = (notesOpen ? notesCloseRef : sourcesCloseRef).current;
    target?.focus({ preventScroll: true });
    return () => { if (previous?.isConnected) previous.focus({ preventScroll: true }); };
  }, [notesOpen, sourcesOpen]);
  const notesRef = useRef<HTMLDetailsElement>(null);
  const [partialPreview,setPartialPreview]=useState<FocusSession>();
  // The chapter the reader asked for first; the writing queue takes it next.
  const priorityOwner=useRef<string>(),[prioritized,setPrioritized]=useState<string>();
  const [analysisProgress, setAnalysisProgress] = useState<FocusAnalysisProgress>();
  const [changes, setChanges] = useState<SourceChange[]>([]);
  const generationRun = useRef<string>();
  const activeGenerationTask = useRef<string>();
  const freshnessRevision = conversations.map((item) => item.id + ":" + item.updatedAt).join("|");
  useEffect(() => { let live = true; if (sessionRef.current) void sourceChanges(sessionRef.current).then((items) => { if (live) setChanges(items); }).catch(() => { if (live) setChanges([]); }); return () => { live = false; }; }, [session?.id, session?.sourceSignatures, session?.sourceOutlines, freshnessRevision]);
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
  const lastGeneration = useRef({ revise: false, expansion: undefined as string | undefined, complete: false, scope: undefined as "section" | "whole" | undefined, scopeChoice:undefined as WikiScopeChoice|undefined });
  const saves = useFocusSave(onSaved, (state) => setStatus(state === "saving" || state === "saved" ? "" : zh ? "保存失败，请点击重试保存。" : "Save failed. Retry saving."));
  const saveSearchPosition = saves.save;
  useEffect(() => {
    const current = sessionRef.current;
    if (!searchTarget || !current?.sections.some((item) => item.id === (current.wikiSectionAliases?.[searchTarget.sectionId]??searchTarget.sectionId))) return;
    const next = { ...current, activeSectionId: current.wikiSectionAliases?.[searchTarget.sectionId]??searchTarget.sectionId, updatedAt: Date.now() };
    sessionRef.current = next; setSession(next); setOverview(false); setFocusedEvidence(undefined); setNotesOpen(next.mode !== "work" && searchTarget.note);
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
  useEffect(() => () => { controller.current?.abort(); if (activeGenerationTask.current) void updateFocusGenerationTask(activeGenerationTask.current, { status: "paused" }).catch(() => undefined); }, []);
  useEffect(() => { let live = true; void getAISettings().then((settings) => { if (live) setProviderUrl(settings?.mode !== "demo" ? settings?.baseUrl ?? "" : ""); }).catch(() => undefined); return () => { live = false; }; }, [settingsRevision]);

  const persist = (next: FocusSession) => {
    sessionRef.current = next; setSession(next);
    return saves.save(next, true);
  };
  const persistRoute = async (next: FocusSession) => {
    await saves.save(next, true);
    sessionRef.current = next; setSession(next);
  };
  const structureAnalysis = useUnderstandingAnalysis(session, sessionRef, persist, phase === "reading" && session?.mode !== "work");
  const saveRoute = async (draft: RouteCardDraft, keepOverview = false) => {
    const current = sessionRef.current;
    if (!current) throw new Error("No reading result");
    await persistRoute({ ...current, sections: saveRouteCard(current.sections, draft), activeSectionId: draft.id, completedSectionIds: current.completedSectionIds.filter(id => id !== draft.id), updatedAt: Date.now() });
    setOverview(keepOverview); setEditing(false);
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
  const createWikiPage = async (title:string,body:string,group?:string) => {
    const current=sessionRef.current;
    if(!current||busy||editing)throw new Error("Project is busy");
    const id=`wiki-page:${crypto.randomUUID()}`;
    const sections=saveRouteCard(current.sections,{id,title,body,transition:""}).map(item=>item.id===id?{...item,wikiGroup:group||undefined,wikiGroupEdited:true}:item);
    await persistRoute({...current,sections,wikiOrder:[...(current.wikiOrder??current.sections.map(item=>item.id)),id],updatedAt:Date.now()});
    return id;
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
  const moveRoute = async (id: string, before?: string) => {
    const current = sessionRef.current;
    if (!current) throw new Error("No reading result");
    await persistRoute({ ...current, sections: moveRouteCard(current.sections, id, before), updatedAt: Date.now() });
  };
  const deleteUnderstandingCard = async (id: string) => {
    const current = sessionRef.current;
    if (!current) throw new Error("No reading result");
    await persistRoute({ ...removeProjectUnderstandingCard(current, id), updatedAt: Date.now() });
  };
  const saveChapterPath = async (steps: FocusSection[]) => {
    const current = sessionRef.current;
    if (!current) throw new Error("No reading result");
    await persistRoute({ ...current, sections: current.sections.map(section => section.id === current.activeSectionId ? { ...section, understandingPath: steps } : section), updatedAt: Date.now() });
  };
  const saveNotes = async (patch: Partial<FocusSession>) => {
    const current = sessionRef.current;
    if (!current) throw new Error("No reading result");
    await persistRoute({ ...current, ...patch, updatedAt: Date.now() });
  };
  const savePreview = async (next: FocusSession) => {
    await saves.save(next, true);
    if (activeGenerationTask.current) await updateFocusGenerationTask(activeGenerationTask.current, { status: "preview", sessionId: next.id }).catch(() => undefined);
  };
  const update = (patch: Partial<FocusSession>) => { if (sessionRef.current && !busy) { const next = { ...sessionRef.current, ...patch, updatedAt: Date.now() }; sessionRef.current = next; setSession(next); void saves.save(next).catch(() => undefined); } };
  const finishChapterEdit = async () => {
    const current=sessionRef.current;
    if(!current)return;
    try { await saves.save(current,true); setEditing(false); }
    catch { setError(zh?"保存失败，编辑内容已保留，请重试。":"Save failed. Your edit is retained. Retry."); }
  };
  const generate = async (goal: string, ids: string[], revise = false, expansion?: string, complete = false, scope?: "section" | "whole", retry = false, scopeChoice?:WikiScopeChoice) => {
    const scopeBase=scopeChoice?(proposal??session):undefined;
    try { if (!hasAIConnection(await getAISettings())) { lastGeneration.current = { revise, expansion, complete, scope, scopeChoice }; setConfirmed({ goal, ids }); setError(zh ? "请先连接自己的 AI。" : "Connect your AI API first."); setPhase(session ? "reading" : "error"); onSettings(); return; } }
    catch { setError(zh ? "读取 AI 配置失败，请重新打开 AI 设置。" : "Could not read AI settings. Reopen AI settings."); return; }
    const discussionScope = scopeBase?.scope ?? (revise ? session?.scope : confirmedScope.current);
    lastGeneration.current = { revise, expansion, complete, scope, scopeChoice };
    if (!retry || !generationRun.current) generationRun.current = !generationRun.current && !revise && !complete && request ? request.runId ?? request.id : `focus-${crypto.randomUUID()}`;
    controller.current?.abort();
    const abort = new AbortController(); controller.current = abort;
    setRevisionFailure(undefined);setPartialPreview(undefined);priorityOwner.current=undefined;setPrioritized(undefined);setAnalysisProgress(undefined); setRetrying(false); setConfirmed({ goal, ids }); setError(""); setErrorInfo(undefined); setStatus(zh ? "正在准备已确认的来源…" : "Preparing confirmed sources…"); setPhase("generating");
    try {
      await saves.flush();
      const sources = ids.map((id) => conversations.find((item) => item.id === id));
      if (sources.some((source) => !source)) throw new Error(zh ? "部分来源已被移除，请重新选择。" : "Some sources were removed. Select sources again.");
      if (request && !revise && !complete) {
        await beginFocusGenerationTask({ id: request.id, runId: generationRun.current!, goal, mode: confirmedMode.current, sourceIds: ids, scope: discussionScope, scopeCanvasId: request.scopeCanvasId });
        activeGenerationTask.current = request.id;
      }
      const sectionRevision = (scope ?? (expansion ? "section" : revisionScope)) === "section";
      const { generateFocusSession } = await import("../../ai/focus-session");
      const incremental = complete && !revise && session?.scope?.kind !== "goal" && Boolean(session);
      const execute: typeof generateFocusSession = incremental ? async (...args) => {
        const { generateFocusUpdate } = await import("../../ai/focus-update");
        return generateFocusUpdate(session!, args[2], args[3], args[4], args[6], args[7], args[8]);
      } : generateFocusSession;
      abort.signal.throwIfAborted();
      let result = await execute(goal, revise ? session?.mode ?? confirmedMode.current : confirmedMode.current, sources as Conversation[], locale, abort.signal, revise && session ? { instruction: expansion ?? instruction, sections: session.sections, evidence: session.evidence, sectionId: sectionRevision ? session.activeSectionId : undefined, title: session.title, completedSectionIds: session.completedSectionIds, locale: session.locale } : undefined, (state) => {
        if (abort.signal.aborted) return;
        setRetrying(state === "retrying");
      }, generationRun.current, (completed, total, stage, detail) => {
        if (!abort.signal.aborted) {
          const progress = detail ?? { completed, total, stage, final: stage === "synthesis", round: 1, completedSourceIds: [], totalSources: ids.length, processedSegments: 0, totalSegments: 0, elapsedMs: 0 };
          setAnalysisProgress(progress);
          if (activeGenerationTask.current) void updateFocusGenerationTask(activeGenerationTask.current, { progress }).catch(() => undefined);
        }
      }, { ...((session??proposal)?.mode==="work"?{wikiProjectBoundary:savedWikiProjectBoundary((session??proposal)!)}:{}), wikiScopeIncludeKeys:scopeChoice?.includeKeys??session?.wikiScopeReview?.includeKeys??proposal?.wikiScopeReview?.includeKeys, wikiScopeExcludeKeys:scopeChoice?.excludeKeys??session?.wikiScopeReview?.excludeKeys??proposal?.wikiScopeReview?.excludeKeys, wikiScopeIgnoredKeys:scopeChoice?.ignoredKeys??session?.wikiScopeReview?.ignoredKeys??proposal?.wikiScopeReview?.ignoredKeys, ...(complete ? {complete:true} : discussionScope ? {scope:discussionScope} : {}),priorityOwner:()=>priorityOwner.current,...(!revise?{onKeyDecisions:(ledger:WikiKnowledgeLedger)=>(pendingWritingQuestions(ledger).length||wikiNamedProjects(ledger).length)&&!abort.signal.aborted?new Promise<WikiKnowledgeLedger>(resolve=>{setDecisionGate({ledger,original:ledger,resolve:next=>{setDecisionGate(undefined);resolve(next);}});abort.signal.addEventListener("abort",()=>{setDecisionGate(undefined);resolve(ledger);},{once:true});}):Promise.resolve(ledger),onWriterQuestions:(questions:WikiWritingQuestion[],ledger:WikiKnowledgeLedger)=>{if(!abort.signal.aborted)setWriterAsk(prev=>{const base=prev?.ledger??ledger;return {...prev,ledger:{...base,writingQuestions:[...base.writingQuestions??[],...questions]},questions:[...prev?.questions??[],...questions]};});},settleWriterQuestions:(ledger:WikiKnowledgeLedger)=>new Promise<WikiKnowledgeLedger>(resolve=>{const finish=()=>{const ask=writerAskRef.current;setWriterAsk(undefined);resolve(ask?withAnswersFrom(ledger,ask.ledger):ledger);};const ask=writerAskRef.current;if(!ask||ask.done||ask.questions.every(question=>ask.ledger.userAnswers?.some(answer=>answer.questionId===question.id))){finish();return;}setWriterAsk({...ask,settle:finish});abort.signal.addEventListener("abort",()=>{setWriterAsk(undefined);resolve(ledger);},{once:true});})}:{}),onPartial:partial=>{
        if(abort.signal.aborted||controller.current!==abort)return;
        setPartialPreview(partial);
        if(generationRun.current)void markAIFirstReadable(generationRun.current);
      }});
      if (abort.signal.aborted) return;
      if(scopeBase?.sections.some(chapter=>!editableWikiTopic(chapter))){
        const [{mergeFocusUpdate},{getMessagesForConversation},{verifyFocusSources}]=await Promise.all([import("../../ai/focus-update"),import("../../storage/messages"),import("../../ai/focus-source-check")]);
        const messages=(await Promise.all(ids.map(id=>getMessagesForConversation(id)))).flat();
        abort.signal.throwIfAborted();
        result=mergeFocusUpdate(scopeBase,result,{fallback:true,changed:true,affectedSectionIds:scopeBase.sections.map(chapter=>chapter.id),scope:discussionScope??{kind:"all"},removedKeys:[]},messages,locale);
        await verifyFocusSources(result,abort.signal);
      }
      if(abort.signal.aborted)return;
      // A revision becomes a separate reviewable result. The original and user edits remain saved.
      const previous = session ?? proposal;
      const nextProposal: FocusSession = { ...result, status: "preview", scope: complete ? { kind: "all" } : discussionScope ?? result.scope, ...(previous ? { rootSessionId: previous.rootSessionId ?? previous.id, previousSessionId: previous.id } : {}), sourceOutlines: revise ? session?.sourceOutlines : result.sourceOutlines, brief: revise && sectionRevision ? session?.brief : result.brief, coverage: revise && sectionRevision ? session?.coverage : result.coverage, ...(incremental ? {} : previous ? carryReviewNotes(previous, result, revise && sectionRevision) : { notes: "" }), visitedSectionIds: incremental ? result.visitedSectionIds : revise && sectionRevision ? session?.visitedSectionIds : undefined, sourceSignatures: revise && sectionRevision ? session?.sourceSignatures : result.sourceSignatures, sourceMessageOrder: revise && sectionRevision ? session?.sourceMessageOrder : result.sourceMessageOrder, sourceRoles: revise && sectionRevision ? session?.sourceRoles : result.sourceRoles, canvasId: session?.canvasId ?? proposal?.canvasId ?? request?.scopeCanvasId };
      setProposal(nextProposal); setStatus(""); setPhase("preview");
      // Saving a completed preview never replaces the original accepted result.
      try {
        await savePreview(nextProposal);
      } catch { /* Keep the generated text and offer a save-only retry. */ }
    } catch (failure) {
      if (activeGenerationTask.current) await updateFocusGenerationTask(activeGenerationTask.current, { status: abort.signal.aborted ? "paused" : "failed", errorCode: failure instanceof DemoApiError || failure instanceof AIProviderHttpError || failure instanceof AIProviderResponseError || failure instanceof AIProviderValidationError ? failure.code : undefined }).catch(() => undefined);
      if (!abort.signal.aborted) { setStatus(""); setError(failure instanceof Error ? failure.message : String(failure)); setErrorInfo(failure instanceof DemoApiError || failure instanceof AIProviderHttpError || failure instanceof AIProviderResponseError || failure instanceof AIProviderValidationError ? { code: failure.code, requestId: failure.requestId, ...(failure instanceof AIProviderValidationError?{fields:failure.fieldPaths?.filter(path=>/^[a-zA-Z.[\]0-9_]{1,100}$/u.test(path)).slice(0,8)}:{}), ...(failure instanceof AIProviderResponseError ? { output: failure.outputDiagnostics } : {}) } : undefined); setPhase(session ? "reading" : "error"); }
    }
  };
  useEffect(() => {
    if (initialSession || !request?.scope || !request.sourceIds?.length) return;
    // Defer until the mount commits; StrictMode's discarded mount never starts AI.
    const timer = window.setTimeout(() => { void generate(request.goal, request.sourceIds!); }, 0);
    return () => window.clearTimeout(timer);
    // Each request has a new workspace key; subsequent edits use explicit actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);
  const reviseProjectWiki = async () => {
    const base=sessionRef.current;
    if(!base||busy||wikiActionPending.current)return;
    const selected=base.sections.filter(chapter=>!chapter.origin&&!chapter.userEdited&&(revisionScope==="whole"||revisionScope==="section"&&chapter.id===base.activeSectionId||revisionScope==="selected"&&revisionIds.includes(chapter.id)));
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
      const revised=await reviseWikiChapters(base,selected.map(chapter=>chapter.id),originals,instruction,createAtlasAI(settings,abort.signal,base.runId??base.id),abort.signal,(done,total,detail)=>{if(!abort.signal.aborted)setWikiRevisionProgress({done,total,...detail});},base.runId??base.id);
      const current=sessionRef.current;
      if(!current||current.id!==base.id||selected.some(chapter=>{const latest=current.sections.find(item=>item.id===chapter.id);return !latest||wikiBasis(current,latest)!==wikiBasis(base,chapter);})||(await sourceChanges(base)).some(change=>change.added||change.changed||change.removed||change.reordered))throw new Error(zh?"正文或来源已变化，当前内容已保留，请重新调整。":"Text or sources changed. Current content is retained; revise again.");
      abort.signal.throwIfAborted();
      const sections=current.sections.flatMap(chapter=>{if(!selected.some(item=>item.id===chapter.id))return [chapter];const next=revised.sections.find(item=>item.id===chapter.id);return next?[next]:[];});
      const aliases=new Map(selected.filter(chapter=>!sections.some(item=>item.id===chapter.id)).map(chapter=>[chapter.id,revised.wikiSectionAliases![chapter.id]]));
      const remapped=aliases.size?remapWikiSectionReferences(current,sections,aliases):{...current,sections};
      const next=refreshWikiBrief({...remapped,wikiRevisionReceipt:revised.wikiRevisionReceipt,wikiContentReview:revised.wikiContentReview,knowledgeViewVersion:revised.knowledgeViewVersion,wikiTitleReview:revised.wikiTitleReview,semanticOverview:undefined,id:crypto.randomUUID(),rootSessionId:current.rootSessionId??current.id,previousSessionId:current.id,status:"preview",createdAt:Date.now(),updatedAt:Date.now()});
      setProposal(next);setPhase("preview");setStatus("");
      try{await savePreview(next);}catch{/* Keep candidate available for save-only retry. */}
    }catch(failure){if(!abort.signal.aborted){
      const message=failure instanceof Error?failure.message:String(failure);setError(message);
      setRevisionFailure({message,budget:failure instanceof WikiRewriteBudgetError?failure:undefined,ids:selected.map(chapter=>chapter.id),instruction});
      setErrorInfo(failure instanceof AIProviderHttpError||failure instanceof AIProviderResponseError||failure instanceof AIProviderValidationError||failure instanceof DemoApiError?{code:failure.code,requestId:failure.requestId}:failure instanceof AILocalInputError?{code:failure.code}:undefined);
    }}
    finally{wikiActionPending.current=false;setBusy(false);setWikiRevisionProgress(undefined);}
  };
  const accept = async () => {
    if (!proposal || busy || wikiActionPending.current) return;
    wikiActionPending.current = true; setBusy(true); setError(""); setStatus(zh ? "保存中…" : "Saving…");
    try {
      if ((await sourceChanges(proposal)).some(change => change.added || change.changed || change.removed || change.reordered)) throw new Error("Sources changed");
      // Saving prose is not approval of its facts, architecture or decisions.
      const next: FocusSession = { ...proposal, status: "ready", updatedAt: Date.now() };
      await saves.save(next, true);
      sessionRef.current = next; setSession(next); confirmedScope.current = proposal.scope;
      setProposal(undefined); setWikiRewrite(undefined); setPhase("reading"); setOverview(true); setInstruction(""); setStatus("");
    } catch (failure) {
      setStatus(""); setError(failure instanceof Error && failure.message === "Sources changed" ? zh ? "来源已有变化，请重新生成更新预览。" : "Sources changed. Regenerate the update preview." : zh ? "结果未能保存，草稿已保留，请重试。" : "Could not save this result. Your draft is retained; retry.");
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
  const applyScopeChoice = async (choice:WikiScopeChoice) => {
    const base = proposalRef.current ?? sessionRef.current;
    if (!base || busy || wikiActionPending.current) return;
    const next = applyWikiMembership(base,choice);
    if (!next) { void generate(base.goal,base.sourceConversationIds,false,undefined,false,undefined,false,choice); return; }
    wikiActionPending.current = true; setBusy(true);
    try { if (proposalRef.current) { await savePreview(next); setProposal(next); } else await persistRoute(next); }
    catch { setStatus(zh ? "未能保存选择，请重试。" : "Could not save your choice; retry."); }
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
      const candidate = await rewriteWikiSection(base, chapter, originals, editorialRequest, createAtlasAI(settings, abort.signal, base.runId ?? base.id), abort.signal, base.runId ?? base.id);
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
  const wikiRewriteView = wikiRewrite ? <WikiRewritePreview previous={wikiRewrite.original} next={wikiRewrite.candidate} zh={zh} busy={busy} onApply={() => void applyChapterRewrite()} onDiscard={() => { setWikiRewrite(undefined); setWikiFeedback({status: zh ? "已保留原稿。" : "Original retained."}); }} /> : null;
  const attach = async () => {
    if (!sessionRef.current || busy || projectSavePending.current) return;
    projectSavePending.current = true; setBusy(true); setProjectSaveError("");
    try {
      await saves.flush();
      const current = sessionRef.current!;
      const sourceName=conversations.find(item=>item.id===current.sourceConversationIds[0])?.title.trim();
      const name=(current.mode==="work"?current.title.trim()||sourceName:sourceName||current.title.trim())||(zh?"未命名项目":"Untitled project");
      const next = await attachFocusSession(current, current.canvasId ? { canvasId: current.canvasId } : { name });
      sessionRef.current = next; setSession(next); setSavedProjectName(name); onSaved(next); setStatus("");
    } catch (failure) { setProjectSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { projectSavePending.current = false; setBusy(false); }
  };
  const renameProject = async () => {
    const current = sessionRef.current, name = spaceName.trim();
    if (!current || !name || busy || projectSavePending.current) return;
    projectSavePending.current = true; setBusy(true); setProjectSaveError("");
    try {
      await saves.flush(); if(current.canvasId)await renameCanvas(current.canvasId, name);
      await persistRoute({...sessionRef.current!,title:name,wikiSuggestedTitle:undefined,updatedAt:Date.now()});
      setSavedProjectName(name); setRenamingProject(false); onSaved(sessionRef.current!);
    } catch (failure) { setProjectSaveError(failure instanceof Error ? failure.message : String(failure)); }
    finally { projectSavePending.current = false; setBusy(false); }
  };
  const authorize = () => { void requestProviderPermission(providerUrl).then((allowed) => setStatus(allowed ? zh ? "已授权，请重试生成。" : "Authorized. Retry generation." : zh ? "未获得连接权限。" : "Connection permission denied.")).catch((failure) => setError(String(failure))); };

  const retryGeneration = () => { if (confirmed) void generate(confirmed.goal, confirmed.ids, lastGeneration.current.revise, lastGeneration.current.expansion, lastGeneration.current.complete, lastGeneration.current.scope, true, lastGeneration.current.scopeChoice); };
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
    {errorDetails}
    {budgetFailure?<details><summary>{zh?"查看原因":"Why this happened"}<ChevronDown size={14}/></summary><p>{zh?`预计输入 ${budgetFailure.inputTokens.toLocaleString()} Token，当前单次调整上限 ${budgetFailure.maxInputTokens.toLocaleString()} Token；包含 ${budgetFailure.sourceMessages} 条关联原始消息。不是服务商额度不足，原样重试不会缩小材料。可先选择其他章节调整。`:`Estimated input: ${budgetFailure.inputTokens.toLocaleString()} tokens; local revision limit: ${budgetFailure.maxInputTokens.toLocaleString()} tokens, including ${budgetFailure.sourceMessages} original messages. This is not a provider quota error. Retrying unchanged input will not reduce it; you can revise other chapters first.`}</p></details>:null}
  </FocusOperationNotice> : null;
  // Reads only what changed in the sources, rewrites the chapters it touches and opens the result as a preview.
  const updateProject = () => { if (!session) return; if (session.sidecarConversationIds?.some(id=>!session.sourceConversationIds.includes(id))) setSourcePickerOpen(true);
    // Nothing new in the sources: no model call, only a word that the document is current.
    else if (!changes.some(item => item.added || item.changed || item.removed || item.reordered || item.unknown) && !ledgerDecisionsPending(session.wikiKnowledge)) setStatus(zh ? "来源没有新内容，文档已是最新。" : "No new source content; the document is current."); else if (session.scope?.kind === "goal") setPhase("scope"); else void generate(session.goal, session.sourceConversationIds, false, undefined, true); };
  const reorganize = () => { if (session) void generate(session.goal, session.sourceConversationIds, false, undefined, false, undefined, false, { includeKeys: [...session.wikiScopeReview?.includeKeys ?? []], excludeKeys: [...session.wikiScopeReview?.excludeKeys ?? []], ignoredKeys:[...session.wikiScopeReview?.ignoredKeys??[]] }); };
  const adjustSources = () => { void saves.flush().catch(() => undefined); onReturnToWorkbench((session && !session.sections.length ? revisionRequest?.instruction : undefined) ?? confirmed?.goal ?? session?.goal ?? request?.goal ?? "", confirmed?.ids ?? session?.scope?.sourceConversationIds ?? session?.sourceConversationIds ?? request?.sourceIds ?? [], session?.mode ?? confirmedMode.current); };

  const currentVersion=phase==="preview"?proposal:session;
  const versions=currentVersion?workspaceFocusVersions(availableSessions??projectSessions,currentVersion):[];
  const projectPicker=versions.length>0&&onOpenSession&&currentVersion?<ProjectVersionPicker versions={versions} currentId={currentVersion.id} zh={zh} disabled={busy||editing||Boolean(wikiRewrite)} onSelect={async id=>{try{await saves.flush();onOpenSession(id);}catch{setStatus(zh?"保存失败，请重试后切换版本。":"Save failed. Retry before switching versions.");}}} onDelete={onDeleteVersion?async id=>{try{await saves.flush();await onDeleteVersion(id);}catch{setStatus(zh?"保存失败，版本已保留，请重试。":"Save failed. The version was retained; retry.");}}:undefined}/>:null;
  if (phase === "scope") {
    const ids = confirmedScope.current?.sourceConversationIds ?? confirmed?.ids ?? request?.sourceIds ?? session?.sourceConversationIds ?? [];
    const goal = confirmed?.goal ?? session?.goal ?? request?.goal ?? "";
    const scopeSources = ids.flatMap((id) => { const source = conversations.find((item) => item.id === id); return source ? [source] : []; });
    return <FocusScopePicker goal={goal} mode={confirmedMode.current} sources={scopeSources} zh={zh} returningToReading={Boolean(session || proposal)} initialScope={confirmedScope.current} onConfigureAI={onSettings} onBack={session || proposal ? () => { const previous = proposal ?? session!; confirmedScope.current = previous.scope; confirmedMode.current = previous.mode; setPhase(proposal ? "preview" : "reading"); } : (nextGoal, nextMode) => { void saves.flush().catch(() => undefined); onReturnToWorkbench(nextGoal, ids, nextMode); }} onConfirm={(scope, nextGoal, nextMode) => { confirmedScope.current = scope; confirmedMode.current = nextMode; const included = scope.kind === "goal" ? ids.filter((id) => scope.blocks?.some((block) => block.conversationId === id)) : ids; void generate(nextGoal, included); }} />;
  }

  if (phase === "sources") return <main className="focus-error-screen"><section className="focus-error-card"><h1>{zh ? "请先确认来源材料" : "Confirm sources first"}</h1><p>{zh ? "在工作台选择已同步的对话，再生成阅读预览。" : "Choose synced conversations on the Workbench before creating a preview."}</p><div className="focus-error-actions"><button className="primary" onClick={adjustSources}>{zh ? "返回工作台" : "Back to Workbench"}</button></div></section></main>;
  if (phase === "error") return <main className="focus-error-screen"><FocusGenerationErrorCard zh={zh} message={error} code={errorInfo?.code} progress={analysisProgress} diagnostics={errorDetails} onRetry={confirmed ? retryGeneration : undefined} onSources={adjustSources} onSettings={onSettings} onAuthorize={needsConnectionPermission ? authorize : undefined} status={status} /></main>;
  if (phase === "generating") {
    const progress = <FocusGenerationProgress compact={Boolean(partialPreview)} zh={zh} mode={session?.mode ?? confirmedMode.current} scopeKind={lastGeneration.current?.complete ? "all" : confirmedScope.current?.kind} detail={analysisProgress} sourceCount={analysisProgress?.totalSources ?? confirmed?.ids.length ?? request?.sourceIds?.length ?? 0} retrying={retrying} onCancel={() => { controller.current?.abort(); setStatus(""); if (session) setPhase("reading"); else adjustSources(); }} />;
    return <main className={`focus-wait${partialPreview ? " has-partial-preview" : ""}`}>
      {writerAsk&&!writerAsk.done&&writerAsk.questions.length ? <div className="focus-decision-gate"><DecisionSteps writing questions={writerAsk.questions} busy={!writerAsk.settle} ledger={writerAsk.ledger} zh={zh} onChange={change=>setWriterAsk(ask=>ask?{...ask,touched:true,ledger:change(ask.ledger)}:ask)} onDone={()=>{const ask=writerAskRef.current;if(ask?.settle)ask.settle();else setWriterAsk(current=>current?{...current,done:true}:current);}}/></div> : null}
      {decisionGate ? <div className="focus-decision-gate"><DecisionSteps ledger={decisionGate.original} zh={zh} onChange={change=>setDecisionGate(gate=>gate?{...gate,touched:true,ledger:change(gate.ledger)}:gate)} onDone={()=>decisionGate.resolve(decisionGate.ledger)}/></div> : null}
      {partialPreview ? headerProgressTarget ? createPortal(progress, headerProgressTarget) : <div className="focus-progress-fallback">{progress}</div> : <div className="focus-generation-panel">{progress}</div>}
      {/* The ledger organizes other projects into their own chapters: the earlier scope review does not run for it. */}
      {partialPreview?.mode==="work"&&!partialPreview.wikiKnowledge?<WikiScopeNotice readerHost={null} session={partialPreview} zh={zh} busy reviewing={!partialPreview.wikiScopeReview} onApply={()=>undefined} onSource={()=>undefined}/>:null}
      {partialPreview ? <section className="focus-partial-preview" aria-label={zh ? "章节草稿预览" : "Chapter draft preview"}>{partialPreview.sections.some(section=>section.wikiOutline)?<p className="focus-partial-note" role="status">{partialPreview.sections.every(section=>section.id.startsWith("rough:"))?zh?"还在读取对话：这是目前读到的主要主题，整理后会变成正式目录。":"Still reading: these are the main topics so far; they become the directory once organized.":partialPreview.sections.some(section=>section.wikiOutline&&section.wikiOwnerId)?zh?"目录和要点已就绪，正文正在逐章写入；想先看哪一章，可以让它先写。":"The outline and key points are ready; chapters are being written one by one. Choose one to write first.":zh?"目录已就绪，正文正在逐章写入。":"The directory is ready; chapters are being written."}</p>:null}{partialPreview.sections.map(section => <article key={section.id} className={section.wikiOutline?"is-outline":undefined}><h2>{section.title}</h2>{section.wikiOutline?<div className="focus-partial-outline-status"><span>{zh?"要点 · 正文生成中":"Key points · being written"}</span>{section.wikiOwnerId?<button type="button" disabled={prioritized===section.wikiOwnerId} onClick={()=>{priorityOwner.current=section.wikiOwnerId;setPrioritized(section.wikiOwnerId);}}>{prioritized===section.wikiOwnerId?zh?"已排到最前":"Next in line":zh?"先写这一章":"Write this first"}</button>:null}</div>:null}<ReaderGuide content={section.body} zh={zh} complete hideEvidenceMarkers /></article>)}</section> : null}
    </main>;
  }
  if (phase === "preview" && proposal) {
    const projectPreview = proposal.mode === "work";
    const renderChapter = (chapter: FocusSection, content: ReactNode, change?: ChapterChange) => projectPreview ? <WikiChapterPreview
      number={proposal.sections.indexOf(chapter)+1} section={chapter} zh={zh} busy={busy} change={change} instruction={previewInstructions[chapter.id] ?? ""}
      onInstruction={text => setPreviewInstructions(previous => ({...previous, [chapter.id]: text}))}
      onSources={() => reviewSources(chapter)} onKeep={() => void keepChapter(chapter)}
      onExclude={chapter.wikiMaterialKeys?.length && proposal.sections.length > 1 && !chapter.userEdited && !chapter.origin ? () => void excludeChapter(chapter) : undefined} onRewrite={() => void rewriteChapter(chapter, previewInstructions[chapter.id] ?? "")}
      feedback={wikiActionChapterId === chapter.id ? wikiFeedbackView : undefined}
      candidate={wikiRewrite?.original.id === chapter.id ? wikiRewriteView : undefined}
    >{content}</WikiChapterPreview> : <><h2>{chapter.title}</h2>{change?.renamedFrom ? <p className="muted">{zh ? "原名：" : "Previously: "}{change.renamedFrom}</p> : null}{change?.previousBody !== undefined ? <details className="update-old-text"><summary>{zh ? "和旧版对比" : "Compare with earlier"}</summary><ChapterDiff before={change.previousBody} after={chapter.body} zh={zh}/></details> : null}{content}</>;
    return <main ref={setScopeReaderHost} className={`focus-preview${projectPreview ? " is-project-preview" : ""}${focusedEvidence ? " has-original-panel" : ""}`}>
      <div className="focus-preview-scroll" ref={previewBaseRef}>
        <div className="focus-preview-inner">
          <div className="focus-preview-heading"><div className="focus-preview-title-row"><h1>{proposal.title}</h1></div></div>
          {projectPreview&&session?<div ref={setUpdateSummaryHost} className="focus-update-summary-slot"/>:null}
          {projectPreview&&!proposal.wikiKnowledge ? <WikiScopeNotice readerHost={focusedEvidence?null:scopeReaderHost} onRead={()=>{setFocusedEvidence(undefined);setSourceSelection(undefined);}} key={`scope:${proposal.id}`} session={proposal} zh={zh} busy={busy} onRetry={()=>void generate(proposal.goal,proposal.sourceConversationIds,false,undefined,false,undefined,false,{includeKeys:proposal.wikiScopeReview?.includeKeys??[],excludeKeys:proposal.wikiScopeReview?.excludeKeys??[],ignoredKeys:proposal.wikiScopeReview?.ignoredKeys??[]})} onSource={ref=>{setSourceSelection(undefined);setFocusedEvidence(ref);}} onApply={choice=>void applyScopeChoice(choice)}/> : null}
          {projectPreview ? <DocumentOverview session={proposal} zh={zh} preview onRead={() => undefined} onLocate={ref=>{setSourceSelection(undefined);setFocusedEvidence(ref);}} /> : null}
          {session ? <FocusUpdatePreview summaryHost={projectPreview?updateSummaryHost:undefined} previous={session} next={proposal} zh={zh} renderSection={renderChapter} pendingSectionId={wikiRewrite?.original.id}/> : <ol>{proposal.sections.map(chapter => <li key={chapter.id}>{renderChapter(chapter, <>{projectPreview?<WikiChapterBody section={chapter} zh={zh} statusInHeading/>:<ReaderGuide content={chapter.body} zh={zh} complete hideEvidenceMarkers/>}</>)}</li>)}</ol>}
          <div className="preview-action-feedback" aria-live="polite">{error ? <p role="alert">{generationFailureReason(error,errorInfo?.code,zh)}</p> : null}{status ? <><p role="status">{generationFailureReason(status,undefined,zh)}</p>{status.includes("失败") || status.startsWith("Save failed") ? <button disabled={busy} onClick={() => void savePreview(proposal).catch(() => undefined)}>{zh ? "重试保存" : "Retry save"}</button> : null}</> : null}</div>
          <div className="focus-preview-actions">{onDeleteVersion && !session ? <button className="focus-preview-delete" disabled={busy} onClick={() => { controller.current?.abort(); void saves.flush().catch(() => undefined).then(() => { onDeleteVersion(proposal.id); onClose(); }); }}>{zh ? "删除此预览" : "Delete this preview"}</button> : null}<button disabled={busy} onClick={adjustSources}>{zh ? "调整来源" : "Change sources"}</button><button className="primary" disabled={busy || Boolean(wikiRewrite)} onClick={() => void accept()}>{busy ? zh ? "处理中…" : "Working…" : projectPreview ? zh ? "保存并查看" : "Save and view" : zh ? "确认并开始" : "Confirm and start"}</button></div>
        </div>
      </div>
      {projectPreview ? <PreviewChapterLocator contentRef={previewBaseRef} zh={zh}/> : null}
      {projectPreview && focusedEvidence ? <WorkspaceSourcePanel session={proposal} reference={focusedEvidence} references={sourceSelection?.references} sectionId={sourceSelection?.sectionId} quote={sourceSelection?.quote} claim={sourceSelection?.claim} conversationTitle={conversations.find(source => source.id === focusedEvidence.conversationId)?.title} zh={zh} onSelect={ref=>{setFocusedEvidence(ref);}} onClose={() => {setFocusedEvidence(undefined);setSourceSelection(undefined);}}/> : focusedEvidence ? <div ref={sourceOverlayRef} tabIndex={-1} className="project-source-reader" role="region" aria-label={zh ? "预览来源" : "Preview source"} onKeyDown={event => {if(event.key === "Escape"){setFocusedEvidence(undefined);event.stopPropagation();}}}><Suspense fallback={<p role="status">{zh ? "读取对话…" : "Loading conversation…"}</p>}>{conversations.find(source => source.id === focusedEvidence.conversationId) ? <FocusSourceReader conversation={conversations.find(source => source.id === focusedEvidence.conversationId)!} session={proposal} zh={zh} targetMessageId={focusedEvidence.messageId} targetExcerpt={focusedEvidence.excerpt} sourceVersionId={focusedEvidence.sourceVersionId} onBack={() => setFocusedEvidence(undefined)}/> : <><ReaderBackButton onClick={() => setFocusedEvidence(undefined)} label={zh ? "返回预览" : "Back to preview"}/><blockquote>{focusedEvidence.excerpt}</blockquote></>}</Suspense></div> : null}
    </main>;
  }
  if (!session) return null;
  // Deleting moves to Trash. A project's only version is deleted with the project.
  const deleteActions = [
    // A result not saved into a project has no project to delete with it; it can still be deleted on its own.
    ...(onDeleteVersion && (!session.canvasId || versions.length > 1 && versions.some(item => item.id === session.id)) ? [{ label: !session.canvasId ? zh ? "删除此结果" : "Delete this result" : zh ? "删除此版本" : "Delete this version", disabled: busy, run: () => { void saves.flush().catch(() => undefined).then(() => onDeleteVersion(session.id)); } }] : []),
    ...(onDeleteProject && session.canvasId ? [{ label: zh ? "删除项目" : "Delete project", disabled: busy, run: () => { void saves.flush().catch(() => undefined).then(() => onDeleteProject(session.canvasId!)); } }] : []),
  ];
  if (!session.sections.length) return <div className="focus-workspace"><nav id="project-workspace-navigation" className={`reading-outline${mobileNavigation?" is-mobile-open":""}`} aria-label={zh ? "对话章节" : "Conversation chapters"} onClick={event=>{if((event.target as HTMLElement).closest(".outline-item"))setMobileNavigation(false);}} onKeyDown={event=>{if(event.key==="Escape"){setMobileNavigation(false);document.querySelector<HTMLButtonElement>(".project-mobile-nav-toggle")?.focus();}}}>
    <button type="button" className="project-mobile-nav-close" onClick={()=>setMobileNavigation(false)}>{zh?"关闭项目导航":"Close project navigation"}</button><ReaderBackButton onClick={onClose} label={zh ? "返回工作台" : "Back to Workbench"} /><h2 title={session.title}>{readingTitle(session.title, 40)}</h2>{projectPicker}</nav><div className="focus-reader-main"><div className="focus-reader-toolbar"><strong>{session.title}</strong>{session.mode === "work" ? <button type="button" disabled={busy} onClick={() => void exportProject()} title={zh ? "导出项目" : "Export project"} aria-label={zh ? "导出" : "Export"}><Download size={15} aria-hidden="true" /><span>{zh ? "导出" : "Export"}</span></button> : null}<button type="button" onClick={adjustSources}>{zh ? "从材料生成" : "Organize sources"}</button></div><main className="focus-reading-body"><div className="reader-content"><header className="reader-section-heading"><h1>{session.title}</h1></header><FocusUnderstandingPath sections={[]} activeId="" zh={zh} onRead={() => undefined} onSave={saveRoute} onMove={moveRoute} />{status ? <small role="status">{generationFailureReason(status,undefined,zh)}</small> : null}</div></main></div>
    {exportOpen ? <Suspense fallback={null}><ProjectExportDialog session={session} zh={zh} onClose={()=>setExportOpen(false)}/></Suspense> : null}</div>;
  const section = session.sections.find((item) => item.id === session.activeSectionId) ?? session.sections[0];
  const position = session.sections.indexOf(section);

  // Sent from the overview: the pending problems one after another, or evidence checking in the first chapter that needs it.
  // Worked out only while the reader steps through problems; saved records, local and quick.
  const reviewIssues=docReview?.kind==="issues"&&session.mode==="work"?wikiBlockIssues(session):[];
  const startReview=(kind:"issues"|"evidence")=>{
    const found=documentReview(session,zh);
    if(kind==="issues"&&found.issues[0]){setDocReview({kind,index:0});move(found.issues[0].sectionId);}
    if(kind==="evidence"&&found.unchecked[0]){setDocReview({kind,sectionId:found.unchecked[0].sectionId,revision:Date.now()});move(found.unchecked[0].sectionId);}
  };
  const stepIssue=(delta:number)=>{if(docReview?.kind!=="issues")return;const index=Math.max(0,Math.min(reviewIssues.length-1,docReview.index+delta)),next=reviewIssues[index];if(!next)return;setDocReview({kind:"issues",index});if(next.sectionId!==section.id)move(next.sectionId);};
  const currentIssue=docReview?.kind==="issues"?reviewIssues[Math.min(docReview.index,reviewIssues.length-1)]:undefined;
  const move = (requestedId: string,heading?:string) => { const id=session.wikiSectionAliases?.[requestedId]??requestedId; setWikiHeadingTarget(heading?{id,title:heading,revision:performance.now()}:undefined); setOverview(false); const page = session.sections.find(item => item.id === id); const group = page ? wikiCategory(page) ?? "" : ""; update({ activeSectionId: id, ...(session.mode === "work" ? { wikiCollapsedGroups: { ...sessionRef.current?.wikiCollapsedGroups, [group]: false } } : {}), visitedSectionIds: [...new Set([...(session.visitedSectionIds ?? []), id])] }); setEditing(false); setNotesOpen(false); setFocusedEvidence(undefined); setNavigationRevision(value => value + 1); };
  openChapterRef.current = id => move(id);
  const complete = () => { const needs = { ...session.reviewNeeds }; delete needs[section.id]; update({ completedSectionIds: [...new Set([...session.completedSectionIds, section.id])], reviewNeeds: needs, visitedSectionIds: [...new Set([...(session.visitedSectionIds ?? []), section.id])] }); };
  const chapterStructure = <FocusChapterPath editing={editing} key={section.id} section={section} session={session} evidence={session.evidence} zh={zh} project={session.mode === "work"} onSave={saveChapterPath} onSource={id => { const ref = session.evidence.find(item => item.id === id); if (ref) openEvidence(ref); }} onLocate={(title, id, body) => { const headings = Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".chapter-guide :is(h1,h2,h3,h4,h5,h6)") ?? []); const index = Number(id.split(":").at(-1)); const heading = Number.isInteger(index) && headings[index]?.textContent === title ? headings[index] : headings.find(item => item.textContent === title); const lead = reviewLead(body); const paragraph = lead ? Array.from(bodyRef.current?.querySelectorAll<HTMLElement>(".chapter-guide :is(p,li,pre)") ?? []).find(item => item.textContent?.replace(/\s+/gu, " ").includes(lead.replace(/\s+/gu, " "))) : undefined; (heading ?? paragraph ?? bodyRef.current?.querySelector<HTMLElement>(".chapter-guide"))?.scrollIntoView?.({ block: "start", behavior: "smooth" }); }} />;
  const chapterEditor = editing ? <div className="focus-editor"><input aria-label={zh ? "章节标题" : "Section title"} value={section.title} onChange={(event) => update({ sections: session.sections.map((item) => item.id === section.id ? { ...item, title: event.target.value, userEdited: true } : item) })} /><textarea aria-label={zh ? "章节内容" : "Section content"} value={section.body} onChange={(event) => update({ sections: session.sections.map((item) => item.id === section.id ? { ...item, body: event.target.value, userEdited: true } : item) })} rows={14} /></div> : undefined;
  const sources = groups.flat();
  const space = canvases.find((item) => item.id === session.canvasId);
  const suggestedProjectName = [session.wikiSuggestedTitle, session.wikiKnowledge?.organization?.projectName].find(name => name?.trim() && name.trim() !== (savedProjectName || space?.title || space?.name || session.title).trim())?.trim();
  const translate = () => { const prompt = zh ? "仅将整个回顾的标题、目录、导读、过渡和项目概况翻译为简体中文。保留原有事实、章节顺序、来源引用及用户的修改，不增加建议或重新整理。代码、公式、专有名词及原文引用保持原样。" : "Translate only the result title, section titles, guides, transitions and project brief into English. Preserve all facts, section order, citations and user edits. Do not add proposals or reorganize. Keep code, formulas, proper names and source quotations unchanged."; setRevisionScope("whole"); setInstruction(prompt); void generate(session.goal, session.sourceConversationIds, true, prompt, false, "whole"); };
  const differentLanguage = Boolean(session.locale && session.locale !== locale) || zh && [session.title, ...session.sections.map((item) => item.title)].some((text) => !/\p{Script=Han}/u.test(text) && (text.match(/[a-zA-Z]{2,}/gu)?.length ?? 0) >= 3);
  const sourceConversation = conversations.find(item => item.id === (focusedEvidence?.conversationId ?? openSourceId));
  const sourceReadingOpen = Boolean(openSourceId || focusedEvidence && (session.mode !== "work" || fullSourceReader));
  const closeSourceReading = () => { if (fullSourceReader && session.mode === "work" && focusedEvidence) { setFullSourceReader(false); return; } setOpenSourceId(undefined); setFocusedEvidence(undefined); setFullSourceReader(false); };
  const openEvidence = (ref:FocusEvidence, options?:WorkspaceEvidenceOptions) => { if(session.mode!=="work"){setFocusedEvidence(ref);return;} const top=bodyRef.current?.scrollTop; setFullSourceReader(false); setOpenSourceId(undefined); setSourcesOpen(false); setNotesOpen(false); setMobileNavigation(false); const chapter=!overview?session.sections.find(item=>item.id===session.activeSectionId):undefined; setSourceSelection(options?.sectionId||options?.points?options:chapter?{...options,sectionId:chapter.id,references:chapterEvidence(session,chapter)}:options); setFocusedEvidence(ref); window.requestAnimationFrame(()=>{if(bodyRef.current&&top!==undefined)bodyRef.current.scrollTop=top;}); };
  const originalPanelOpen = Boolean(focusedEvidence && session.mode === "work" && !sourceReadingOpen);
  // A sentence's status is its mark: switching it marks every claim of that sentence in its chapter and records the
  // verdict on the units it states, so the next organizing and writing keep it. The prose is not touched.
  // A workspace check started from the overview goes on to the next chapter with points to look at.
  const nextReviewChapter = (() => {
    if (docReview?.kind !== "evidence" || docReview.sectionId !== section.id) return undefined;
    const chapters = documentReview(session, zh).unchecked, at = chapters.findIndex(item => item.sectionId === section.id), following = chapters[at + 1];
    if (!following) return undefined;
    const page = session.sections.find(item => item.id === following.sectionId);
    return { label: zh ? `下一章：${page?.wikiDisplayTitle || page?.title || ""}（还有 ${chapters.length - at - 1} 章）` : `Next chapter: ${page?.wikiDisplayTitle || page?.title || ""} (${chapters.length - at - 1} left)`,
      onNext: () => { setDocReview({ kind: "evidence", sectionId: following.sectionId, revision: Date.now() }); move(following.sectionId); } };
  })();
  const switchHolder = (point: EvidencePoint, holder: WikiHolder) => {
    const sectionId = sourceSelection?.sectionId ?? point.key.slice(0, point.key.lastIndexOf(":"));
    const page = session.sections.find(item => item.id === sectionId);
    const matching = page?.claims?.filter(claim => claim.text === point.claim) ?? [];
    if (!page || !matching.length) return;
    const verdict = holder === "decided" ? "confirmed" as const : holder === "open" ? "open" as const : holder === "earlier" ? "rejected" as const : undefined;
    const unitIds = [...new Set(matching.flatMap(claim => claim.unitIds ?? []))];
    // Answered: the sentence keeps its new status and is not asked about again.
    update({ sections: session.sections.map(item => item.id !== page.id ? item : { ...item, claims: item.claims?.map(claim => claim.text === point.claim ? { ...claim, holder, holderMark: true, userDecided: holder === "decided", checked: true } : claim) }),
      ...(unitIds.length && session.wikiKnowledge ? { wikiKnowledge: withDecision(session.wikiKnowledge, unitIds, verdict) } : {}) });
    setSourceSelection(value => value && { ...value, points: value.points?.map(item => item.key === point.key ? { ...item, holder, holderMark: true, checked: true } : item) });
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
  return <ProjectKnowledgeActions.Provider value={session.mode==="work"?{save:async update=>{const current=sessionRef.current;if(!current||current.id!==session.id)throw new Error("Project changed");await persistRoute(update(current));},read:move,matter:ref=>{const source=projectMatters(session).find(item=>item.id===ref.id&&item.type===ref.type)?.sources[0];if(source)openEvidence(source);else{setNotesOpen(false);setSourcesOpen(true);}}}:undefined}><WorkspaceEvidenceContext.Provider value={session.mode === "work" ? {open:openEvidence,close:()=>{setFocusedEvidence(undefined);setSourcesOpen(false);},active:originalPanelOpen?{...sourceSelection,shown:focusedEvidence}:undefined} : undefined}><div ref={setScopeReaderHost} className={`focus-workspace${originalPanelOpen?" has-original-panel":""}`}><div ref={readingBaseRef} className="project-reading-base" aria-hidden={sourceReadingOpen || undefined}><nav id="project-workspace-navigation" className={`reading-outline${mobileNavigation?" is-mobile-open":""}`} aria-label={zh ? "对话章节" : "Conversation chapters"} onClick={event=>{if((event.target as HTMLElement).closest(".outline-item"))setMobileNavigation(false);}} onKeyDown={event=>{if(event.key==="Escape"){setMobileNavigation(false);document.querySelector<HTMLButtonElement>(".project-mobile-nav-toggle")?.focus();}}}>
    <button type="button" className="project-mobile-nav-close" onClick={()=>setMobileNavigation(false)}>{zh?"关闭项目导航":"Close project navigation"}</button>
    <ReaderBackButton onClick={() => { void saves.flush().catch(() => undefined); onClose(); }} label={zh ? "返回工作台" : "Back to Workbench"} />
    <h2 title={session.title}>{readingTitle(session.title, 40)}</h2>{projectPicker}
    <button className="outline-item" aria-current={overview && !ledgerPage ? "page" : undefined} onClick={() => { setLedgerPage(false); setOverview(true); bodyRef.current?.scrollTo?.({ top: 0 }); }}><LayoutDashboard size={18} aria-hidden="true" /><strong>{session.mode === "work" ? zh ? "文档总览" : "Document overview" : zh ? "阅读总览" : "Reading overview"}</strong></button>
    {session.mode === "work" && session.wikiKnowledge?.organization ? <button className="outline-item" aria-current={overview && ledgerPage ? "page" : undefined} onClick={() => { setLedgerPage(true); setOverview(true); bodyRef.current?.scrollTo?.({ top: 0 }); }}><BookMarked size={18} aria-hidden="true" /><strong>{zh ? "知识点账本" : "Knowledge ledger"}</strong></button> : null}
    {session.mode!=="work"?<button type="button" className="outline-item" onClick={() => { setSourcesOpen(false); setNotesOpen(true); }}><NotebookPen size={18} aria-hidden="true" /><strong>{zh ? "我的笔记" : "My notes"}</strong></button>:null}
    <div className="project-navigation-tabs" role="tablist" aria-label={zh ? "项目目录" : "Project navigation"} onKeyDown={event => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return; event.preventDefault(); const next = event.key === "Home" ? "chapters" : event.key === "End" ? "sources" : navigationTab === "chapters" ? "sources" : "chapters"; setNavigationTab(next); event.currentTarget.querySelector<HTMLButtonElement>(`#project-${next}-tab`)?.focus(); }}>
      <button type="button" role="tab" id="project-chapters-tab" tabIndex={navigationTab === "chapters" ? 0 : -1} aria-controls="project-navigation-list" aria-selected={navigationTab === "chapters"} onClick={() => setNavigationTab("chapters")}>{session.mode === "work" ? "Wiki" : zh ? "章节" : "Chapters"}</button>
      <button type="button" role="tab" id="project-sources-tab" tabIndex={navigationTab === "sources" ? 0 : -1} aria-controls="project-navigation-list" aria-selected={navigationTab === "sources"} onClick={() => setNavigationTab("sources")}>{zh ? "来源" : "Sources"}<small>{session.sourceConversationIds.length}</small></button>
    </div>
    <div id="project-navigation-list" role="tabpanel" aria-labelledby={navigationTab === "chapters" ? "project-chapters-tab" : "project-sources-tab"} className="project-navigation-list">
      {navigationTab === "chapters" ? session.mode === "work" ? <ProjectWikiNavigation key={session.id} session={session} activeId={!overview ? section.id : undefined} zh={zh} onRead={move} adjusting={wikiAdjusting} onDone={() => setWikiAdjusting(false)} onCollapse={(group, collapsed) => update({ wikiCollapsedGroups: { ...sessionRef.current?.wikiCollapsedGroups, [group]: collapsed } })} onEdit={saveWikiPage} onMove={saveWikiOrder} onCreateGroup={saveWikiGroup} onCreatePage={createWikiPage} disabled={busy||editing} onDropPage={dropWikiPage} /> : session.sections.map((item, index) => <button key={item.id} className="outline-item" aria-current={!overview && item.id === section.id ? "step" : undefined} onClick={() => move(item.id)}><span>{session.mode === "work" ? index + 1 : session.completedSectionIds.includes(item.id) ? "✓" : session.reviewNeeds?.[item.id] ? "?" : index + 1}</span><strong>{item.title}{session.mode !== "work" && session.reviewNeeds?.[item.id] ? <small className="outline-review-need">{zh ? "待复习" : "Revisit"} · {session.reviewNeeds[item.id]}</small> : null}</strong></button>) : session.sourceConversationIds.map(id => <button type="button" key={id} className="outline-item outline-source-item" onClick={() => { void saves.flush().catch(() => undefined); setOpenSourceId(id); }}><FileText size={18} aria-hidden="true" /><strong>{conversations.find(item => item.id === id)?.title ?? session.evidence.find(item => item.conversationId === id)?.title ?? (zh ? "来源对话" : "Source conversation")}</strong></button>)}
    </div>
    {navigationTab === "sources" && session.mode === "work" && session.scope?.kind!=="goal" ? <div className="project-source-management"><button type="button" className="outline-item" disabled={busy} onClick={() => setSourcePickerOpen(true)}><FileText size={18} aria-hidden="true" /><strong>{zh ? "添加对话" : "Add conversations"}</strong></button></div> : null}
    {session.mode !== "work" ? <ReaderProgress zh={zh} completed={session.completedSectionIds.length} total={session.sections.length} work={false} /> : null}
    </nav>
    <div className={`focus-reader-main${notesOpen || sourcesOpen ? " has-utility-panel" : ""}`}>
    <div className="focus-reader-toolbar"><button type="button" className="project-mobile-nav-toggle" aria-controls="project-workspace-navigation" aria-expanded={mobileNavigation} onClick={()=>setMobileNavigation(!mobileNavigation)}>{zh?"项目导航":"Project navigation"}</button><div className="focus-reader-location">{renamingProject ? <form className="focus-project-rename" onSubmit={event => { event.preventDefault(); void renameProject(); }}><input autoFocus aria-label={zh ? "项目标题" : "Project title"} value={spaceName} maxLength={200} onChange={event => setSpaceName(event.target.value)} /><button className="primary" disabled={busy || !spaceName.trim()}>{zh ? "保存" : "Save"}</button><button type="button" disabled={busy} onClick={() => setRenamingProject(false)}>{zh ? "取消" : "Cancel"}</button>{suggestedProjectName ? <div className="project-rename-suggestion"><span>{zh ? "建议名称：" : "Suggested name:"}</span><button type="button" disabled={busy} aria-label={zh ? "采用建议名称" : "Use suggested name"} onClick={() => setSpaceName(suggestedProjectName.slice(0,200))}>{suggestedProjectName}</button></div> : null}</form> : <span>{savedProjectName || (space ? space.title ?? space.name : session.mode === "work" ? zh ? "项目工作" : "Project work" : zh ? session.sourceConversationIds.length > 1 ? "跨对话回顾" : "对话回顾" : session.sourceConversationIds.length > 1 ? "Cross-conversation review" : "Conversation review")}</span>}{!overview && session.mode !== "work" ? <small>{zh ? `第 ${position + 1}/${session.sections.length} 节 · 待理解 ${Math.max(0, session.sections.length - session.completedSectionIds.length)} 节` : `Section ${position + 1}/${session.sections.length} · ${Math.max(0, session.sections.length - session.completedSectionIds.length)} left to understand`}</small> : null}</div><div className={`focus-reader-toolbar-actions${session.mode === "work" ? " project-document-actions" : ""}`}>{!overview && session.mode !== "work" ? <button type="button" disabled={busy || session.completedSectionIds.includes(section.id)} onClick={complete}>{session.completedSectionIds.includes(section.id) ? zh ? "已理解" : "Reviewed" : zh ? "标记已理解" : "Mark understood"}</button> : null}{!renamingProject && !session.canvasId ? <button type="button" disabled={busy} onClick={() => void attach()}><Save size={15} aria-hidden="true" /><span>{zh ? "保存项目" : "Save project"}</span></button> : null}{session.mode === "work" && session.canvasId ? <button type="button" disabled={busy} title={zh ? "只读取新增或变化的对话，重写受影响的章节，先预览再采用" : "Read only new or changed messages, rewrite the chapters they touch, and preview before applying"} onClick={updateProject} aria-label={zh ? "增量更新" : "Update"}><RefreshCw size={15} aria-hidden="true" /><span>{zh ? "更新" : "Update"}</span></button> : null}{session.mode === "work" ? <button type="button" disabled={busy} onClick={() => void exportProject()} title={zh ? "导出项目" : "Export project"} aria-label={zh ? "导出" : "Export"}><Download size={15} aria-hidden="true" /><span>{zh ? "导出" : "Export"}</span></button> : null}<ReaderMoreMenu iconOnly={session.mode==="work"} flat={session.mode==="work"} zh={zh} sourcesLabel={zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"} onSources={session.mode==="work"?undefined:() => { setNotesOpen(false); setSourcesOpen(true); }} edits={[
      ...(session.canvasId && !renamingProject ? [{ label: zh ? "修改标题" : "Rename project", disabled: busy, run: () => { setSpaceName(savedProjectName || space?.title || space?.name || session.title); setRenamingProject(true); } }] : []),
      ...(session.mode === "work" ? [{ label: zh ? "调整目录" : "Edit directory", title: zh ? "在本地调整章节顺序、标题与分组，不调用模型" : "Reorder, rename and group chapters locally, without model calls", disabled: busy, run: () => { setNavigationTab("chapters"); setWikiAdjusting(true); setMobileNavigation(true); } }] : []),
      ...(session.mode!=="work" && !overview ? [{ label: editing ? zh ? "完成编辑" : "Done editing" : zh ? "编辑本节" : "Edit this section", disabled: busy, run: () => { if(editing)void finishChapterEdit();else setEditing(true); } }] : []),
      // Project Wikis use 重新整理 · 先预览 instead; other modes keep instruction-based revision.
      ...(session.mode!=="review"&&session.mode!=="work"?[{ label: zh ? "AI 调整内容" : "Revise with AI", disabled: busy, run: () => { setRevisionScope(overview ? "whole" : "section"); setRevisionIds([section.id]); setRevisionFailure(undefined); setFollowUpOpen(true); } }]:[]),
      ...(differentLanguage && session.mode!=="review" ? [{ label: zh ? "转换为中文 · 先预览" : "Translate to English · Preview", disabled: busy, run: translate }] : []),
    ]} maintenance={[
      // A ledger document is generated again from its extracted knowledge units: the directory is planned anew and every
      // chapter rewritten; Update in the toolbar handles only what changed.
      ...(session.mode==="work"?[session.wikiKnowledge?{ label: zh ? "重新生成 · 先预览" : "Regenerate · Preview", title: zh ? "复用已抽取的知识点，重新规划目录并重写全文；只处理变化部分请用「增量更新」" : "Reuses the extracted knowledge units, plans the directory again and rewrites every chapter; use Update for changes only", disabled: busy, run: reorganize }:{ label: zh ? "重新整理 · 先预览" : "Reorganize · Preview", disabled: busy, run: reorganize }]:[]),
      // Only after writing: a saved project, never while it is generated.
      ...(session.mode!=="work"?[{ label: zh ? "调整项目材料" : "Change project materials", disabled: busy, run: adjustSources }]:[]),
    ]} danger={deleteActions} /></div></div>
    <main className={`focus-reading-body${!overview ? " is-chapter-view" : ""}`} ref={bodyRef}><div className="reader-content">
      <div className="project-reading-document">
      {wikiRevisionProgress?<div className="project-analysis-running" role="status"><span>{zh?`${wikiRevisionProgress.stage==="preparing"?"正在准备完整材料":wikiRevisionProgress.stage==="planning"?"正在规划章节归属":wikiRevisionProgress.stage==="checking"?"正在核对修改预览":"正在调整内容"} · ${wikiRevisionProgress.done}/${wikiRevisionProgress.total}${wikiRevisionProgress.cached?` · 复用 ${wikiRevisionProgress.cached} 批缓存`:""}`:`${wikiRevisionProgress.stage==="preparing"?"Preparing complete material":wikiRevisionProgress.stage==="planning"?"Planning chapter ownership":wikiRevisionProgress.stage==="checking"?"Checking revision preview":"Revising content"} · ${wikiRevisionProgress.done}/${wikiRevisionProgress.total}${wikiRevisionProgress.cached?` · ${wikiRevisionProgress.cached} batches reused`:""}`}</span><button type="button" onClick={()=>controller.current?.abort()}>{zh?"取消":"Cancel"}</button></div>:null}
      {errorPanel}
      {projectSaveError ? <p className="project-save-error" role="alert">{projectSaveError} <button type="button" disabled={busy} onClick={() => void (renamingProject ? renameProject() : attach())}>{zh ? "重试保存" : "Retry save"}</button></p> : null}
      {session.mode!=="review"?<SourceUpdateNotice session={session} changes={changes} conversations={conversations} zh={zh} onUpdate={updateProject} />:null}


      {overview ? session.mode === "work" ? ledgerPage && session.wikiKnowledge?.organization ? <KnowledgeLedger session={session} zh={zh} onLocate={openEvidence} onApplyDecisions={updateProject}/> : <DocumentOverview onReview={startReview} onRename={name=>{setSpaceName(name);setRenamingProject(true);}} title={savedProjectName || space?.title || space?.name} key={session.id} session={session} zh={zh} onLocate={openEvidence} onRead={move} onSources={()=>{setNavigationTab("sources");setMobileNavigation(true);}} onMaintain={async projectMaintenance => { const current = sessionRef.current; if (current) await persistRoute({ ...current, projectMaintenance, updatedAt: Date.now() }); }} scope={session.wikiKnowledge?undefined:<WikiScopeNotice readerHost={focusedEvidence||sourceReadingOpen?null:scopeReaderHost} onRead={()=>{setFocusedEvidence(undefined);setSourceSelection(undefined);setFullSourceReader(false);}} key={`scope:${session.id}`} session={session} zh={zh} busy={busy} onRetry={()=>void generate(session.goal,session.sourceConversationIds,false,undefined,false,undefined,false,{includeKeys:session.wikiScopeReview?.includeKeys??[],excludeKeys:session.wikiScopeReview?.excludeKeys??[],ignoredKeys:session.wikiScopeReview?.ignoredKeys??[]})} onSource={openEvidence} onApply={choice=>void applyScopeChoice(choice)}/>}/>
       : <><FocusOverview showSourceNavigation={false} route={<ProjectUnderstanding adaptive onDelete={deleteUnderstandingCard} onAnalyze={session.mode==="review"?undefined:() => void structureAnalysis.analyze()} analyzing={structureAnalysis.running} analysisError={structureAnalysis.error} readingRoute={<FocusUnderstandingPath sections={session.sections} activeId={section.id} zh={zh} onRead={move} onSave={draft => saveRoute(draft, true)} onMove={moveRoute} />} session={session} zh={zh} onRead={move} onLocate={openEvidence} onSave={async projectUnderstanding => { const current = sessionRef.current; if (!current) throw new Error("No reading result"); await persistRoute({ ...current, projectUnderstanding, updatedAt: Date.now() }); }} />} session={session} conversations={conversations} zh={zh} onRead={move} onLocate={openEvidence} onOpenSource={(id) => { void saves.flush().catch(() => undefined); setOpenSourceId(id); }} onAdjustScope={session.mode!=="review" && session.scope?.kind === "goal" ? () => setPhase("scope") : undefined} onAnalyze={session.mode==="review"?undefined:() => void generate(session.goal, session.sourceConversationIds, false, undefined, true)} >{session.brief ? <FocusBrief hideOpenQuestions session={session} zh={zh} onOpenEvidence={setFocusedEvidence} onChange={(brief) => update({ brief, briefUserEdited: true })} /> : null}</FocusOverview></> : <>
      <WikiDocument scrollRef={bodyRef} key={section.id} issue={currentIssue&&currentIssue.sectionId===section.id?{issue:currentIssue,index:reviewIssues.indexOf(currentIssue),total:reviewIssues.length}:undefined} onIssueStep={stepIssue} onIssueClose={()=>setDocReview(undefined)} autoReview={docReview?.kind==="evidence"&&docReview.sectionId===section.id?docReview.revision:undefined} headingTarget={wikiHeadingTarget?.id===section.id?wikiHeadingTarget:undefined} section={section} session={session} zh={zh} updatedConversationIds={changes.filter(change => change.added || change.changed || change.removed || change.reordered).map(change => change.conversationId)} structure={chapterStructure} editor={chapterEditor} onEdit={()=>setEditing(true)} onLocate={openEvidence} onCurrent={() => setOverview(true)} onFinishEdit={()=>void finishChapterEdit()} />


      {session.mode !== "work" && session.completedSectionIds.length === session.sections.length ? <section className="focus-completed"><strong>{zh ? "本次阅读已完成" : "Review complete"}</strong></section> : null}
      </>}

      {status ? <div className="reader-save-status"><small role="status">{generationFailureReason(status,undefined,zh)}</small>{status.includes("失败") || status.startsWith("Save failed") ? <button onClick={() => void persist(session).catch(() => undefined)}>{zh ? "重试保存" : "Retry save"}</button> : null}</div> : null}
      </div>
    </div></main>
    {session.mode!=="work"?<aside hidden={!notesOpen} className="reader-utility-panel" aria-label={zh ? "我的笔记面板" : "My notes panel"} onKeyDown={event => { if (event.key === "Escape") { setNotesOpen(false); event.stopPropagation(); } }}>
      <header><h2>{zh ? "我的笔记" : "My notes"}</h2><div className="reader-notes-header-actions"><div ref={setNotesHeaderActions} /><button ref={notesCloseRef} type="button" aria-label={zh ? "关闭笔记" : "Close notes"} onClick={() => setNotesOpen(false)}><X size={18} /></button></div></header>
      <FocusNotes session={session} sectionId={overview ? undefined : section.id} zh={zh} open={notesOpen} onOpen={setNotesOpen} panelRef={notesRef} headerActionsHost={notesHeaderActions} onSave={saveNotes} onLocate={openEvidence} onRead={move} />
    </aside>:null}
    {sourcesOpen ? <aside className="reader-utility-panel" aria-label={zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"} onKeyDown={event => { if (event.key === "Escape") { setSourcesOpen(false); event.stopPropagation(); } }}>
      <header><h2>{zh ? overview ? "项目来源" : "本章来源" : overview ? "Project sources" : "Chapter sources"}</h2><button ref={sourcesCloseRef} type="button" aria-label={zh ? "关闭来源" : "Close sources"} onClick={() => setSourcesOpen(false)}><X size={18} /></button></header>
      <ChapterSources session={session} refs={overview ? session.evidence : sources} conversations={conversations} zh={zh} onLocate={openEvidence} />
    </aside> : null}
    </div>
    {followUpOpen ? <FocusFollowUp zh={zh} title={revisionScope === "whole" ? session.title : section.title} instruction={instruction} scope={revisionScope} chapters={session.mode==="work"?session.sections.map(chapter=>({id:chapter.id,title:chapter.wikiDisplayTitle||chapter.title,disabled:Boolean(chapter.origin||chapter.userEdited)})):undefined} currentId={section.id} selectedIds={revisionIds} onSelection={setRevisionIds} onInstruction={setInstruction} onScope={setRevisionScope} onClose={() => setFollowUpOpen(false)} onSubmit={() => { setFollowUpOpen(false); if(session.mode==="work")void reviseProjectWiki();else void generate(session.goal, session.sourceConversationIds, true); }}  /> : null}
    </div>
    {exportOpen ? <Suspense fallback={null}><ProjectExportDialog session={session} zh={zh} onClose={()=>setExportOpen(false)}/></Suspense> : null}
    {sourcePickerOpen ? <ProjectSourcePicker conversations={conversations} existingIds={session.sourceConversationIds} suggestedIds={session.sidecarConversationIds} zh={zh} onSync={()=>{setSourcePickerOpen(false);void saves.flush().then(()=>onReturnToWorkbench(session.goal,[...new Set([...session.sourceConversationIds,...session.sidecarConversationIds??[]])],session.mode)).catch(()=>setError(zh?"保存失败，请重试。":"Save failed; retry."));}} onClose={() => setSourcePickerOpen(false)} onConfirm={ids => { setSourcePickerOpen(false); void generate(session.goal, [...session.sourceConversationIds, ...ids], false, undefined, true); }} /> : null}
    {originalPanelOpen && focusedEvidence ? <WorkspaceSourcePanel conversationTitle={sourceConversation?.title} session={session} reference={focusedEvidence} references={sourceSelection?.references} sectionId={sourceSelection?.sectionId} quote={sourceSelection?.quote} claim={sourceSelection?.claim} points={sourceSelection?.points} pointIndex={sourceSelection?.pointIndex} onPoint={index=>{const points=sourceSelection?.points,point=points?.[index];if(point)openEvidence(point.reference,{references:point.references,quote:point.quote,claim:point.claim,points,pointIndex:index});}} zh={zh} onSelect={ref=>{setFocusedEvidence(ref);}} onClose={()=>{setFocusedEvidence(undefined);setSourceSelection(undefined);}} onReader={()=>setFullSourceReader(true)} onHolder={switchHolder} next={nextReviewChapter} /> : null}
    
    {sourceReadingOpen && sourceConversation ? <div ref={sourceOverlayRef} tabIndex={-1} className="project-source-reader" role="region" aria-label={zh ? "原文阅读" : "Original discussion reader"} onKeyDown={event => { if (event.key === "Escape") { closeSourceReading(); event.stopPropagation(); } }}><Suspense fallback={<p role="status">{zh ? "读取对话…" : "Loading conversation…"}</p>}><FocusSourceReader key={sourceConversation.id} conversation={sourceConversation} session={session} zh={zh} targetMessageId={focusedEvidence?.messageId} targetExcerpt={focusedEvidence?.excerpt} sourceVersionId={focusedEvidence?.sourceVersionId} onBack={closeSourceReading} evidenceSteps={readerEvidenceSteps} /></Suspense></div> : null}
    {sourceReadingOpen && !sourceConversation ? <div ref={sourceOverlayRef} tabIndex={-1} role="complementary" onKeyDown={event => { if (event.key === "Escape") { closeSourceReading(); event.stopPropagation(); } }} className="focus-context-panel" aria-label={zh ? "当时的问题与上下文" : "Original question and context"}><div className="focus-context-header"><ReaderBackButton onClick={closeSourceReading} label={zh ? "返回阅读原位置" : "Back to Brief / reading"} /><strong>{focusedEvidence?.title}</strong></div>{focusedEvidence ? <FocusDiscussion key={focusedEvidence.id} evidence={[focusedEvidence]} focusMessageId={focusedEvidence.messageId} focusExcerpt={focusedEvidence.excerpt} zh={zh} /> : <p>{zh ? "该来源已不在本地。" : "This source is no longer available locally."}</p>}</div> : null}
  </div></WorkspaceEvidenceContext.Provider></ProjectKnowledgeActions.Provider>;
}
