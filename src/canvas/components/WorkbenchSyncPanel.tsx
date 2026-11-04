import {ChatGPTFileImport} from "./ChatGPTFileImport";
import { AIPlatformFilter } from "./AIPlatformFilter";
import { conversationPlatformGroup, platformName } from "../../shared/platforms";
import { BookOpen, CheckCircle2, CircleAlert, FolderPlus, LoaderCircle, Pause, RefreshCw, Search, SearchX, Square, SquareCheck, SquareMinus, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import { memo, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Conversation, ConversationMessage, ImportJob } from "../../shared/types";
import type { FocusSession } from "../../shared/focus-session";
import type { MessageSourceRange } from "../../shared/message-location";
import { messageFullTextSearch, type MessageSearchHit } from "../../search/message-fulltext";
import { normalizeSearch } from "../../search/query";
import { savedSidecarProjects } from "../../sidecar/project-model";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import { usePreferences } from "../preferences";
import { useStableCallback } from "../hooks/useStableCallback";

const WorkbenchSourceList = memo(function WorkbenchSourceList({ visible, selectedIds, readyIds, activeIds, retryingIds, disabled, emptyMessage, emptyHint, onSelectedIds, zh, matches, related, onOpen, onOpenProject }: {
  matches?: Map<string, MessageSearchHit>;
  related?: Map<string, FocusSession[]>;
  onOpen?: (id: string, message?: ConversationMessage, sourceRange?: MessageSourceRange) => void;
  onOpenProject?: (id: string) => void;
  visible: Conversation[];
  selectedIds: Set<string>;
  readyIds: Set<string>;
  activeIds: Set<string>;
  retryingIds: Set<string>;
  disabled: boolean;
  emptyMessage: string;
  emptyHint: string;
  onSelectedIds: (ids: Set<string>) => void;
  zh: boolean;
}) {
  const toggle = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    onSelectedIds(next);
  };
  const hydrationLabel = (conversation: Conversation) => readyIds.has(conversation.id) ? zh ? "已同步" : "Synced"
    : retryingIds.has(conversation.id) ? zh ? "等待重试" : "Waiting to retry"
    : activeIds.has(conversation.id) || conversation.hydrationState === "syncing" ? zh ? "同步中" : "Syncing"
    : ["retry_wait", "rate_limited"].includes(conversation.hydrationState ?? "") ? zh ? "等待重试" : "Waiting to retry"
    : conversation.hydrationState === "failed" ? zh ? "同步失败" : "Sync failed"
    : conversation.hydrationState === "queued" ? zh ? "已排队" : "Queued"
    : zh ? "待同步" : "Pending";
  // Slots for a project tag or a read button exist only when some shown row has one, so the columns stay aligned
  // without empty space between the sync state and the platform.
  const projectSlot = Boolean(related && visible.some(conversation => related.get(conversation.id)?.length)), readSlot = Boolean(onOpen && visible.some(conversation => conversation.messageCount != null));
  return <div className="workbench-sync-list" role="group" aria-label={zh ? "选择本次使用的对话" : "Choose conversations for this task"}>
    {visible.map((conversation) => {
      // A row selects; reading the original and opening a project it belongs to are small actions at its end.
      const match = matches?.get(conversation.id), projects = related?.get(conversation.id) ?? [];
      return <div key={conversation.id} className={`workbench-sync-item ${selectedIds.has(conversation.id) ? "is-selected" : ""}`}><label><input type="checkbox" checked={selectedIds.has(conversation.id)} disabled={disabled} onChange={() => toggle(conversation.id)} /><span className="workbench-sync-copy"><span title={conversation.title}>{conversation.title}</span>{match ? <span className="workbench-sync-match">{match.summary}</span> : null}</span></label>
        {projects.length ? <button type="button" className="workbench-source-projects" title={projects.map(project => project.title).join("、")} onClick={() => onOpenProject?.(projects[0].id)} disabled={!onOpenProject}>{zh ? `${projects.length} 个项目` : `${projects.length} ${projects.length > 1 ? "projects" : "project"}`}</button> : projectSlot ? <span className="workbench-source-projects" aria-hidden="true" /> : null}
        <small className={`workbench-source-state ${readyIds.has(conversation.id) ? "is-ready" : "is-pending"}`}>{hydrationLabel(conversation)}</small>
        <small className="workbench-source-platform">{platformName(conversation.platform,zh?"zh-CN":"en")}</small>
        {onOpen && conversation.messageCount != null ? <button type="button" className="workbench-source-read" aria-label={zh ? `阅读原文：${conversation.title}` : `Read: ${conversation.title}`} title={zh ? "阅读原文" : "Read original"} onClick={() => onOpen(conversation.id, match?.message, match?.sourceRange)}><BookOpen size={15} aria-hidden="true" /></button> : readSlot ? <span className="workbench-source-read" aria-hidden="true" /> : null}
      </div>;
    })}
    {!visible.length ? <div className="workbench-sync-empty"><div className="workbench-sync-empty-icon" aria-hidden="true"><SearchX size={20} /></div><strong>{emptyMessage}</strong><span>{emptyHint}</span></div> : null}
  </div>;
});

