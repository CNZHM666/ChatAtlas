import { useContext, useId, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Pencil, Quote } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { saveOverviewChoice, type OverviewBasis, type ProjectOverviewWorkspace } from "../project-overview-workspace";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { ReaderGuide } from "./ReaderGuide";
import { WikiDisclosure } from "./ReaderSourceSupplement";
import { WikiDecisionCards } from "./WikiDecisionCards";

type Question = ProjectOverviewWorkspace["questions"][number];
type Chapter = Question["chapter"];
type Locate = (source: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;

function OverviewChoices({ question, selected, zh, working, onChoose }: {
  question: Question;
  selected: string;
  zh: boolean;
  working: boolean;
  onChoose: (optionId: string) => void;
}) {
  const group = useId();
  const [draft, setDraft] = useState(selected);
  const optionsLabel = zh ? "备选方案" : "Options";

  return <>
    <fieldset className="overview-options" aria-label={optionsLabel} disabled={working}>
      {question.options.map(option => <div key={option.id}><label>
        <input type="radio" name={group} value={option.id} checked={draft === option.id} onChange={() => setDraft(option.id)}/>
        <span>{option.label}</span>
        {option.decidedAt&&<small>{new Intl.DateTimeFormat(zh?"zh-CN":"en",{dateStyle:"medium",timeStyle:"short"}).format(option.decidedAt)}</small>}
      </label></div>)}
    </fieldset>
    <div className="overview-question-footer">
      <button type="button" className="overview-choice" disabled={working || draft === selected}
        onClick={() => onChoose(draft)}>{zh ? "确认选择" : "Confirm choice"}</button>
    </div>
  </>;
}

export function DocumentOverviewDetails({ session, data, zh, onRead, onLocate, onUpdateDecisions, updateDisabled }: {
  session: FocusSession;
  data: ProjectOverviewWorkspace;
  zh: boolean;
  onRead: (id: string, heading?: string) => void;
  onLocate: Locate;
  onUpdateDecisions?: () => void;
  updateDisabled?: boolean;
}) {
  const actions = useContext(ProjectKnowledgeActions);
  const activeId = useContext(WorkspaceEvidenceContext)?.active?.overviewEntryId;
  const questionGroup = useId();
  const [editing, setEditing] = useState<string>();
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const tr = (cn: string, en: string) => zh ? cn : en;
  const deferred = new Set(session.projectMaintenance?.deferredOverviewQuestions);
  const pending = data.questions.filter(question => !deferred.has(question.id));
  const paused = data.questions.filter(question => deferred.has(question.id));
  const plan = data.plan;
  const evidence = (items: OverviewBasis[], id: string, claim?: string) => items.length > 0 &&
    <button type="button" className="overview-icon-button" aria-label={tr("依据", "Evidence")} title={tr("查看原文依据", "Read original evidence")}
      aria-pressed={activeId === id} onClick={() => {
      const [first] = items;
      const references = [...new Map(items.map(item => [item.ref.id, item.ref])).values()];
      const sourcePassages = items.map(({ ref, quote }) => ({ referenceId: ref.id, quote }));
      onLocate(first.ref, { references, sourcePassages, ...(claim ? { claim, quote: first.quote } : {}), overviewEntryId: id, mode: "view", locationRevision: performance.now() });
    }}><Quote size={15} aria-hidden="true"/></button>;
  const highlighted = (text: string, id: string) => activeId === id ? <mark className="overview-active-claim">{text}</mark> : text;
  const chapterLink = (chapter: Chapter) => chapter &&
    <button type="button" className="overview-icon-button" aria-label={tr("查看章节", "Read chapter")} title={tr("查看章节", "Read chapter")} onClick={() => onRead(chapter.id, chapter.heading)}>
      <ArrowUpRight size={16} aria-hidden="true"/>
    </button>;

  async function save(update: (current: FocusSession) => FocusSession, message: string) {
    if (!actions || lock.current) return false;
    lock.current = true;
    setWorking(true);
    setFeedback(undefined);
    try {
      await actions.save(update);
      setFeedback({ error: false, text: message });
      return true;
    } catch {
      setFeedback({ error: true, text: tr("未能保存，请重试。", "Could not save. Try again.") });
      return false;
    } finally {
      lock.current = false;
      setWorking(false);
    }
  }

  function resume(question: Question) {
    void save(current => {
      const ids = new Set(current.projectMaintenance?.deferredOverviewQuestions);
      ids.delete(question.id);
      return { ...current, updatedAt: Date.now(), projectMaintenance: { ...current.projectMaintenance, deferredOverviewQuestions: [...ids] } };
    }, tr("已移回待决问题。", "Moved back to open questions."));
  }

  async function choose(question: Question, optionId: string) {
    if (await save(current => saveOverviewChoice(current, question, optionId, zh), tr("已保存选择。", "Choice saved."))) setEditing(undefined);
  }

  const deferredQuestions = paused.length > 0 ? <WikiDisclosure className="overview-disclosure" label={<>{tr("已暂缓", "Deferred")}<small>{paused.length}</small></>}>
    <ul className="overview-list">{paused.map(question => <li className="overview-row" key={question.id}>
      <WikiDisclosure label={highlighted(question.text, question.id)} name={questionGroup} className="overview-question">
        <div className="overview-entry-tools">
          {evidence(question.basis, question.id)}
          {actions&&<button type="button" className="overview-text-button" disabled={working} onClick={()=>resume(question)}>{tr("继续处理","Resume")}</button>}
        </div>
      </WikiDisclosure>
    </li>)}</ul>
  </WikiDisclosure> : undefined;

  const standing = { confirmed: tr("已确认", "Confirmed"), stated: tr("用户提出", "From you"), proposed: tr("讨论中", "Discussed") };
  const parts = { now: tr("安排", "Action"), notNow: tr("范围", "Scope"), done: tr("验收", "Acceptance") };
  const discussionRoadmap = plan?.discussion;
  const planRows = plan?.items ?? [];
  const followup = data.followup;
  const confirmedFollowup = followup.filter(item => item.standing === "confirmed");
  const discussion = followup.filter(item => item.standing !== "confirmed");
  const planCount = planRows.length + followup.length;

  type Choice = ProjectOverviewWorkspace["decisions"][number]["choice"];
  const editButton = (id: string, choice: Choice) => actions && choice &&
    <button type="button" className="overview-icon-button" aria-expanded={editing === id}
      aria-label={tr("修改选择", "Change choice")} title={tr("修改选择", "Change choice")}
      onClick={() => setEditing(previous => previous === id ? undefined : id)}><Pencil size={15} aria-hidden="true"/></button>;
  const choiceEditor = (id: string, choice: Choice) => editing === id && choice && actions &&
    <div className="overview-question-detail"><p>{choice.question.text}</p>
      <OverviewChoices key={choice.option} question={choice.question} selected={choice.option} zh={zh} working={working}
        onChoose={option => void choose(choice.question, option)}/>
      {choice.previous?.length ? <WikiDisclosure label={tr("此前的选择", "Previous choices")} className="overview-disclosure">
        <ul>{choice.previous.map((entry, index) => <li key={entry.at + "-" + index}>{entry.answer}</li>)}</ul>
      </WikiDisclosure> : null}
    </div>;
  const decisionRow = (item: ProjectOverviewWorkspace["decisions"][number]) => <li key={item.id} className="overview-row">
    <WikiDisclosure className="overview-entry" label={<span className="overview-entry-text">{highlighted(item.text, item.id)}</span>}>
      <div className="overview-entry-tools">{evidence(item.basis, item.id, item.text)}{chapterLink(item.chapter)}{editButton(item.id, item.choice)}</div>
      {choiceEditor(item.id, item.choice)}
    </WikiDisclosure>
  </li>;
  const planLine = (id: string, label: string, text: string, tools: ReactNode, choice: Choice, status?: string) => <li key={id} className="overview-plan-line">
    <div className="overview-plan-type">{label}{status && <small>{status}</small>}</div>
    <p>{highlighted(text, id)}</p>
    <div className="overview-plan-actions">{tools}{editButton(id, choice)}</div>
    {choiceEditor(id, choice)}
  </li>;
  const followupLine = (item: typeof followup[number]) => planLine(item.id, parts[item.part], item.text,
    <>{evidence(item.basis, item.id, item.text)}{chapterLink(item.chapter)}</>, item.choice, item.standing === "stated" ? standing.stated : undefined);

  const planLabel = tr("后续计划与验收", "Plan and acceptance");
  const decisionLabel = tr("已定的关键决定", "Key decisions");
  return <>
    {feedback && <p className={feedback.error ? "overview-feedback" : "sr-only"} role={feedback.error ? "alert" : "status"}>{feedback.text}</p>}
    <WikiDecisionCards session={session} questions={pending} deferred={deferredQuestions} zh={zh} onLocate={onLocate}
      onUpdate={onUpdateDecisions} updateDisabled={updateDisabled}/>
    {(plan?.personal || planCount > 0 || discussionRoadmap) && <section className="overview-fold overview-plan" aria-label={planLabel}>
      <WikiDisclosure className="overview-section-toggle" label={<>{planLabel}{planCount > 0 && <small>{planCount}</small>}</>}>
        {plan?.personal && <div className="overview-plan-group overview-personal-plan">
          <h3>{tr("个人计划", "Personal plan")}</h3><ReaderGuide content={plan.personal} zh={zh} complete/>
        </div>}
        {(planRows.length > 0 || confirmedFollowup.length > 0) && <div className="overview-plan-group">
          <h3>{standing.confirmed}</h3>
          <ul className="overview-list">
            {planRows.map(item => planLine(item.unit.id, item.roadmap ? tr("交付顺序", "Delivery order") : tr("版本安排", "Release plan"),
              item.text, <>{evidence([{ ref: item.source, quote: item.unit.evidence.quote, text: item.text }], item.unit.id, item.text)}{chapterLink(data.planChapters[item.unit.id])}</>, data.planChoices[item.unit.id]))}
            {confirmedFollowup.map(followupLine)}
          </ul>
        </div>}
        {discussion.length > 0 && <div className="overview-plan-group">
          <h3>{standing.proposed}</h3>
          <ul className="overview-list">{discussion.map(followupLine)}</ul>
        </div>}
        {discussionRoadmap && <button type="button" className="overview-chapter-link" onClick={() => onRead(discussionRoadmap.sectionId, discussionRoadmap.heading)}>
          {tr("查看路线图", "Read the roadmap")}<ArrowUpRight size={15} aria-hidden="true"/>
        </button>}
      </WikiDisclosure>
    </section>}
    {data.decisions.length > 0 && <section className="overview-fold" aria-label={decisionLabel}>
      <WikiDisclosure className="overview-section-toggle" label={<>{decisionLabel}<small>{data.decisions.length}</small></>}>
        <ul className="overview-list">{data.decisions.map(decisionRow)}</ul>
      </WikiDisclosure>
    </section>}
  </>;
}
