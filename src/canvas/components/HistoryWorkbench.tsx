import { homeEntryIntent } from "../../shared/home-entry-intent";
import {experimentalHomeGoal} from "../../shared/home-experiments";
import { useEffect, useRef, useState } from "react";
import { Compass, FileText, FolderGit2, Info, MessageSquare, Plus, Search, X } from "lucide-react";
import type { Conversation, ConversationMessage } from "../../shared/types";
import { AIQuickSelect } from "./AIQuickSelect";
import { DocumentTypePicker } from "./DocumentTypePicker";
import type { HomeTaskPlan } from "../../ai/home-task";
import { usePreferences } from "../preferences";
import type { MessageSourceRange } from "../../shared/message-location";
import { isCurrentHydrationComplete } from "../../sync/import-state";

const defaultGoals={
 project:{"zh-CN":"把全部已选对话整理成一个项目",en:"Create a project from all selected conversations"},
 summary:{"zh-CN":"总结全部已选对话的主要结论、决策和未解决问题",en:"Summarize the conclusions, decisions and open questions in all selected conversations"},
} as const;

export function HistoryWorkbench({ conversations, goal, onGoal, onRequest, onSources, onHydrate, onConfigureAI, selectedIds, onSelectedIds, onDiscoverGoal, discovery = true, experimentalActions = false }: {
  conversations: Conversation[]; goal: string; onGoal: (goal: string) => void;
  onRequest: (goal: string, ids?: string[], action?: HomeTaskPlan["action"], localSearch?: boolean) => void; onSources: () => void;
  onRead?: (id: string, message?: ConversationMessage, sourceRange?: MessageSourceRange) => void;
  onHydrate: (ids: string[], force?: boolean) => void; onDiscover: () => void; onConfigureAI?: () => void; selectedIds?: Set<string>; onSelectedIds?: (ids: Set<string>) => void; discovery?: boolean; onDiscoverGoal?: (goal:string,poolIds:string[])=>void; experimentalActions?:boolean;
}) {
  const { locale } = usePreferences(), zh = locale === "zh-CN";
  const projectGoal=defaultGoals.project[locale],summaryGoal=defaultGoals.summary[locale];
  // Recognize saved built-in drafts in either language; edited prose never
  // becomes a template merely because it contains a default instruction.
  const defaultKind=Object.values(defaultGoals.project).some(value=>value===goal)?"project":experimentalActions&&Object.values(defaultGoals.summary).some(value=>value===goal)?"summary":undefined;
  const isDefaultGoal=defaultKind!==undefined;
  const [error, setError] = useState("");
  const [shortcut, setShortcut] = useState<number | undefined>(isDefaultGoal ? defaultKind === "summary" ? 1 : 2 : undefined);
  const [intent, setIntent] = useState<HomeTaskPlan["action"] | undefined>(isDefaultGoal ? defaultKind === "summary" ? "answer" : "project" : undefined);
  const automaticGoal = useRef<string | undefined>(isDefaultGoal ? goal : undefined);
  const previousSelection = useRef<string>();
  const previousLocale=useRef(locale);
  const selectionKey = JSON.stringify([...(selectedIds ?? [])].sort());
  const [switchingAI, setSwitchingAI] = useState(false);
  const [allMaterials, setAllMaterials] = useState(false);
  const [coverageHint, setCoverageHint] = useState(false);
  const incompleteIds = conversations.filter(source => !isCurrentHydrationComplete(source)).map(source => source.id);
  const materials = [...(selectedIds ?? [])].map(id => ({ id, source: conversations.find(source => source.id === id) }));
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { const node = input.current; if (node) { node.style.height = "auto"; node.style.height = `${Math.min(220, Math.max(76, node.scrollHeight))}px`; } }, [goal]);
  useEffect(() => {
    const selectionChanged=previousSelection.current!==selectionKey;
    const languageChanged=previousLocale.current!==locale;
    if(!selectionChanged&&!languageChanged)return;
    previousSelection.current = selectionKey;previousLocale.current=locale;
    setError("");
    if (selectionKey === "[]") {
      if (goal === automaticGoal.current) { onGoal(""); setIntent(undefined); setShortcut(undefined); }
      automaticGoal.current = undefined;
    } else if (goal === automaticGoal.current || selectionChanged && !goal.trim() && shortcut !== 0 && shortcut !== 3) {
      const next = shortcut === 1 ? summaryGoal : projectGoal;
      automaticGoal.current = next; if(goal!==next)onGoal(next);
      setIntent(shortcut === 1 ? "answer" : "project"); setShortcut(shortcut === 1 ? 1 : 2);
    }
  }, [selectionKey, locale, goal, onGoal, projectGoal, summaryGoal, shortcut]);
  const [choosing,setChoosing]=useState(false);
  const entryAction = (text:string, action = intent):HomeTaskPlan["action"] => action ?? (text===projectGoal?"project":({find:"answer",project:"project",summarize:"answer",review:"project",continue:"continue",choose:"clarify"} as const)[homeEntryIntent(text)]);
  const currentAction = entryAction(goal), summary = experimentalActions&&(shortcut === 1 || homeEntryIntent(goal)==="summarize");
  const search = (action = intent, selectedShortcut = shortcut, text = goal) => {
    if (!text.trim() || switchingAI) return;
    if(!experimentalActions&&(selectedShortcut===1||selectedShortcut===3||experimentalHomeGoal(text)&&entryAction(text,action)!=="project")){
      setChoosing(false);setError(zh?"该功能暂未开放，可使用找回历史对话或整理成项目。":"This feature is not available yet. Find past conversations or organize a project instead.");return;
    }
    if(selectedShortcut!==3&&entryAction(text,action)==="clarify"){setChoosing(true);return;}
    setChoosing(false);
    if(selectedShortcut===3){const pool=selectedIds?.size?[...selectedIds]:conversations.map(source=>source.id);if(pool.length<2){setError(zh?"请至少选择两条对话来发现共同主题。":"Choose at least two conversations to discover shared topics.");onSources();return;}onDiscoverGoal?.(text.trim(),pool);return;}
    const isSummary = selectedShortcut === 1 || homeEntryIntent(text)==="summarize";
    const resolvedAction = entryAction(text, action);
    const localSearch = resolvedAction === "answer" && !isSummary;
    if (!selectedIds?.size && !localSearch) { setError(zh ? "请先选择来源材料。" : "Choose source materials first."); onSources(); return; }
    const value = selectedShortcut === 1 && text !== summaryGoal && !/^(?:总结|Summarize)/iu.test(text.trim()) ? zh ? `总结历史讨论：${text.trim()}` : `Summarize historical discussions: ${text.trim()}` : text.trim();
    const pool = !selectedIds?.size && localSearch ? conversations.filter(isCurrentHydrationComplete).map(source => source.id) : undefined;
    if (localSearch) onRequest(value, pool, resolvedAction, true); else onRequest(value, pool, resolvedAction);
  };
  const runShortcut = (index: number) => {
    if (switchingAI) return;
    setCoverageHint(index === 0 || index === 3);
    if(index===3){setError("");setChoosing(false);setShortcut(3);setIntent(undefined);if(goal===automaticGoal.current){automaticGoal.current=undefined;onGoal("");}input.current?.focus();return;}
    setError("");
    const action = index === 2 ? "project" : "answer";
    setIntent(action); setShortcut(index);
    const custom = Boolean(goal.trim() && goal !== automaticGoal.current);
    if (index === 0) { automaticGoal.current = undefined; if (!custom) onGoal(""); input.current?.focus(); return; }
    if (!selectedIds?.size && index !== 0) { setError(zh ? "请先选择来源材料。" : "Choose source materials first."); onSources(); return; }
    const next = custom ? goal : index === 1 ? summaryGoal : projectGoal;
    if (!custom) { automaticGoal.current = next; onGoal(next); }
    search(action, index, next);
  };
  return <div className="history-workbench">
    <form className="goal-composer is-simple history-composer" onSubmit={event => { event.preventDefault(); search(); }}>
      {materials.length ? <div className="history-source-attachments" role="group" aria-label={zh ? "已选材料" : "Selected materials"}>
        {materials.slice(0, allMaterials ? undefined : 4).map(({id, source}) => {
          const title = source?.title || (zh ? "不可用的对话" : "Unavailable conversation");
          return <div className="history-source-attachment" key={id}>
            <MessageSquare size={16} aria-hidden="true" /><span title={title}>{title}</span>
            {!source || !isCurrentHydrationComplete(source) ? <small>{zh ? source ? "待同步" : "不可用" : source ? "Needs sync" : "Unavailable"}</small> : null}
            <button type="button" disabled={!onSelectedIds} aria-label={zh ? `移除材料：${title}` : `Remove material: ${title}`} onClick={() => onSelectedIds?.(new Set([...selectedIds ?? []].filter(value => value !== id)))}><X size={13} /></button>
          </div>;
        })}
        {materials.length > 4 ? <button type="button" className="history-source-toggle" onClick={() => setAllMaterials(!allMaterials)}>{allMaterials ? zh ? "收起" : "Show less" : zh ? `+ ${materials.length - 4} 条` : `+ ${materials.length - 4} more`}</button> : null}
        <button type="button" className="history-source-toggle" onClick={() => onSelectedIds?.(new Set())}>{zh ? "清空材料" : "Clear materials"}</button>
        <button type="button" className="history-source-add" onClick={onSources} aria-label={zh ? "添加材料" : "Add materials"} title={zh ? "添加材料" : "Add materials"}><Plus size={16} /></button>
      </div> : null}
      <label><span className="sr-only">{zh ? "搜索或整理历史对话" : "Search or organize past conversations"}</span>
        <textarea ref={input} rows={2} maxLength={500} value={goal}
          onChange={event => { if (automaticGoal.current) { setIntent(undefined); setShortcut(undefined); } automaticGoal.current = undefined; setError(""); onGoal(event.target.value); }}
          onKeyDown={event => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); search(); } }}
          placeholder={shortcut===3
            ?zh?"想从历史讨论中发现哪些主题？例如：找出值得继续的硬件 AI 项目":"What topics would you like to discover? e.g. Find hardware AI projects worth continuing."
            :intent==="answer"&&shortcut===1
              ?zh?"想总结哪个主题的讨论？":"Which topic would you like to summarize?"
              :intent==="project"
                ?zh?"例如：整理过去讨论过的硬件 AI 项目":"e.g. Organize the hardware AI project we discussed earlier"
                :zh?"例如：之前关于 Orama 搜索索引的讨论在哪里？":"e.g. Where did we discuss the Orama search index?"} />
      </label>
      <div className="goal-composer-footer">
        {!materials.length ? <button type="button" className="history-selection-summary" onClick={onSources}><Plus size={14}/>{zh ? "添加材料" : "Add materials"}</button> : null}
        {currentAction === "project" ? <DocumentTypePicker zh={zh} /> : null}
        <div className="goal-composer-actions"><AIQuickSelect zh={zh} configureLabel={zh ? "配置模型" : "Configure model"} onConfigure={onConfigureAI} onBusy={setSwitchingAI} /><button className="primary" title="Ctrl / ⌘ + Enter" disabled={!goal.trim() || switchingAI}><Search size={15} />{shortcut===3?zh?"发现主题":"Discover topics":currentAction === "project" ? zh ? "开始整理" : "Organize project" : currentAction === "continue" ? zh ? "继续项目" : "Continue project" : summary ? zh ? "总结讨论" : "Summarize" : currentAction==="clarify"?zh?"选择操作":"Choose action":zh ? "搜索历史" : "Search history"}</button></div>
      </div>
    </form>
    <div className={`history-shortcuts${experimentalActions?" has-experiments":""}`} role="group" aria-label={zh ? "快捷入口" : "Shortcuts"}>
      <button type="button" aria-pressed={shortcut === 0} onClick={() => runShortcut(0)} disabled={switchingAI}><Search size={16} aria-hidden="true"/><span>{zh ? "找回历史对话" : "Find history"}</span></button>
      <button type="button" aria-pressed={shortcut === 2} onClick={() => runShortcut(2)} disabled={switchingAI}><FolderGit2 size={16} aria-hidden="true"/><span>{zh ? "整理成项目" : "Organize as project"}</span></button>
      {experimentalActions?<button type="button" aria-pressed={shortcut === 1} disabled={switchingAI} onClick={() => runShortcut(1)}><FileText size={16} aria-hidden="true"/><span>{zh ? "总结历史讨论" : "Summarize discussions"}</span></button>:null}
      {experimentalActions&&discovery ? <button type="button" aria-pressed={shortcut===3} disabled={switchingAI} onClick={() => runShortcut(3)}><Compass size={16} aria-hidden="true"/><span>{zh ? "发现整理主题" : "Discover topics"}</span></button> : null}
    </div>
    {coverageHint && incompleteIds.length ? <div className="history-coverage-hint"><Info size={14} aria-hidden="true"/><span>{zh ? `还有 ${incompleteIds.length} 条已发现对话未导入完整正文，${experimentalActions?"搜索和主题发现":"搜索"}可能遗漏结果。` : `${incompleteIds.length} discovered conversations still need their full messages imported; ${experimentalActions?"search and topic discovery":"search"} may miss results.`}</span><button type="button" disabled={switchingAI} onClick={() => onHydrate(incompleteIds)}>{zh ? "同步全部正文" : "Sync all messages"}</button></div> : null}
    {choosing?<div className="home-intent-choice" role="group" aria-label={zh?"选择执行方式":"Choose action"}><p>{zh?"选择如何使用这段输入：":"Choose how to use this input:"}</p><button type="button" onClick={()=>search("answer",0)}>{zh?"搜索历史":"Search history"}</button><button type="button" onClick={()=>search("project",2)}>{zh?"整理成项目":"Organize as project"}</button>{experimentalActions?<button type="button" onClick={()=>search("answer",1)}>{zh?"总结讨论":"Summarize"}</button>:null}</div>:null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
