import { useContext, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { CircleHelp, Clock3, GitMerge, PencilLine } from "lucide-react";
import { evidenceMessageKey } from "../../shared/evidence-identity";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { applyWikiDecisionCard, editOverviewDecision, type ProjectOverviewWorkspace } from "../project-overview-workspace";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { WorkspaceDisclosureTitle } from "./WorkspaceDisclosureTitle";
import { WorkspaceMoreMenu } from "./WorkspaceMoreMenu";
import { WikiDisclosure } from "./ReaderSourceSupplement";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";

type Question = ProjectOverviewWorkspace["questions"][number];
type Action = Parameters<typeof applyWikiDecisionCard>[2];
type Locate = (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;

export function WikiDecisionCards({session, questions, deferred, zh, onLocate, onRead}: {
  session: FocusSession;
  questions: Question[];
  deferred?: ReactNode;
  zh: boolean;
  onLocate: Locate;
  onRead?: (id: string, heading?: string) => void;
}) {
  const actions=useContext(ProjectKnowledgeActions);
  const activeId=useContext(WorkspaceEvidenceContext)?.active?.overviewEntryId;
  const prefix=useId();
  const lock=useRef(false);
  const [working,setWorking]=useState(false);
  const [choices,setChoices]=useState<Record<string,string>>({});
  const [editing,setEditing]=useState<{id:string;mode:"custom"|"merge";text:string}>();
  const [notice,setNotice]=useState("");
  const [undo,setUndo]=useState<{id:string; at?:number}>();
  const [settled,setSettled]=useState<{id:string;at:number}>();
  const t=(cn:string,en:string)=>zh?cn:en;
  const date=useMemo(()=>new Intl.DateTimeFormat(zh?"zh-CN":"en",{dateStyle:"medium"}),[zh]);

  const sourceButtons = (question: Question) => {
    const messages = new Map<string, { ref: FocusEvidence; quotes: Set<string> }>();
    for (const { ref, quote } of question.sources ?? question.basis) {
      const key = evidenceMessageKey(ref);
      const message = messages.get(key) ?? { ref, quotes: new Set<string>() };
      message.quotes.add(quote);
      messages.set(key, message);
    }
    return messages.size ? <div className="wiki-decision-sources">{[...messages].map(([key, {ref, quotes}], index) =>
      <button key={key} type="button" className="wiki-decision-source" title={ref.title} onClick={() => onLocate(ref, {
        overviewEntryId:question.id, quote: quotes.values().next().value, references: [ref], locationRevision:performance.now(),
        sourcePassages: [...quotes].map(quote => ({ referenceId: ref.id, quote })), mode: "view",
      })}>{zh ? `来源 ${index + 1}` : `Source ${index + 1}`}</button>
    )}</div> : null;
  };
  async function update(question:Question,action:Action){
    if(!actions||lock.current)return;
    lock.current=true; setWorking(true); setNotice("");
    let timestamp: number | undefined;
    try{
      await actions.save(before=>{
        const after=applyWikiDecisionCard(before,question,action,zh);
        timestamp=after.wikiKnowledge?.decisionArbitrations?.[question.id]?.at;
        return after;
      });
      setUndo({id:question.id, at: action.mode === "defer" ? undefined : timestamp}); setEditing(undefined);
      setSettled(timestamp!==undefined&&action.mode!=="defer"?{id:question.id,at:timestamp}:undefined);
      setNotice(action.mode==="defer"?t("已移到暂缓列表","Moved to deferred questions")
        :t("已保存决定。可单独预览正文更新。", "Decision saved. You can preview the chapter update separately."));
    }catch{
      setNotice(t("这条决定已变化，请重试","This decision changed. Try again."));
    }finally{lock.current=false;setWorking(false);}
  }
  async function reverse(){
    if(!actions||!undo||lock.current)return;
    lock.current=true;setWorking(true);
    try{
      await actions.save(current=>{
        if(undo.at!==undefined)return editOverviewDecision(current,undo.id,undo.at);
        const deferred=current.projectMaintenance?.deferredOverviewQuestions??[];
        if(!deferred.includes(undo.id))throw new Error("Decision changed");
        return {...current,updatedAt:Date.now(),projectMaintenance:{...current.projectMaintenance,
          deferredOverviewQuestions:deferred.filter(id=>id!==undo.id)}};
      });
      setUndo(undefined);setSettled(undefined);setNotice(t("已撤销","Undone"));
    }catch{setNotice(t("此决定已有新修改，请到总览核对","This decision was edited again. Check it in the overview."));}
    finally{lock.current=false;setWorking(false);}
  }
  const menuAction=(event:MouseEvent<HTMLButtonElement>,run:()=>void)=>{
    const menu=event.currentTarget.closest("details");
    if(menu){menu.open=false;menu.querySelector("summary")?.focus();}
    run();
  };
  const pending=questions.filter(question=>question.id!==settled?.id||settled.at!==session.wikiKnowledge?.decisionsAt);
  const decisions=pending;
  async function deferAll() {
    if(!actions||lock.current)return;
    lock.current=true;setWorking(true);
    try {
      await actions.save(current=>{
        const ids=new Set([...current.projectMaintenance?.deferredOverviewQuestions??[],...decisions.map(question=>question.id)]);
        return {...current,updatedAt:Date.now(),projectMaintenance:{...current.projectMaintenance,deferredOverviewQuestions:[...ids]}};
      });
      setUndo(undefined);
      setSettled(undefined);
      setNotice(t("已批量暂缓","Questions deferred"));
    } catch { setNotice(t("未能保存，请重试","Could not save. Try again")); }
    finally { lock.current=false;setWorking(false); }
  }
  const card=(question:Question)=>{
    const chapter = question.chapter;
    return <details name={prefix} key={question.id} data-decision-id={question.id} className="overview-question wiki-decision-card">
      <WorkspaceDisclosureTitle icon={CircleHelp} label={activeId===question.id?<mark className="overview-active-claim">{question.text}</mark>:question.text}/>
      <div className="wiki-supplement-content">
      <fieldset className="overview-options wiki-decision-options" aria-label={t("备选方案","Alternatives")} disabled={working||!actions}>
        {question.options.map(option=><div className="wiki-decision-option" key={option.id}>
          <label>
            <input type="radio" name={prefix+question.id} checked={choices[question.id]===option.id}
              onChange={()=>setChoices(previous=>({...previous,[question.id]:option.id}))}/>
            <span>{option.label}</span>
          </label>
          {option.decidedAt?<time dateTime={new Date(option.decidedAt).toISOString()}>{date.format(option.decidedAt)}</time>:null}
        </div>)}
      </fieldset>
      {editing?.id!==question.id?<div className="wiki-decision-actions">
        {sourceButtons(question)}
        {chapter && onRead && <button type="button" className="wiki-decision-source" onClick={() => onRead(chapter.id, chapter.heading)}>{t("查看章节", "Read chapter")}</button>}
        {actions?<div className="wiki-decision-controls"><WorkspaceMoreMenu label={t("更多决定操作","More decision actions")}>
          {question.mergeable?<button type="button" disabled={working} onClick={event=>menuAction(event,()=>setEditing({id:question.id,mode:"merge",text:""}))}><GitMerge size={14} aria-hidden="true"/>{t("合并方案","Merge options")}</button>:null}
          <button type="button" disabled={working} onClick={event=>menuAction(event,()=>setEditing({id:question.id,mode:"custom",text:""}))}><PencilLine size={14} aria-hidden="true"/>{t("自定义决定","Write a decision")}</button>
          <button type="button" disabled={working} onClick={event=>menuAction(event,()=>void update(question,{mode:"defer"}))}><Clock3 size={14} aria-hidden="true"/>{t("暂缓","Defer")}</button>
        </WorkspaceMoreMenu>
        <button type="button" className="wiki-decision-adopt" disabled={working||!choices[question.id]}
          onClick={()=>void update(question,{mode:"choose",choice:choices[question.id]})}>
          {t("确认选择","Confirm choice")}</button></div>:null}
      </div>:null}
      {editing?.id===question.id?<form className="wiki-decision-actions wiki-decision-edit" onSubmit={event=>{event.preventDefault();void update(question,{mode:editing.mode,text:editing.text});}}>
        {sourceButtons(question)}
        <input autoFocus aria-label={t("写下当前决定","Write the current decision")} placeholder={editing.mode==="merge"?t("写下合并后的方案","Write the merged option"):t("写下当前决定","Write the current decision")} maxLength={500} value={editing.text}
          onChange={event=>setEditing({...editing,text:event.target.value})}/>
        <button type="button" className="wiki-decision-source" disabled={working} onClick={()=>setEditing(undefined)}>{t("取消","Cancel")}</button>
        <button type="submit" className="wiki-decision-adopt" disabled={working||!editing.text.trim()}>{t("保存","Save")}</button>
      </form>:null}
      </div>
    </details>;
  };
  if(!pending.length&&!deferred&&!notice)return null;
  const label=t("待决问题","Open questions");
  return <section className="overview-block overview-pending" aria-label={label}>
    <h2>{label}{decisions.length>0&&<small aria-live="polite">{decisions.length}</small>}</h2>
    {decisions[0]&&card(decisions[0])}
    {decisions.length>1&&<WikiDisclosure className="overview-disclosure" label={t("查看全部待决问题","View all open questions")}>
      {actions?<button type="button" className="overview-text-button" disabled={working} onClick={()=>void deferAll()}>{t("批量暂缓","Defer all")}</button>:null}
      {decisions.slice(1).map(card)}
    </WikiDisclosure>}
    {deferred}
    {notice?<div className="wiki-decision-notice"><span role="status">{notice}</span>
      {undo?<button type="button" className="wiki-decision-source" disabled={working} onClick={()=>void reverse()}>{t("撤销","Undo")}</button>:null}
    </div>:null}
  </section>;
}
