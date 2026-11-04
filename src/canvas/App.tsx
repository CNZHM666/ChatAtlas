import { NativeImportDialog } from "./components/NativeImportDialog";
import {ContextHandoffDialog} from "./components/ContextHandoffDialog";
import {readContextHandoff,removeContextHandoff,type ContextHandoff} from "../storage/context-handoff";
import { parseMessageSourceRange, parseReaderSearchContext, readerSearchContext, type MessageSourceRange, type ReaderSearchContext } from "../shared/message-location";
import { deleteProject, restoreProject, listDeletedProjects, isDeletedProject, emptyProjectTrash } from "../storage/project-deletion";
import { useAtlasSearch } from "./hooks/useAtlasSearch";
import { observeMessageSearchEvents } from "../search/message-search-events";
import type { SearchResult } from "../search/search-index";
import { groupFocusVersions,workspaceFocusVersions } from "./focus-versions";
import { lazy, startTransition, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AtlasMessage } from "../shared/messages";
import { OVERVIEW_CANVAS_ID } from "../shared/constants";
import type { AtlasCanvas, CanvasCard, CanvasEdge, Conversation, ConversationMessage, ImportJob, KnowledgeProposal, MessageAnchor, OrganizationPlan, SourceRef } from "../shared/types";
import { getAnchorsByIds } from "../storage/anchors";
import { listCanvases, renameCanvas as renameCanvasRecord, saveReadingPath } from "../storage/canvases";
import { getConversation, listConversations } from "../storage/conversations";
import { getMessagesForConversation, invalidateStoredMessageSearchIndex } from "../storage/messages";
import { getOrganizationPlan, saveOrganizationPlan } from "../storage/organization-plans";
import { isCurrentHydrationComplete } from "../sync/import-state";
import { applyKnowledgeProposal, cancelKnowledgeProposal, getLatestKnowledgeProposal, listSearchableKnowledgeCards, undoKnowledgeProposal } from "../storage/knowledge-graph";
import type { AutoOrganizeStage } from "./components/AutoOrganizePanel";
import { NewCardDialog } from "./components/NewCardDialog";
const SettingsPanel = lazy(() => import("./components/SettingsPanel").then((module) => ({ default: module.SettingsPanel })));
import { TopBar, type PrimaryView } from "./components/TopBar";
import { BackgroundSyncStatus } from "./components/BackgroundSyncStatus";
import { ReaderToolbarProvider } from "./components/ReaderToolbar";
import { MapSidebar } from "./components/MapSidebar";
import { ProposalActionBar } from "./components/ProposalActionBar";
import { useOrganizationTasks } from "./hooks/useOrganizationTasks";
import { useCanvasHistory } from "./hooks/useCanvasHistory";
import { attachConversationToTopic, createTopicFromConversation } from "./global-attachments";
import type { CanvasMode } from "./views/ConversationCanvas";
import { usePreferences } from "./preferences";
import { requestProviderPermission } from "../ai/provider";
import { deriveKnowledgeSpaceUiState, type KnowledgeBuildState } from "./atlas-status";
import { readerNeighbors, relatedKnowledge } from "./reader-path";
import { invalidateReaderMessages, readerMessages } from "./reader-message-cache";
import { useReadingHistory } from "./hooks/useReadingHistory";
import { useImportCommands } from "./hooks/useImportCommands";
import type { FocusMode, FocusScope, FocusSession } from "../shared/focus-session";
import { listDeletedFocusSessions, listFocusSessions, setFocusSessionDeleted } from "../storage/focus-sessions";
import type { GoalRequest } from "./components/FocusWorkspace";
import { ReviewHome } from "./components/ReviewHome";
import { listFocusGenerationTasks, recoverLegacyFocusTasks, type FocusGenerationTask } from "../storage/focus-generation-tasks";
import { projectReader } from "../storage/project-reader";
import { getDatabase } from "../storage/db";
import { useStableCallback } from "./hooks/useStableCallback";
import { OrganizationHistory } from "./components/OrganizationHistory";
import { recommendedReadingPath } from "./reader-path";
import { reconcileConversations } from "./conversation-refresh";

const SearchPalette = lazy(() => import("./components/SearchPalette").then((module) => ({ default: module.SearchPalette })));
const FlowProvider = lazy(() => import("./components/FlowProvider"));
const GlobalCanvas = lazy(() => import("./views/GlobalCanvas").then((module) => ({ default: module.GlobalCanvas })));

const ReadingSession = lazy(() => import("./components/ReadingSession").then((module) => ({ default: module.ReadingSession })));
const OriginalReader = lazy(() => import("./components/OriginalReader").then((module) => ({ default: module.OriginalReader })));
const FocusWorkspace = lazy(() => import("./components/FocusWorkspace").then((module) => ({ default: module.FocusWorkspace })));
const KnowledgeOverview = lazy(() => import("./views/KnowledgeOverview").then((module) => ({ default: module.KnowledgeOverview })));
const KnowledgeSpaceCreate = lazy(() => import("./components/KnowledgeSpaceCreate").then((module) => ({ default: module.KnowledgeSpaceCreate })));
const OrganizationTaskWorkspace = lazy(() => import("./components/OrganizationTaskWorkspace").then((module) => ({ default: module.OrganizationTaskWorkspace })));

