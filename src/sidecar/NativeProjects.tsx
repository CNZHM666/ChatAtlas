import { ArrowLeft, ArrowUpRight, ChevronDown, ChevronRight, CircleHelp, Copy, Download, FileText, House, Plus, RefreshCw, ScrollText, Paperclip, StickyNote, Trash2, Undo2, X } from "lucide-react";
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { FocusEvidence, FocusSection, FocusSession } from "../shared/focus-session";
import { sidecarWritingMode, WIKI_WRITING_MODES } from "../shared/wiki-writing-modes";
import { prepareEditableChapterBody } from "../shared/chapter-editable-prose";
import type { WikiWritingMode } from "../shared/wiki-knowledge";
import type { WikiEdition } from "../shared/wiki-reading-edition";
import type { AtlasMessage, CaptureCommandResponse, NavigationResponse } from "../shared/messages";
import type { Conversation } from "../shared/types";
import { currentSourceChange, hasSourceChange, sourceChangeLabels, type SourceChange } from "../canvas/source-freshness";
import { defaultProjectExportPreset, PROJECT_EXPORT_PRESETS, projectExportSelection } from "../export/project-export-presets";
import { getDatabase } from "../storage/db";
import { createLivingProject, listFocusSessions } from "../storage/focus-sessions";
import { isCurrentHydrationComplete } from "../sync/import-state";
import { recordUiFailure } from "../canvas/ui-failure";
import { saveManualWikiChapter, setSidecarWritingMode, sidecarProjectHead, trashSidecarProject } from "../storage/sidecar-projects";
import { downloadFile } from "../export/download-file";
import { discardSidecarDraft, listSidecarDrafts, saveSidecarDraft, sidecarDraftId, sidecarFirstRunActive, type SidecarReviewChoices, type SidecarUpdateDraft } from "../storage/sidecar-update-drafts";
import { savedFocusProjects } from "../canvas/focus-versions";
import { SidecarHeader } from "./SidecarHeader";
import { SidecarSheet } from "./SidecarSheet";
import { ProjectDesk } from "./ProjectDesk";
import { SidecarProjectWiki } from "./SidecarProjectWiki";
import { ProjectNotice, ProjectUpdateStatus } from "./ProjectUpdateStatus";
import { ProjectUpdateLog } from "./ProjectUpdateLog";
import { changeDirectoryId, minimumChapterNotes, projectUpdateIssue, type UpdateIssue, type UpdatePhase } from "./project-update-state";
import { appendProjectUpdateLog, readProjectUpdateLog, updateDiagnosticCode, updateValidationFields, type ProjectUpdateLogEntry } from "./project-update-log";
import { sendSidecarMessage } from "./host";
import { projectIdentity, replacementPoint } from "../shared/project-continuation";
import type { ProjectAnswer, ProjectIncrementResume } from "./project-increment";
import { SidecarSourceReader, type SidecarSource } from "./SidecarSourceReader";
import { sourceVersion } from "../storage/source-versions";
import { getMessagesForConversation } from "../storage/messages";
import { FirstWikiPanel } from "./FirstWikiPanel";
import { commandFirstWiki, useFirstWikiDraft } from "./first-wiki-client";
import { conversationDisplayTitle } from "../shared/platforms";
import { ReaderGuide } from "../canvas/components/ReaderGuide";

type Screen = "projects" | "project" | "create";
const deskTabs = [{ id: "document", cn: "文档", en: "Document", icon: FileText }, { id: "files", cn: "资料", en: "Files", icon: Paperclip }, { id: "notes", cn: "便利贴", en: "Notes", icon: StickyNote }] as const;
type Operation = "creating" | "staging" | "applying" | "exporting" | "mode" | "undoing" | "discarding" | "resuming" | "deleting";
const Editor = lazy(async () => ({ default: (await import("../canvas/components/ChapterTextEditor")).ChapterTextEditor }));

function WritingModeSelect({ zh, mode, disabled, onChange }: {
  zh: boolean; mode: WikiWritingMode; disabled?: boolean; onChange: (mode: WikiWritingMode) => void;
}) {
  return <label className="native-writing-mode">
    <span>{zh ? "写作模式" : "Writing mode"}</span>
    <span className="native-select">
      <select value={mode} onChange={event => onChange(event.target.value as WikiWritingMode)} disabled={disabled}>
        {(Object.keys(WIKI_WRITING_MODES) as WikiWritingMode[]).map(value =>
          <option key={value} value={value}>{WIKI_WRITING_MODES[value][zh ? "zh" : "en"]}</option>)}
      </select>
      <ChevronDown size={14} aria-hidden="true"/>
    </span>
  </label>;
}