export const WorkbenchSyncPanel = memo(function WorkbenchSyncPanel({ conversations, importJob, importSource, selectedIds, onSelectedIds, onScan, onHydrate, onZip, onPause, onResume, onConnect, heading, onToggle, expanded = true, compact = false, initialImport = false, controlsHost,statusHost, sessions, onOpen, onOpenProject, onLinkProject, onUseSources }: {
  onUseSources?: (ids: string[]) => void;
  /** Saved projects: each row says which ones it belongs to, and selected rows can join one. */
  sessions?: FocusSession[];
  onOpen?: (id: string, message?: ConversationMessage, sourceRange?: MessageSourceRange) => void;
  onOpenProject?: (id: string) => void;
  onLinkProject?: (projectId: string, conversationIds: string[]) => Promise<void>;
  controlsHost?:HTMLElement|null;statusHost?:HTMLElement|null;
  expanded?: boolean;
  initialImport?: boolean;
  compact?: boolean;
  heading?: ReactNode;
  onToggle?: () => void;
  conversations: Conversation[];
  importJob: ImportJob | null;
  importSource: "web" | "zip";
  selectedIds: Set<string>;
  onSelectedIds: (ids: Set<string>) => void;
  onPrioritize: (id: string) => void | Promise<boolean>;
  onScan: () => void;
  onHydrate: (ids: string[]) => void | Promise<boolean>;
  onZip: (file: File) => void;
  onPause: () => void;
  onResume?: () => void;
  onConnect: () => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const changeSelection = useStableCallback(onSelectedIds);
  const listRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLDivElement>(null);
  const [searchLayout, setSearchLayout] = useState<{list:number;footer:number}>();
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query);
  const searchPending = query !== deferredQuery;
  const [filter, setFilter] = useState<"all" | "ready" | "pending">("all");
  const [platform, setPlatform] = useState("");
  const [visibleCount, setVisibleCount] = useState(8);
  const [submitting, setSubmitting] = useState(false);
  const [commandError, setCommandError] = useState("");
  const requestSync = async (ids: string[]) => {
    if (submitting) return;
    setSubmitting(true); setCommandError("");
    try {
      if (await onHydrate(ids) === false) setCommandError(zh ? "同步未启动，请检查连接后重试。" : "Sync did not start. Check the connection and retry.");
    } catch { setCommandError(zh ? "同步未启动，请重试。" : "Sync did not start. Try again."); }
    finally { setSubmitting(false); }
  };
  const projects = useMemo(() => {
    const byProject = new Map<string, FocusSession>();
    for (const session of savedSidecarProjects(sessions ?? [])) if (!byProject.has(session.canvasId ?? session.id)) byProject.set(session.canvasId ?? session.id, session);
    return [...byProject.values()];
  }, [sessions]);
  const related = useMemo(() => {
    const map = new Map<string, FocusSession[]>();
    for (const session of projects) for (const id of new Set([...session.sourceConversationIds, ...(session.sidecarConversationIds ?? [])])) map.set(id, [...map.get(id) ?? [], session]);
    return map;
  }, [projects]);
  const [joining, setJoining] = useState(false), [target, setTarget] = useState(""), [joined, setJoined] = useState<{ id: string; title: string; already: boolean }>();
  const titleRows = useMemo(() => conversations.map((item) => ({ item, title: item.title.toLocaleLowerCase() })).sort((a, b) => (b.item.sourceUpdatedAt ?? b.item.updatedAt) - (a.item.sourceUpdatedAt ?? a.item.updatedAt)), [conversations]);
  const readyIds = useMemo(() => new Set(conversations.filter(isCurrentHydrationComplete).map((item) => item.id)), [conversations]);
  const platformSources = useMemo(() => conversations.filter(item => !platform || conversationPlatformGroup(item.platform) === platform), [conversations,platform]);
  const platformReady = platformSources.filter(item => readyIds.has(item.id)).length;
  const activeKey = JSON.stringify(importJob?.activeIds ?? []), retryingKey = JSON.stringify(importJob?.retryingIds ?? []);
  const activeIds = useMemo(() => new Set<string>(JSON.parse(activeKey)), [activeKey]);
  const retryingIds = useMemo(() => new Set<string>(JSON.parse(retryingKey)), [retryingKey]);
  const selectedPendingIds = useMemo(() => conversations.filter((item) => (item.platform === "chatgpt" || item.nativeHistorySourceId) && selectedIds.has(item.id) && !readyIds.has(item.id)).map((item) => item.id), [conversations, selectedIds, readyIds]);
  const selectedCount = useMemo(() => conversations.filter((item) => selectedIds.has(item.id)).length, [conversations, selectedIds]);
  const selectedActive = selectedPendingIds.filter(id => importJob?.activeIds?.includes(id)).length;
  const selectedWaiting = selectedPendingIds.filter(id => importJob?.retryingIds?.includes(id)).length;
  const selectedQueued = selectedPendingIds.filter(id => !activeIds.has(id));
  const queueHead = new Set(importJob?.pendingIds?.filter(id => !activeIds.has(id)).slice(0, selectedQueued.length));
  // A subset of an earlier bulk selection may still be deep in the queue.
  // Let it be promoted again until it actually reaches the next waiting slots.
  const selectedAccepted = selectedPendingIds.length > 0 && selectedPendingIds.every(id => activeIds.has(id) || importJob?.priorityPendingIds?.includes(id)) && selectedQueued.every(id => queueHead.has(id));
  const needsConnection = importJob?.status === "auth_required" || importJob?.status === "connecting" && importJob.diagnostic?.success === false;
  const active = Boolean(importJob && ["connecting", "discovering", "syncing", "reconciling"].includes(importJob.status) && !needsConnection);
  const scanning = active && importSource !== "zip" && (importJob?.retryScope === "titles" || importJob?.phase === "discovering");
  const importingFile = active && importSource === "zip";
  const paused = importSource === "web" && importJob?.status === "paused";
  const complete = importJob && ["completed", "inventory_ready"].includes(importJob.status);
  const error = importJob && (["auth_required", "unavailable", "failed"].includes(importJob.status) || ["partial", "completed_with_warnings"].includes(importJob.status) && importJob.failed > 0 || needsConnection || importJob.native?.sources.some(source => source.error));
  // Titles match at once; message text is searched too, among the conversations the filters leave.
  const inFilter = useMemo(() => titleRows.filter(({ item }) => (!platform || conversationPlatformGroup(item.platform) === platform) && (filter === "all" || (filter === "ready") === readyIds.has(item.id))), [titleRows, filter, readyIds, platform]);
  const bodyQuery = normalizeSearch(deferredQuery.trim());
  const [bodySearch, setBodySearch] = useState<{ query: string; matches: Map<string, MessageSearchHit> }>();
  useEffect(() => {
    if (!bodyQuery || !onOpen) return;
    const controller = new AbortController();
    void messageFullTextSearch.searchConversations(bodyQuery, { conversationIds: inFilter.map(({ item }) => item.id), signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setBodySearch({ query: bodyQuery, matches: new Map(result.hits.map(hit => [hit.conversationId, hit])) }); })
      .catch(() => { if (!controller.signal.aborted) setBodySearch({ query: bodyQuery, matches: new Map() }); });
    return () => controller.abort();
  }, [bodyQuery, inFilter, onOpen]);
  const matches = bodySearch?.query === bodyQuery ? bodySearch.matches : undefined;
  const listed = useMemo(() => {
    const search = deferredQuery.trim().toLocaleLowerCase();
    return inFilter.filter(({ item, title }) => title.includes(search) || matches?.has(item.id)).map(({ item }) => item);
  }, [inFilter, deferredQuery, matches]);
  const visible = useMemo(() => listed.slice(0, visibleCount), [listed, visibleCount]);
  const matchingPendingIds = useMemo(() => {
    const selected: string[] = [], remaining: string[] = [];
    for (const item of listed) if ((item.platform === "chatgpt" || item.nativeHistorySourceId) && !readyIds.has(item.id)) (selectedIds.has(item.id) ? selected : remaining).push(item.id);
    return selected.concat(remaining);
  }, [listed, readyIds, selectedIds]);
  const allMatchingSelected = useMemo(() => listed.length > 0 && listed.every((item) => selectedIds.has(item.id)), [listed, selectedIds]);
  const someMatchingSelected = listed.some(item => selectedIds.has(item.id));
  const SelectionIcon = allMatchingSelected ? SquareCheck : someMatchingSelected ? SquareMinus : Square;
  const preserveSearchLayout = () => {
    if(searchLayout)return;
    const height=listRef.current?.getBoundingClientRect().height??0;
    if(height)setSearchLayout({list:Math.max(160,height),footer:footerRef.current?.getBoundingClientRect().height??0});
  };
  const selectionLabel=allMatchingSelected ? zh ? "取消全选" : "Clear selection" : query.trim() ? zh ? `全选搜索结果 ${listed.length} 条` : `Select ${listed.length} results` : zh ? `全选 ${listed.length} 条` : `Select all ${listed.length}`;
  const status = scanning ? zh ? `正在扫描标题 · 已发现 ${importJob?.discovered ?? 0} 条` : `Scanning titles · ${importJob?.discovered ?? 0} found`
    : importingFile ? importJob?.discovered ? zh ? `正在导入 · ${importJob.completed}/${importJob.discovered} 条` : `Importing · ${importJob.completed}/${importJob.discovered}` : zh ? "正在读取文件" : "Reading file"
      : active && importJob?.status === "connecting" ? zh ? (importJob?.native ? "正在连接 AI" : "正在连接 ChatGPT") : (importJob?.native ? "Connecting to AI" : "Connecting to ChatGPT")
      : active && importJob?.retryingIds?.length ? zh ? `正在等待重试 · ${importJob.retryingIds.length} 条` : `Waiting to retry · ${importJob.retryingIds.length}`
      : active && importJob?.retryScope === "selected" ? zh ? `正在同步 ${importJob.activeIds?.length ?? 0} 条 · 剩余 ${importJob.pendingIds.length} 条` : `Syncing ${importJob.activeIds?.length ?? 0} · ${importJob.pendingIds.length} remaining`
        : active ? zh ? `正在同步对话 · ${importJob?.completed ?? 0}/${importJob?.discovered ?? 0}` : `Syncing conversations · ${importJob?.completed ?? 0}/${importJob?.discovered ?? 0}`
        : paused ? zh ? `同步已暂停 · ${importJob?.pendingIds?.length ?? 0} 条待处理` : `Sync paused · ${importJob?.pendingIds?.length ?? 0} pending`
        : complete ? importSource === "zip" ? zh ? `已导入 ${importJob.completed} 条` : `${importJob.completed} imported` : importJob.retryScope === "titles" ? zh ? `扫描完成 · ${importJob.discovered} 条，勾选后同步正文` : `Scan complete · ${importJob.discovered} found. Select chats to sync.` : zh ? `同步完成 · ${readyIds.size} 条可用` : `Sync complete · ${readyIds.size} ready`
        : error ? importJob?.lastError || (importSource === "zip" && importJob?.failed ? zh ? `${importJob.completed} 条已导入 · ${importJob.failed} 条失败` : `${importJob.completed} imported · ${importJob.failed} failed` : needsConnection ? zh ? "请登录 ChatGPT 后重新扫描" : "Sign in to ChatGPT, then scan again" : zh ? "同步失败，请重试" : "Sync failed. Try again")
          : zh ? "对话材料" : "Conversation sources";
  const join = async () => {
    const project = projects.find(item => item.id === target), ids = conversations.filter(item => selectedIds.has(item.id)).map(item => item.id);
    if (!project || !ids.length || !onLinkProject || submitting) return;
    setSubmitting(true); setCommandError("");
    // Conversations the project already holds are not added again; the message says so instead of claiming an addition.
    const held = new Set([...project.sourceConversationIds, ...(project.sidecarConversationIds ?? [])]), already = ids.every(id => held.has(id));
    try { if (!already) await onLinkProject(project.id, ids); setJoined({ id: project.id, title: project.title, already }); setJoining(false); setTarget(""); }
    catch (failure) { setCommandError(failure instanceof Error ? failure.message : zh ? "加入失败，请重试。" : "Could not add. Try again."); }
    finally { setSubmitting(false); }
  };
  const toggleMatching = () => {
    const next = new Set(selectedIds);
    for (const item of listed) {
      if (allMatchingSelected) next.delete(item.id);
      else next.add(item.id);
    }
    onSelectedIds(next);
  };

  const introductory=initialImport&&!conversations.length&&!active&&!error&&!paused&&!complete;
  const Header = heading ? "summary" : "div";
  const controls=<div className={`workbench-sync-controls${introductory?" is-import-choice":""}`} onClick={heading ? (event) => event.stopPropagation() : undefined}>
        <button type="button" className={!introductory&&!conversations.length&&!needsConnection?"primary":undefined} onClick={onScan} disabled={Boolean(active) || submitting} aria-label={introductory?zh?"导入":"Import":undefined}><RefreshCw size={introductory?22:14} />{introductory?<><strong>{zh?"导入":"Import"}</strong><small>{zh?"自动检测 AI · 读取账号历史":"Detect AI · read account history"}</small></>:zh?"导入":"Import"}</button>
        <ChatGPTFileImport onImport={onZip} disabled={Boolean(active) || submitting} ariaLabel={introductory?zh?"导入对话文件":"Import conversation files":undefined}><Upload size={introductory?22:14} />{introductory?<><strong>{zh?"导入对话文件":"Import conversation files"}</strong><small>ZIP / JSON / Markdown / TXT</small></>:zh?"导入文件":"Import files"}</ChatGPTFileImport>
        {needsConnection && importSource === "web" ? <button type="button" className="primary" onClick={onConnect}>{importJob?.native ? zh ? "打开 AI 后重试" : "Retry after opening AI" : zh ? "打开 ChatGPT" : "Open ChatGPT"}</button> : null}
        {paused && onResume ? <button type="button" onClick={onResume}>{zh ? "继续同步" : "Resume sync"}</button> : null}
        {error && !needsConnection && importSource === "web" && importJob?.failedIds?.length ? <button type="button" disabled={submitting} onClick={() => void requestSync(importJob.failedIds)}>{zh ? `重试失败 ${importJob.failedIds.length} 条` : `Retry ${importJob.failedIds.length} failed`}</button> : null}
        {active && importSource === "web" ? <button type="button" onClick={onPause}><Pause size={13} />{zh ? "暂停" : "Pause"}</button> : null}
      </div>;
  const syncStatus=active || error || paused || !compact && complete ? <div className="workbench-sync-status-slot"><div className={`workbench-sync-status ${active ? "workbench-sync-activity" : "workbench-sync-notice"}`} role="status">{active ? <LoaderCircle className="workbench-sync-spinner" size={14} aria-hidden="true" /> : error ? <CircleAlert size={14} aria-hidden="true" /> : paused ? <Pause size={14} aria-hidden="true" /> : <CheckCircle2 size={14} aria-hidden="true" />}<span>{compact ? [active || error || paused ? status : "", selectedCount > 0 ? zh ? `已选 ${selectedCount} 条` : `${selectedCount} selected` : ""].filter(Boolean).join(" · ") : status}</span>{active && !scanning && importJob && importJob.retryScope !== "selected" && importJob.discovered > 0 ? <progress value={importJob.completed} max={Math.max(1, importJob.discovered)} aria-label={zh ? "同步进度" : "Sync progress"} /> : null}</div></div>:null;
  const top = <Header className="workbench-sync-top" onClick={onToggle ? (event) => { event.preventDefault(); onToggle(); } : undefined}><div className="workbench-sync-heading">{heading}{statusHost?null:syncStatus?syncStatus : !heading && !compact ? <strong>{conversations.length ? zh ? "对话材料" : "Conversation sources" : zh ? "添加对话" : "Add conversations"}</strong> : null}</div>
      {controlsHost?createPortal(controls,controlsHost):controls}
    </Header>;

  const content = <section className="workbench-sync" aria-label={zh ? "同步与选择对话" : "Sync and choose conversations"}>
    {statusHost?createPortal(syncStatus,statusHost):null}
    {!heading ? top : null}
    {expanded && conversations.length > 0 ? <>
      <div className="workbench-platform-row"><AIPlatformFilter conversations={conversations} value={platform} zh={zh} onChange={value=>{setPlatform(value);setVisibleCount(8);setSearchLayout(undefined);if(listRef.current)listRef.current.scrollTop=0;}}/></div>
      <div className="workbench-sync-toolbar">
      <div className="workbench-sync-tabs" role="tablist" aria-label={zh ? "对话同步状态" : "Conversation sync status"}>{([
        { id: "all", label: zh ? "全部" : "All", count: platformSources.length },
        { id: "ready", label: zh ? "已同步" : "Synced", count: platformReady },
        { id: "pending", label: zh ? "待同步" : "Pending", count: platformSources.length - platformReady },
      ] as const).map((tab) => <button key={tab.id} type="button" role="tab" aria-selected={filter === tab.id} onClick={() => { setFilter(tab.id); setVisibleCount(8); if (listRef.current) listRef.current.scrollTop = 0; }}><span>{tab.label}</span> <span className="source-count">{tab.count}</span></button>)}</div>
      <div className="workbench-sync-selection-actions"><label className="workbench-sync-search"><Search size={14} aria-hidden="true" /><span className="sr-only">{zh ? "搜索对话标题" : "Search conversation titles"}</span><input value={query} onFocus={preserveSearchLayout} onBlur={() => {if(!query.trim())setSearchLayout(undefined);}} onChange={(event) => { preserveSearchLayout(); setQuery(event.target.value); setVisibleCount(8); if (listRef.current) listRef.current.scrollTop = 0; }} placeholder={onOpen ? zh ? "搜索标题或内容" : "Search titles or content" : zh ? "搜索对话标题" : "Search conversation titles"} /></label></div>
      </div>
      <div className={`workbench-sync-list-viewport ${listed.length <= 8 ? "is-short" : ""} ${!listed.length ? "is-empty" : ""}`} style={searchLayout ? {height:searchLayout.list,minHeight:searchLayout.list,maxHeight:searchLayout.list} : undefined} ref={listRef}><WorkbenchSourceList visible={visible} selectedIds={selectedIds} readyIds={readyIds} activeIds={activeIds} retryingIds={retryingIds} disabled={false} emptyMessage={query.trim() ? zh ? "没有找到相关对话" : "No matching conversations" : platform && !platformSources.length ? zh ? "该平台暂无对话" : "No conversations from this AI yet" : filter === "ready" ? zh ? "暂无已同步的对话" : "No synced conversations yet" : zh ? "暂无待同步的对话" : "No pending conversations"} emptyHint={query.trim() ? zh ? "试试其他关键词，或切换 AI 分类与同步状态。" : "Try another keyword, AI platform or sync filter." : platform && !platformSources.length ? zh ? "导入该平台的对话文件后，就会显示在这里。" : "Import a conversation file from this AI to see it here." : zh ? "切换同步状态查看其他对话。" : "Switch the sync filter to see other conversations."} onSelectedIds={changeSelection} zh={zh} matches={matches} related={related} onOpen={onOpen} onOpenProject={onOpenProject} />{listed.length > visibleCount ? <button type="button" className="workbench-sync-more" onClick={() => setVisibleCount((count) => count + 40)}>{zh ? `加载更多（已显示 ${visible.length}/${listed.length} 条）` : `Load more (${visible.length}/${listed.length} shown)`}</button> : null}</div>
      <div ref={footerRef} className="workbench-sync-footer" style={searchLayout?.footer ? { minHeight: searchLayout.footer } : undefined}>
        <div className="workbench-selection-buttons">
          <button className="workbench-match-selection" title={selectionLabel} aria-label={selectionLabel} aria-pressed={allMatchingSelected ? true : someMatchingSelected ? "mixed" : false} type="button" onClick={toggleMatching} disabled={!listed.length || searchPending}><SelectionIcon size={15} aria-hidden="true" />{zh ? "全选" : "Select all"}</button>
          {selectedCount ? <div className="workbench-selection-summary"><span>{zh ? `已选 ${selectedCount} 条` : `${selectedCount} selected`}</span><button className="workbench-footer-icon" type="button" aria-label={zh ? `清空已选 ${selectedCount} 条` : `Clear all ${selectedCount} selected`} title={zh ? "清空选择" : "Clear selection"} onClick={() => onSelectedIds(new Set())}><X size={14} aria-hidden="true" /></button></div> : null}
        </div>
        <div className="workbench-footer-actions">
          {active && selectedAccepted ? <small className="workbench-selection-progress" role="status" title={selectedWaiting ? zh ? "平台限流或连接波动，正在等待重试" : "Waiting to retry after a platform or connection error" : zh ? "所选对话正在同步，排队项将优先读取" : "Selected conversations are syncing; queued selections have priority"}><span className="workbench-progress-dot" aria-hidden="true" />{selectedWaiting ? zh ? `${selectedWaiting} 等待重试` : `${selectedWaiting} waiting to retry` : [selectedActive ? zh ? `${selectedActive} 同步中` : `${selectedActive} syncing` : "", selectedPendingIds.length > selectedActive ? zh ? `${selectedPendingIds.length - selectedActive} 排队` : `${selectedPendingIds.length - selectedActive} queued` : ""].filter(Boolean).join(" · ")}</small> : null}
          {selectedCount > 0 && projects.length > 0 && onLinkProject && !joining ? <button className="workbench-footer-icon" type="button" aria-label={zh ? "加入项目" : "Add to project"} title={zh ? "加入项目" : "Add to project"} onClick={() => { setJoining(true); setJoined(undefined); setCommandError(""); }}><FolderPlus size={16} aria-hidden="true" /></button> : null}
          {selectedCount > 0 && onUseSources ? <button className="workbench-use-sources" type="button" aria-label={zh ? `用于本次整理 ${selectedCount} 条` : `Use ${selectedCount} for this task`} onClick={() => onUseSources(conversations.filter(item => selectedIds.has(item.id)).map(item => item.id))}>{zh ? "用于本次整理" : "Use for this task"}</button> : null}
          {matchingPendingIds.length > 0 && !selectedCount ? <button type="button" disabled={Boolean(active) || searchPending || submitting} onClick={() => void requestSync(matchingPendingIds)}>{submitting ? zh ? "正在提交同步…" : "Requesting sync…" : query.trim() || filter !== "all" || platform ? zh ? `同步当前结果 ${matchingPendingIds.length} 条` : `Sync ${matchingPendingIds.length} matching` : zh ? `同步全部 ${matchingPendingIds.length} 条` : `Sync all ${matchingPendingIds.length}`}</button> : null}
          {selectedPendingIds.length > 0 && !(active && selectedAccepted) ? <button type="button" className="primary" disabled={scanning || importingFile || submitting} aria-label={submitting ? zh ? "正在提交同步…" : "Requesting sync…" : active ? zh ? `优先同步所选 ${selectedPendingIds.length} 条` : `Prioritize ${selectedPendingIds.length} selected` : zh ? `同步所选 ${selectedPendingIds.length} 条` : `Sync ${selectedPendingIds.length} selected`} onClick={() => void requestSync(selectedPendingIds)}>{submitting ? zh ? "提交中…" : "Requesting…" : active ? zh ? "优先同步" : "Sync first" : zh ? "同步所选" : "Sync selected"}</button> : null}
        </div>
      </div>
    </> : null}
    {joining && selectedCount && onLinkProject ? <form className="workbench-sync-join" onSubmit={event => { event.preventDefault(); void join(); }}><select aria-label={zh ? "加入哪个项目" : "Choose a project"} value={target} onChange={event => setTarget(event.target.value)}><option value="">{zh ? "选择项目" : "Choose project"}</option>{projects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select><button type="submit" className="primary" disabled={!target || submitting}>{zh ? `加入 ${selectedCount} 条` : `Add ${selectedCount}`}</button><button type="button" onClick={() => setJoining(false)}>{zh ? "取消" : "Cancel"}</button></form> : null}
    {joined ? <p className="workbench-sync-joined" role="status">{joined.already ? zh ? `所选对话已在「${joined.title}」中。` : `The selected conversations are already in "${joined.title}".` : zh ? `已加入「${joined.title}」，在项目里点更新即可整理进来。` : `Added to "${joined.title}". Update the project to organize them.`}{onOpenProject ? <button type="button" onClick={() => onOpenProject(joined.id)}>{zh ? "查看项目" : "View project"}</button> : null}</p> : null}
    {commandError ? <p className="workbench-sync-command-error" role="alert">{commandError}</p> : null}
  </section>;
  return heading ? <>{top}{content}</> : content;
});
