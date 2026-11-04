import { useEffect, useMemo, useRef, useState } from "react";
import { LARGE_SCOPE_CHARACTERS, focusScopeDefault } from "../focus-scope-default";
import type { Conversation } from "../../shared/types";
import type { FocusMode, FocusScope } from "../../shared/focus-session";
import { confirmedFocusScope, discoverFocusScope, type FocusScopeCandidate } from "../../ai/focus-scope";
import { GoalComposer } from "./GoalComposer";

export function FocusScopePicker({ goal, mode = "review", sources, zh, initialScope, returningToReading = false, onConfirm, onBack, onConfigureAI }: { goal: string; mode?: FocusMode; sources: Conversation[]; zh: boolean; initialScope?: FocusScope; returningToReading?: boolean; onConfirm: (scope: FocusScope, goal: string, mode: FocusMode) => void; onBack: (goal: string, mode: FocusMode) => void; onConfigureAI?: () => void }) {
  const [draftGoal, setDraftGoal] = useState(goal);
  const [draftMode, setDraftMode] = useState(mode);
  const [candidates, setCandidates] = useState<FocusScopeCandidate[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [kind, setKindState] = useState<"goal" | "all">(initialScope?.kind ?? "goal");
  // Until the user picks, the default follows size: large material starts with the
  // related discussions only; small material is organized in full.
  const kindChosen = useRef(Boolean(initialScope?.kind));
  const setKind = (next: "goal" | "all") => { kindChosen.current = true; setKindState(next); };
  const [loading, setLoading] = useState(true);
  const [discoveredGoal, setDiscoveredGoal] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [showOther, setShowOther] = useState(false);
  const [limit, setLimit] = useState(40);
  const sourceRevision = sources.map((source) => `${source.id}:${source.updatedAt}`).join("|");
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    const timer = window.setTimeout(() => {
      void discoverFocusScope(draftGoal, sources, controller.signal).then((items) => {
        if (controller.signal.aborted) return;
        setCandidates(items);
        if (!kindChosen.current) setKindState(focusScopeDefault(items));
        const saved = new Set(initialScope?.blocks?.flatMap((block) => block.messageIds.map((id) => JSON.stringify([block.conversationId, id]))) ?? []);
        const restore = initialScope?.kind === "goal" && draftGoal === goal;
        setSelected(new Set(items.filter((item) => restore ? item.messageIds.some((id) => saved.has(JSON.stringify([item.conversationId, id]))) : item.recommended).map((item) => item.id)));
        setDiscoveredGoal(draftGoal);
      }).catch((failure) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    }, 150);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // Sources are identified by their revision; manual selection never triggers discovery.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftGoal, sourceRevision]);
  const chosen = candidates.filter((item) => selected.has(item.id));
  const totalCharacters = candidates.reduce((sum, item) => sum + item.characters, 0);
  const visible = useMemo(() => {
    const noMatch = !candidates.some((item) => item.recommended);
    return candidates.filter((item) => (showOther || noMatch || item.recommended || selected.has(item.id) || query.trim()) && `${item.title} ${item.sourceTitle} ${item.excerpt}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  }, [candidates, selected, showOther, query]);
  const toggle = (id: string) => { setExpanded(true); setSelected((previous) => { const next = new Set(previous); if (next.has(id)) next.delete(id); else next.add(id); return next; }); };
  const readySources = new Set(candidates.map((item) => item.conversationId));
  const missing = sources.some((source) => !readySources.has(source.id));
  const finding = loading || (!error && discoveredGoal !== draftGoal);
  const unavailable = finding || Boolean(error) || (kind === "goal" ? !chosen.length : missing || !candidates.length);
  const confirm = (nextGoal: string, nextMode: FocusMode) => onConfirm({ ...(kind === "all" ? { kind: "all" as const } : confirmedFocusScope(candidates, selected)), sourceConversationIds: sources.map((source) => source.id) }, nextGoal, nextMode);
  return <main className="focus-scope-screen"><section className="focus-scope-card" aria-label={zh ? "确认整理范围" : "Confirm discussion scope"}>
    <header className="focus-scope-heading"><h1>{zh ? "今天想做什么？" : "What would you like to do?"}</h1><button type="button" className="workspace-back-button" onClick={() => onBack(draftGoal, draftMode)}>{returningToReading ? zh ? "← 返回阅读" : "← Back to reading" : zh ? "← 返回工作台" : "← Back to Workbench"}</button></header>
    <GoalComposer goalValue={draftGoal} modeValue={draftMode} onGoalChange={setDraftGoal} onModeChange={setDraftMode} onStart={confirm} disabled={unavailable} submitLabel={zh ? "开始生成" : "Generate preview"} onConfigureAI={onConfigureAI}>
      <div className="focus-scope-controls">
        <div className="focus-scope-materials"><span className="focus-scope-label">{zh ? "材料" : "Materials"}<small>{sources.length}</small></span><div><span className="focus-scope-source-title" title={sources.map((source) => source.title).join(" · ")}>{sources.map((source) => source.title).join(" · ")}</span>{!returningToReading ? <button type="button" onClick={() => onBack(draftGoal, draftMode)}>{zh ? "更换材料" : "Change materials"}</button> : null}</div></div>
        <fieldset className="focus-scope-options"><legend className="focus-scope-label">{zh ? "范围" : "Scope"}</legend><div>
          <label><input className="sr-only" type="radio" name="focus-scope" checked={kind === "goal"} onChange={() => setKind("goal")} /><span>{zh ? "相关板块" : "Related discussions"}</span></label>
          <label><input className="sr-only" type="radio" name="focus-scope" checked={kind === "all"} onChange={() => setKind("all")} /><span>{zh ? "全部内容" : "All content"}</span></label>
        </div></fieldset>
        {finding ? <p className="focus-scope-status" role="status">{zh ? "正在匹配板块…" : "Finding discussions…"}</p> : error ? <p className="focus-scope-status" role="alert">{error}</p> : <div className="focus-scope-summary"><div>{kind === "goal" ? <><span className="focus-scope-selection-count">{zh ? `已选 ${chosen.length} 个板块` : `${chosen.length} discussions selected`}</span>{chosen.slice(0, 2).map((item) => <span className="focus-scope-topic" key={item.id} title={item.title}>{item.title}</span>)}{chosen.length > 2 ? <span className="focus-scope-selection-count">+{chosen.length - 2}</span> : null}</> : <span>{zh ? "整理所选材料的全部内容" : "All content from selected sources"}</span>}{totalCharacters > LARGE_SCOPE_CHARACTERS ? <small className="focus-scope-size">{zh ? `材料约 ${Math.round(totalCharacters / 10000)} 万字${kind === "all" ? "，全部整理会明显更慢" : "，默认只整理相关部分"}` : `About ${Math.round(totalCharacters / 1000)}k characters${kind === "all" ? "; organizing everything takes much longer" : "; only related parts by default"}`}</small> : null}</div>{kind === "goal" ? <button type="button" aria-expanded={expanded || !chosen.length} aria-controls="focus-scope-discussions" onClick={() => setExpanded(!expanded)}>{expanded ? zh ? "收起" : "Hide discussions" : zh ? "调整板块" : "Adjust discussions"}<span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button> : null}</div>}
      </div>
    </GoalComposer>
    {!finding && !error ? <>
      {missing ? <p className="focus-scope-status" role="alert">{zh ? "部分材料缺少正文，请更换材料或选择可用板块。" : "Some sources have no text. Change materials or choose available discussions."}</p> : null}
      {kind === "goal" && (expanded || !chosen.length) ? <section id="focus-scope-discussions" className="focus-scope-discussions" aria-label={zh ? "选择板块" : "Choose discussions"}>
        {!candidates.some((item) => item.recommended) ? <p className="focus-scope-empty">{zh ? "未找到匹配板块，请修改目标或手动选择。" : "No clear match. Edit your goal or choose discussions."}</p> : null}
        <div className="focus-scope-toolbar"><input className="focus-scope-search" aria-label={zh ? "搜索讨论板块" : "Search discussions"} placeholder={zh ? "搜索板块" : "Search discussions"} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(40); }} /><button type="button" onClick={() => setSelected(new Set())}>{zh ? "清空" : "Clear"}</button><button type="button" onClick={() => setSelected(new Set(candidates.filter((item) => item.recommended).map((item) => item.id)))}>{zh ? "恢复推荐" : "Reset recommendations"}</button></div>
        <div className="focus-scope-list">{visible.slice(0, limit).map((item) => <article key={item.id} className="focus-scope-item"><label><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /><span><strong>{item.title}</strong><small>{item.sourceTitle}</small></span></label><details><summary>{zh ? "原文片段" : "Original excerpt"}</summary><p>{item.excerpt}</p></details></article>)}</div>
        {visible.length > limit ? <button type="button" onClick={() => setLimit((count) => count + 40)}>{zh ? "显示更多" : "Show more discussions"}</button> : null}
        <button type="button" className="focus-scope-other" onClick={() => { setShowOther(!showOther); setLimit(40); }}>{showOther ? zh ? "收起其他板块" : "Hide other discussions" : zh ? "查看其他板块" : "Browse other discussions"}</button>
      </section> : null}
    </> : null}
  </section></main>;
}
