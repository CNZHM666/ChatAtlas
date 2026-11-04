import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, LoaderCircle, History, ArrowUp, Square, Search, ChevronRight, Sparkles, X } from "lucide-react";
import type { Conversation } from "../../shared/types";
import type { FocusEvidence, FocusMode, FocusScope, FocusSession } from "../../shared/focus-session";
import { eligibleHomeProjects, homeTaskMode, planHomeTask, retrieveHomeTask, type HomeTaskPlan } from "../../ai/home-task";
import { searchKnowledge } from "../../sidecar/knowledge-search";
import { savedSidecarProjects } from "../../sidecar/project-model";
import { createAtlasAI } from "../../ai/atlas-ai";
import { getAISettings } from "../../storage/knowledge-graph";
import { effectiveAISettings, hasAIConnection } from "../../ai/ai-mode";
import { AIProviderValidationError, hasProviderPermission } from "../../ai/provider";
import { AIQuickSelect } from "./AIQuickSelect";
import { streamedSectionProse } from "../../ai/streamed-prose";
import { findHistory, historyRequest, type HistoryMatch } from "../../search/home-history";
import { answerHomeRecall } from "../../ai/home-recall";
import { ReaderGuide } from "./ReaderGuide";
import { getDatabase } from "../../storage/db";
import { sourceMessageSignature } from "../../shared/source-signature";
import type { ConversationMessage } from "../../shared/types";
import { saveHomeResult, type HomeActivity, type HomeAnswerResult } from "../../storage/home-results";
import { HomeRecallAnswer } from "./HomeRecallAnswer";
import { ReaderBackButton } from "./ReaderBackButton";
import { WorkspaceSourcePanel } from "./WorkspaceSourcePanel";
import {historyReaderContext} from "../../search/history-reader";
import type { ReaderSearchContext, MessageSourceRange } from "../../shared/message-location";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import { invalidateReaderMessages } from "../reader-message-cache";
import { getMessagesForConversation } from "../../storage/messages";
import { OriginalReader } from "./OriginalReader";
import { historyFragments, historyPlatformMatches, mergeHistoryFilters, parseHistoryFilters, type HistoryFilters, type HistoryFragment } from "../../search/history-fragments";
import { platformName } from "../../shared/platforms";

