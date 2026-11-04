import { Search, Settings2 } from "lucide-react";
import { WorkspaceBackButton } from "./WorkspaceBackButton";
import { useEffect, useMemo, useRef, useState } from "react";
import type { AISettings, Conversation } from "../../shared/types";
import { effectiveAISettings, hasAIConnection } from "../../ai/ai-mode";
import { getAISettings } from "../../storage/knowledge-graph";
import { rankKnowledgeSources, retrieveKnowledgeSources, type KnowledgeSourceCandidate } from "../../ai/knowledge-source-retrieval";
import { fallbackKnowledgeTitle } from "../../ai/knowledge-intent";
import { isCurrentHydrationComplete } from "../../sync/import-state";
import { usePreferences } from "../preferences";

const emptyExclusions: ReadonlySet<string> = new Set();
const PAGE_SIZE = 80;

export function KnowledgeSpaceCreate({ conversations, initialIntent = "", initialConversationIds = [], excludedConversationIds = emptyExclusions, settingsRevision = 0, purpose = "space", onClose, onConfigureAI, onConfirm }: {
  purpose?: "space" | "focus";
  conversations: Conversation[];
  initialIntent?: string;
  initialConversationIds?: string[];
  excludedConversationIds?: ReadonlySet<string>;
  settingsRevision?: number;
  onClose: () => void;
  onConfigureAI?: () => void;
  onConfirm: (intent: string, conversationIds: string[], modelId: string, title: string) => void;
}) {
  const { locale } = usePreferences();
  const zh = locale === "zh-CN";
  const [intent, setIntent] = useState(initialIntent);
  const [title, setTitle] = useState(initialIntent);
  const titleEdited = useRef(Boolean(initialIntent));
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initialConversationIds));
  const [visibleLimit, setVisibleLimit] = useState(PAGE_SIZE);
  const [settings, setSettings] = useState<AISettings | null>(null);
  const [settingsLoaded, setSettingsLoaded] = useState(false);
  const [sourceCandidates, setSourceCandidates] = useState<KnowledgeSourceCandidate[]>([]);
  const [searchingSources, setSearchingSources] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const sourceSearchRef = useRef<{ goal: string; readyCount: number; schedule: () => void } | null>(null);

  const available = useMemo(() => conversations
    .filter((item) => !excludedConversationIds.has(item.id))
    .sort((a, b) => Number(isCurrentHydrationComplete(b)) - Number(isCurrentHydrationComplete(a)) || (b.sourceUpdatedAt ?? b.updatedAt) - (a.sourceUpdatedAt ?? a.updatedAt)), [conversations, excludedConversationIds]);
  const readyCount = useMemo(() => available.filter(isCurrentHydrationComplete).length, [available]);
  const readyCountRef = useRef(readyCount);
  readyCountRef.current = readyCount;
  const availableRef = useRef(available);
  availableRef.current = available;
  const sourceGoal = intent.trim() || title.trim();
  const ranked = useMemo(() => sourceGoal.length >= 2 ? rankKnowledgeSources(sourceGoal, available, [], []) : [], [sourceGoal, available]);
  const candidateById = useMemo(() => new Map([...ranked, ...sourceCandidates].map((item) => [item.conversation.id, item])), [sourceCandidates, ranked]);
  useEffect(() => {
    if (sourceGoal.length < 2) { setSourceCandidates([]); setSearchingSources(false); return; }
    let timer: number | null = null;
    let controller: AbortController | null = null;
    let running = false;
    let dirty = false;
    let disposed = false;
    const run = async () => {
      timer = null;
      dirty = false;
      running = true;
      controller = new AbortController();
      const signal = controller.signal;
      setSearchingSources(true);
      try {
        const found = await retrieveKnowledgeSources(sourceGoal, availableRef.current.filter(isCurrentHydrationComplete), signal);
        if (!signal.aborted) setSourceCandidates(found);
      } catch { /* Keep title ranking available when message search fails. */ }
      finally {
        running = false;
        if (!disposed && dirty) schedule();
        else if (!disposed) setSearchingSources(false);
      }
    };
    const schedule = (delay = 800) => {
      dirty = true;
      if (timer === null && !running) timer = window.setTimeout(() => void run(), delay);
    };
    sourceSearchRef.current = { goal: sourceGoal, readyCount: readyCountRef.current, schedule };
    setSourceCandidates([]);
    schedule(350);
    return () => { disposed = true; if (timer !== null) window.clearTimeout(timer); controller?.abort(); sourceSearchRef.current = null; };
  }, [sourceGoal]);
  useEffect(() => {
    const state = sourceSearchRef.current;
    if (!state || state.goal !== sourceGoal || state.readyCount === readyCount) return;
    state.readyCount = readyCount;
    state.schedule();
  }, [sourceGoal, readyCount]);
  const matching = useMemo(() => {
    const term = query.trim().toLocaleLowerCase().normalize("NFKC");
    if (term) return available.filter((item) => item.title.toLocaleLowerCase().normalize("NFKC").includes(term));
    return sourceGoal.length >= 2 ? [...available].sort((a, b) => Number(isCurrentHydrationComplete(b)) - Number(isCurrentHydrationComplete(a)) || (candidateById.get(b.id)?.score ?? 0) - (candidateById.get(a.id)?.score ?? 0) || (b.sourceUpdatedAt ?? b.updatedAt) - (a.sourceUpdatedAt ?? a.updatedAt)) : available;
  }, [available, query, sourceGoal, candidateById]);
  const readyIds = useMemo(() => available.filter((item) => selected.has(item.id) && isCurrentHydrationComplete(item)).map((item) => item.id), [available, selected]);
  const selectableIds = matching.filter(isCurrentHydrationComplete).map((item) => item.id);
  const allMatchingSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));
  const shown = matching.slice(0, visibleLimit);

  useEffect(() => { setVisibleLimit(PAGE_SIZE); if (listRef.current) listRef.current.scrollTop = 0; }, [query]);
  useEffect(() => {
    let live = true;
    setSettingsLoaded(false);
    void getAISettings().then((next) => { if (live) setSettings(effectiveAISettings(next)); }).catch(() => { if (live) setSettings(null); }).finally(() => { if (live) setSettingsLoaded(true); });
    return () => { live = false; };
  }, [settingsRevision]);

  const toggle = (id: string) => setSelected((current) => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleMatching = () => setSelected((current) => {
    const next = new Set(current);
    for (const id of selectableIds) { if (allMatchingSelected) next.delete(id); else next.add(id); }
    return next;
  });
  const create = () => {
    const name = purpose === "focus" ? intent.trim() : title.trim();
    if (!settingsLoaded || !name || !readyIds.length) return;
    if (!hasAIConnection(settings)) { onConfigureAI?.(); return; }
    onConfirm(intent.trim() || name, readyIds, settings!.model, name);
  };

  return <main className="knowledge-create is-source-selection" aria-label={purpose === "focus" ? zh ? "选择材料" : "Choose sources" : zh ? "创建知识空间" : "Create Knowledge Space"}>
    <WorkspaceBackButton className="knowledge-create-back" onClick={onClose} />
    <div className="knowledge-create-inner">
      <header className="knowledge-source-heading"><h1>{purpose === "focus" ? zh ? "选择材料" : "Choose sources" : zh ? "创建知识空间" : "Create a Knowledge Space"}</h1></header>
      <label className="knowledge-create-field">{purpose === "focus" ? zh ? "本次目标" : "Your goal" : zh ? "我想复习什么？" : "What do you want to review?"}<input value={intent} maxLength={240} onChange={(event) => { const goal = event.target.value; setIntent(goal); if (!titleEdited.current) setTitle(fallbackKnowledgeTitle(goal).slice(0, 80)); }} placeholder={zh ? "例如：特征值如何影响系统稳定性" : "e.g. How eigenvalues affect system stability"} aria-label={zh ? "复习目标" : "Review goal"} /></label>
      {purpose === "space" ? <label className="knowledge-create-field">{zh ? "知识空间名称" : "Knowledge Space name"}<input value={title} maxLength={80} onChange={(event) => { titleEdited.current = true; setTitle(event.target.value); }} placeholder={zh ? "例如：控制理论" : "e.g. Control theory"} aria-label={zh ? "知识空间名称" : "Knowledge Space name"} /></label> : null}
      <div className="knowledge-source-section-heading"><strong>{zh ? "相关对话" : "Relevant conversations"}</strong><span>{zh ? `${readyCount} 条可用` : `${readyCount} ready`}{available.length > readyCount ? zh ? ` · ${available.length - readyCount} 条待同步` : ` · ${available.length - readyCount} pending` : ""}{searchingSources ? " · …" : ""}</span></div>
      <label className="knowledge-source-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zh ? "搜索对话" : "Search conversations"} aria-label={zh ? "搜索对话标题" : "Search conversation titles"} /></label>
      <div className="knowledge-source-toolbar"><span>{purpose === "focus" ? zh ? `已选 ${readyIds.length}/24` : `${readyIds.length}/24 selected` : zh ? `已选 ${readyIds.length} 条对话` : `${readyIds.length} selected`}</span><button type="button" aria-label={allMatchingSelected ? zh ? "取消全选搜索结果" : "Deselect all results" : zh ? "全选搜索结果" : "Select all results"} disabled={!selectableIds.length} onClick={toggleMatching}>{allMatchingSelected ? zh ? "取消全选" : "Deselect all" : zh ? "全选结果" : "Select results"}</button>{readyIds.length ? <button type="button" onClick={() => setSelected(new Set())}>{zh ? `清空已选 ${readyIds.length} 条` : `Clear all ${readyIds.length} selected`}</button> : null}</div>
      <div className="knowledge-source-list" ref={listRef} role="group" aria-label={zh ? "对话来源" : "Conversation sources"}>
        {!matching.length ? <p className="knowledge-create-empty">{zh ? "没有匹配的对话标题。试试标题中的其他词。" : "No matching conversation titles. Try another word from the title."}</p> : null}
        {shown.map((conversation) => {
          const ready = isCurrentHydrationComplete(conversation);
          const candidate = candidateById.get(conversation.id);
          return <label key={conversation.id} className={`knowledge-source-item knowledge-source-row ${selected.has(conversation.id) ? "is-selected" : ""}`}>
            <input type="checkbox" aria-label={conversation.title} checked={selected.has(conversation.id)} disabled={!ready} onChange={() => toggle(conversation.id)} />
            <span className="knowledge-source-copy"><strong title={conversation.title}>{conversation.title}</strong>{sourceGoal.length >= 2 && candidate && candidate.relevance !== "other" ? <small>{candidate.reason}</small> : null}</span>
            <span className="knowledge-source-meta">{!ready ? <span>{zh ? "内容未就绪" : "Not ready"}</span> : null}<time>{new Intl.DateTimeFormat(locale, { year: "numeric", month: "2-digit", day: "2-digit" }).format(conversation.sourceCreatedAt ?? conversation.updatedAt)}</time></span>
          </label>;
        })}
        {matching.length > shown.length ? <button type="button" className="knowledge-source-show-more" onClick={() => setVisibleLimit((value) => value + PAGE_SIZE)}>{zh ? `显示更多（还有 ${matching.length - shown.length} 条）` : `Show more (${matching.length - shown.length} remaining)`}</button> : null}
      </div>
      <footer className="knowledge-create-actions"><button type="button" className="knowledge-create-model" onClick={onConfigureAI} disabled={!onConfigureAI} aria-label={zh ? "AI 设置" : "AI settings"}><Settings2 size={16} /><span>{hasAIConnection(settings) ? settings!.model : zh ? "连接 AI" : "Connect AI"}</span></button><button type="button" className="primary" disabled={!settingsLoaded || !(purpose === "focus" ? intent : title).trim() || readyIds.length === 0 || purpose === "focus" && readyIds.length > 24} onClick={create}>{purpose === "focus" ? zh ? `确认 ${readyIds.length} 条并生成` : `Confirm ${readyIds.length} sources and generate` : zh ? `创建并分析 ${readyIds.length} 条对话` : `Create and analyze ${readyIds.length} ${readyIds.length === 1 ? "conversation" : "conversations"}`}</button></footer>
    </div>
  </main>;
}
