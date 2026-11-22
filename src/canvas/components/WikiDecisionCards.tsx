import { useContext, useId, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { CircleHelp, Clock3, GitMerge, Lightbulb, PencilLine, X } from "lucide-react";
import { ledgerDecisionsPending } from "../../ai/wiki-key-decisions";
import { evidenceMessageKey } from "../../shared/evidence-identity";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { applyWikiDecisionCard, type ProjectOverviewWorkspace } from "../project-overview-workspace";
import type { WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { WorkspaceDisclosureTitle } from "./WorkspaceDisclosureTitle";
import { WorkspaceMoreMenu } from "./WorkspaceMoreMenu";
import { WikiDisclosure } from "./ReaderSourceSupplement";
import { WorkspaceEvidenceContext } from "../workspace-evidence-context";

type Question = ProjectOverviewWorkspace["questions"][number];
type Action = Parameters<typeof applyWikiDecisionCard>[2];
type Locate = (ref: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;

export function WikiDecisionCards({session, questions, deferred, zh, onLocate, onUpdate, updateDisabled}: {
  session: FocusSession;
  questions: Question[];
  deferred?: ReactNode;
  zh: boolean;
  onLocate: Locate;
  onUpdate?: () => void;
  updateDisabled?: boolean;
}) {
  const actions=useContext(ProjectKnowledgeActions);
  const activeId=useContext(WorkspaceEvidenceContext)?.active?.overviewEntryId;
  const prefix=useId();
  const lock=useRef(false);
  const [working,setWorking]=useState(false);
  const [choices,setChoices]=useState<Record<string,string>>({});
  const [editing,setEditing]=useState<{id:string;mode:"custom"|"merge";text:string}>();
  const [notice,setNotice]=useState("");
  const [undo,setUndo]=useState<{before:FocusSession;after:FocusSession}>();
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
    let receipt:typeof undo;
    try{
      await actions.save(before=>{
        const after=applyWikiDecisionCard(before,question,action,zh);
        receipt={before,after}; return after;
      });
      setUndo(receipt); setEditing(undefined);
      const timestamp=receipt?.after.wikiKnowledge?.decisionsAt;
      setSettled(timestamp!==undefined&&action.mode!=="defer"?{id:question.id,at:timestamp}:undefined);
      const entry=receipt?.after.wikiKnowledge?.decisionArbitrations?.[question.id];
      const needsRewrite=entry?entry.locallyApplied===false:ledgerDecisionsPending(receipt?.after.wikiKnowledge);
      setNotice(action.mode==="defer"?t("已移到暂缓列表","Moved to deferred questions")
        :action.mode==="reject"?t("已设为不采用","Set aside"):needsRewrite?t("已保存决定","Decision saved"):t("已更新正文","Wiki updated"));
    }catch{
      setNotice(t("这条决定已变化，请重试","This decision changed. Try again."));
    }finally{lock.current=false;setWorking(false);}
  }
  async function reverse(){
    if(!actions||!undo||lock.current)return;
    lock.current=true;setWorking(true);
    try{
      await actions.save(current=>{
        if(current.wikiKnowledge?.decisionsAt!==undo.after.wikiKnowledge?.decisionsAt
          || current.wikiKnowledge?.draft?.generatedAt!==undo.after.wikiKnowledge?.draft?.generatedAt
          || JSON.stringify(current.projectMaintenance?.deferredOverviewQuestions??[])!==JSON.stringify(undo.after.projectMaintenance?.deferredOverviewQuestions??[]))throw new Error("Decision changed");
        return {...current,wikiKnowledge:undo.before.wikiKnowledge,updatedAt:Date.now(),
          projectMaintenance:{...current.projectMaintenance,deferredOverviewQuestions:undo.before.projectMaintenance?.deferredOverviewQuestions}};
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
  const decisions=pending.filter(question=>question.kind!=="suggestion");
  const suggestions=pending.filter(question=>question.kind==="suggestion");
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
    const suggestion=question.kind==="suggestion";
    return <details name={prefix} key={question.id} data-decision-id={question.id} className="overview-question wiki-decision-card">
      <WorkspaceDisclosureTitle icon={suggestion?Lightbulb:CircleHelp} label={activeId===question.id?<mark className="overview-active-claim">{question.text}</mark>:question.text}/>
      <div className="wiki-supplement-content">
      {!suggestion&&<fieldset className="overview-options wiki-decision-options" aria-label={t("备选方案","Alternatives")} disabled={working||!actions}>
        {question.options.map(option=><div className="wiki-decision-option" key={option.id}>
          <label>
            <input type="radio" name={prefix+question.id} checked={choices[question.id]===option.id}
              onChange={()=>setChoices(previous=>({...previous,[question.id]:option.id}))}/>
            <span>{option.label}</span>
          </label>
          {option.decidedAt?<time dateTime={new Date(option.decidedAt).toISOString()}>{date.format(option.decidedAt)}</time>:null}
        </div>)}
      </fieldset>}
      {editing?.id!==question.id?<div className="wiki-decision-actions">
        {sourceButtons(question)}
        {actions?<div className="wiki-decision-controls"><WorkspaceMoreMenu label={t("更多决定操作","More decision actions")}>
          {question.mergeable?<button type="button" disabled={working} onClick={event=>menuAction(event,()=>setEditing({id:question.id,mode:"merge",text:""}))}><GitMerge size={14} aria-hidden="true"/>{t("合并方案","Merge options")}</button>:null}
          {suggestion?<button type="button" disabled={working} onClick={event=>menuAction(event,()=>void update(question,{mode:"reject"}))}><X size={14} aria-hidden="true"/>{t("不采用","Set aside")}</button>
            :<button type="button" disabled={working} onClick={event=>menuAction(event,()=>setEditing({id:question.id,mode:"custom",text:""}))}><PencilLine size={14} aria-hidden="true"/>{t("自定义决定","Write a decision")}</button>}
          <button type="button" disabled={working} onClick={event=>menuAction(event,()=>void update(question,{mode:"defer"}))}><Clock3 size={14} aria-hidden="true"/>{t("暂缓","Defer")}</button>
        </WorkspaceMoreMenu>
        <button type="button" className="wiki-decision-adopt" disabled={working||!suggestion&&!choices[question.id]}
          onClick={()=>void update(question,{mode:"choose",choice:suggestion?question.options[0].id:choices[question.id]})}>
          {suggestion?t("采纳建议","Adopt suggestion"):t("确认选择","Confirm choice")}</button></div>:null}
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
  const entry=settled&&session.wikiKnowledge?.decisionArbitrations?.[settled.id];
  const needsUpdate=Boolean(settled&&settled.at===session.wikiKnowledge?.decisionsAt
    &&(entry?entry.locallyApplied===false&&entry.at>(session.wikiKnowledge?.draft?.generatedAt??0):ledgerDecisionsPending(session.wikiKnowledge)));
  if(!pending.length&&!deferred&&!notice)return null;
  const label=t("待决问题","Open questions");
  return <section className="overview-block overview-pending" aria-label={label}>
    <h2>{label}{decisions.length>0&&<small aria-live="polite">{decisions.length}</small>}</h2>
    {decisions[0]&&card(decisions[0])}
    {decisions.length>1&&<WikiDisclosure className="overview-disclosure" label={t("查看全部待决问题","View all open questions")}>
      {actions?<button type="button" className="overview-text-button" disabled={working} onClick={()=>void deferAll()}>{t("批量暂缓","Defer all")}</button>:null}
      {decisions.slice(1).map(card)}
    </WikiDisclosure>}
    {suggestions.length>0&&<WikiDisclosure className="overview-disclosure" label={<>{t("可选建议","Optional suggestions")}<small>{suggestions.length}</small></>}>
      {suggestions.map(card)}
    </WikiDisclosure>}
    {deferred}
    {notice?<div className="wiki-decision-notice"><span role="status">{notice}</span>
      {undo?<button type="button" className="wiki-decision-source" disabled={working} onClick={()=>void reverse()}>{t("撤销","Undo")}</button>:null}
      {needsUpdate&&onUpdate?<button type="button" className="wiki-decision-source" onClick={onUpdate} disabled={updateDisabled}>{t("预览正文更新","Preview article update")}</button>:null}
    </div>:null}
  </section>;
}