export function HomeTaskWorkspace({ goal, poolIds, conversations, sessions, projectsReady = true, zh, onStart, onContinue, onBack, onHydrate, onConfigureAI, requestedAction, onRead, initialRecord, initialActivity, onHistory, initialDraft, initialPaused, localSearch = false, readOnly = false, onOpenChapter }: {
  localSearch?: boolean; readOnly?:boolean;
  /** Opens a saved Wiki chapter a search found. */
  onOpenChapter?: (sessionId: string, sectionId: string) => void;
  requestedAction?: HomeTaskPlan["action"]; onRead?: (id: string, message?: ConversationMessage, sourceRange?: MessageSourceRange, search?:ReaderSearchContext) => void;
  initialRecord?: HomeAnswerResult; initialActivity?: HomeActivity; initialDraft?: string; initialPaused?: boolean; onHistory?: (record?: HomeAnswerResult, goal?: string, draft?: string, activity?: HomeActivity) => void;
  goal: string; poolIds: string[]; conversations: Conversation[]; sessions: FocusSession[]; projectsReady?: boolean; zh: boolean;
  onStart: (goal: string, mode: FocusMode, ids: string[], scope?: FocusScope) => void;
  onContinue?: (session: FocusSession, goal: string, poolIds: string[]) => void;
  onBack: (goal: string) => void; onHydrate: (ids: string[]) => void; onConfigureAI?: () => void;
}) {
  const [localMatches, setLocalMatches] = useState<HistoryMatch[]>([]);
  const [localOnly, setLocalOnly] = useState(localSearch && !initialRecord);
  const [localLoading, setLocalLoading] = useState(false), [localError, setLocalError] = useState("");
  const [searchDraft, setSearchDraft] = useState(initialDraft ?? goal), [visibleMatches, setVisibleMatches] = useState(10), [localCapped, setLocalCapped] = useState(false);
  const [source, setSource] = useState<{ session: FocusSession; reference: FocusEvidence; references: FocusEvidence[]; range?: MessageSourceRange; quote?: string; search?:ReaderSearchContext }>();
  const [reading, setReading] = useState<{ conversation: Conversation; messages: ConversationMessage[]; search: ReaderSearchContext; metadataMissing: boolean; target?: string }>();
  // Each matched conversation's messages, so hits can be grouped under the question they answer.
  const [originals, setOriginals] = useState<Map<string, ConversationMessage[]>>(new Map());
  // Removed condition chips and the undated opt-in belong to one search text.
  const [removed, setRemoved] = useState<{ goal: string; keys: string[] }>(), [undatedFor, setUndatedFor] = useState<string>();
  const [expanded, setExpanded] = useState<string[]>([]);
  const [opening, setOpening] = useState<string>();
  const searchBody = useRef<HTMLDivElement>(null);
  const returnPosition = useRef<{ conversationId: string; top: number }>();
  const [followup, setFollowup] = useState(initialDraft ?? "");
  const [answer, setAnswer] = useState<FocusSession | undefined>(initialRecord?.answer);
  const [record, setRecord] = useState<HomeAnswerResult | undefined>(initialRecord);
  const [saveError, setSaveError] = useState(false);
  const [draftAnswer, setDraftAnswer] = useState("");
  const [run, setRun] = useState(!readOnly && !initialRecord && (localSearch || !initialPaused));
  const [topicGoal, setTopicGoal] = useState(initialRecord?.topicGoal ?? goal);
  const [aiReady, setAIReady] = useState(false), [aiBusy, setAIBusy] = useState(false);
  const [retry, setRetry] = useState(0), [question, setQuestion] = useState(""), [detail, setDetail] = useState("");
  const [error, setError] = useState<{ message: string; code?: string; paths?: string[] }>(), [stage, setStage] = useState(initialRecord ? "answered" : initialPaused ? "cancelled" : "planning"), [pending, setPending] = useState<string[]>([]);
  const [clarifiedGoal, setClarifiedGoal] = useState(goal);
  const taskGoal = topicGoal === clarifiedGoal ? clarifiedGoal : `${topicGoal}\n追问：${clarifiedGoal}`;
  const lastRecord = useRef(initialRecord);
  const parsedSearch = useMemo(() => parseHistoryFilters(historyRequest(taskGoal).query, zh), [taskGoal, zh]);
  // Already organized knowledge comes first, as in the sidebar: the saved Wiki chapters that match, at most three.
  // Conversations the reader picked from the results to organize; a new search starts with none.
  const [picked, setPicked] = useState<{ goal: string; ids: string[] }>({ goal: "", ids: [] });
  const pickedIds = picked.goal === taskGoal ? picked.ids : [];
  const togglePick = (id: string) => setPicked({ goal: taskGoal, ids: pickedIds.includes(id) ? pickedIds.filter(item => item !== id) : [...pickedIds, id] });
  const savedProjects = useMemo(() => savedSidecarProjects(sessions), [sessions]);
  const knowledgeHits = useMemo(() => localOnly && parsedSearch.query ? searchKnowledge(parsedSearch.query, savedProjects, zh) : [], [localOnly, parsedSearch.query, savedProjects, zh]);
  const activeChips = parsedSearch.chips.filter(chip => !(removed?.goal === taskGoal && removed.keys.includes(chip.key)));
  const filterKey = JSON.stringify(mergeHistoryFilters(activeChips)), includeUndated = undatedFor === taskGoal;
  const localActivity = useRef<HomeActivity | undefined>(initialActivity), activitySave = useRef<Promise<void>>();
  const sourceRequest = useRef(0);
  useEffect(()=>()=>{sourceRequest.current++;},[]);
  useEffect(() => {
    if (reading || !returnPosition.current) return;
    const frame = requestAnimationFrame(() => {
      const body = searchBody.current, position = returnPosition.current;
      if (!body || !position) return;
      body.scrollTop = position.top;
      [...body.querySelectorAll<HTMLButtonElement>("[data-history-conversation]")].find(button => button.dataset.historyConversation === position.conversationId)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [reading]);
  const plan = useRef<HomeTaskPlan>(), controller = useRef<AbortController>();
  const background = useRef<Array<{ question: string; answer: string }>>([]);
  const inputs = useRef({ conversations, sessions, onStart, onContinue }); inputs.current = { conversations, sessions, onStart, onContinue };
  const poolKey = JSON.stringify(poolIds);
  const sourceRevision = JSON.stringify(conversations.filter(source => poolIds.includes(source.id)).map(source => [source.id, source.updatedAt, source.rawRevision, source.sourceRevision, source.importState, source.hydrationState]));
  useEffect(() => {
    if (!run || readOnly) return;
    let live = true; sourceRequest.current++; setLocalMatches([]); setAnswer(undefined); setDraftAnswer(""); setSource(undefined); setVisibleMatches(10); setLocalCapped(false);
    if (requestedAction === "answer") {
      const activity: HomeActivity = localActivity.current?.question === taskGoal && JSON.stringify(localActivity.current.poolIds) === poolKey ? {...localActivity.current, status:"started"} : {id:`history-search-${crypto.randomUUID()}`,kind:"search",question:taskGoal,topicGoal:taskGoal,poolIds:JSON.parse(poolKey),createdAt:Date.now(),status:"started"};
      if(localOnly){localActivity.current=activity;activitySave.current=saveHomeResult(activity).catch(()=>{if(live)setSaveError(true);});}
      setLocalLoading(true); setLocalError(""); setError(undefined);
      const filters = JSON.parse(filterKey) as HistoryFilters, searchQuery = parseHistoryFilters(historyRequest(taskGoal).query, zh).query;
      // Time and platform only narrow results; there must still be something to search for.
      if (!searchQuery) { setLocalLoading(false); setLocalError(zh ? "请再加一个主题词或关键词；时间和平台只用来筛选结果。" : "Add a topic or keyword; time and platform only filter the results."); return () => { live = false; }; }
      void findHistory(searchQuery, inputs.current.conversations.filter(source => JSON.parse(poolKey).includes(source.id) && historyPlatformMatches(source, filters)))
      .then(result => { if (live) { const matches=result.matches.filter(match => match.messages.length); setLocalMatches(matches);
        void Promise.all(matches.map(match => getMessagesForConversation(match.conversation.id).then(messages => [match.conversation.id, messages] as const).catch(() => [match.conversation.id, [] as ConversationMessage[]] as const))).then(entries => { if (live) setOriginals(new Map(entries)); }); setLocalCapped(result.capped); if(localOnly){const completed={...activity,status:"completed" as const,matchCount:matches.length,capped:result.capped};localActivity.current=completed;activitySave.current=(activitySave.current??Promise.resolve()).then(()=>saveHomeResult(completed)).catch(()=>{if(live)setSaveError(true);});} } }).catch(() => { if (live) { setLocalError(zh ? "本地搜索失败，请重试；原始对话保留。" : "Local search failed. Retry; originals are retained."); if(localOnly){const failed={...activity,status:"failed" as const};localActivity.current=failed;activitySave.current=(activitySave.current??Promise.resolve()).then(()=>saveHomeResult(failed)).catch(()=>{if(live)setSaveError(true);});} } }).finally(() => { if (live) setLocalLoading(false); }); }
    return () => { live = false; };
  }, [poolKey, sourceRevision, taskGoal, requestedAction, run, retry, zh, localOnly, readOnly, filterKey]);
  useEffect(() => {
    if (readOnly || !run || localOnly || !aiReady || aiBusy || !projectsReady) return;
    const abort = new AbortController(); controller.current = abort; let live = true;
    const diagnosticRunId=`history-search-${crypto.randomUUID()}`;
    void (async () => {
      setError(undefined); setPending([]); setAnswer(undefined); setDraftAnswer(""); setSaveError(false);
      try {
        const pool = new Set<string>(JSON.parse(poolKey));
        const sources = inputs.current.conversations.filter(source => pool.has(source.id));
        if (!sources.length || sources.length !== pool.size) throw new Error(zh ? "部分来源不可用，请返回调整材料后继续；已保存的记录仍可阅读。" : "Some sources are unavailable. Adjust sources to continue; saved results remain readable.");
        const projects = eligibleHomeProjects(inputs.current.sessions, pool);
        if (!plan.current) {
          setStage("planning");
          const settings = effectiveAISettings(await getAISettings());
          if (!hasAIConnection(settings) || !await hasProviderPermission(settings.baseUrl)) throw new Error(zh ? "请先连接 AI。" : "Connect AI first.");
          plan.current = await planHomeTask(createAtlasAI(settings, abort.signal, diagnosticRunId), taskGoal, sources, projects, zh, abort.signal, requestedAction);
        }
        abort.signal.throwIfAborted();
        const next = plan.current;
        if (next.action === "clarify") { setQuestion(next.question!); setStage("clarify"); return; }
        if (next.action === "continue") {
          const project = projects.find(project => project.id === next.projectId);
          if (!project || !inputs.current.onContinue) throw new Error(zh ? "项目暂时不可继续，请重试。" : "Project unavailable. Try again.");
          inputs.current.onContinue(project, taskGoal, [...pool]); return;
        }
        setStage("retrieving");
        const settings = effectiveAISettings(await getAISettings());
        const found = await retrieveHomeTask(next, sources, abort.signal, { provider: createAtlasAI(settings, abort.signal, diagnosticRunId), goal: taskGoal, zh, onStage: value => { if (live) setStage(value); } });
        if (!live) return;
        if (found.pending.length) { setPending(found.pending); setStage("sync"); return; }
        if (!found.ids.length) { setQuestion(found.question || (zh ? "已选材料中没有找到这个主题的足够依据，能补充一个项目名或术语吗？" : "No sufficient evidence for this subject. Add a project name or term?")); setStage("clarify"); return; }
        if (next.action === "answer" && !next.allSources && found.scope.kind === "goal") {
          setStage("answering");
          const response = await answerHomeRecall(taskGoal, sources, found, next.queries, zh, abort.signal, text => { if (live) setDraftAnswer(streamedSectionProse(text)); }, { runId:diagnosticRunId, history: background.current, onVerifying: () => { if (live) setStage("verifying"); } });
          abort.signal.throwIfAborted();
          const db = await getDatabase();
          const expected = (found.scope.blocks ?? []).flatMap(block => block.messageIds.map(messageId => ({ conversationId: block.conversationId, messageId, signature: block.messageSignatures[messageId] })));
          const original = (await Promise.all([...new Set([...response.evidence.map(ref => ref.messageId), ...expected.map(ref => ref.messageId)])].map(id => db.get("messages", id)))).filter((message): message is ConversationMessage => Boolean(message));
          if (expected.some(ref => !original.some(message => message.id === ref.messageId && message.conversationId === ref.conversationId && sourceMessageSignature(message.content) === ref.signature)) || response.evidence.some(ref => !original.some(message => message.id === ref.messageId && message.conversationId === ref.conversationId && sourceMessageSignature(message.content) === ref.sourceSignature))) throw new Error(zh ? "原始讨论已更新，请重新查找。" : "Original discussions changed. Search again.");
          const saved: HomeAnswerResult = { id: response.id, question: clarifiedGoal, topicGoal, poolIds: [...pool], answer: response, createdAt: Date.now(), previousId: lastRecord.current?.id };
          if (!live) return;
          try { await saveHomeResult(saved, abort.signal); } catch { abort.signal.throwIfAborted(); if (live) setSaveError(true); }
          if (live) { lastRecord.current = saved; setAnswer(response); setRecord(saved); setStage("answered"); setDraftAnswer(""); setRun(false); }
          return;
        }
        inputs.current.onStart(taskGoal, homeTaskMode(next), found.ids, found.scope);
      } catch (failure) {
        if (live && !abort.signal.aborted) {
          setError({ message: failure instanceof TypeError ? zh ? "连接 AI 失败，请检查网络或 AI 配置后重试。" : "Could not connect to AI. Check your connection or AI settings and retry." : failure instanceof Error ? failure.message : zh ? "任务未能完成，请重试。" : "Could not complete the task. Try again.", ...(failure instanceof AIProviderValidationError ? { code: failure.code, paths: failure.fieldPaths } : {}) });
          setDraftAnswer(""); setStage("error");
        }
      }
    })();
    return () => { live = false; abort.abort(); };
  }, [run, localOnly, aiReady, aiBusy, projectsReady, retry, poolKey, sourceRevision, taskGoal, clarifiedGoal, topicGoal, zh, requestedAction, initialRecord?.id, readOnly]);
  const busy = !localOnly && run && aiReady && !["answered", "error", "clarify", "sync", "cancelled"].includes(stage);
  const locate = async (conversationId: string, messageId: string, signature?: string, range?: MessageSourceRange, search?:ReaderSearchContext) => {
    try {
      const db=await getDatabase();
      const message = await db.get("messages", messageId);
      if (!message || message.conversationId !== conversationId || sourceMessageSignature(message.content) !== signature) throw new Error(zh ? "原文已更新或删除，记录已保留，请重新查找当前依据。" : "Source changed or was removed. The saved result is retained; search for current evidence.");
      if(!await db.get("conversations",conversationId))throw new Error(zh?"这条对话的本地资料不可用，可继续在原文面板核对已保存消息。":"Conversation metadata is unavailable. Retained messages remain readable in the source panel.");
      invalidateReaderMessages(conversationId);
      if(search)onRead?.(conversationId,message,range,search);else onRead?.(conversationId, message, ...(range ? [range] : []));
    } catch (failure) { setError({ message: failure instanceof Error ? failure.message : zh ? "暂时无法读取原文。" : "Could not read the source." }); }
  };
  const fragmentsById = useMemo(() => new Map(localMatches.map(match => [match.conversation.id, historyFragments(match, originals.get(match.conversation.id) ?? [], JSON.parse(filterKey) as HistoryFilters, includeUndated)])), [localMatches, originals, filterKey, includeUndated]);
  const shownMatches = localMatches.filter(match => fragmentsById.get(match.conversation.id)?.fragments.length);
  const fragmentTotal = shownMatches.reduce((sum, match) => sum + fragmentsById.get(match.conversation.id)!.fragments.length, 0);
  const undated = [...fragmentsById.values()].reduce((sum, value) => sum + value.undated, 0);
  const openMatch = async (match: HistoryMatch, target?: string) => {
    const request=++sourceRequest.current;
    returnPosition.current = { conversationId: match.conversation.id, top: searchBody.current?.scrollTop ?? 0 };
    setOpening(match.conversation.id); setError(undefined);
    const first = match.messages[0];
    try {
      const db = await getDatabase();
      const [current, conversation] = await Promise.all([db.get("messages", first.id), db.get("conversations", match.conversation.id)]);
      if (!current || current.conversationId !== match.conversation.id || sourceMessageSignature(current.content) !== sourceMessageSignature(first.content)) throw new Error(zh ? "原文已更新或删除，请重新搜索；原始记录保留。" : "Source changed or was removed. Search again; records are retained.");
      invalidateReaderMessages(match.conversation.id);
      const originals=await getMessagesForConversation(match.conversation.id);
      if(request!==sourceRequest.current)return;
      const query = parseHistoryFilters(historyRequest(clarifiedGoal).query, zh).query;
      const search = historyReaderContext(match,query,originals);
      if(!search.hits.length)throw new Error(zh?"匹配消息已变化，请重新搜索。":"Matching messages changed. Search again.");
      setSource(undefined);
      setReading({ conversation: conversation ?? { ...match.conversation, url: "" }, messages: originals, search, metadataMissing: !conversation, ...(target && search.hits.some(hit => hit.messageId === target) ? { target } : {}) });
    } catch (failure) { if(request===sourceRequest.current)setError({ message: failure instanceof Error ? failure.message : zh ? "暂时无法读取原文。" : "Could not read the source." }); }
    finally { if(request===sourceRequest.current)setOpening(undefined); }
  };
  const searchLocal = () => {
    if (!searchDraft.trim()) return;
    controller.current?.abort(); plan.current = undefined;
    setTopicGoal(searchDraft.trim()); setClarifiedGoal(searchDraft.trim()); setRun(true); setRetry(value => value + 1);
  };
  const unsynced = conversations.filter(conversation => poolIds.includes(conversation.id) && !isCurrentHydrationComplete(conversation)).map(conversation => conversation.id);
  const submit = () => {
    if (readOnly || !followup.trim() || busy || aiBusy) return;
    if (answer) background.current = [{ question: clarifiedGoal, answer: answer.sections.map(section => section.body).join("\n").slice(0, 500) }];
    const contextual = /^(?:那|它|这个|这样|还有|继续|具体|展开|再|为什么呢|and\b|that\b|it\b|what about)/iu.test(followup.trim());
    if (!contextual) setTopicGoal(followup.trim());
    plan.current = undefined; setQuestion(""); setError(undefined); setStage("planning"); setClarifiedGoal(followup.trim()); setFollowup(""); setRun(true);
  };
  return <div className={`focus-workspace home-recall-workspace${source && !reading ? " has-original-panel" : ""}${reading ? " is-reading-conversation" : ""}`}>
    {reading ? <section className="home-conversation-reader" aria-label={zh ? "对话阅读" : "Conversation reading"}>{reading.metadataMissing ? <p className="home-recall-limit" role="status">{zh ? "对话资料已缺失，以下为本地保留的原始消息。" : "Conversation details are unavailable. Retained original messages follow."}</p> : null}<OriginalReader key={reading.conversation.id} conversation={reading.conversation} messages={reading.messages} loading={false} searchContext={reading.search} targetMessageId={reading.target ?? reading.search.hits[0].messageId} backLabel={zh ? "返回搜索结果" : "Back to search results"} onBack={() => { sourceRequest.current++; setReading(undefined); }}/></section> : null}
    <main hidden={Boolean(reading)} className="home-task-workspace project-reading-base">
    <header className="home-task-header">
      <div className="home-task-navigation"><ReaderBackButton onClick={() => onBack(taskGoal)} label={zh ? "返回" : "Back"} /><h1>{requestedAction === "answer" ? zh ? "找回历史对话" : "Find past conversations" : zh ? "任务工作区" : "Task workspace"}</h1></div>
      <div className="home-task-tools">{localSearch && !localOnly ? <button disabled={aiBusy} onClick={()=>{controller.current?.abort();setSearchDraft(clarifiedGoal);setTopicGoal(clarifiedGoal);setLocalOnly(true);setRun(true);setRetry(value=>value+1);}}><Search size={15}/>{zh?"本地搜索":"Local search"}</button>:null}{onHistory ? <button onClick={async () => { await activitySave.current; controller.current?.abort(); setRun(false); onHistory(answer ? record : undefined, taskGoal, localOnly ? searchDraft : followup, localOnly ? localActivity.current : undefined); }}><History size={15} />{zh ? "历史记录" : "History"}</button> : null}{!readOnly && !localOnly ? <AIQuickSelect zh={zh} configureLabel={zh ? "配置模型" : "Configure model"} onConfigure={onConfigureAI} onReady={setAIReady} onBusy={setAIBusy} /> : null}</div>
    </header>
    <div ref={searchBody} className="home-task-body"><div className="home-task-content">{readOnly?<p className="home-recall-limit">{zh?"已保存的讨论总结，仅供查看；该功能暂未开放。":"Saved discussion summary, available for reading only. This feature is not currently open."}</p>:null}
      {localOnly ? <section className="home-recall-search" aria-label={zh ? "历史搜索" : "History search"}>
        {initialActivity ? <p className="home-recall-limit">{zh?"历史搜索 · 匹配当前可用正文":"Past search · matched against current messages"}</p>:null}
        <form role="search" onSubmit={event => { event.preventDefault(); searchLocal(); }}><Search size={19} aria-hidden="true"/><label><span className="sr-only">{zh ? "搜索历史对话" : "Search past conversations"}</span><input value={searchDraft} maxLength={500} onChange={event => setSearchDraft(event.target.value)} placeholder={zh ? "输入主题、项目名或关键词" : "Enter a topic, project or keyword"}/></label><button className="primary" disabled={!searchDraft.trim()}>{zh ? "搜索" : "Search"}</button></form>
        <div className="home-recall-result-tools"><p role="status">{localLoading ? zh ? "搜索中…" : "Searching…" : zh ? `${shownMatches.length} 个对话 · ${fragmentTotal} 处讨论 · 本地搜索` : `${shownMatches.length} conversations · ${fragmentTotal} discussions · Local search`}</p><button type="button" className="home-recall-secondary" onClick={() => onBack(taskGoal)}>{zh ? "调整材料" : "Adjust sources"}</button><button type="button" className="home-recall-secondary" disabled={localLoading} onClick={() => { setLocalOnly(false); setRun(true); }}><Sparkles size={15} aria-hidden="true"/>{zh ? "使用 AI 分析" : "Analyze with AI"}</button></div>
        {knowledgeHits.length ? <section className="home-recall-knowledge" aria-label={zh ? "已整理的知识" : "Organized knowledge"}><h3>{zh ? "已整理的知识" : "Organized knowledge"}</h3><ul>{knowledgeHits.map(hit => <li key={`${hit.sessionId}:${hit.sectionId}`}><button type="button" disabled={!onOpenChapter} onClick={() => onOpenChapter?.(hit.sessionId, hit.sectionId)}><span><strong>{hit.chapter}</strong><small>{hit.project}</small></span><span>{hit.excerpt}</span></button></li>)}</ul></section> : null}
        {parsedSearch.chips.length ? <div className="home-recall-filters" aria-label={zh ? "筛选条件" : "Filters"}>{activeChips.map(chip => <button type="button" key={chip.key} aria-label={zh ? `移除条件：${chip.label}` : `Remove filter: ${chip.label}`} onClick={() => setRemoved({ goal: taskGoal, keys: [...(removed?.goal === taskGoal ? removed.keys : []), chip.key] })}><span>{chip.label}</span><X size={13} aria-hidden="true"/></button>)}{!includeUndated && undated && activeChips.some(chip => chip.kind === "time") ? <p>{zh ? `另有 ${undated} 处讨论没有原始日期，未按时间筛选。` : `${undated} discussions have no original date and were left out of the time filter.`}<button type="button" onClick={() => setUndatedFor(taskGoal)}>{zh ? "一并显示" : "Show them too"}</button></p> : null}</div> : null}
        {localError || error && !source ? <div className="home-recall-search-error"><p role="alert">{localError || error?.message}</p><button type="button" onClick={() => setRetry(value => value + 1)}>{zh ? "重试搜索" : "Retry search"}</button></div> : null}
        {saveError && localActivity.current ? <p className="home-recall-limit" role="alert">{zh?"历史记录保存失败。":"Could not save history."}<button onClick={()=>void saveHomeResult(localActivity.current!).then(()=>setSaveError(false)).catch(()=>setSaveError(true))}>{zh?"重新保存":"Save again"}</button></p>:null}
        {!localLoading && !localError && !shownMatches.length ? <div className="home-recall-empty"><Search size={26} aria-hidden="true"/><h2>{zh ? "未找到匹配正文" : "No matching messages"}</h2><p>{zh ? "试试具体术语或项目名。" : "Try a specific term or project name."}</p>{unsynced.length ? <button type="button" onClick={() => onHydrate(unsynced)}>{zh ? `同步 ${unsynced.length} 条待导入正文` : `Sync ${unsynced.length} conversations`}</button> : null}</div> : null}
      </section> : <header className="home-task-goal-heading">{initialRecord ? <span className="eyebrow">{zh ? "历史记录" : "History"} · {new Date(initialRecord.createdAt).toLocaleDateString(zh ? "zh-CN" : "en")}</span> : null}<h2 className="home-task-goal">{clarifiedGoal}</h2></header>}
      {!readOnly && !answer && !localOnly ? <section className="home-task-panel" aria-label={zh ? "任务状态" : "Task status"}>
        {error ? <><div className="home-task-message" role="alert"><AlertCircle size={18} /><div><h3>{zh ? "暂时无法继续" : "Unable to continue"}</h3><p>{error.message}</p></div></div><div className="home-task-actions"><button className="primary" disabled={!aiReady || aiBusy} onClick={() => { setRun(true); setRetry(value => value + 1); }}>{zh ? "重试" : "Retry"}</button><button onClick={() => onBack(taskGoal)}>{zh ? "调整材料" : "Adjust sources"}</button></div>{error.code ? <details className="home-task-diagnostics"><summary>{zh ? "查看诊断" : "Diagnostics"}</summary><code>{error.code}{error.paths?.length ? ` · ${error.paths.join(", ")}` : ""}</code></details> : null}</>
        : stage === "cancelled" ? <div><p>{zh ? "已停止，可以继续提问。" : "Stopped. You can ask again."}</p><button disabled={!aiReady || aiBusy} onClick={() => { setStage("planning"); setRun(true); }}>{zh ? "继续当前问题" : "Continue this question"}</button></div>
        : !aiReady ? <p className="home-task-connect-hint">{zh ? requestedAction === "answer" ? "本地匹配可直接查看。需要总结与分析时，再配置模型。" : "项目整理需要模型，请先配置模型。" : "Connect AI to continue."}</p>
        : stage === "clarify" ? <form onSubmit={event => { event.preventDefault(); if (!detail.trim()) return; plan.current = undefined; const next = `${taskGoal}\n${detail.trim()}`; setTopicGoal(next); setClarifiedGoal(next); setDetail(""); setQuestion(""); setRun(true); }}><label>{question}<input autoFocus value={detail} maxLength={160} onChange={event => setDetail(event.target.value)} /></label><button className="primary" disabled={!detail.trim() || aiBusy}>{zh ? "继续" : "Continue"}</button></form>
        : stage === "sync" ? <><h3>{zh ? "相关讨论需要同步正文" : "Sync related discussions"}</h3><button className="primary" onClick={() => onHydrate(pending)}>{zh ? `同步相关 ${pending.length} 条对话` : `Sync ${pending.length} conversations`}</button></>
        : <div className="home-task-message is-loading" role="status"><LoaderCircle size={18} /><span>{zh ? !projectsReady ? "读取项目记录…" : aiBusy ? "切换 AI…" : stage === "verifying" ? "核对主题与回答…" : stage === "answering" ? "结合原始讨论回答…" : stage === "planning" ? "理解你的目标…" : stage === "assessing" ? "定位相关材料…" : stage === "refining" ? "补查相关讨论…" : "检索相关讨论与上下文…" : "Finding and checking related discussions…"}</span></div>}
      </section> : null}
      {!answer && shownMatches.length ? <section className="home-recall-results" aria-label={zh ? "搜索结果" : "Search results"}>{shownMatches.slice(0, visibleMatches).map(match => {
        const {fragments} = fragmentsById.get(match.conversation.id)!, [top, ...rest] = fragments, open = expanded.includes(match.conversation.id);
        const busy = opening === match.conversation.id;
        const meta = (fragment: HistoryFragment) => fragment.date ? <time dateTime={new Date(fragment.date).toISOString()}>{new Date(fragment.date).toLocaleDateString(zh ? "zh-CN" : "en")}</time> : null;
        // One card per conversation: its strongest discussion first, the others as rows that open at their own place.
        const chosen = pickedIds.includes(match.conversation.id);
        return <article key={match.conversation.id} className={`home-history-hit${localOnly ? " is-pickable" : ""}${chosen ? " is-picked" : ""}`}>
          {localOnly ? <label className="home-history-pick"><input type="checkbox" checked={chosen} onChange={() => togglePick(match.conversation.id)} /><span className="sr-only">{zh ? `选择对话：${match.conversation.title}` : `Choose conversation: ${match.conversation.title}`}</span></label> : null}
          <button type="button" className="home-history-hit-main" data-history-conversation={match.conversation.id} disabled={busy} aria-busy={busy || undefined} aria-label={zh ? `阅读对话：${match.conversation.title}` : `Read conversation: ${match.conversation.title}`} onClick={() => void openMatch(match, top.targetMessageId)}><div>
            <span className="home-history-hit-meta"><strong>{match.conversation.title}</strong><span>·</span><span>{platformName(match.conversation.platform, zh ? "zh-CN" : "en")}</span>{top.date ? <><span>·</span>{meta(top)}</> : null}<span>·</span><span>{zh ? `${new Set(match.messages.map(message => message.id)).size} 条匹配消息` : `${new Set(match.messages.map(message => message.id)).size} matching messages`}</span></span>
            {top.question ? <p className="home-history-question">{top.question}</p> : null}{top.excerpt !== top.question ? <p>{top.excerpt}</p> : null}</div><ChevronRight size={18} aria-hidden="true"/></button>
          {rest.length ? <div className="home-history-fragments">{(open ? rest : rest.slice(0, 2)).map(fragment => <button type="button" key={fragment.id} disabled={busy} onClick={() => void openMatch(match, fragment.targetMessageId)}><span>{fragment.question ?? fragment.excerpt}</span>{fragment.question ? <small>{fragment.excerpt}</small> : null}{meta(fragment)}</button>)}{rest.length > 2 ? <button type="button" className="home-history-fragments-toggle" aria-expanded={open} onClick={() => setExpanded(open ? expanded.filter(id => id !== match.conversation.id) : [...expanded, match.conversation.id])}>{open ? zh ? "收起" : "Show less" : zh ? `本对话另有 ${rest.length - 2} 处` : `${rest.length - 2} more in this conversation`}</button> : null}</div> : null}
        </article>;
      })}{visibleMatches < shownMatches.length ? <button type="button" className="home-recall-secondary" onClick={() => setVisibleMatches(value => value + 10)}>{zh ? "显示更多结果" : "Show more results"}</button> : null}{localCapped ? <p className="home-recall-limit">{zh ? "匹配较多，已显示本次检索范围；可补充关键词缩小范围。" : "Many matches; refine your keywords to narrow the search."}</p> : null}
        {localOnly && pickedIds.length ? <div className="home-recall-pick-bar" role="region" aria-label={zh ? "已选对话" : "Chosen conversations"}>
          <span>{zh ? `已选 ${pickedIds.length} 个对话` : `${pickedIds.length} chosen`}</span>
          <button type="button" className="home-recall-secondary" onClick={() => setPicked({ goal: taskGoal, ids: [] })}>{zh ? "清空" : "Clear"}</button>
          {onContinue && savedProjects.length ? <select aria-label={zh ? "加入已有项目" : "Add to a project"} value="" onChange={event => { const project = savedProjects.find(item => item.id === event.target.value); if (project) onContinue(project, taskGoal, pickedIds); }}><option value="">{zh ? "加入已有项目…" : "Add to a project…"}</option>{savedProjects.map(project => <option key={project.id} value={project.id}>{project.title}</option>)}</select> : null}
          <button type="button" className="primary" onClick={() => onStart(zh ? `整理这些讨论：${taskGoal}` : `Organize these discussions: ${taskGoal}`, "work", pickedIds, { kind: "all", sourceConversationIds: pickedIds })}>{zh ? "整理成项目" : "Organize as a project"}</button>
        </div> : null}</section> : null}
      {draftAnswer && !answer ? <article className="home-recall-answer"><small>{zh ? "正在生成 · 待核对" : "Generating · awaiting verification"}</small><ReaderGuide content={draftAnswer} zh={zh} complete hideEvidenceMarkers /></article> : null}
      {answer ? <><HomeRecallAnswer answer={answer} zh={zh} onSource={ref => setSource({session: answer, reference: ref, references: answer.evidence})} onLocate={ref => void locate(ref.conversationId, ref.messageId, ref.sourceSignature)} />{error && !source ? <p role="alert">{error.message}</p> : null}{saveError && record ? <p role="alert">{zh ? "记录保存失败。" : "Could not save the result."}<button onClick={() => void saveHomeResult(record).then(() => setSaveError(false)).catch(() => setSaveError(true))}>{zh ? "重新保存" : "Save again"}</button></p> : null}<div className="home-answer-actions">{!readOnly?<button onClick={() => { plan.current = undefined; setStage("planning"); setRun(true); setRetry(value => value + 1); }}>{zh ? "重新查找" : "Search again"}</button>:null}<button onClick={() => inputs.current.onStart(zh ? `整理这些讨论：${taskGoal}` : `Organize these discussions: ${taskGoal}`, "work", answer.sourceConversationIds, { kind: "all", sourceConversationIds: answer.sourceConversationIds })}>{zh ? "整理为项目" : "Organize as a project"}</button></div></> : null}
    </div></div>
    {!readOnly && !localOnly ? <footer className="home-task-composer"><form onSubmit={event => { event.preventDefault(); submit(); }}><label><span className="sr-only">{zh ? "继续提问" : "Ask another question"}</span><textarea rows={2} placeholder={zh ? "继续提问或查找一个问题…" : "Ask or find another answer…"} value={followup} maxLength={500} onChange={event => setFollowup(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(); } }} /></label>{busy ? <button type="button" aria-label={zh ? "停止生成" : "Stop generation"} onClick={() => { controller.current?.abort(); setRun(false); setDraftAnswer(""); setStage("cancelled"); }}><Square size={17} /></button> : <button className="primary" disabled={!followup.trim() || aiBusy} aria-label={zh ? "提问" : "Ask"}><ArrowUp size={19} /></button>}</form></footer> : null}
  </main>{source && !reading ? <WorkspaceSourcePanel session={source.session} reference={source.reference} references={source.references} conversationTitle={conversations.find(conversation=>conversation.id===source.reference.conversationId)?.title} quote={source.quote} readerError={error?.message} zh={zh} onSelect={reference => {sourceRequest.current++;setError(undefined);const hit=source.search?.hits.find(hit=>hit.messageId===reference.messageId);setSource({...source, reference, range:hit?.sourceRange, quote:hit?.excerpt});}} onClose={() => {sourceRequest.current++;setSource(undefined);}} onReader={() => void locate(source.reference.conversationId, source.reference.messageId, source.reference.sourceSignature, source.range, source.search)}/> : null}</div>;
}