export function NativeProjects({ zh, onToggleLanguage, conversationId, conversationTitle, canInsert, platformLabel }: {
  zh: boolean; onToggleLanguage: () => void; conversationId: string; conversationTitle: string; canInsert: boolean; platformLabel: string;
}) {
  const t = (cn: string, en: string) => zh ? cn : en;
  const [projects, setProjects] = useState<FocusSession[]>([]);
  const [chat, setChat] = useState<Conversation>();
  const [sourceDelta, setSourceDelta] = useState<SourceChange>();
  const [screen, setScreen] = useState<Screen>("projects");
  const [deskView, setDeskView] = useState<typeof deskTabs[number]["id"]>("document");
  const [active, setActive] = useState<string>();
  const [chapterId, setChapterId] = useState<string>();
  const [edit, setEdit] = useState<{ project: FocusSession; chapter?: FocusSection }>();
  const [name, setName] = useState("");
  const [createMode, setCreateMode] = useState<WikiWritingMode>("concise");
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPreset, setExportPreset] = useState<WikiEdition>();
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState<Operation>();
  const [status, setStatus] = useState(""), [error, setError] = useState("");
  const [citationNoticeDismissed, setCitationNoticeDismissed] = useState(false);
  const [savingNoticeDismissed, setSavingNoticeDismissed] = useState(false);
  const [importNeeded, setImportNeeded] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>();
  const [updateIssue, setUpdateIssue] = useState<UpdateIssue>();
  const [updateLog, setUpdateLog] = useState(readProjectUpdateLog);
  const [logOpen, setLogOpen] = useState(false);
  const [drafts, setDrafts] = useState<SidecarUpdateDraft[]>([]);
  const [openDraft, setOpenDraft] = useState<SidecarUpdateDraft>();
  const draftRef = useRef<SidecarUpdateDraft>();
  const pendingDraftEdits = useRef(Promise.resolve());
  const [draftError, setDraftError] = useState("");
  const [discardCandidate, setDiscardCandidate] = useState<string>();
  const [trashCandidate, setTrashCandidate] = useState<FocusSession>();
  const [sourceView, setSourceView] = useState<SidecarSource>();
  const sourceOrigin = useRef<HTMLElement>();
  const currentChat = useRef(conversationId);
  currentChat.current = conversationId;
  const mounted = useRef(true), action = useRef<AbortController>(), refreshId = useRef(0);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const navigation = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [firstActionsHost, setFirstActionsHost] = useState<HTMLElement | null>(null);
  const project = projects.find(item => projectIdentity(item) === active);
  const deskProjectId = project ? projectIdentity(project) : undefined;
  const preview = openDraft?.preview;
  const reviewingDraft = preview;
  const reviewSourceVersionId = reviewingDraft?.version.id;
  const { choices = {}, destinations = {}, answers = {}, questionIndices = [], questionIndex,
    answerChoice, answerDraft = "", useOutline = false } = openDraft?.review ?? {};
  const current = chat?.id === conversationId ? chat : undefined;
  const chatTitle = conversationId ? conversationDisplayTitle(current?.title || conversationTitle, current?.platform ?? platformLabel) : "";
  const chatLabel = [platformLabel, chatTitle].filter(Boolean).join(" · ");
  const linked = Boolean(project && conversationId && (project.sourceConversationIds.includes(conversationId) || project.sidecarConversationIds?.includes(conversationId)));
  const changed = Boolean(linked && sourceDelta && sourceDelta.conversationId === current?.id && (sourceDelta.unknown || hasSourceChange(sourceDelta)));
  const changeLabels = changed && sourceDelta ? sourceChangeLabels(sourceDelta, zh) : [];
  const canUndo = project?.continuationUpdate && project.updatedAt === project.continuationUpdate.at;
  const hasChapters = Boolean(project?.sections.length);
  const defaultExportPreset = project ? defaultProjectExportPreset(project) : undefined;
  const canPickExportPreset = Boolean(project && hasChapters && project.wikiKnowledge?.documentType !== "learning");
  const activeExportPreset: WikiEdition = exportPreset ?? defaultExportPreset ?? "handoff";
  const activeExportMeta = PROJECT_EXPORT_PRESETS.find(item => item.id === activeExportPreset) ?? PROJECT_EXPORT_PRESETS[1];
  const reading = screen === "project" && !edit && Boolean(chapterId && project?.sections.some(section => section.id === chapterId));
  const showUpdateCard = screen === "project" && project && !edit && !reading && deskView === "document";
  const questions = preview ? questionIndices.map(index => ({ item: preview.changes[index], index })) : [];
  const question = questionIndex === undefined ? undefined : questions[questionIndex];
  const reviewing = Boolean(reviewingDraft && !question);
  const showDeskTabs = Boolean(deskProjectId && !reading && !reviewingDraft);
  const questionOptions = question?.item.options ?? [];
  const optionIndex = typeof answerChoice === "number" ? answerChoice : questionOptions.length === 1 && answerChoice !== "custom" ? 0 : undefined;
  const answerOption = optionIndex === undefined ? undefined : questionOptions[optionIndex];
  const customAnswer = answerChoice === "custom" || questionOptions.length === 0;
  const answerToConfirm = customAnswer ? answerDraft.trim() : answerOption?.label;
  const citationNotice = (count: number) => t(`${count} 条建议未能定位原话，暂未纳入。`, `${count} suggestions were left out because their quotes could not be verified.`);
  const outlineUnavailable = t("本轮未能生成章节建议，仍可写入已核对的条目。", "Chapter suggestions are unavailable. Verified notes can still be saved.");
  const selectedCount = Object.keys(choices).length;
  const hasSelection = selectedCount > 0;
  const projectChapters = preview?.project.sections.filter(section => !section.continuationLoose) ?? [];
  const pendingEdits = preview?.changes.filter((item,index) => item.operation && choices[index] !== "approve_edit").length ?? 0;
  const changeGroups = new Map<string, number[]>();
  preview?.changes.forEach((item, index) => {
    const destination = item.target ?? destinations[index] ?? item.appendTo ?? "";
    const group = changeGroups.get(destination) ?? [];
    group.push(index);
    changeGroups.set(destination, group);
  });
  const firstDraft = useFirstWikiDraft(screen === "project" ? active : undefined);
  const firstRunning = Boolean(firstDraft && sidecarFirstRunActive(firstDraft));
  const firstBase = firstDraft?.initialDocument?.project;
  const firstStale = Boolean(firstBase && project && (firstBase.id !== project.id || firstBase.updatedAt !== project.updatedAt || sidecarWritingMode(firstBase) !== sidecarWritingMode(project)));
  const showFirstWiki = Boolean(showUpdateCard && firstDraft && !reviewingDraft);
  const projectDrafts = drafts.filter(draft => draft.projectId === active && !draft.initialRun?.input && !draft.initialDocument);
  const previewChanged = Boolean(reviewingDraft && project && (reviewingDraft.project.id !== project.id || reviewingDraft.project.updatedAt !== project.updatedAt || sidecarWritingMode(reviewingDraft.project) !== sidecarWritingMode(project)));
  const showUndo = Boolean(screen === "project" && deskView === "document" && !reviewingDraft && !showFirstWiki && !reading && !edit && canUndo);
  const looseSelections = new Map(preview?.changes.flatMap((item, index) => choices[index] && !item.target && !(destinations[index] ?? item.appendTo)
    ? [[changeDirectoryId(index), item] as const] : []) ?? []);
  const outline = preview?.directory.flatMap(page => {
    if (!page.sectionIds.some(id => looseSelections.has(id))) return [];
    const notes = page.sectionIds.flatMap(id => {
      const saved = preview?.project.sections.find(section => section.id === id);
      const title = saved?.title ?? looseSelections.get(id)?.title;
      return title ? [{ id, title, saved: Boolean(saved) }] : [];
    });
    return notes.length >= minimumChapterNotes ? [{ title: page.title, notes }] : [];
  }) ?? [];
  useEffect(() => {
    if (reviewSourceVersionId) reviewHeading.current?.focus({ preventScroll: true });
  }, [reviewSourceVersionId, questionIndex]);
  useLayoutEffect(() => {
    if (content.current) content.current.scrollTop = 0;
  }, [screen, active, deskView, reading, edit, reviewSourceVersionId, questionIndex]);
  useLayoutEffect(() => {
    if (navigation.current) navigation.current.inert = Boolean(sourceView);
    if (content.current) content.current.inert = Boolean(sourceView);
    if (!sourceView && sourceOrigin.current) {
      sourceOrigin.current.focus({ preventScroll: true });
      sourceOrigin.current = undefined;
    }
  }, [sourceView]);

  useEffect(() => {
    if (!active || screen !== "project") return;
    let live = true;
    void pendingDraftEdits.current.then(() => listSidecarDrafts(active)).then(items => {
      if (live) setDrafts(items);
    }).catch(() => {
      if (live) setDraftError(zh ? "无法读取本地更新草稿。" : "Could not read local update drafts.");
    });
    return () => { live = false; };
  }, [active, screen, zh]);

  const refresh = useCallback(async () => {
    const revision = ++refreshId.current;
    const [sessions, chat] = await Promise.all([
      listFocusSessions(),
      conversationId ? getDatabase().then(db => db.get("conversations", conversationId)) : undefined,
    ]);
    if (!mounted.current || revision !== refreshId.current) return;
    setProjects([...new Map(savedFocusProjects(sessions).sort((a, b) => a.createdAt - b.createdAt).map(item => [projectIdentity(item), item])).values()]
      .sort((a, b) => b.updatedAt - a.updatedAt));
    if (currentChat.current === conversationId) setChat(chat);
    setLoaded(true);
  }, [conversationId]);

  useEffect(() => {
    mounted.current = true;
    const reload = () => {
      if (!document.hidden) void refresh().catch(() => {
        if (mounted.current) setError(zh ? "无法读取项目。" : "Could not load projects.");
      });
    };
    reload();
    const timer = window.setInterval(reload, 8000);
    const captured = (message: AtlasMessage) => {
      if (screen !== "create" && (message.type === "ATLAS_CAPTURE_SAVED" || message.type === "ATLAS_PROJECT_TRASHED" || message.type === "ATLAS_PROJECT_RESTORED"
        || message.type === "ATLAS_PROJECT_VERSION_SAVED"
        || message.type === "ATLAS_FIRST_WIKI_CHANGED" && message.savedSessionId)) reload();
    };
    globalThis.chrome?.runtime?.onMessage?.addListener(captured);
    window.addEventListener("focus", reload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", reload);
      globalThis.chrome?.runtime?.onMessage?.removeListener(captured);
    };
  }, [zh, screen, refresh]);

  useEffect(() => {
    let live = true;
    setSourceDelta(undefined);
    if (project && current && linked) {
      void currentSourceChange(project, current.id).then(change => {
        if (live) setSourceDelta(change);
      }).catch(() => undefined);
    }
    return () => { live = false; };
  }, [project, current, linked]);

  useEffect(() => () => {
    mounted.current = false;
    action.current?.abort();
  }, []);
  const cancelAction = useCallback(() => {
    action.current?.abort();
    action.current = undefined;
    setBusy(undefined);
    setUpdatePhase(undefined);
  }, []);
  useEffect(() => {
    draftRef.current = undefined;
    setOpenDraft(undefined);
    setSourceView(undefined);
    setChapterId(undefined);
    setImportNeeded(false);
    setUpdateIssue(undefined);
    setExportOpen(false);
    setStatus("");
    setError("");
    cancelAction();
  }, [conversationId, cancelAction]);

  const run = async (operation: Operation, work: (signal: AbortSignal) => Promise<void>,
    onFailure?: (failure: unknown, detail: ReturnType<typeof recordUiFailure>) => void) => {
    if (action.current) return;
    const controller = new AbortController();
    action.current = controller;
    setStatus("");
    setError("");
    setUpdateIssue(undefined);
    setSavingNoticeDismissed(false);
    setBusy(operation);
    try { await work(controller.signal); }
    catch (failure) {
      if (!controller.signal.aborted && mounted.current) {
        const detail = recordUiFailure(failure, `sidecar-${operation}`);
        if (onFailure) onFailure(failure, detail);
        else setError(projectUpdateIssue(failure, undefined, zh).message);
      }
    } finally {
      if (action.current === controller) {
        action.current = undefined;
        if (mounted.current) { setBusy(undefined); setUpdatePhase(undefined); }
      }
    }
  };
  const logUpdate = (entry: Omit<ProjectUpdateLogEntry, "at">) => setUpdateLog(appendProjectUpdateLog(entry));
  const logFailure = (failure: unknown, detail: ReturnType<typeof recordUiFailure>, stage: UpdatePhase["stage"], reason: string,
    batch?: Pick<ProjectUpdateLogEntry, "completed" | "total" | "smallerBatches">) => {
    const frames = detail.frames.filter(frame => /^(?:[a-z][\w-]*-[\w-]{8}\.js|[a-z][\w-]*\.tsx?):\d+(?::\d+)?$/iu.test(frame));
    logUpdate({ stage, state: "failed", reason, code: updateDiagnosticCode(failure, stage === "reading" || stage === "importing", detail),
      error: detail.name, frames, fields: updateValidationFields(failure), ...batch });
  };

  const go = (next: Screen) => {
    cancelAction();
    openReview();
    setSourceView(undefined);
    setImportNeeded(false);
    setUpdateIssue(undefined);
    setLogOpen(false);
    setExportOpen(false);
    setDraftError("");
    setDiscardCandidate(undefined);
    setTrashCandidate(undefined);
    setStatus("");
    setError("");
    setChapterId(undefined);
    setScreen(next);
  };
  const confirmTrash = () => {
    if (!trashCandidate) return;
    const id = projectIdentity(trashCandidate);
    void run("deleting", async signal => {
      await trashSidecarProject(trashCandidate);
      if (!mounted.current) return;
      refreshId.current++;
      setProjects(items => items.filter(item => projectIdentity(item) !== id));
      if (signal.aborted) { setTrashCandidate(current => current === trashCandidate ? undefined : current); return; }
      setActive(undefined);
      go("projects");
      setStatus(t("已移到工作台回收站。", "Moved to Workbench Trash."));
    }, () => setError(t("未能删除项目，请重试。", "Could not delete the project. Try again.")));
  };
  const showSaved = (saved: FocusSession) => {
    refreshId.current++;
    setProjects(items => [saved, ...items.filter(item => projectIdentity(item) !== projectIdentity(saved))]);
    setActive(projectIdentity(saved));
  };
  const navigate = async (message: Extract<AtlasMessage, { type: "ATLAS_OPEN" | "ATLAS_OPEN_REVIEW" | "ATLAS_OPEN_AI_SETTINGS" }>) => {
    setError("");
    try {
      const response = await sendSidecarMessage(message) as NavigationResponse;
      if (!response?.ok) throw new Error();
    } catch { setError(t("无法打开工作台。", "Could not open the workbench.")); }
  };
  const openSource = (source: SidecarSource) => {
    sourceOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
    setSourceView(source);
  };
  const openNoteSource = (ref: FocusEvidence, quote?: string) => {
    if (project) openSource({ messageId: ref.messageId, title: ref.title, conversationId: ref.conversationId,
      project, sourceVersionId: ref.sourceVersionId, signature: ref.sourceSignature, quote });
  };
  const openProject = (sectionId?: string) => {
    if (project) void navigate({ type: "ATLAS_OPEN_REVIEW", sessionId: project.id, ...(sectionId ? { sectionId } : {}) });
  };
  const openReview = (draft?: SidecarUpdateDraft) => {
    draftRef.current = draft;
    setOpenDraft(draft);
    setCitationNoticeDismissed(false);
    setUpdateIssue(undefined);
    setError("");
  };
  const rememberDraft = (draft: SidecarUpdateDraft) => {
    setDrafts(items => [draft, ...items.filter(item => item.id !== draft.id)]);
  };
  const forgetDraft = (draft: SidecarUpdateDraft) => setDrafts(items => items.filter(item => item.id !== draft.id));
  const resumeReview = (draft: SidecarUpdateDraft) => void run("resuming", async signal => {
    await pendingDraftEdits.current;
    const saved = await (await getDatabase()).get("sidecarUpdateDrafts", draft.id);
    signal.throwIfAborted();
    if (saved?.preview) { setDraftError(""); openReview(saved); }
    else forgetDraft(draft);
  });
  const editReview = (update: (review: SidecarReviewChoices) => SidecarReviewChoices) => {
    const previous = draftRef.current;
    if (!previous?.review) return;
    const next = { ...previous, revision: crypto.randomUUID(), updatedAt: Date.now(), review: update(previous.review) };
    draftRef.current = next;
    setOpenDraft(next);
    pendingDraftEdits.current = pendingDraftEdits.current.then(async () => {
      await saveSidecarDraft(next, previous.revision);
      rememberDraft(next);
    }).catch(() => setDraftError(t("草稿改动未能保存。请留在此页，检查本地存储或其他已打开的侧栏。", "Draft changes could not be saved. Stay on this page and check local storage or another open sidebar.")));
  };
  const discardDraft = (draft: SidecarUpdateDraft) => void run("discarding", async () => {
    await pendingDraftEdits.current;
    await discardSidecarDraft(draft);
    forgetDraft(draft);
    setDraftError("");
    setDiscardCandidate(undefined);
  }, () => setDraftError(t("草稿已有变化。返回项目列表后重新打开。", "The draft changed. Reopen this project from the list.")));
  const stage = (allowImport = false, retry?: "retry-analysis" | "retry-smaller") => {
    if (!project || !conversationId) return;
    let phase: UpdatePhase["stage"] = "reading";
    let smallerBatches = retry === "retry-smaller";
    let analysisProgress: { completed: number; total: number } | undefined;
    const resume: ProjectIncrementResume = {};
    return run("staging", async signal => {
      setChapterId(undefined); setImportNeeded(false); setDraftError("");
      await pendingDraftEdits.current;
      const db = await getDatabase();
      const projectId = projectIdentity(project);
      const id = sidecarDraftId(projectId, conversationId);
      let staged = await db.get("sidecarUpdateDrafts", id);
      signal.throwIfAborted();
      if (staged?.preview) { openReview(staged); return; }
      if (staged?.initialDocument) return;
      resume.batchRun = staged?.batchRun;
      smallerBatches ||= staged?.smallerBatches === true;
      const saveDraft = async (update: Partial<SidecarUpdateDraft>, persistAfterPause = false) => {
        if (!persistAfterPause) signal.throwIfAborted();
        const next = { id, projectId, conversationId, title: chatLabel || conversationTitle, ...staged, ...update,
          revision: crypto.randomUUID(), updatedAt: Date.now() };
        try { await saveSidecarDraft(next, staged?.revision); }
        catch { throw Object.assign(new Error("Could not save sidecar draft"), { code: "SIDECAR_DRAFT_SAVE" }); }
        staged = next;
        if (mounted.current) rememberDraft(next);
        if (!persistAfterPause) signal.throwIfAborted();
        return next;
      };
      setUpdatePhase({ stage: "reading" });
      logUpdate({ stage: phase, state: "started" });
      const savedChat = await db.get("conversations", conversationId);
      signal.throwIfAborted();
      const needsImport = !savedChat || !isCurrentHydrationComplete(savedChat) || !(savedChat.messageCount && savedChat.messageCount > 0);
      if (needsImport && !allowImport) {
        logUpdate({ stage: phase, state: "waiting" });
        setImportNeeded(true);
        return;
      }
      if (!retry || needsImport) {
        if (needsImport) {
          logUpdate({ stage: phase, state: "finished" });
          phase = "importing";
          logUpdate({ stage: phase, state: "started" });
        }
        setUpdatePhase({ stage: needsImport ? "importing" : "reading" });
        const response = await sendSidecarMessage({ type: "ATLAS_SIDECAR_SYNC", conversationId }) as CaptureCommandResponse;
        signal.throwIfAborted();
        if (!response?.ok || response.summary && response.summary.conversationId !== conversationId) {
          throw Object.assign(new Error(response?.error), { code: response?.code });
        }
        const latestChat = await db.get("conversations", conversationId);
        signal.throwIfAborted();
        setChat(latestChat);
      }
      logUpdate({ stage: phase, state: "finished" });
      if (project.sections.length === 0) {
        phase = "analyzing";
        const [source, messages] = await Promise.all([db.get("conversations", conversationId), getMessagesForConversation(conversationId, { cache: false })]);
        signal.throwIfAborted();
        if (!source || !isCurrentHydrationComplete(source) || !messages.length) throw Object.assign(new Error("Source unavailable"), { code: "SIDECAR_CHAT_UNAVAILABLE" });
        const version = sourceVersion(conversationId, messages, Date.now());
        const mode = sidecarWritingMode(project);
        const key = JSON.stringify([project.id, project.updatedAt, version.id, mode, zh]);
        const reusable = staged?.initialRun?.key === key;
        const first = reusable ? staged!.initialRun! : { key, id: `sidecar-first-${crypto.randomUUID()}` };
        const draft = await saveDraft({ initialRun: { ...first, input: { project, version, zh } }, batchRun: undefined,
          initialLog: reusable ? staged?.initialLog : [] });
        await commandFirstWiki(draft.id);
        void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId } satisfies AtlasMessage).catch(() => undefined);
        return;
      }
      phase = "analyzing";
      logUpdate({ stage: phase, state: "started", smallerBatches });
      setUpdatePhase({ stage: "analyzing", completed: 0, total: 0 });
      const { previewProjectIncrement, applyProjectIncrement } = await import("./project-increment");
      let planning = false;
      const next = await previewProjectIncrement(project, conversationId, zh, signal, (completed, total) => {
        if (!signal.aborted) {
          analysisProgress = { completed, total };
          setUpdatePhase({ stage: "analyzing", completed, total });
        }
      }, resume, smallerBatches, () => {
        planning = true;
        logUpdate({ stage: "analyzing", state: "finished", smallerBatches, ...analysisProgress });
        phase = "organizing";
        setUpdatePhase({ stage: "organizing" });
        logUpdate({ stage: "organizing", state: "started" });
      }, async batchRun => { await saveDraft({ batchRun: structuredClone(batchRun), smallerBatches, initialRun: undefined }); });
      signal.throwIfAborted();
      const unmatched = next?.unmatchedCitations ?? 0;
      if (!planning || unmatched) logUpdate({ stage: "analyzing", state: unmatched ? "partial" : "finished", smallerBatches, ...analysisProgress,
        ...(unmatched ? { code: "PROVIDER_SCHEMA_sidecar_source", reason: citationNotice(unmatched),
          fields: next?.citationFields, unmatchedCitations: unmatched } : {}) });
      if (next?.directoryError) logFailure(next.directoryError, recordUiFailure(next.directoryError, "sidecar-outline"), "organizing", outlineUnavailable);
      else if (planning) logUpdate({ stage: "organizing", state: "finished" });
      if (unmatched && !next?.changes.length) {
        setUpdateIssue({ message: t("未能定位建议的原话，本轮未写入。可重新分析已保存的对话。", "No quotes could be located, so nothing was written. Retry with the saved chat."), action: smallerBatches ? "retry-analysis" : "retry-smaller" });
        return;
      }
      if (!next || !next.changes.length && !next.removed) {
        if (next) {
          phase = "saving";
          setUpdatePhase({ stage: phase });
          logUpdate({ stage: phase, state: "started" });
          const saved = await applyProjectIncrement(next, [], zh, false, signal, staged);
          if (!signal.aborted) {
            logUpdate({ stage: phase, state: "finished", reason: t("已记录本轮检查，正文没有改动。", "Review recorded; the document has no changes.") });
            if (staged) forgetDraft(staged);
            showSaved(saved);
          }
        } else {
          if (staged) { await discardSidecarDraft(staged); forgetDraft(staged); }
          await refresh();
        }
        if (!signal.aborted) setStatus(t("这轮没有需要写入的内容。", "Nothing new to write from this chat."));
        return;
      }
      const questionIndices = next.changes.flatMap((item, index) => item.kind === "open_question" && item.options?.length ? [index] : []).slice(0, 3);
      const draft = await saveDraft({ batchRun: undefined, preview: { ...next, directoryError: Boolean(next.directoryError) }, review: {
        choices: Object.fromEntries(next.changes.flatMap((item, index) => item.operation ? [] : [[index, "include"] as const])), destinations: {}, answers: {},
        questionIndices, questionIndex: questionIndices.length ? 0 : undefined, answerDraft: "", useOutline: false,
      } });
      openReview(draft);
    }, (failure, detail) => {
        const batchRun = resume.batchRun;
      const failedSmallBatch = phase === "analyzing" && batchRun?.batches[batchRun.completed]?.small === true;
      const issue = projectUpdateIssue(failure, phase, zh, failedSmallBatch);
      logFailure(failure, detail, phase, issue.message, phase === "analyzing" ? { ...analysisProgress, smallerBatches: failedSmallBatch } : undefined);
      setUpdateIssue(issue.action === "save" ? {
        message: t("未能记录这次检查结果。可以用已导入的对话重试。", "Could not record this check. Retry with the saved conversation."),
        action: "retry",
      } : issue);
    });
  };
  const advanceQuestion = (answer?: ProjectAnswer) => {
    if (!question || questionIndex === undefined) return;
    editReview(review => {
      const next = { ...review.answers };
      if (answer) next[question.index] = answer;
      else delete next[question.index];
      return { ...review, answers: next, answerChoice: undefined, answerDraft: "",
        questionIndex: questionIndex + 1 < questions.length ? questionIndex + 1 : undefined };
    });
  };
  const apply = () => preview && openDraft && run("applying", async signal => {
    setUpdatePhase({ stage: "saving" });
    logUpdate({ stage: "saving", state: "started" });
    await pendingDraftEdits.current;
    const { applyProjectIncrement } = await import("./project-increment");
    signal.throwIfAborted();
    const selection = preview.changes.flatMap((item, index) => choices[index] && (!item.operation || choices[index] === "approve_edit") ? [{
      item, decide: choices[index] === "decide", editConfirmed: choices[index] === "approve_edit", answer: answers[index], appendTo: destinations[index],
    }] : []);
    const saved = await applyProjectIncrement(preview, selection, zh, useOutline && outline.length > 0, signal, openDraft);
    if (!signal.aborted) {
      logUpdate({ stage: "saving", state: "finished", reason: selection.length
        ? t(`已写入 ${selection.length} 条更新。`, `${selection.length} updates saved.`)
        : t("已记录本轮检查，正文没有改动。", "Review recorded; the document has no changes.") });
      forgetDraft(openDraft);
      openReview();
      setDraftError("");
      showSaved(saved);
      const written = selection.length ? t(`已写入 ${selection.length} 条更新。`, `${selection.length} updates saved.`)
        : t("已核对本轮消息。", "This round is reviewed.");
      setStatus(preview.unmatchedCitations ? `${written} ${citationNotice(preview.unmatchedCitations)}` : written);
    }
  }, (failure, detail) => {
    const issue = projectUpdateIssue(failure, "saving", zh);
    logFailure(failure, detail, "saving", issue.message);
    setUpdateIssue(issue);
  });
  const applyFirstDocument = () => firstDraft?.initialDocument && !firstStale && run("applying", async signal => {
    setUpdatePhase({ stage: "saving" });
    logUpdate({ stage: "saving", state: "started" });
    const { applySidecarFirstDocument } = await import("./project-increment");
    const saved = await applySidecarFirstDocument(firstDraft, zh, signal);
    if (signal.aborted) return;
    logUpdate({ stage: "saving", state: "finished" });
    forgetDraft(firstDraft);
    openReview();
    showSaved(saved);
    void chrome.runtime.sendMessage({ type: "ATLAS_FIRST_WIKI_CHANGED", projectId: firstDraft.projectId, savedSessionId: saved.id } satisfies AtlasMessage).catch(() => undefined);
    setStatus(t("已保存首版文档。", "First document saved."));
  }, (failure, detail) => {
    const issue = projectUpdateIssue(failure, "saving", zh);
    logFailure(failure, detail, "saving", issue.message);
    setUpdateIssue(issue);
  });
  const exportMarkdown = (action: "download" | "copy" = "download", preset?: WikiEdition) => project && run("exporting", async signal => {
    const [{ projectDocument, projectDocumentFilename }, sessions] = await Promise.all([
      import("../export/project-document"), listFocusSessions(),
    ]);
    signal.throwIfAborted();
    const saved = sidecarProjectHead(sessions, project);
    if (!saved) throw new Error(t("找不到要导出的项目。", "The project is no longer available."));
    if (saved.livingProject && !saved.sections.length) {
      const title = saved.title.replace(/\s+/gu, " ");
      const text = [`# ${title}`, saved.goal.trim()].filter(Boolean).join("\n\n") + "\n";
      if (action === "copy") {
        await navigator.clipboard.writeText(text);
        if (!signal.aborted) setStatus(t("已复制 Markdown。", "Markdown copied."));
      } else {
        downloadFile(text, projectDocumentFilename(saved, "md"), "text/markdown;charset=utf-8");
      }
      setExportOpen(false);
      return;
    }
    const chosenPreset = preset ?? defaultProjectExportPreset(saved);
    const file = projectDocument(saved, projectExportSelection(saved, chosenPreset), "md", zh);
    const presetMeta = chosenPreset ? PROJECT_EXPORT_PRESETS.find(item => item.id === chosenPreset) : undefined;
    const modeLabel = presetMeta ? presetMeta.label[zh ? "zh" : "en"] : "";
    if (action === "copy") {
      await navigator.clipboard.writeText(file.text);
      if (!signal.aborted) {
        setExportOpen(false);
        setStatus(modeLabel ? t(`已复制${modeLabel}版 Markdown。`, `${modeLabel} Markdown copied.`) : t("已复制 Markdown。", "Markdown copied."));
      }
      return;
    }
    downloadFile(file.text, file.filename, file.mime);
    if (!signal.aborted) {
      setExportOpen(false);
      setStatus(modeLabel ? t(`已导出${modeLabel}版 Markdown。`, `${modeLabel} Markdown exported.`) : t("已导出 Markdown。", "Markdown exported."));
    }
  });
  const startEdit = (chapter?: FocusSection) => {
    if (!project || busy) return;
    setStatus(""); setError(""); setImportNeeded(false); setUpdateIssue(undefined); setExportOpen(false);
    setEdit({ project, chapter });
  };
  const updateLogButton = <button type="button" className="native-tool native-chat-log"
    aria-label={t("更新日志", "Update log")} title={t("更新日志", "Update log")}
    aria-expanded={logOpen} aria-controls={logOpen ? "native-project-update-log" : undefined}
    onClick={() => { if (!logOpen) setUpdateLog(readProjectUpdateLog()); setLogOpen(!logOpen); }}>
    <ScrollText size={16} aria-hidden="true"/>
  </button>;
  const updateFeedback = <ProjectUpdateStatus zh={zh} importNeeded={importNeeded}
    progress={savingNoticeDismissed && updatePhase?.stage === "saving" ? undefined : updatePhase} status={status}
    issue={updateIssue ?? (error ? { message: error } : undefined)}
    onCancel={busy === "staging" ? cancelAction : undefined}
    onDismissSaving={() => setSavingNoticeDismissed(true)}
    onImport={() => void stage(true)} onRetry={() => {
      const retry = updateIssue?.action;
      if (retry === "save") void (preview ? apply() : applyFirstDocument());
      else if (retry === "refresh-preview") openReview();
      else if (retry === "retry-analysis" || retry === "retry-smaller") void stage(false, retry);
      else void stage(true);
    }}
    onSettings={() => void navigate({ type: "ATLAS_OPEN_AI_SETTINGS" })}
    onDismiss={() => { setImportNeeded(false); setUpdateIssue(undefined); setStatus(""); setError(""); }}/>;
  const citationFeedback = preview && preview.unmatchedCitations > 0 && !citationNoticeDismissed
    ? <ProjectNotice zh={zh} text={citationNotice(preview.unmatchedCitations)} onDismiss={() => setCitationNoticeDismissed(true)}/> : null;

  return <main className="sidecar-project native-projects" data-source-reader={Boolean(sourceView) || undefined}>
    {!reading && <header ref={navigation} className="native-project-top" data-project-list={screen === "projects" || undefined}>
      {screen !== "projects" && <button type="button" className="native-tool" aria-label={t("返回项目", "Back to projects")} onClick={() => go("projects")} disabled={Boolean(edit) || busy === "applying" || busy === "creating"}><ArrowLeft size={16}/>{t("项目", "Projects")}</button>}
      <div>
        <button type="button" className="native-tool" aria-label={t("打开工作台首页", "Open workbench home")} title={t("打开工作台首页", "Open workbench home")} onClick={() => void navigate({ type: "ATLAS_OPEN", home: true })}><House size={17} aria-hidden="true"/></button>
        <SidecarHeader zh={zh} onToggleLanguage={onToggleLanguage} showBrand={false}/>
      </div>
      {screen === "projects" && <button type="button" className="native-tool native-new" onClick={() => go("create")}><Plus size={15} aria-hidden="true"/>{t("新建", "New")}</button>}
    </header>}
    <div ref={content} className="sidecar-project-body native-project-content" data-reading={reading || undefined} data-reviewing={reviewing || undefined} data-editing={Boolean(screen === "project" && edit) || undefined}>
      {screen === "projects" && <>
        <div className="native-project-heading"><h1>{t("我的项目", "My projects")}</h1></div>
        {projects.length ? <ul className="native-project-list">
          {projects.map(item => <li key={projectIdentity(item)}><button type="button" onClick={() => { setActive(projectIdentity(item)); setDeskView("document"); go("project"); }} title={item.title}><FileText size={16} aria-hidden="true"/><span>{item.title}</span><ChevronRight size={15} aria-hidden="true"/></button></li>)}
        </ul> : loaded ? <p className="native-muted">{t("新建项目后，可以从当前对话开始积累文档。", "Create a project and start building its document from this chat.")}</p> : !error && <p role="status">{t("正在读取项目…", "Loading projects…")}</p>}
      </>}
      {screen === "create" && <form className="native-project-form" onSubmit={event => {
        event.preventDefault();
        if (!name.trim()) return;
        void run("creating", async signal => {
          const saved = await createLivingProject(name, "", zh ? "zh-CN" : "en", createMode);
          showSaved(saved); setName(""); setCreateMode("concise"); setDeskView("document");
          if (!signal.aborted) setScreen("project");
        });
      }}>
        <h1>{t("新建项目", "New project")}</h1>
        <label>{t("项目名称", "Project name")}<input autoFocus required maxLength={100} value={name} onChange={event => setName(event.target.value)}/></label>
        <WritingModeSelect zh={zh} mode={createMode} onChange={setCreateMode} disabled={Boolean(busy)}/>
        <div className="native-form-actions">
          <button className="native-tool" type="button" onClick={() => go("projects")} disabled={Boolean(busy)}>{t("取消", "Cancel")}</button>
          <button className="native-primary" type="submit" disabled={Boolean(busy) || !name.trim()}>{t("创建项目", "Create project")}</button>
        </div>
      </form>}

      {screen === "project" && edit && <Suspense fallback={<p role="status">{t("正在打开编辑器…", "Opening editor…")}</p>}>
        <Editor
          key={edit.chapter?.id ?? "__new__"}
          title={edit.chapter?.title ?? ""}
          body={edit.chapter ? prepareEditableChapterBody(edit.project, edit.chapter) : ""}
          zh={zh}
          compact
          onCancel={() => setEdit(undefined)}
          onSave={async (title, body) => {
            const saved = await saveManualWikiChapter(edit.project, edit.chapter, title, body, zh);
            showSaved(saved); setChapterId(saved.activeSectionId); setEdit(undefined);
          }}
        />
      </Suspense>}
      {screen === "project" && project && !edit && <>
        {!reading && !reviewingDraft && <>
          <div className="native-project-heading"><h1 title={project.title}>{project.title}</h1>
            <div className="native-project-heading-actions">
              {!hasChapters && <button type="button" className="native-tool" onClick={() => openProject()} aria-label={t("打开完整文档", "Open full document")} title={t("打开完整文档", "Open full document")}><ArrowUpRight size={17}/></button>}
              <button type="button" className="native-tool native-project-trash" aria-haspopup="dialog" disabled={Boolean(busy || firstRunning)}
                aria-label={t("删除项目", "Delete project")} title={t("删除项目", "Delete project")} onClick={() => { setError(""); setTrashCandidate(project); }}>
                <Trash2 size={17} aria-hidden="true"/>
              </button>
            </div>
          </div>
          {conversationId && chatLabel && <small className="native-current-caption" title={chatLabel}>{chatLabel}</small>}
        </>}
        {showDeskTabs && <div className="project-desk-tabs" role="tablist" aria-label={t("项目工作区", "Project workspace")}
          onKeyDown={event => {
            if (busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const index = deskTabs.findIndex(tab => tab.id === deskView);
            const at = event.key === "Home" ? 0 : event.key === "End" ? deskTabs.length - 1
              : (index + deskTabs.length + (event.key === "ArrowRight" ? 1 : -1)) % deskTabs.length;
            setDeskView(deskTabs[at].id); setChapterId(undefined);
            event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[at]?.focus();
          }}>
          {deskTabs.map(({ id, cn, en, icon: Icon }) => <button key={id} type="button" role="tab" id={`desk-tab-${id}`}
            tabIndex={id === deskView ? 0 : -1} aria-selected={id === deskView} aria-controls="project-desk-panel"
            disabled={Boolean(busy) && id !== deskView} onClick={() => { setDeskView(id); setChapterId(undefined); }}>
            <Icon size={15} aria-hidden="true"/>{t(cn, en)}
          </button>)}
        </div>}
        {deskProjectId && deskView !== "document" ? <div id="project-desk-panel" role="tabpanel" aria-labelledby={`desk-tab-${deskView}`}>
          <ProjectDesk projectId={deskProjectId} conversationId={conversationId} canAttach={canInsert} view={deskView} zh={zh}/>
        </div> : <div className="project-desk-document" id="project-desk-panel"
          role={showDeskTabs ? "tabpanel" : undefined} aria-labelledby={showDeskTabs ? "desk-tab-document" : undefined}>
        {!reading && !reviewing && <section className="native-update-card" onKeyDown={event => {
          if (event.key === "Escape" && exportOpen) { event.stopPropagation(); setExportOpen(false); }
        }}>
          <div className="native-chat-bar">
            <WritingModeSelect zh={zh} mode={sidecarWritingMode(project)} disabled={Boolean(busy || preview || firstRunning || firstDraft?.initialDocument)} onChange={mode => void run("mode", async signal => {
              const saved = await setSidecarWritingMode(project, mode, zh);
              if (!signal.aborted) {
                showSaved(saved);
                setExportPreset(defaultProjectExportPreset(saved));
                setImportNeeded(false);
                setStatus(t("下次从对话更新时使用此模式。", "This mode applies to the next chat update."));
              }
            })}/>
            <div className="native-chat-actions" role="group" aria-label={t("项目操作", "Project actions")}>
              {conversationId && <button type="button" className="native-tool native-chat-update" onClick={() => { setExportOpen(false); void stage(); }}
                aria-label={busy === "staging" ? t("正在准备更新", "Preparing update") : t("更新项目", "Update project")}
                title={hasChapters ? t("预览从当前对话提取的项目更新", "Preview project changes from this chat")
                  : t("从当前对话生成首版", "Generate a first document from this chat")}
                aria-busy={busy === "staging" || firstRunning} data-changed={changed || undefined} disabled={Boolean(busy || preview || firstRunning || firstDraft?.initialDocument)}>
                <RefreshCw size={16} aria-hidden="true"/>
              </button>}
              <button type="button" className="native-tool native-chat-export"
                onClick={() => {
                  if (!canPickExportPreset) { void exportMarkdown("download"); return; }
                  setExportOpen(open => {
                    const next = !open;
                    if (next) {
                      setExportPreset(defaultExportPreset ?? "handoff");
                      setLogOpen(false);
                    }
                    return next;
                  });
                }}
                aria-label={t("导出 Markdown", "Export Markdown")} title={t("导出 Markdown", "Export Markdown")}
                aria-expanded={canPickExportPreset ? exportOpen : undefined}
                aria-busy={busy === "exporting"} disabled={Boolean(busy)}>
                <Download size={16} aria-hidden="true"/>
              </button>
              {!firstDraft && updateLogButton}
            </div>
          </div>
          {exportOpen && canPickExportPreset && !reviewingDraft && <div className="native-export-tray" role="region" aria-label={t("导出 Markdown", "Export Markdown")}>
            <div className="native-export-tray-head">
              <strong>{t("导出模式", "Export mode")}</strong>
              {defaultExportPreset && activeExportPreset === defaultExportPreset && <small>{t("当前默认", "Default")}</small>}
              <button type="button" className="native-tool native-export-close" aria-label={t("关闭导出选项", "Close export options")} onClick={() => setExportOpen(false)}>
                <X size={14} aria-hidden="true"/>
              </button>
            </div>
            <div className="native-export-pills" role="group" aria-label={t("Markdown 导出模式", "Markdown export mode")}>
              {PROJECT_EXPORT_PRESETS.map(option => (
                <button key={option.id} type="button" className={activeExportPreset === option.id ? "is-active" : undefined}
                  aria-pressed={activeExportPreset === option.id} disabled={Boolean(busy)}
                  onClick={() => setExportPreset(option.id)}>
                  {option.label[zh ? "zh" : "en"]}
                </button>
              ))}
            </div>
            <p className="native-export-hint">{activeExportMeta.summary[zh ? "zh" : "en"]}</p>
            <div className="native-export-actions">
              <button type="button" className="native-tool" disabled={Boolean(busy)} onClick={() => void exportMarkdown("copy", activeExportPreset)}>
                <Copy size={14} aria-hidden="true"/>{t("复制 Markdown", "Copy Markdown")}
              </button>
              <button type="button" className="native-primary" disabled={Boolean(busy)} onClick={() => void exportMarkdown("download", activeExportPreset)}>
                <Download size={14} aria-hidden="true"/>{t("下载 .md", "Download .md")}
              </button>
            </div>
          </div>}
          {!exportOpen && !reviewingDraft && !busy && !importNeeded && !firstDraft && !firstRunning && changed && hasChapters && <div className="native-change-banner" role="status">
            <span>{changeLabels.length ? `${t("当前对话有更新", "Chat updated")} · ${changeLabels.join(" · ")}` : t("当前对话有新内容可更新", "New content available in this chat")}</span>
            <button type="button" className="native-tool native-update-action" onClick={() => void stage()}>{t("预览更新", "Preview")}</button>
          </div>}
          {updateFeedback}
          {!reviewingDraft && !busy && projectDrafts.length > 0 && <ul className="native-draft-list" aria-label={t("更新草稿", "Update drafts")}>
            {projectDrafts.map(draft => {
              const ready = Boolean(draft.preview || draft.initialDocument);
              const paused = draft.batchRun;
              return <li key={draft.id}>
                <div><strong>{draft.initialDocument ? t("首版文档待保存", "First document ready to save")
                  : draft.preview ? t(`待核对 · ${draft.preview.changes.length} 条`, `${draft.preview.changes.length} changes to review`)
                    : paused ? t(`整理进度 · ${paused.completed} / ${paused.batches.length}`, `Analysis · ${paused.completed} / ${paused.batches.length}`)
                      : t("首版整理已暂停", "First document paused")}</strong>
                <small title={draft.title}>{draft.title}</small></div>
                <button className="native-tool native-update-action" type="button" disabled={!ready && draft.conversationId !== conversationId}
                  title={!ready && draft.conversationId !== conversationId ? t("切回该对话后继续整理", "Return to this chat to resume") : undefined}
                  onClick={() => ready ? resumeReview(draft) : void stage(false, "retry-analysis")}>
                  {ready ? t("继续核对", "Continue review") : t("继续整理", "Resume analysis")}
                </button>
                {discardCandidate === draft.id ? <>
                  <button type="button" className="native-tool" onClick={() => setDiscardCandidate(undefined)}>{t("取消", "Cancel")}</button>
                  <button type="button" className="native-tool" onClick={() => discardDraft(draft)}>{t("确认丢弃", "Discard permanently")}</button>
                </> : <button type="button" className="native-tool" onClick={() => setDiscardCandidate(draft.id)}>{t("丢弃草稿", "Discard draft")}</button>}
              </li>;
            })}
          </ul>}
          {logOpen && !firstDraft && <ProjectUpdateLog id="native-project-update-log" entries={[...updateLog, ...project.sidecarGenerationLog ?? []].sort((a, b) => a.at - b.at)} zh={zh}/>}
          {question && citationFeedback}
          {question && <form key={question.index} className="native-update-question" aria-label={t("写作前确认", "Before writing")} onSubmit={event => {
            event.preventDefault();
            if (answerToConfirm) advanceQuestion({ text: answerToConfirm, optionIndex });
          }}>
            <div className="native-question-header"><CircleHelp size={15} aria-hidden="true"/><span>{t("写作前确认", "Before writing")}</span><small>{(questionIndex ?? 0) + 1} / {questions.length}</small></div>
            <h2 ref={reviewHeading} tabIndex={-1}>{question.item.text}</h2>
            <details><summary>{t("查看讨论原话", "See original wording")}</summary><blockquote>{question.item.quote}</blockquote>
              {questionOptions.filter(option => option.messageId !== question.item.messageId || !question.item.quote.includes(option.quote))
                .map(option => <blockquote key={option.label}>{option.quote}</blockquote>)}
            </details>
            {questionOptions.length === 1 && !customAnswer && <p className="native-single-proposal">{questionOptions[0].label}</p>}
            {questionOptions.length > 1 && <fieldset className="native-question-options" aria-label={t("可选答案", "Answer choices")}>
              {questionOptions.map((option, index) => <label key={option.label} data-selected={answerChoice === index || undefined}>
                <input type="radio" name="sidecar-question-answer" checked={answerChoice === index} onChange={() => editReview(review => ({ ...review, answerChoice: index }))}/>
                <span>{option.label}</span>
              </label>)}
            </fieldset>}
            {customAnswer && <textarea autoFocus value={answerDraft} maxLength={700} rows={2} onChange={event => editReview(review => ({ ...review, answerDraft: event.target.value }))}
              aria-label={t("你的决定", "Your decision")} placeholder={t("写下你的决定", "Write your decision")}/>}
            <div className="native-question-actions">
              <button type="button" className="native-tool native-question-custom" onClick={() => openReview()} disabled={Boolean(draftError)}>{t("稍后继续", "Resume later")}</button>
              {!customAnswer && <button type="button" className="native-tool" onClick={() => editReview(review => ({ ...review, answerChoice: "custom" }))}>{t("自定义回答", "Custom answer")}</button>}
              <button type="button" className="native-tool" onClick={() => advanceQuestion()}>{t("暂不决定", "Leave open")}</button>
              <button type="submit" className="native-primary" disabled={!answerToConfirm}>{questionOptions.length === 1 && !customAnswer ? t("采用此提案", "Use this proposal") : t("确认并继续", "Confirm and continue")}</button>
            </div>
          </form>}
        </section>}
        {showFirstWiki && firstDraft && <FirstWikiPanel key={firstDraft.id} draft={firstDraft} zh={zh}
          actionsHost={firstActionsHost} saving={busy === "applying"} stale={firstStale} onSave={applyFirstDocument}
          onSettings={() => void navigate({ type: "ATLAS_OPEN_AI_SETTINGS" })}/>}
        {!reviewingDraft && !firstDraft && busy !== "staging" && !reading && !hasChapters && <div className="native-empty-document">
            <FileText size={18} aria-hidden="true"/>
            <h2>{t("项目还没有记录", "No project notes yet")}</h2>
            <div className="native-empty-actions">
              {conversationId && !importNeeded && !projectDrafts.some(draft => draft.conversationId === conversationId) && <button type="button" className="native-primary" disabled={Boolean(busy)} onClick={() => void stage()}>
                <FileText size={15} aria-hidden="true"/>{t("生成首版", "Generate first document")}
              </button>}
              <button type="button" className={conversationId ? "native-tool" : "native-primary"} disabled={Boolean(busy)} onClick={() => startEdit()}><Plus size={15} aria-hidden="true"/>{t("新建章节", "New chapter")}</button>
            </div>
          </div>}
        {!reviewingDraft && hasChapters && <SidecarProjectWiki project={project} chapterId={reading ? chapterId : undefined} onRead={setChapterId} zh={zh} onOpen={openProject}
          onEdit={startEdit} onAdd={() => startEdit()} onSource={openNoteSource} showProjectTitle={false} compact/>}
        {preview && !question && <section className="native-review" aria-labelledby="native-review-title">
          <header className="native-review-header">
            <h2 id="native-review-title" ref={reviewHeading} tabIndex={-1}>{t("本轮更新", "Changes from this chat")}</h2>
            {updateLogButton}
          </header>
          {updateFeedback}
          <div className="native-review-scroll">
            {logOpen && <ProjectUpdateLog id="native-project-update-log" entries={updateLog} zh={zh}/>}
            {previewChanged && <p className="native-muted" role="status">{t("项目有新版本，草稿已保留。请先查看当前文档。", "The project has a newer version. Your draft is kept. Review the current document first.")}</p>}
            {citationFeedback}
            {Boolean(preview.directoryError) && <p className="native-muted" role="status">{outlineUnavailable}</p>}
            {preview.removed > 0 && <p className="native-muted">{t(`有 ${preview.removed} 条原消息不在当前采集中。已保存的文档和引用仍可查看。`, `${preview.removed} messages are missing from this capture. Saved text and citations are still available.`)}</p>}
            {pendingEdits > 0 && <div className="native-review-banner" role="status">
              <span>{t(`${pendingEdits} 项会改动已有正文，请确认后写入。`, `${pendingEdits} edits change existing text and need confirmation.`)}</span>
              {!previewChanged && <button type="button" className="native-tool native-update-action" disabled={Boolean(busy)} onClick={() => editReview(review => {
                const next = { ...review.choices };
                preview.changes.forEach((item, index) => {
                  const target = item.target ? preview.project.sections.find(section => section.id === item.target) : undefined;
                  if (item.operation && target && replacementPoint(target, item)) next[index] = "approve_edit";
                });
                return { ...review, choices: next };
              })}>{t("全部确认", "Confirm all")}</button>}
            </div>}
            {preview.changes.filter(item => !item.operation).length > 1 && <div className="native-review-bulk">
              <span>{t(`共 ${preview.changes.length} 项变更`, `${preview.changes.length} changes`)}</span>
              <button type="button" className="native-tool" disabled={Boolean(busy)} onClick={() => editReview(review => {
                const regularIndices = preview.changes.map((item, idx) => (!item.operation ? idx : -1)).filter(idx => idx >= 0);
                const allSelected = regularIndices.every(idx => Boolean(review.choices[idx]));
                const next = { ...review.choices };
                for (const idx of regularIndices) {
                  if (allSelected) delete next[idx];
                  else if (!next[idx]) next[idx] = "include";
                }
                return { ...review, choices: next };
              })}>
                {preview.changes.every((item, idx) => item.operation || Boolean(choices[idx])) ? t("取消全选", "Unselect all") : t("全选新增", "Select all")}
              </button>
            </div>}
            {[...changeGroups].map(([destinationId, indices]) => {
              const groupChapter = preview.project.sections.find(section => section.id === destinationId);
              return <section className="native-change-group" key={destinationId}>
                <h3>{groupChapter?.wikiDisplayTitle || groupChapter?.title || t("项目记录", "Project notes")}<small>{indices.length}</small></h3>
                <ul className="native-changes">{indices.map(index => {
                const item = preview.changes[index];
                const target = preview.project.sections.find(section => section.id === item.target);
                const destination = destinations[index] ?? item.appendTo ?? "";
                const prior = target && replacementPoint(target, item);
                const latestTarget = previewChanged && target ? project.sections.find(section => section.id === target.id) : undefined;
                const allowDecision = !item.operation && item.kind !== "open_question" && (!target || Boolean(prior));
                const editLabel = item.operation === "remove" ? t("删除旧段落", "Remove old paragraph")
                  : item.operation === "merge" ? t("合并到旧段落", "Merge into old paragraph") : t("替换旧段落", "Replace old paragraph");
                return <li key={index} data-requires-confirmation={Boolean(item.operation) || undefined}>
                  {!item.operation && <input className="native-change-checkbox" type="checkbox" id={`native-change-${index}`} checked={Boolean(choices[index])} disabled={Boolean(busy)} onChange={event => editReview(review => {
                    const next = { ...review.choices };
                    if (event.target.checked) next[index] = "include";
                    else delete next[index];
                    return { ...review, choices: next };
                  })}/>}
                  <div className="native-change-content">
                    <div className="native-change-heading">
                      {item.operation ? <strong className="native-change-title">{item.title}</strong> : <label className="native-change-title" htmlFor={`native-change-${index}`}>{item.title}</label>}
                      <small className="native-change-kind" data-kind={item.operation ? "edit" : answers[index] || choices[index] === "decide" ? "decided" : item.kind}>{item.operation ? editLabel : prior && choices[index] === "decide" ? t("替换正文", "Replace paragraph")
                        : answers[index] || choices[index] === "decide" ? t("你的决定", "Your decision")
                        : target ? t("待核对变更", "Change to review")
                        : item.kind === "open_question" ? t("待决", "Open") : item.kind === "proposal" ? t("提案", "Proposal") : destination ? t("补充正文", "Add to chapter") : null}</small>
                    </div>
                    {prior && <div className="native-change-before"><small>{t("原文", "Before")}</small><blockquote>{prior.text}</blockquote></div>}
                    <p>{answers[index]?.text ?? item.text}</p>
                    {item.table && item.operation !== "remove" && !answers[index] && <details className="native-change-table"><summary>{t("复用原表", "Reuse source table")}</summary>
                      <ReaderGuide content={item.table} zh={zh} complete hideCitationAnnotations/>
                    </details>}
                    <div className="native-change-actions">
                      {!target && projectChapters.length > 0 && <label className="native-change-destination">
                        <select id={`native-change-destination-${index}`} title={projectChapters.find(chapter => chapter.id === destination)?.title} aria-label={t(`「${item.title}」写入位置`, `Save ${item.title} to`)} value={destination} disabled={Boolean(busy)}
                          onChange={event => {
                            const next = event.currentTarget.value;
                            editReview(review => ({ ...review, destinations: { ...review.destinations, [index]: next } }));
                            requestAnimationFrame(() => document.getElementById(`native-change-destination-${index}`)?.focus({ preventScroll: true }));
                          }}>
                          <option value="">{t("项目记录", "Project notes")}</option>
                          {projectChapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.wikiDisplayTitle || chapter.title}</option>)}
                        </select>
                      </label>}
                      {destination && destination === item.appendTo && item.afterHeading && <small className="native-change-subsection">{item.afterHeading.replace(/^#+\s/u, "")}</small>}
                      {target && !prior && <details className="native-change-current">
                        <summary>{previewChanged ? t("草稿依据的版本", "Draft’s base version") : t("当前文档", "Current document")} · {target.title}</summary>
                        <blockquote>{target.body}</blockquote>
                      </details>}
                      {latestTarget && latestTarget.body !== target?.body && <details className="native-change-current">
                        <summary>{t("当前版本", "Current version")} · {latestTarget.title}</summary><blockquote>{latestTarget.body}</blockquote>
                      </details>}
                      <button type="button" className="native-tool" onClick={() => openSource({ title: preview.source.title, messageId: item.messageId, messages: preview.version.messages })}>{t("查看原话", "View source")}</button>
                      {item.kind === "open_question" && <button type="button" className="native-tool" disabled={!choices[index] || Boolean(busy)}
                        onClick={() => editReview(review => {
                          const answer = review.answers[index];
                          return { ...review, questionIndices: [index], questionIndex: 0,
                            answerChoice: answer?.optionIndex ?? (answer && item.options?.length ? "custom" : undefined), answerDraft: answer?.text ?? "" };
                        })}>
                        {answers[index] ? t("修改回答", "Edit answer") : t("现在回答", "Answer now")}
                      </button>}
                      {allowDecision && <label><input type="checkbox" checked={choices[index] === "decide"} disabled={!choices[index] || Boolean(busy)} onChange={event => editReview(review => ({ ...review, choices: { ...review.choices, [index]: event.target.checked ? "decide" : "include" } }))}/>{target ? t("替换并确认", "Replace and confirm") : t("设为决定", "Mark as decided")}</label>}
                      {item.operation && <label className="native-confirm-edit"><input type="checkbox" checked={choices[index] === "approve_edit"} disabled={!prior || Boolean(busy) || previewChanged}
                        onChange={event => editReview(review => {
                          const next = { ...review.choices };
                          if (event.target.checked) next[index] = "approve_edit";
                          else delete next[index];
                          return { ...review, choices: next };
                        })}/>{t(`确认${editLabel}`, `Confirm: ${editLabel}`)}</label>}
                    </div>
                  </div>
                </li>;
                })}</ul>
              </section>;
            })}
            {outline.length > 0 && <details className="native-preview-outline">
              <summary>{t("章节建议", "Suggested chapters")}</summary>
              <ul>{outline.map(page => <li key={page.notes[0].id}>
                <strong>{page.title}</strong>
                <ul>{page.notes.map(note => <li key={note.id}>{note.saved && <small>{t("移入已有条目", "Move saved note")} · </small>}{note.title}</li>)}</ul>
              </li>)}</ul>
              <label><input type="checkbox" checked={useOutline} disabled={Boolean(busy)} onChange={event => editReview(review => ({ ...review, useOutline: event.target.checked }))}/>
                {t("写入时应用章节建议", "Apply suggested chapters when saving")}
              </label>
            </details>}
          </div>
          <footer className="native-review-footer">
            {!hasSelection && (preview.unmatchedCitations || pendingEdits > 0) && !previewChanged && (
              <p className="native-review-disabled-hint">
                {pendingEdits > 0
                  ? t("请先勾选要写入的条目或确认上方旧段落修改。", "Select items or confirm an existing-text edit above first.")
                  : t("请至少勾选一项要写入的更新。", "Select at least one change to apply.")}
              </p>
            )}
            <small aria-live="polite">{t(`已选 ${selectedCount} / ${preview.changes.length}`, `${selectedCount} of ${preview.changes.length} selected`)}</small>
            <button type="button" className="native-tool" onClick={() => openReview()} disabled={Boolean(busy || draftError)}>{t("稍后继续", "Resume later")}</button>
            <button type="button" className="native-primary" onClick={apply} disabled={Boolean(busy || previewChanged || updateIssue?.action === "refresh-preview" || draftError || (preview.unmatchedCitations || pendingEdits) && !hasSelection)}>{hasSelection ? t("写入所选", "Apply selected") : t("标记已核对", "Mark reviewed")}</button>
          </footer>
        </section>}
        </div>}
      </>}
      {screen === "project" && loaded && !project && !edit && <p role="status">{t("项目已移除。", "This project was removed.")}</p>}
      {status && !showUpdateCard && <ProjectNotice zh={zh} text={status} onDismiss={() => setStatus("")}/>}
      {error && !showUpdateCard && <ProjectNotice zh={zh} text={error} error onDismiss={() => setError("")}/>}
    </div>
    {showFirstWiki && <footer ref={setFirstActionsHost} className="first-wiki-actions native-first-actions"/>}
    {draftError && !sourceView && <p className="native-draft-error" role="alert">{draftError}</p>}
    {showUndo && project && <footer className="native-document-footer"><button type="button" className="native-tool" disabled={Boolean(busy)} onClick={() => void run("undoing", async signal => {
        const { undoProjectIncrement } = await import("./project-increment");
        signal.throwIfAborted();
        const saved = await undoProjectIncrement(project, zh);
        if (!signal.aborted) { showSaved(saved); setStatus(t("已撤销上次写入。", "Last update undone.")); }
      })}><Undo2 size={14} aria-hidden="true"/>{t("撤销上次写入", "Undo last update")}</button></footer>}
    {sourceView && <SidecarSourceReader source={sourceView} zh={zh} onBack={() => setSourceView(undefined)}/>}
    {trashCandidate && <SidecarSheet title={t("删除项目", "Delete project")} zh={zh} onClose={() => {
      if (busy !== "deleting") { setTrashCandidate(undefined); setError(""); }
    }} footer={<div className="native-trash-actions">
      <button type="button" disabled={busy === "deleting"} onClick={() => { setTrashCandidate(undefined); setError(""); }}>{t("取消", "Cancel")}</button>
      <button type="button" className="native-trash-confirm" disabled={busy === "deleting"} onClick={confirmTrash}>{t("移到回收站", "Move to Trash")}</button>
    </div>}>
      <p>{t(`「${trashCandidate.title}」可以从工作台回收站恢复。`, `“${trashCandidate.title}” can be restored from Workbench Trash.`)}</p>
      {error && <p role="alert">{error}</p>}
    </SidecarSheet>}
  </main>;
}