function AtlasApp() {
  const { locale, t } = usePreferences();
  const [canvases, setCanvases] = useState<AtlasCanvas[]>([]);
  const [deletedProjects, setDeletedProjects] = useState<AtlasCanvas[]>([]);
  const [deletedVersions, setDeletedVersions] = useState<FocusSession[]>([]);
  const deletedProjectIds = useRef(new Set<string>());
  useEffect(() => { deletedProjectIds.current = new Set(deletedProjects.map(project => project.id)); }, [deletedProjects]);
  const [activeCanvasId, setActiveCanvasId] = useState(OVERVIEW_CANVAS_ID);
  const [view, setView] = useState<PrimaryView>("canvas");
  const viewRef = useRef(view);
  viewRef.current = view;
  const [structureView, setStructureView] = useState(false);
  const [discoverView, setDiscoverView] = useState(false);
  const history = useCanvasHistory(activeCanvasId, view === "canvas" && activeCanvasId !== OVERVIEW_CANVAS_ID);
  const [focusSessionsReady, setFocusSessionsReady] = useState(false);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [focusTasks, setFocusTasks] = useState<FocusGenerationTask[]>([]);
  useEffect(() => {
    let live = true; let revision = 0;
    const load = () => { const current = ++revision; void listFocusGenerationTasks().then(tasks => { if (live && current === revision) setFocusTasks(tasks); }).catch(() => undefined); };
    void recoverLegacyFocusTasks().then(load).catch(load); window.addEventListener("atlas-focus-tasks-changed", load);
    return () => { live = false; window.removeEventListener("atlas-focus-tasks-changed", load); };
  }, []);
  const atlasSearch = useAtlasSearch();
  const showSearch = atlasSearch.show;
  const [searchChapter, setSearchChapter] = useState<{ sessionId: string; sectionId: string; note: boolean; nonce: number }>();
  useEffect(() => { const shortcut = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); showSearch(); } }; window.addEventListener("keydown", shortcut); return () => window.removeEventListener("keydown", shortcut); }, [showSearch]);
  const [workbenchSelectedIds, setWorkbenchSelectedIds] = useState<Set<string>>(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem("atlas-workbench-project-sources") ?? "[]") as unknown;
      return new Set(Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : []);
    } catch { return new Set(); }
  });
  const [syncSelectedIds, setSyncSelectedIds] = useState<Set<string>>(() => {
    try { const saved: unknown = JSON.parse(localStorage.getItem("atlas-workbench-selected-conversations") ?? "[]"); return new Set(Array.isArray(saved) ? saved.filter((id): id is string => typeof id === "string") : []); } catch { return new Set(); }
  });
  const workbenchDraft = useRef<{ goal: string; mode: FocusMode }>({ goal: "", mode: "work" });
  const workbenchResumeTask = useRef<FocusGenerationTask>();
  const projectOpenRevision = useRef(0);
  const [projectOpening, setProjectOpening] = useState(false);
  useEffect(() => {
    try { window.localStorage.setItem("atlas-workbench-project-sources", JSON.stringify([...workbenchSelectedIds])); }
    catch { /* Browsing still works if local storage is unavailable. */ }
  }, [workbenchSelectedIds]);
  useEffect(() => { try { localStorage.setItem("atlas-workbench-selected-conversations", JSON.stringify([...syncSelectedIds])); } catch { /* Sync selection is optional. */ } }, [syncSelectedIds]);
  const [goalRequest, setGoalRequest] = useState<GoalRequest>();
  const [focusProgressTarget, setFocusProgressTarget] = useState<HTMLDivElement | null>(null);
  const [focusSessionId, setFocusSessionId] = useState<string>();
  useEffect(() => { void listFocusSessions().then(setFocusSessions).catch(() => undefined).finally(() => setFocusSessionsReady(true)); }, []);
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [newCardOpen, setNewCardOpen] = useState(false);
  const [focusRequest, setFocusRequest] = useState<{ id: string; nonce: number } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [capturedConversations, setCapturedConversations] = useState<Conversation[]>([]);
  const conversationRefreshInFlight = useRef(false);
  const conversationRefreshQueued = useRef(false);
  const conversationRefreshTimer = useRef<number | null>(null);
  const importProgressTimer = useRef<number | null>(null);
  const pendingImportProgress = useRef<ImportJob | null>(null);
  const messageRequestId = useRef(0);
  const selectedConversationRef = useRef<string | null>(null);
  const importedCacheVersion = useRef({ sessionId: "", persistedIds: new Set<string>(), pendingIds: new Set<string>() });
  const prioritizedCanvasIds = useRef(new Set<string>());
  const [conversationsReady, setConversationsReady] = useState(false);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [conversationMessages, setConversationMessages] = useState<ConversationMessage[]>([]);
  const [conversationFocusRequest, setConversationFocusRequest] = useState<{ message: ConversationMessage; nonce: number; excerpt?: string; sourceRange?: MessageSourceRange; search?:ReaderSearchContext } | null>(null);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [messageLoadError, setMessageLoadError] = useState<string>();
  const [globalMode, setGlobalMode] = useState<CanvasMode>("browse");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"ai" | "data">("data");
  const [aiSettingsRevision, setAISettingsRevision] = useState(0);
  useEffect(() => { const changed = () => setAISettingsRevision((revision) => revision + 1); window.addEventListener("atlas-ai-settings-changed", changed); return () => window.removeEventListener("atlas-ai-settings-changed", changed); }, []);
  const [sourcePickerRequest, setSourcePickerRequest] = useState<{ topicId: string; nonce: number } | null>(null);
  const [sourceFocusRequest, setSourceFocusRequest] = useState<{ topicId: string; nonce: number } | null>(null);
  const [detailAnchors, setDetailAnchors] = useState<MessageAnchor[]>([]);
  const [organizationPlan, setOrganizationPlan] = useState<OrganizationPlan | null>(null);
  const [organizeStage, setOrganizeStage] = useState<AutoOrganizeStage | null>(null);
  const [taskWorkspaceId, setTaskWorkspaceId] = useState<string | null>(null);
  const [taskHistoryOpen, setTaskHistoryOpen] = useState(false);
  const [taskSourceRefs, setTaskSourceRefs] = useState<SourceRef[] | null>(null);
  const [autoOrganizeUndo, setAutoOrganizeUndo] = useState<{ historyVersion: number; plan: OrganizationPlan } | null>(null);
  const [knowledgeProposal, setKnowledgeProposal] = useState<KnowledgeProposal | null>(null);
  const [searchableCards, setSearchableCards] = useState<CanvasCard[]>([]);
  const searchableCardsLoaded = useRef(false);
  const [knowledgeUndoId, setKnowledgeUndoId] = useState<string | null>(null);
  const [knowledgeCreateRequest, setKnowledgeCreateRequest] = useState<{ intent: string; conversationIds?: string[]; scopeCanvasId?: string } | null>(null);
  const readingHistory = useReadingHistory();
  const [readerTargetMessageId, setReaderTargetMessageId] = useState<string | undefined>();

  const openSettings = useCallback((tab: "ai" | "data") => {
    setSettingsInitialTab(tab);
    setSettingsOpen(true);
  }, []);
  useEffect(() => {
    const linked = () => { if (new URLSearchParams(location.hash.slice(1)).get("settings") === "ai") openSettings("ai"); };
    const listener = (message: AtlasMessage) => { if (message.type === "ATLAS_FOCUS_AI_SETTINGS") openSettings("ai"); };
    linked(); window.addEventListener("hashchange", linked);
    if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.onMessage.addListener(listener);
    return () => { window.removeEventListener("hashchange", linked); if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.onMessage.removeListener(listener); };
  }, [openSettings]);

  const selectedCard = useMemo(() => history.cards.find((card) => card.id === selectedCardId && card.canvasId === activeCanvasId) ?? null, [history.cards, selectedCardId, activeCanvasId]);
  const selectedAnchorIds = selectedCard?.anchorIds;
  useEffect(() => {
    let live = true;
    if (!selectedCardId || !selectedAnchorIds?.length) return;
    void getAnchorsByIds(selectedAnchorIds.filter((id) => !id.startsWith(`${selectedCardId}-anchor-`)))
      .then((anchors) => { if (live) setDetailAnchors(anchors); })
      .catch(() => { if (live) setDetailAnchors([]); });
    return () => { live = false; };
  }, [selectedCardId, selectedAnchorIds]);
  const visibleDetailAnchors = useMemo(() => selectedCardId && selectedAnchorIds?.length ? detailAnchors.filter((anchor) => selectedAnchorIds.includes(anchor.id)) : [], [selectedCardId, selectedAnchorIds, detailAnchors]);

  const flash = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  }, []);

  const refreshCapturedConversations = useCallback(() => {
    if (conversationRefreshInFlight.current) { conversationRefreshQueued.current = true; return; }
    const run = () => {
      conversationRefreshInFlight.current = true;
      void listConversations().then((items) => {
        startTransition(() => setCapturedConversations((current) => reconcileConversations(current, items)));
      }).catch(() => undefined).finally(() => {
        conversationRefreshInFlight.current = false;
        setConversationsReady(true);
        if (conversationRefreshQueued.current) { conversationRefreshQueued.current = false; run(); }
      });
    };
    run();
  }, []);
  const { importJob, setImportJob, importSource, setImportSource, fileImporting, commandImport, commandHydrate, openChatGPTForImport, pauseImport, resumeImport, importZip, importChoices, chooseImportSources, closeImportChoices } = useImportCommands({ flash, refreshConversations: refreshCapturedConversations });
  const importWorkbenchFile = (file: File) => {
    void importZip(file).then((ids) => {
      if (ids.length) flash(locale === "zh-CN" ? `已导入 ${ids.length} 条，请勾选本次使用的对话。` : `${ids.length} imported. Choose conversations for this task.`);
    });
  };

  const refreshCanvases = useCallback(() => {
    void listCanvases().then(setCanvases).catch(() => undefined);
    void listDeletedProjects().then(setDeletedProjects).catch(() => undefined);
    void listDeletedFocusSessions().then(setDeletedVersions).catch(() => undefined);
    if (searchableCardsLoaded.current) void listSearchableKnowledgeCards().then(setSearchableCards).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!atlasSearch.open && !discoverView && !readingHistory.recent.length) return;
    let live = true;
    searchableCardsLoaded.current = true;
    void listSearchableKnowledgeCards().then((cards) => { if (live) setSearchableCards(cards); }).catch(() => undefined);
    return () => { live = false; };
  }, [atlasSearch.open, discoverView, readingHistory.recent]);

  const tasks = useOrganizationTasks({
    conversations: capturedConversations, conversationsReady, canvases,
    onKnowledgeProposal: (proposal) => { setKnowledgeProposal(proposal); setOrganizeStage("preview"); },
    onApplied: () => { setKnowledgeProposal(null); setOrganizeStage(null); refreshCanvases(); },
    onError: flash,
  });

  const selectConversation = useCallback((id: string, entry: "map" | "reader" = "map") => {
    setStructureView(false);
    
    
    if (entry === "map") setConversationFocusRequest(null);
    setGoalRequest(undefined); setFocusSessionId(undefined);
    selectedConversationRef.current = id;
    const requestId = ++messageRequestId.current;
    setSelectedConversationId(id);
    setLoadingMessages(true);
    setMessageLoadError(undefined);
    setConversationMessages([]);
    void readerMessages(id)
      .then((messages) => { if (requestId === messageRequestId.current && selectedConversationRef.current === id) setConversationMessages(messages); })
      .catch((error: unknown) => { if (requestId === messageRequestId.current && selectedConversationRef.current === id) { setConversationMessages([]); setMessageLoadError(error instanceof Error ? error.message : String(error)); } })
      .finally(() => { if (requestId === messageRequestId.current && selectedConversationRef.current === id) setLoadingMessages(false); });
  }, []);

  const refreshConversationMessages = useCallback((id: string) => {
    const requestId = ++messageRequestId.current;
    void getMessagesForConversation(id).then((messages) => {
      if (requestId !== messageRequestId.current || selectedConversationRef.current !== id) return;
      setMessageLoadError(undefined);
      setConversationMessages((current) => {
        const byId = new Map(current.map((message) => [message.id, message]));
        const next = messages.map((message) => {
          const previous = byId.get(message.id);
          return previous && previous.content === message.content && previous.contentHash === message.contentHash && previous.role === message.role && previous.messageIndex === message.messageIndex ? previous : message;
        });
        return next.length === current.length && next.every((message, index) => message === current[index]) ? current : next;
      });
    }).catch((error: unknown) => { if (requestId === messageRequestId.current && selectedConversationRef.current === id) setMessageLoadError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (requestId === messageRequestId.current && selectedConversationRef.current === id) setLoadingMessages(false); });
  }, []);

  const openSidecarConversation = useCallback(async (id: string, messageId?: string, sourceRange?: MessageSourceRange, search?: ReaderSearchContext) => {
    const conversation = await getConversation(id).catch(() => undefined);
    setTaskWorkspaceId(null);
    setTaskHistoryOpen(false);
    if (conversation && isCurrentHydrationComplete(conversation)) {
      setView("conversations");
      selectConversation(id);
      if (messageId) {
        const db = await getDatabase();
        const target = (await db.getAllFromIndex("messages", "by-conversation", id)).find(item => item.id === messageId || item.platformMessageId === messageId);
        if (target && selectedConversationRef.current === id) setConversationFocusRequest({ message: target, sourceRange, search: search && { ...search, hits: search.hits.map(hit => hit.messageId === messageId ? { ...hit, messageId: target.id } : hit) }, nonce: Date.now() });
      }
      return;
    }
    // The Sidecar can open ChatAtlas before this conversation has been imported.
    // Keep the user in the workbench, where the source can be synced first.
    selectedConversationRef.current = null;
    messageRequestId.current++;
    setSelectedConversationId(null);
    setConversationMessages([]);
    setConversationFocusRequest(null);
    setStructureView(false);
    setDiscoverView(false);
    setActiveCanvasId(OVERVIEW_CANVAS_ID);
    setView("canvas");
    if (conversation) setSyncSelectedIds((current) => new Set([...current, id]));
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      void chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_PRIORITY", conversationId: id } satisfies AtlasMessage).catch(() => undefined);
    }
  }, [selectConversation]);

  useEffect(() => {
    const openLinkedConversation = () => {
      const params = new URLSearchParams(window.location.hash.slice(1)), id = params.get("conversation");
      if (id) void openSidecarConversation(id, params.get("message") ?? undefined, parseMessageSourceRange(params.get("location")), parseReaderSearchContext(params.get("search")));
    };
    openLinkedConversation();
    window.addEventListener("hashchange", openLinkedConversation);
    return () => window.removeEventListener("hashchange", openLinkedConversation);
  }, [openSidecarConversation]);

  const selectConversationFromUser = (id: string, entry: "map" | "reader" = "reader") => {
    selectConversation(id, entry);
    const item = capturedConversations.find((conversation) => conversation.id === id);
    if (item && (item.importState !== "complete" || item.hydrationState && item.hydrationState !== "hydrated") && typeof chrome !== "undefined" && chrome.runtime?.id) {
      prioritizedCanvasIds.current.add(id);
      void chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_PRIORITY", conversationId: id } satisfies AtlasMessage).catch(() => undefined);
    }
  };

  useEffect(() => {
    refreshCanvases();
    refreshCapturedConversations();
    void getLatestKnowledgeProposal().then((proposal) => { if (proposal) { setKnowledgeProposal(proposal); setOrganizeStage("preview"); } }).catch(() => undefined);
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    void chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_STATUS" } satisfies AtlasMessage).then((job: ImportJob | { error: string } | undefined) => { if (job && "status" in job) setImportJob(job); }).catch(() => undefined);
  }, [refreshCanvases, refreshCapturedConversations, setImportJob]);

  useEffect(() => {
    if (typeof chrome === "undefined" || !chrome.runtime?.id) return;
    const listener = (message: AtlasMessage) => {
      if (message.type === "ATLAS_FOCUS_CONVERSATION") {
        void openSidecarConversation(message.conversationId, message.messageId, message.sourceRange, readerSearchContext(message.search));
      }
      if (message.type === "ATLAS_CAPTURE_SAVED") {
        invalidateStoredMessageSearchIndex();
        invalidateReaderMessages(message.summary.conversationId);
        if (conversationRefreshTimer.current === null) conversationRefreshTimer.current = window.setTimeout(() => { conversationRefreshTimer.current = null; refreshCapturedConversations(); }, 1000);
        if (viewRef.current === "conversations" && message.summary.conversationId === selectedConversationId) refreshConversationMessages(selectedConversationId);
      }
      if (message.type === "ATLAS_IMPORT_PROGRESS") {
        const cacheVersion = importedCacheVersion.current;
        if (cacheVersion.sessionId !== message.job.sessionId) {
          cacheVersion.sessionId = message.job.sessionId;
          cacheVersion.persistedIds.clear();
          cacheVersion.pendingIds.clear();
        }
        const pendingIds = new Set(message.job.pendingIds);
        const newlyPersisted = message.job.persistedIds.filter((id) => !cacheVersion.persistedIds.has(id) || cacheVersion.pendingIds.has(id) && !pendingIds.has(id));
        cacheVersion.persistedIds = new Set(message.job.persistedIds);
        cacheVersion.pendingIds = pendingIds;
        if (newlyPersisted.length) {
          invalidateStoredMessageSearchIndex();
          newlyPersisted.forEach(invalidateReaderMessages);
        }
        const finished = !["connecting", "discovering", "syncing", "reconciling"].includes(message.job.status);
        const urgentProgress = Boolean(message.job.priorityPendingIds?.length || pendingImportProgress.current?.priorityPendingIds?.length);
        if (!fileImporting.current) {
          setImportSource("web");
          pendingImportProgress.current = message.job;
          if (finished || urgentProgress) {
            if (importProgressTimer.current !== null) window.clearTimeout(importProgressTimer.current);
            importProgressTimer.current = null;
            setImportJob(message.job);
          } else if (importProgressTimer.current === null) {
            importProgressTimer.current = window.setTimeout(() => {
              importProgressTimer.current = null;
              if (pendingImportProgress.current) startTransition(() => setImportJob(pendingImportProgress.current));
            }, 1200);
          }
        }
        if (finished || urgentProgress) {
          if (conversationRefreshTimer.current !== null) window.clearTimeout(conversationRefreshTimer.current);
          conversationRefreshTimer.current = null;
          refreshCapturedConversations();
        } else if (conversationRefreshTimer.current === null) conversationRefreshTimer.current = window.setTimeout(() => {
          conversationRefreshTimer.current = null;
          refreshCapturedConversations();
        }, 3000);
        if (viewRef.current === "conversations" && selectedConversationId && newlyPersisted.includes(selectedConversationId) && !pendingIds.has(selectedConversationId)) {
          refreshConversationMessages(selectedConversationId);
        }
      }
    };
    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
      if (conversationRefreshTimer.current !== null) { window.clearTimeout(conversationRefreshTimer.current); conversationRefreshTimer.current = null; }
      if (importProgressTimer.current !== null) { window.clearTimeout(importProgressTimer.current); importProgressTimer.current = null; }
    };
  }, [refreshCanvases, refreshCapturedConversations, openSidecarConversation, refreshConversationMessages, selectedConversationId, fileImporting, setImportJob, setImportSource]);

  useEffect(() => {
    let live = true;
    setOrganizationPlan(null);
    void getOrganizationPlan(activeCanvasId)
      .then((plan) => { if (live) setOrganizationPlan(plan ?? null); })
      .catch(() => { if (live) setOrganizationPlan(null); });
    return () => { live = false; };
  }, [activeCanvasId]);

  const deleteSelection = useCallback(() => {
    if (!selectedCardId && !selectedEdgeId) return;
    history.mutate((current) => ({
      cards: selectedCardId ? current.cards.filter((card) => card.id !== selectedCardId) : current.cards,
      edges: current.edges.filter((edge) => edge.id !== selectedEdgeId && edge.source !== selectedCardId && edge.target !== selectedCardId),
    }));
    setSelectedCardId(null);
    setSelectedEdgeId(null);
  }, [history, selectedCardId, selectedEdgeId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const editing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement;
      if (structureView && view === "canvas" && globalMode === "edit" && !editing && (event.key === "Delete" || event.key === "Backspace")) deleteSelection();
      if (structureView && !editing && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (view === "canvas") {
          if (event.shiftKey) history.redo();
          else if (autoOrganizeUndo?.historyVersion === history.historyVersion) {
            history.undo();
            setOrganizationPlan(autoOrganizeUndo.plan);
            void saveOrganizationPlan(autoOrganizeUndo.plan).catch(() => undefined);
            setAutoOrganizeUndo(null);
          } else history.undo();
        }

      }
      if (event.key === "Escape") {
        setNewCardOpen(false);
        setSelectedCardId(null);
        setSelectedEdgeId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [autoOrganizeUndo, deleteSelection, globalMode, history, view, structureView]);

  const createCard = (title: string, content: string) => {

    const rightmost = history.cards.reduce((maximum, card) => Math.max(maximum, card.x), 0);
    const id = crypto.randomUUID();
    const now = Date.now();
    const card: CanvasCard = {
      id,
      canvasId: activeCanvasId,
      kind: "concept",
      title,
      description: content,
      notes: content,
      origin: "user",
      x: rightmost + 318,
      y: 250,
      tags: [],
      anchorIds: [],
      conversationIds: [],
      createdAt: now,
      updatedAt: now,
    };
    history.mutate((current) => ({ ...current, cards: [...current.cards, card] }));
    setNewCardOpen(false);
    setSelectedCardId(id);
    setFocusRequest({ id, nonce: Date.now() });
  };

  const openAnchor = async (anchor: MessageAnchor) => {
    try {
      const messages = await getMessagesForConversation(anchor.conversationId);
      const message = messages.find((item) => item.id === anchor.messageId || item.platformMessageId === anchor.messageId)
        ?? messages.find((item) => item.messageIndex === anchor.messageIndex && item.role === anchor.role)
        ?? messages.find((item) => item.contentHash === anchor.contentHash && item.role === anchor.role);
      if (message) { selectConversationFromUser(anchor.conversationId, "reader"); setConversationFocusRequest({ message, nonce: Date.now() }); setView("conversations"); setSelectedCardId(null); }
      else flash(t("referenceUnavailable"));
    } catch { flash(t("referenceUnavailable")); }
  };

  const searchableConversations = capturedConversations;
  const activeConversation = searchableConversations.find((conversation) => conversation.id === selectedConversationId);
  useEffect(() => {
    if (view !== "conversations" || !activeConversation || prioritizedCanvasIds.current.has(activeConversation.id) || activeConversation.importState === "complete" && (!activeConversation.hydrationState || activeConversation.hydrationState === "hydrated") || typeof chrome === "undefined" || !chrome.runtime?.id) return;
    prioritizedCanvasIds.current.add(activeConversation.id);
    void chrome.runtime.sendMessage({ type: "ATLAS_IMPORT_PRIORITY", conversationId: activeConversation.id } satisfies AtlasMessage).catch(() => undefined);
  }, [view, activeConversation]);
  const selectedSourceIds = useMemo(() => new Set([...(selectedCard?.conversationIds ?? []), ...(selectedCard?.evidenceRefs ?? []).map((ref) => ref.conversationId), ...visibleDetailAnchors.map((anchor) => anchor.conversationId)]), [selectedCard, visibleDetailAnchors]);
  const activeSpace = canvases.find((canvas) => canvas.id === activeCanvasId);
  const confirmedScope = useMemo(() => activeSpace?.sourceConversationIds ? new Set(activeSpace.sourceConversationIds) : null, [activeSpace?.sourceConversationIds]);
  const selectedSources = useMemo(() => searchableConversations.filter((conversation) => selectedSourceIds.has(conversation.id) && (!confirmedScope || confirmedScope.has(conversation.id))), [searchableConversations, selectedSourceIds, confirmedScope]);
  const spaceContext = view === "canvas" && activeCanvasId !== OVERVIEW_CANVAS_ID;
  const contentsCards = useMemo(() => spaceContext ? history.cards.filter((card) => card.canvasId === activeCanvasId && !["conversation", "portal", "bridge", "conversation-root"].includes(card.kind)) : [], [history.cards, activeCanvasId, spaceContext]);
  const contentsById = useMemo(() => new Map(contentsCards.map((card) => [card.id, card])), [contentsCards]);
  const defaultContents = useMemo(() => contentsCards.length ? recommendedReadingPath(history.cards, history.edges).filter((card) => contentsById.has(card.id)) : [], [history.cards, history.edges, contentsCards, contentsById]);
  const contentsIds = useMemo(() => [...new Set([...(activeSpace?.readingPathCardIds ?? []).filter((id) => contentsById.has(id)), ...defaultContents.map((card) => card.id)])], [activeSpace?.readingPathCardIds, contentsById, defaultContents]);
  const selectedReaderPath = useMemo(() => selectedCard ? readerNeighbors(selectedCard.id, contentsCards, history.edges, contentsIds) : { previous: [], next: [] }, [selectedCard, contentsCards, history.edges, contentsIds]);
  const selectedRelated = useMemo(() => selectedCard ? relatedKnowledge(selectedCard.id, history.cards, history.edges, [selectedCard.id, ...selectedReaderPath.previous.map((item) => item.id), ...selectedReaderPath.next.map((item) => item.id)]) : [], [selectedCard, history.cards, history.edges, selectedReaderPath]);
  const readerPathCards = useMemo(() => history.cards.filter((card) => card.canvasId === activeCanvasId && card.kind !== "conversation" && card.kind !== "portal"), [history.cards, activeCanvasId]);

  const persistOrganizationPlan = (plan: OrganizationPlan) => {
    setOrganizationPlan(plan);
    void saveOrganizationPlan(plan).catch(() => undefined);
  };

  const markConversationsConfirmed = (conversationIds: string[]) => {
    if (!organizationPlan) return;
    const confirmed = new Set(conversationIds);
    const next: OrganizationPlan = {
      ...organizationPlan,
      reviewItems: organizationPlan.reviewItems.filter((item) => !confirmed.has(item.conversationId)),
      conversationStates: { ...organizationPlan.conversationStates },
      updatedAt: Date.now(),
    };
    for (const id of confirmed) next.conversationStates[id] = "confirmed";
    persistOrganizationPlan(next);
  };

  const openOrganizePicker = (conversationId?: string, clearSelection = false) => {
    setGoalRequest(undefined); setFocusSessionId(undefined);
    if (knowledgeProposal) { flash(t("organizePreviewPending")); return; }
    const scopeCanvasId = clearSelection || activeCanvasId === OVERVIEW_CANVAS_ID ? undefined : activeCanvasId;
    setView("canvas");
    setKnowledgeCreateRequest({ intent: scopeCanvasId ? canvases.find((canvas) => canvas.id === scopeCanvasId)?.title ?? "" : "", conversationIds: conversationId ? [conversationId] : undefined, scopeCanvasId });
  };

  const startKnowledgeFromIntent = (intent: string, conversationIds: string[], modelId: string, title: string) => {
    const selected = new Set(conversationIds);
    const ready = capturedConversations.filter((conversation) => selected.has(conversation.id) && isCurrentHydrationComplete(conversation));
    if (!ready.length || ready.length !== selected.size) { flash(t("conversationContentPending")); return; }
    const id = tasks.start({ title: title.trim(), intent: intent.trim(), modelId, targetType: "knowledge_space", targetIds: ready.map((item) => item.id), scopeCanvasId: knowledgeCreateRequest?.scopeCanvasId });
    setKnowledgeCreateRequest(null);
    setTaskWorkspaceId(id);
  };


  const cancelProposal = async () => {
    const associated = tasks.runs.find((run) => run.status === "waiting_review" && run.proposalId === knowledgeProposal?.id);
    if (associated) { await tasks.discard(associated); setActiveCanvasId(OVERVIEW_CANVAS_ID); return; }
    if (knowledgeProposal) await cancelKnowledgeProposal(knowledgeProposal.id);
    setKnowledgeProposal(null);
    setOrganizeStage(null);
    setActiveCanvasId(OVERVIEW_CANVAS_ID);
  };

  const openAppliedKnowledge = (proposal: KnowledgeProposal, selectedCanvasIds?: ReadonlySet<string>) => {
    setStructureView(false); setTaskWorkspaceId(null); setTaskHistoryOpen(false);
    const allowed = (id: string) => !selectedCanvasIds || selectedCanvasIds.has(id);
    const targetId = proposal.scopeUpdates?.find((update) => allowed(update.canvasId))?.canvasId
      ?? proposal.canvases.find((canvas) => allowed(canvas.id))?.id
      ?? proposal.memberships.find((membership) => allowed(membership.canvasId))?.canvasId;
    setActiveCanvasId(targetId ?? OVERVIEW_CANVAS_ID);
    setView("canvas");
    const pathId = proposal.scopeUpdates?.find((update) => update.canvasId === targetId)?.readingPathCardIds[0]
      ?? proposal.canvases.find((canvas) => canvas.id === targetId)?.readingPathCardIds?.[0];
    setSelectedCardId(pathId ?? proposal.memberships.find((membership) => membership.canvasId === targetId)?.cardId ?? null);
  };

  const commitProposal = async () => {
    if (!knowledgeProposal) return;
    const associated = tasks.runs.find((run) => run.status === "waiting_review" && run.proposalId === knowledgeProposal.id);
    if (associated) { try { await tasks.apply(associated, knowledgeProposal); setKnowledgeUndoId(knowledgeProposal.id); openAppliedKnowledge(knowledgeProposal); flash(t("knowledgeGenerated")); } catch (error) { flash(error instanceof Error ? error.message : String(error)); } return; }
    await applyKnowledgeProposal(knowledgeProposal);
    void import("../search/semantic-index").then(({ queueSemanticVectorRefresh }) => queueSemanticVectorRefresh(knowledgeProposal.analyzedConversationIds)).catch(() => undefined);
    setKnowledgeUndoId(knowledgeProposal.id);
    setKnowledgeProposal(null);
    setOrganizeStage(null);
    openAppliedKnowledge(knowledgeProposal);
    await refreshCanvases();
    flash(t("knowledgeGenerated"));
  };

  const undoCanvas = () => {
    if (knowledgeUndoId) {
      void undoKnowledgeProposal(knowledgeUndoId).then(async () => {
        setKnowledgeUndoId(null);
        setActiveCanvasId(OVERVIEW_CANVAS_ID);
        await refreshCanvases();
        flash(t("knowledgeUndoComplete"));
      });
      return;
    }
    if (autoOrganizeUndo?.historyVersion === history.historyVersion) {
      history.undo();
      persistOrganizationPlan(autoOrganizeUndo.plan);
      setAutoOrganizeUndo(null);
      return;
    }
    history.undo();
  };

  const attachConversation = (topicId: string, conversationId: string) => {
    const conversation = searchableConversations.find((item) => item.id === conversationId);
    const topic = history.cards.find((card) => card.id === topicId && (card.kind === "topic" || card.kind === "concept"));
    if (!conversation || !topic) return;
    history.mutate((current) => attachConversationToTopic(current, activeCanvasId, topicId, conversation, `conversation-card-${crypto.randomUUID()}`, `attachment-${crypto.randomUUID()}`, Date.now()));
    markConversationsConfirmed([conversationId]);
    flash(t("attachedToTopic", { title: conversation.title, topic: topic.title }));
  };

  const placeConversation = (conversationId: string, position: { x: number; y: number }) => {
    const conversation = searchableConversations.find((item) => item.id === conversationId);
    if (!conversation) return;
    const existing = history.cards.find((card) => card.kind === "conversation" && card.conversationIds.includes(conversationId));
    if (existing) {
      setSelectedCardId(existing.id);
      setFocusRequest({ id: existing.id, nonce: Date.now() });
      return;
    }
    const now = Date.now();
    const topicId = `topic-${crypto.randomUUID()}`;
    history.mutate((current) => createTopicFromConversation(
      current,
      activeCanvasId,
      conversation,
      { x: position.x - 116, y: position.y - 79 },
      { topicId, sourceCardId: `conversation-card-${crypto.randomUUID()}`, edgeId: `attachment-${crypto.randomUUID()}` },
      now,
    ));
    markConversationsConfirmed([conversationId]);
    setSelectedCardId(topicId);
    setFocusRequest({ id: topicId, nonce: now });
    flash(t("topicCreatedFromConversation", { title: conversation.title }));
  };

  const changeProjectDeletion = async (id: string, restore = false) => {
    try {
      await (restore ? restoreProject(id) : deleteProject(id));
      if (restore) deletedProjectIds.current.delete(id); else deletedProjectIds.current.add(id);
      projectOpenRevision.current++;
      refreshCanvases();
      setFocusSessions(await listFocusSessions());
      if (!restore && (activeCanvasId === id || activeFocus?.canvasId === id)) openSpace(OVERVIEW_CANVAS_ID);
      flash(locale === "zh-CN" ? restore ? "项目已恢复" : "项目已删除，可在回收站恢复" : restore ? "Project restored" : "Project deleted. Restore it from Trash.");
    } catch { flash(locale === "zh-CN" ? "操作未能完成，请重试。" : "Could not complete the action. Try again."); }
  };

  /** A deleted version goes to Trash; the reader moves to the project's newest remaining version. */
  const changeVersionDeletion = async (id: string, restore = false) => {
    try {
      const version = focusSessions.find(session => session.id === id) ?? deletedVersions.find(session => session.id === id);
      await setFocusSessionDeleted(id, !restore);
      const sessions = await listFocusSessions();
      setFocusSessions(sessions);
      refreshCanvases();
      if (!restore && activeFocus?.id === id) {
        const remaining = sessions.find(session => session.canvasId && session.canvasId === version?.canvasId);
        if (remaining) openFocus(remaining.id); else openSpace(version?.canvasId ?? OVERVIEW_CANVAS_ID);
      }
      flash(locale === "zh-CN" ? restore ? "版本已恢复" : "版本已删除，可在回收站恢复" : restore ? "Version restored" : "Version deleted. Restore it from Trash.");
    } catch { flash(locale === "zh-CN" ? "操作未能完成，请重试。" : "Could not complete the action. Try again."); }
  };
  const clearProjectTrash = async () => {
    await emptyProjectTrash();
    const [projects, versions, sessions] = await Promise.all([listDeletedProjects(), listDeletedFocusSessions(), listFocusSessions()]);
    setDeletedProjects(projects); setDeletedVersions(versions); setFocusSessions(sessions);
    refreshCanvases();
    flash(locale === "zh-CN" ? "回收站已清空" : "Trash emptied");
  };

  const renameMap = async (id: string, name: string) => {
    await renameCanvasRecord(id, name);
    refreshCanvases();
    flash(t("mapRenamed", { name }));
  };

  const proposalCanvases: AtlasCanvas[] = useMemo(() => (knowledgeProposal?.canvases ?? []).map((canvas) => ({ ...canvas, name: canvas.title })), [knowledgeProposal?.canvases]);
  const previewCanvasIds = useMemo(() => new Set(proposalCanvases.map((canvas) => canvas.id)), [proposalCanvases]);
  const realDomainIds = useMemo(() => new Set(searchableCards.map((card) => card.canvasId).filter((id) => id !== OVERVIEW_CANVAS_ID)), [searchableCards]);
  const realDomainCount = realDomainIds.size;
  const proposalDomainCount = useMemo(() => new Set([
    ...proposalCanvases.map((canvas) => canvas.id),
    ...(knowledgeProposal?.memberships.map((membership) => membership.canvasId) ?? []),
  ]).size, [proposalCanvases, knowledgeProposal?.memberships]);
  const conversationCounts = useMemo(() => ({
    ready: capturedConversations.filter(isCurrentHydrationComplete).length,
    failed: capturedConversations.filter((conversation) => conversation.importState === "failed").length,
  }), [capturedConversations]);
  const knowledgeBuildState: KnowledgeBuildState = tasks.runs.some((run) => run.status === "running" && run.targetType !== "conversation") ? "organizing"
    : knowledgeProposal ? "preview"
      : realDomainCount > 0 ? "organized"
        : "not_started";
  const knowledgeUiState = deriveKnowledgeSpaceUiState({
    syncState: importJob?.status ?? null,
    knowledgeBuildState,
    discoveredCount: Math.max(importJob?.discovered ?? 0, capturedConversations.length),
    persistedCount: conversationCounts.ready,
    failedCount: importJob?.failed ?? conversationCounts.failed,
    domainCount: realDomainCount,
    proposalDomainCount,
    hasImportedData: conversationCounts.ready > 0,
    lastSyncedAt: importJob?.lastSyncedAt,
  });
  // A user-owned space may contain saved results/sources before knowledge
  // cards exist. Its navigation must not depend on graph generation.
  const committedSidebarCanvases = canvases;
  const sidebarCanvases = [...committedSidebarCanvases, ...proposalCanvases.filter((canvas) => !committedSidebarCanvases.some((item) => item.id === canvas.id))];
  const proposalCards = useMemo(() => knowledgeProposal ? knowledgeProposal.memberships.filter((membership) => membership.canvasId === activeCanvasId).flatMap((membership) => {
    const card = knowledgeProposal.cards.find((item) => item.id === membership.cardId);
    if (!card) return [];
    return [{
      id: card.id, canvasId: activeCanvasId, kind: card.type, title: card.title, description: card.body, notes: card.notes,
      x: membership.x, y: membership.y, tags: card.tags, anchorIds: [], evidenceRefs: card.evidenceRefs,
      conversationIds: [...new Set(knowledgeProposal.sources.filter((source) => source.cardId === card.id).map((source) => source.conversationId))],
      createdAt: card.createdAt, updatedAt: card.updatedAt, origin: card.origin, userEdited: card.userEdited, homeCanvasId: card.homeCanvasId, ghost: true,
    } satisfies CanvasCard];
  }) : [], [knowledgeProposal, activeCanvasId]);
  const displayCards = useMemo(() => {
    const existingIds = new Set(history.cards.map((card) => card.id));
    return [...history.cards, ...proposalCards.filter((card) => !existingIds.has(card.id))];
  }, [history.cards, proposalCards]);
  const displayCardIds = useMemo(() => new Set(displayCards.map((card) => card.id)), [displayCards]);
  const proposalEdges: CanvasEdge[] = useMemo(() => (knowledgeProposal?.relations ?? []).filter((relation) => displayCardIds.has(relation.fromCardId) && displayCardIds.has(relation.toCardId)).map((relation) => ({
    id: relation.id, canvasId: activeCanvasId, source: relation.fromCardId, target: relation.toCardId,
    type: "suggested", relation: relation.type === "explains" ? "bridge" : "structural",
    knowledgeRelationType: relation.type, label: relation.label, evidenceRefs: relation.evidenceRefs, status: relation.status, createdAt: relation.createdAt,
  })), [knowledgeProposal?.relations, displayCardIds, activeCanvasId]);
  const displayEdges = useMemo(() => {
    const existingIds = new Set(history.edges.map((edge) => edge.id));
    return [...history.edges, ...proposalEdges.filter((edge) => !existingIds.has(edge.id))];
  }, [history.edges, proposalEdges]);
  const activeCanvas = sidebarCanvases.find((canvas) => canvas.id === activeCanvasId);
  const isOverview = activeCanvasId === OVERVIEW_CANVAS_ID || activeCanvas?.type === "overview";
  const isPreviewCanvas = previewCanvasIds.has(activeCanvasId);
  const activeTask = tasks.runs.find((run) => run.id === taskWorkspaceId);
  const openTask = (id: string, fromHistory = false) => { setGoalRequest(undefined); setFocusSessionId(undefined); setTaskWorkspaceId(id); setTaskHistoryOpen(fromHistory); setTaskSourceRefs(null); };
  const openTaskHistory = () => { setGoalRequest(undefined); setFocusSessionId(undefined); setTaskWorkspaceId(null); setTaskHistoryOpen(true); setTaskSourceRefs(null); };
  const applyTask = async (selection?: { canvasIds: ReadonlySet<string>; conversationIds: ReadonlySet<string> }) => {
    if (!activeTask) return;
    try { await tasks.apply(activeTask, knowledgeProposal, selection); if (activeTask.targetType === "conversation") selectConversation(activeTask.targetIds[0]); else { setKnowledgeUndoId(activeTask.proposalId ?? null); if (knowledgeProposal) openAppliedKnowledge(knowledgeProposal, selection?.canvasIds); } flash(t("knowledgeGenerated")); }
    catch (error) { flash(error instanceof Error ? error.message : String(error)); }
  };
  const discardTask = async () => {
    if (!activeTask) return;
    try { await tasks.discard(activeTask); if (activeTask.targetType !== "conversation") setActiveCanvasId(OVERVIEW_CANVAS_ID); }
    catch (error) { flash(error instanceof Error ? error.message : String(error)); }
  };

  const openSpace = (id: string) => {
    projectOpenRevision.current++; setProjectOpening(false);
    workbenchResumeTask.current = undefined;
    setGoalRequest(undefined); setFocusSessionId(undefined); setStructureView(false); setDiscoverView(false);
    setActiveCanvasId(id); setView("canvas"); setGlobalMode("browse"); setKnowledgeCreateRequest(null);
    setTaskWorkspaceId(null); setTaskHistoryOpen(false); setSelectedCardId(null); setSelectedEdgeId(null);
  };
  const openProject = async (id: string, created?: AtlasCanvas) => {
    if (id === OVERVIEW_CANVAS_ID) { openSpace(id); return; }
    const project = created ?? canvases.find(canvas => canvas.id === id);
    if (!project) return;
    openSpace(id);
    const revision = projectOpenRevision.current;
    setProjectOpening(true);
    try {
      const session = await projectReader(project);
      if (revision !== projectOpenRevision.current) return;
      setFocusSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
      setFocusSessionId(session.id);
    } catch { if (revision === projectOpenRevision.current) { openSpace(OVERVIEW_CANVAS_ID); flash(locale === "zh-CN" ? "项目未能读取，请重试。" : "Could not open the project. Try again."); } }
    finally { if (revision === projectOpenRevision.current) setProjectOpening(false); }
  };
  const continueProject = useStableCallback((id: string) => void openProject(id));
  const returnGoalToWorkbench = (goal: string, mode: FocusMode, sourceIds: string[] = [], resume?: FocusGenerationTask) => {
    workbenchDraft.current = { goal, mode:mode==="review"?"work":mode };
    setWorkbenchSelectedIds(new Set(sourceIds));
    openSpace(OVERVIEW_CANVAS_ID);
    workbenchResumeTask.current = resume;
  };
  const selectWorkbenchSources = (ids: Set<string>) => {
    setWorkbenchSelectedIds(ids);
  };
  const hydrateWorkbenchSources = async (ids: string[]) => {
    // Syncing content must not silently remove the source scope chosen by the user.
    return commandHydrate(ids);
  };
  const prioritizeWorkbenchSource = (id: string) => {
    setSyncSelectedIds(current => new Set([...current, id]));
    return commandHydrate([id]);
  };
  const startGoal = (goal: string, mode: FocusMode, sourceIds?: string[], scopeCanvasId?: string, scope?: FocusScope, resume?: FocusGenerationTask, sourcePoolIds?: string[],validatedSources?:Conversation[]) => {
    if(mode==="review"){returnGoalToWorkbench(goal,"work",sourceIds);return;}
    projectOpenRevision.current++; setProjectOpening(false);
    if (!sourceIds?.length || sourceIds.some((id) => !(validatedSources??capturedConversations).some((item) => item.id === id && isCurrentHydrationComplete(item)))) {
      returnGoalToWorkbench(goal, mode, sourceIds, resume);
      return;
    }
    workbenchDraft.current = { goal, mode };
    workbenchResumeTask.current = undefined;
    setGoalRequest({ id: resume?.id ?? crypto.randomUUID(), ...(resume ? { runId: resume.runId } : {}), goal, mode, sourceIds: [...sourceIds], sourcePoolIds, scopeCanvasId, scope: scope ?? { kind: "all", sourceConversationIds: [...sourceIds] } }); setFocusSessionId(undefined);
    setView("canvas"); setKnowledgeCreateRequest(null); setTaskWorkspaceId(null); setTaskHistoryOpen(false); setSelectedCardId(null); setGlobalMode("browse");
  };
  const [contextHandoff,setContextHandoff]=useState<ContextHandoff>();
  useEffect(()=>{let live=true,revision=0;const load=()=>{const run=++revision,id=new URLSearchParams(location.hash.slice(1)).get("prepare");if(!id){setContextHandoff(undefined);return;}void readContextHandoff(id).then(value=>{if(live&&run===revision)setContextHandoff(value);}).catch(()=>{if(live&&run===revision)setContextHandoff(undefined);});};load();window.addEventListener("hashchange",load);return()=>{live=false;window.removeEventListener("hashchange",load);};},[]);
  const closeContextHandoff=()=>{if(contextHandoff)void removeContextHandoff(contextHandoff.id).catch(()=>undefined);setContextHandoff(undefined);const params=new URLSearchParams(location.hash.slice(1));params.delete("prepare");window.history.replaceState(null,"",`${location.pathname}${params.size?"#"+params:""}`);};
  const openFocus = (id: string) => {
    setFocusRevisionRequest(undefined);
    projectOpenRevision.current++; setProjectOpening(false);
    setSearchChapter(undefined);
    setFocusSessionId(id); setGoalRequest(undefined); setView("canvas"); setKnowledgeCreateRequest(null);
    setTaskWorkspaceId(null); setTaskHistoryOpen(false); setSelectedCardId(null);
  };
  // The conversation list lives on the home page: leaving the reader, or opening conversations with none chosen,
  // goes there, to its source list.
  const [sourcesRequest, setSourcesRequest] = useState(0);
  const openSourceList = useStableCallback(() => { openSpace(OVERVIEW_CANVAS_ID); setSourcesRequest(Date.now()); });
  const refreshLibraryProjects = async () => {
    setFocusSessions(await listFocusSessions());
    refreshCanvases();
  };
  const [focusRevisionRequest, setFocusRevisionRequest] = useState<{ sessionId: string; nonce: number; instruction: string; poolIds?: string[] }>();
  const openLinkedReview = useStableCallback(async (sessionId: string, sectionId?: string) => {
    const revision = ++projectOpenRevision.current;
    try {
      const db = await getDatabase();
      const session = await db.get("focusSessions", sessionId);
      const project = session?.canvasId ? await db.get("canvases", session.canvasId) : undefined;
      if (revision !== projectOpenRevision.current) return;
      if (!session) { flash(locale === "zh-CN" ? "这个成果已被移除。" : "This saved reading was removed."); return; }
      if (session.deletedAt) { flash(locale === "zh-CN" ? "这个版本已删除，可在工作台回收站恢复。" : "This version was deleted. Restore it from Workbench Trash."); return; }
      if (project && isDeletedProject(project)) { flash(locale === "zh-CN" ? "项目已删除，可在工作台回收站恢复。" : "Project deleted. Restore it from Workbench Trash."); return; }
      setFocusSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
      openFocus(session.id);

      if (sectionId && session.sections.some(section => section.id === sectionId)) setSearchChapter({ sessionId, sectionId, note: false, nonce: Date.now() });
    } catch { if (revision === projectOpenRevision.current) flash(locale === "zh-CN" ? "读取成果失败，请重试。" : "Unable to load saved reading. Try again."); }
  });
  useEffect(() => {
    const linked = () => { const params = new URLSearchParams(window.location.hash.slice(1)); const id = params.get("review"); if (id) void openLinkedReview(id, params.get("section") ?? undefined); };
    linked(); window.addEventListener("hashchange", linked);
    const listener = (message: AtlasMessage) => { if (message.type === "ATLAS_FOCUS_REVIEW") void openLinkedReview(message.sessionId, message.sectionId); };
    if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.onMessage.addListener(listener);
    return () => { window.removeEventListener("hashchange", linked); if (typeof chrome !== "undefined" && chrome.runtime?.id) chrome.runtime.onMessage.removeListener(listener); };
  }, [openLinkedReview]);
  const selectSearchResult = (result: SearchResult) => {
    atlasSearch.close();
    setTaskWorkspaceId(null); setTaskHistoryOpen(false); setKnowledgeCreateRequest(null);
    if (result.kind === "section" || result.kind === "note") { openFocus(result.sessionId); setSearchChapter({ sessionId: result.sessionId, sectionId: result.sectionId, note: result.kind === "note", nonce: Date.now() }); }
    else if (result.kind === "message") { selectConversationFromUser(result.message.conversationId, "reader"); setConversationFocusRequest({ message: result.message, excerpt: result.excerpt, sourceRange: result.sourceRange, nonce: Date.now() }); setView("conversations"); setSelectedCardId(null); }
    else if (result.kind === "conversation") { selectConversationFromUser(result.id, "reader"); setView("conversations"); setSelectedCardId(null); }
    else if (result.kind === "anchor") { const anchor = atlasSearch.anchors.find((item) => item.id === result.id); if (anchor) void openAnchor(anchor); }
    else if (result.kind === "card" || result.kind === "mark") { const cardId = result.kind === "mark" ? result.cardId : result.id; const canvasId = result.canvasId; if (canvasId) { setGoalRequest(undefined); setFocusSessionId(undefined); setActiveCanvasId(canvasId); setView("canvas"); setDiscoverView(false); setStructureView(false); setSelectedCardId(cardId); setGlobalMode("browse"); setReaderTargetMessageId(result.kind === "mark" ? result.messageId : undefined); } }
  };
  const saveFocus = (session: FocusSession) => {
    // A pending write from a reader that just closed must not resurrect its deleted project.
    if (session.canvasId && deletedProjectIds.current.has(session.canvasId)) return;
    setFocusSessions((current) => [session, ...current.filter((item) => item.id !== session.id)].sort((a, b) => b.updatedAt - a.updatedAt));
    const previous = focusSessions.find((item) => item.id === session.id);
    if (session.canvasId && (previous?.canvasId !== session.canvasId || previous.sourceConversationIds.join("|") !== session.sourceConversationIds.join("|"))) refreshCanvases();
  };
  const conversationReviews = useMemo(() => focusSessions.filter((session) => session.sourceConversationIds.includes(selectedConversationId ?? "")), [focusSessions, selectedConversationId]);
  const activeFocus = focusSessions.find((session) => session.id === focusSessionId);
  const focusOpen = Boolean(goalRequest || activeFocus);
  useEffect(() => {
    if (view === "canvas" && !isOverview && !focusOpen && !projectOpening && !knowledgeCreateRequest && !activeTask && !taskHistoryOpen && !isPreviewCanvas && !selectedCard && !structureView) continueProject(activeCanvasId);
  }, [view, isOverview, focusOpen, projectOpening, knowledgeCreateRequest, activeTask, taskHistoryOpen, isPreviewCanvas, selectedCard, structureView, activeCanvasId, continueProject]);
  const showMapSidebar = view === "canvas" && !focusOpen && !knowledgeCreateRequest && !activeTask && !taskHistoryOpen && !selectedCard && (isOverview || structureView || isPreviewCanvas);
  const graphToolbarVisible = structureView && !focusOpen && !knowledgeCreateRequest && !activeTask && !taskHistoryOpen && !selectedCard
    && view === "canvas" && !isOverview;
  const canSwitchStructure = !focusOpen && !projectOpening && !knowledgeCreateRequest && !activeTask && !taskHistoryOpen && !selectedCard
    && view === "canvas" && !isOverview
    && (!structureView || graphToolbarVisible);
  const resumeReading = (entry: { canvasId: string; cardId: string; messageId?: string }) => {
    openSpace(entry.canvasId); setReaderTargetMessageId(entry.messageId); setSelectedCardId(entry.cardId);
  };
  const recentReading = readingHistory.recent.flatMap((entry) => {
    const card = searchableCards.find((item) => item.id === entry.cardId);
    const space = canvases.find((item) => item.id === entry.canvasId);
    return card && space ? [{ ...entry, title: card.title, spaceTitle: space.title ?? space.name }] : [];
  });

  return (
    <div className={`app-shell ${showMapSidebar ? "is-canvas-view" : ""}`}>
      <TopBar
        generationProgressRef={setFocusProgressTarget}
        syncStatus={<BackgroundSyncStatus job={importJob} source={importSource} onPause={() => void pauseImport()} onResume={() => void resumeImport()} onConnect={() => void openChatGPTForImport()} />}
        view={view}
        onHome={() => openSpace(OVERVIEW_CANVAS_ID)}
        structureView={structureView}
        onStructureChange={canSwitchStructure ? (next) => { setStructureView(next); setGlobalMode("browse"); setSelectedCardId(null); } : undefined}
        onNewCard={() => setNewCardOpen(true)}
        onUndo={undoCanvas}
        onRedo={history.redo}
        canUndo={view === "canvas" && (history.canUndo || Boolean(knowledgeUndoId))}
        canRedo={view === "canvas" && history.canRedo}
        mode={view === "canvas" && !isOverview ? globalMode : "browse"}
        onModeChange={(mode) => {
          if (view === "canvas" && !isOverview) setGlobalMode(mode);
          flash(mode === "edit" ? t("editModeToast") : t("browseModeToast"));
        }}
        minimal={false}
        onSettings={() => openSettings("data")}
        allowEdit={graphToolbarVisible}
        organizeProgress={null}
      />
      <div className="workspace-shell">
        {showMapSidebar ? <MapSidebar
          canvases={sidebarCanvases}
          activeId={activeCanvasId}
          onSelect={(id) => void openProject(id)}
          onRename={(id, name) => void renameMap(id, name)}
          onDelete={id => void changeProjectDeletion(id)} deletedProjects={deletedProjects} onRestore={id => void changeProjectDeletion(id, true)}
          deletedVersions={deletedVersions} onRestoreVersion={id => void changeVersionDeletion(id, true)} onEmptyTrash={clearProjectTrash}
          previewIds={previewCanvasIds}
          tasks={tasks.runs}
          activeTaskId={taskWorkspaceId}
          onSelectTask={openTask}
          onTaskHistory={openTaskHistory}
        /> : null}
        <div className={`workspace ${!structureView && !isOverview && view === "canvas" && !focusOpen && !knowledgeCreateRequest ? "contents-workspace" : ""} ${selectedCard && view === "canvas" && !taskWorkspaceId && !taskHistoryOpen && !focusOpen ? globalMode === "browse" && selectedCard.kind !== "conversation" && selectedCard.kind !== "portal" ? "reader-open" : "detail-open" : ""}`}>
        <Suspense fallback={<div className="workspace-loading" role="status">{locale === "zh-CN" ? "正在打开…" : "Opening…"}</div>}>
        {projectOpening ? <main className="project-opening" role="status">{locale === "zh-CN" ? "读取项目…" : "Opening project…"}</main> : focusOpen ? <FocusWorkspace onDeleteVersion={id => changeVersionDeletion(id)} onDeleteProject={id => void changeProjectDeletion(id)} headerProgressTarget={focusProgressTarget} key={goalRequest?.id ?? activeFocus!.id} request={goalRequest} initialSession={activeFocus} revisionRequest={focusRevisionRequest?.sessionId === activeFocus?.id ? focusRevisionRequest : undefined} projectSessions={activeFocus?workspaceFocusVersions(focusSessions,activeFocus).filter(session=>(!focusRevisionRequest?.poolIds||focusRevisionRequest.sessionId!==activeFocus.id||session.sourceConversationIds.every(id=>focusRevisionRequest.poolIds!.includes(id)))):[]} availableSessions={focusSessions.filter(session=>(!focusRevisionRequest?.poolIds||focusRevisionRequest.sessionId!==activeFocus?.id||session.sourceConversationIds.every(id=>focusRevisionRequest.poolIds!.includes(id))))} onOpenSession={(id, sectionId, note = false) => { openFocus(id); if (sectionId) setSearchChapter({ sessionId: id, sectionId, note, nonce: Date.now() }); }} searchTarget={searchChapter?.sessionId === activeFocus?.id ? searchChapter : undefined} conversations={capturedConversations} canvases={canvases} settingsRevision={aiSettingsRevision} onClose={() => openSpace(OVERVIEW_CANVAS_ID)} onReturnToWorkbench={(goal, ids, mode) => returnGoalToWorkbench(goal, mode ?? goalRequest?.mode ?? activeFocus?.mode ?? "work", goalRequest?.sourcePoolIds ?? ids, focusTasks.find(task => task.id === goalRequest?.id && task.status !== "preview"))} onSettings={() => openSettings("ai")} onSaved={saveFocus} /> : knowledgeCreateRequest ? <KnowledgeSpaceCreate conversations={capturedConversations} initialIntent={knowledgeCreateRequest.intent} initialConversationIds={knowledgeCreateRequest.conversationIds} excludedConversationIds={knowledgeCreateRequest.scopeCanvasId ? new Set([...(canvases.find((canvas) => canvas.id === knowledgeCreateRequest.scopeCanvasId)?.sourceConversationIds ?? []), ...history.cards.filter((card) => card.canvasId === knowledgeCreateRequest.scopeCanvasId).flatMap((card) => card.conversationIds)]) : undefined} settingsRevision={aiSettingsRevision} onClose={() => setKnowledgeCreateRequest(null)} onConfigureAI={() => openSettings("ai")} onConfirm={startKnowledgeFromIntent} /> : activeTask ? <OrganizationTaskWorkspace
          run={activeTask} conversations={capturedConversations} knowledgeProposal={knowledgeProposal} canvasNames={Object.fromEntries(canvases.map((canvas) => [canvas.id, canvas.title ?? canvas.name]))} sourceRefs={taskSourceRefs} onSourceRefs={setTaskSourceRefs}
          onBack={() => { setTaskWorkspaceId(null); setTaskSourceRefs(null); }}
          onApply={() => void applyTask()} onApplySelected={(selection) => void applyTask(selection)} onDiscard={() => void discardTask()}
          onViewChanges={() => { if (activeTask.targetType !== "conversation") { setTaskWorkspaceId(null); setTaskSourceRefs(null); setView("canvas"); setActiveCanvasId(OVERVIEW_CANVAS_ID); } }}
          onRetry={() => tasks.retry(activeTask)}
          onCancel={() => tasks.cancel(activeTask)}
          onConfigureAI={() => openSettings("ai")}
          onSelectSources={() => { setTaskWorkspaceId(null); setTaskSourceRefs(null); setActiveCanvasId(OVERVIEW_CANVAS_ID); setKnowledgeCreateRequest({ intent: activeTask.intent ?? "", conversationIds: activeTask.targetIds, scopeCanvasId: activeTask.scopeCanvasId }); }}
          onAuthorize={activeTask.permissionBaseUrl ? () => { void requestProviderPermission(activeTask.permissionBaseUrl!, activeTask.permissionModelsUrl).then((allowed) => { if (allowed) tasks.retry(activeTask); else flash(t("providerPermissionDenied")); }).catch((error) => flash(error instanceof Error ? error.message : String(error))); } : undefined}
          queuedBehindReview={activeTask.status === "queued" && activeTask.targetType !== "conversation" && tasks.runs.some((run) => run.id !== activeTask.id && run.status === "waiting_review" && run.targetType !== "conversation")}
          onOpenConversation={(id, message) => { selectConversationFromUser(id, message ? "reader" : "map"); setConversationFocusRequest(message ? { message, nonce: Date.now() } : null); setView("conversations"); setTaskWorkspaceId(null); setTaskSourceRefs(null); }}
        /> : taskHistoryOpen ? <OrganizationHistory runs={tasks.runs} onBack={() => setTaskHistoryOpen(false)} onSelect={(id) => openTask(id, true)} /> : view === "canvas" ? (isOverview ? (
          !discoverView ? <ReviewHome onReadConversation={(id, message, sourceRange, search) => { selectConversationFromUser(id, "reader"); setConversationFocusRequest(message ? { message, sourceRange, search, nonce: Date.now() } : null); setView("conversations"); setTaskWorkspaceId(null); setTaskSourceRefs(null); }} canvases={canvases} sessions={focusSessions} projectsReady={focusSessionsReady} conversations={capturedConversations} organizationRuns={tasks.runs} focusTasks={focusTasks} onContinueTask={(task) => task.needsConfirmation ? returnGoalToWorkbench("", task.mode, task.sourceIds, task) : startGoal(task.goal, task.mode, task.sourceIds, task.scopeCanvasId, task.scope, task)} onTask={openTask} importJob={importJob} importSource={importSource} selectedIds={workbenchSelectedIds} onSelectedIds={selectWorkbenchSources} syncSelectedIds={syncSelectedIds} onSyncSelectedIds={setSyncSelectedIds} onPrioritize={prioritizeWorkbenchSource} draft={workbenchDraft.current} onDraft={(next) => { workbenchDraft.current = next; }} recentReading={recentReading} resumeTask={workbenchResumeTask.current} onContinueProject={(session, instruction, poolIds) => { openFocus(session.id); setFocusRevisionRequest({ sessionId: session.id, nonce: Date.now(), instruction, poolIds }); }} onStart={(goal, mode, sourceIds, scope, poolIds) => startGoal(goal, mode, sourceIds, workbenchResumeTask.current?.scopeCanvasId, scope, workbenchResumeTask.current, poolIds)} onSession={openFocus} onOpenChapter={(sessionId, sectionId) => { openFocus(sessionId); setSearchChapter({ sessionId, sectionId, note: false, nonce: Date.now() }); }} onTaskHistory={openTaskHistory} onResume={resumeReading} onSpace={openSpace} onScan={() => void commandImport("titles")} onHydrate={hydrateWorkbenchSources} onZip={importWorkbenchFile} onPause={() => void pauseImport()} onResumeImport={() => void resumeImport()} onConnect={() => void openChatGPTForImport()} onDiscover={() => setDiscoverView(true)} onConfigureAI={() => openSettings("ai")} onProjectsChanged={refreshLibraryProjects} sourcesRequest={sourcesRequest} /> : <KnowledgeOverview
            canvases={sidebarCanvases}
            recentReading={readingHistory.recent.flatMap((entry) => {
              const card = searchableCards.find((item) => item.id === entry.cardId);
              const space = canvases.find((item) => item.id === entry.canvasId);
              return card && space ? [{ ...entry, title: card.title, spaceTitle: space.title ?? space.name }] : [];
            })}
            onResume={resumeReading}
            proposal={knowledgeProposal}
            uiState={knowledgeUiState}
            onSelect={(id) => void openProject(id)}
            onStartSync={() => { setDiscoverView(false); void commandImport("titles"); }}
            onStartCreate={() => openOrganizePicker(undefined, true)}
            onImportFile={(file) => { setDiscoverView(false); importWorkbenchFile(file); }}
            onRetrySync={() => void commandImport("titles")}
            onReconnect={() => void openChatGPTForImport()}
            onViewDetails={() => setDiscoverView(false)}
          />
        ) : (
          !structureView && !isPreviewCanvas ? selectedCard ? null : <main className="project-opening" role="status">{locale === "zh-CN" ? "读取项目…" : "Opening project…"}</main> : <FlowProvider key={`global-${activeCanvasId}`}>
            <GlobalCanvas
              mode={isPreviewCanvas ? "browse" : globalMode}
              canvasId={activeCanvasId}
              cards={displayCards}
              edges={displayEdges}
              selectedCardId={selectedCardId}
              selectedEdgeId={selectedEdgeId}
              focusRequest={focusRequest}
              syncComplete={importJob?.status === "completed" && capturedConversations.every((conversation) => conversation.importState !== "discovered")}
              onSelectedCard={(id) => { setReaderTargetMessageId(undefined); setSelectedCardId(id); }}
              onSelectedEdge={setSelectedEdgeId}
              onPositions={history.updatePositions}
              onSmartOrganize={openOrganizePicker}
              onBeginDrag={history.beginDrag}
              onFinishDrag={history.finishDrag}
              onCreateEdge={(edge, alignment) => history.mutate((current) => ({ ...current, cards: alignment ? current.cards.map((card) => card.id === alignment.id ? { ...card, x: alignment.x, y: alignment.y, layoutLocked: true, updatedAt: Date.now() } : card) : current.cards, edges: [...current.edges, edge] }))}
              onUpdateEdgeLabel={(id, label) => history.mutate((current) => ({ ...current, edges: current.edges.map((edge) => edge.id === id ? { ...edge, label } : edge) }))}
              onInsertBridge={(id) => history.mutate((current) => {
                const edge = current.edges.find((item) => item.id === id);
                const source = current.cards.find((card) => card.id === edge?.source);
                const target = current.cards.find((card) => card.id === edge?.target);
                if (!edge || !source || !target) return current;
                const now = Date.now();
                const bridgeId = `bridge-${crypto.randomUUID()}`;
                return {
                  cards: [...current.cards, { id: bridgeId, canvasId: activeCanvasId, kind: "bridge", title: edge.label || t("defaultBridgeTitle"), x: (source.x + target.x) / 2, y: (source.y + target.y) / 2, tags: [], anchorIds: [], conversationIds: [], origin: "user", createdAt: now, updatedAt: now }],
                  edges: [...current.edges.filter((item) => item.id !== id),
                    { id: `edge-${crypto.randomUUID()}`, canvasId: activeCanvasId, source: source.id, target: bridgeId, type: "manual", relation: "bridge", knowledgeRelationType: "explains", createdAt: now },
                    { id: `edge-${crypto.randomUUID()}`, canvasId: activeCanvasId, source: bridgeId, target: target.id, type: "manual", relation: "bridge", knowledgeRelationType: "leads_to", createdAt: now }],
                };
              })}
              onRenameCard={(id, title) => history.mutate((current) => ({ ...current, cards: current.cards.map((card) => card.id === id ? { ...card, title, updatedAt: Date.now() } : card) }))}
              onOpenConversation={(conversationId) => {
                selectConversationFromUser(conversationId);
                setView("conversations");
              }}
              conversations={searchableConversations}
              onAttachConversation={attachConversation}
              onPlaceConversation={placeConversation}
              onCreateTopic={() => { setGlobalMode("edit"); setNewCardOpen(true); }}
              onShowSources={(topicId) => { setSelectedCardId(topicId); setSourceFocusRequest({ topicId, nonce: Date.now() }); }}
              sourcePickerRequest={sourcePickerRequest}
              preview={Boolean(knowledgeProposal)}
              onOpenPortal={(canvasId, cardId) => {
                setActiveCanvasId(canvasId);
                setSelectedCardId(cardId);
                setFocusRequest({ id: cardId, nonce: Date.now() });
              }}
            />
          </FlowProvider>
        )) : activeConversation ? (
          <OriginalReader key={activeConversation.id} conversation={activeConversation} conversations={searchableConversations} messages={conversationMessages} loading={loadingMessages} error={messageLoadError} targetMessageId={conversationFocusRequest?.message.conversationId === activeConversation.id ? conversationFocusRequest.message.id : undefined} targetExcerpt={conversationFocusRequest?.excerpt} targetRange={conversationFocusRequest?.sourceRange} searchContext={conversationFocusRequest?.message.conversationId === activeConversation.id ? conversationFocusRequest.search : undefined} onRetry={() => selectConversation(activeConversation.id, "reader")} reviews={conversationReviews} onOpenReview={openFocus} onOpenChapter={(sessionId, sectionId) => { openFocus(sessionId); setSearchChapter({ sessionId, sectionId, note: false, nonce: Date.now() }); }} onBack={() => { selectedConversationRef.current = null; messageRequestId.current++; setSelectedConversationId(null); setConversationMessages([]); setConversationFocusRequest(null); }} />
        ) : selectedConversationId ? <main className="original-reading-body" role="status"><button className="original-back" onClick={() => { selectedConversationRef.current = null; messageRequestId.current++; setSelectedConversationId(null); }}>{locale === "zh-CN" ? "← 全部对话" : "← All conversations"}</button><p>{conversationsReady ? locale === "zh-CN" ? "这条对话的本地资料尚未就绪。同步完成后会自动显示。" : "This conversation is not available locally yet. It will appear after syncing." : locale === "zh-CN" ? "正在打开对话…" : "Opening conversation…"}</p></main> : <SourceListRedirect onOpen={openSourceList} />}
        {!focusOpen && !knowledgeCreateRequest && !taskWorkspaceId && !taskHistoryOpen && selectedCard && view === "canvas" && !isOverview && !isPreviewCanvas ? <ReadingSession key={activeCanvasId} card={selectedCard} space={activeSpace} cards={readerPathCards} edges={history.edges} sources={selectedSources} anchors={visibleDetailAnchors} previous={selectedReaderPath.previous} next={selectedReaderPath.next} related={selectedRelated} mode={globalMode} initialMessageId={readerTargetMessageId} sourceFocusNonce={sourceFocusRequest?.topicId === selectedCard.id ? sourceFocusRequest.nonce : undefined} onSelectCard={(id) => { setReaderTargetMessageId(undefined); setSelectedCardId(id); }} onClose={() => setSelectedCardId(null)} onSavePath={async (ids) => { if (!activeSpace) return; const updated = await saveReadingPath(activeSpace.id, ids); setCanvases((current) => current.map((canvas) => canvas.id === updated.id ? updated : canvas)); }} onNotesChange={(notes) => history.updateCardNotes(selectedCard.id, notes)} onNotesBlur={() => void history.saveNow().catch(() => flash(t("noteSaveFailed")))} onOpenConversation={(id) => { selectConversationFromUser(id, "reader"); setView("conversations"); }} onAddSource={(id) => setSourcePickerRequest({ topicId: id, nonce: Date.now() })} onConvertCard={selectedCard.origin === "user" ? (kind) => history.mutate((current) => ({ ...current, cards: current.cards.map((card) => card.id === selectedCard.id ? { ...card, kind, updatedAt: Date.now() } : card) })) : undefined} onAnchor={(anchor) => void openAnchor(anchor)} onProgress={readingHistory.refresh} /> : null}
        {view === "canvas" && !focusOpen && !knowledgeCreateRequest && !taskWorkspaceId && !taskHistoryOpen ? <ProposalActionBar proposal={knowledgeProposal} analyzing={organizeStage === "analyzing"} onCancel={() => void cancelProposal()} onApply={() => void commitProposal()} /> : null}
        {toast ? <div className="toast" role="status">{toast}</div> : null}
        </Suspense>
        </div>
      </div>
      {atlasSearch.open ? <Suspense fallback={null}><SearchPalette cards={searchableCards} conversations={capturedConversations} sessions={groupFocusVersions(focusSessions).map((group) => group.latest)} anchors={atlasSearch.anchors} marks={atlasSearch.marks} onClose={atlasSearch.close} onSelect={selectSearchResult} /></Suspense> : null}
      {contextHandoff?<ContextHandoffDialog request={contextHandoff} zh={locale==="zh-CN"} onClose={closeContextHandoff} onSync={commandHydrate} onStart={(goal,sources)=>{const scope=contextHandoff.scope;const ids=scope.blocks!.map(block=>block.conversationId);setCapturedConversations(current=>[...current.filter(item=>!ids.includes(item.id)),...sources]);closeContextHandoff();startGoal(goal,"work",ids,undefined,scope,undefined,undefined,sources);}}/>:null}
      {importChoices ? <NativeImportDialog sources={importChoices} zh={locale === "zh-CN"} onChoose={sources => void chooseImportSources(sources)} onClose={closeImportChoices}/> : null}
      {newCardOpen ? <NewCardDialog onClose={() => setNewCardOpen(false)} onCreate={createCard} /> : null}
      {settingsOpen ? <Suspense fallback={null}><SettingsPanel initialTab={settingsInitialTab} onClose={() => { setSettingsOpen(false); setAISettingsRevision((revision) => revision + 1); }} /></Suspense> : null}
    </div>
  );
}

export default function App() {
  useEffect(() => observeMessageSearchEvents(), []);
  return <ReaderToolbarProvider><AtlasApp /></ReaderToolbarProvider>;
}

/** No conversation is open: the list to choose one from is on the home page. */
function SourceListRedirect({ onOpen }: { onOpen: () => void }) {
  useEffect(() => { onOpen(); }, [onOpen]);
  return null;
}
