import { useContext, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, Check, Copy, Pencil, Plus, Quote, X } from "lucide-react";
import type { FocusEvidence, FocusSession } from "../../shared/focus-session";
import { wikiLedgerUnits } from "../../shared/wiki-knowledge";
import { withDecision } from "../../ai/wiki-key-decisions";
import { ProjectKnowledgeActions } from "../project-knowledge-actions";
import { editOverviewDecision, saveOverviewChoice, type OverviewBasis, type ProjectOverviewWorkspace } from "../project-overview-workspace";
import { WorkspaceEvidenceContext, type WorkspaceEvidenceOptions } from "../workspace-evidence-context";
import { ReaderGuide } from "./ReaderGuide";
import { WikiDisclosure } from "./ReaderSourceSupplement";
import { WikiDecisionCards } from "./WikiDecisionCards";

type Question = ProjectOverviewWorkspace["questions"][number];
type Chapter = Question["chapter"];
type Locate = (source: FocusEvidence, options?: WorkspaceEvidenceOptions) => void;
type DecisionItem = ProjectOverviewWorkspace["decisions"][number] & {
  chapterTitle?: string;
  origin?: "user_confirmed" | "user_message" | "review_confirmed" | "manual";
  decidedAt?: number;
  tier?: "core" | "detail";
  unitId?: string;
};
type ExtendedPlan = NonNullable<ProjectOverviewWorkspace["plan"]> & {
  reportedProgress?: { date?: number; items: string[]; source?: FocusEvidence };
  proposals?: Array<{ id: string; text: string; scope?: string; source?: FocusEvidence; chapter?: { id: string; heading?: string } }>;
};

const ORIGIN_LABEL: Record<NonNullable<DecisionItem["origin"]>, [string, string]> = {
  user_confirmed: ["已确认", "Confirmed"],
  user_message: ["你亲口提出", "From your message"],
  review_confirmed: ["核对确认", "Confirmed in review"],
  manual: ["手动记录", "Added manually"],
};

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

export function DocumentOverviewDetails({ session, data, zh, onRead, onLocate }: {
  session: FocusSession;
  data: ProjectOverviewWorkspace;
  zh: boolean;
  onRead: (id: string, heading?: string) => void;
  onLocate: Locate;
}) {
  const actions = useContext(ProjectKnowledgeActions);
  const activeId = useContext(WorkspaceEvidenceContext)?.active?.overviewEntryId;
  const questionGroup = useId();
  const [editing, setEditing] = useState<string>();
  const [decisionText, setDecisionText] = useState("");
  const [addingDecision, setAddingDecision] = useState(false);
  const [newDecisionText, setNewDecisionText] = useState("");
  const [editingPlan, setEditingPlan] = useState(false);
  const [planDraft, setPlanDraft] = useState("");
  const [copiedConsensus, setCopiedConsensus] = useState(false);
  const [feedback, setFeedback] = useState<{ error: boolean; text: string }>();
  const [working, setWorking] = useState(false);
  const lock = useRef(false);
  const tr = (cn: string, en: string) => zh ? cn : en;
  const deferred = new Set(session.projectMaintenance?.deferredOverviewQuestions);
  const pending = data.questions.filter(question => !deferred.has(question.id)).slice(0, 5);
  const paused = data.questions.filter(question => deferred.has(question.id));
  const plan = data.plan as ExtendedPlan | undefined;
  const sectionTitles = useMemo(() => new Map(session.sections.map(section => [section.id, section.wikiDisplayTitle || section.title])), [session.sections]);

  const evidence = (items: OverviewBasis[], id: string, claim?: string) => items.length > 0 &&
    <button type="button" className="overview-action-chip" aria-label={tr("依据", "Evidence")} title={tr("查看原文依据", "Read original evidence")}
      aria-pressed={activeId === id} onClick={() => {
      const [first] = items;
      const references = [...new Map(items.map(item => [item.ref.id, item.ref])).values()];
      const sourcePassages = items.map(({ ref, quote }) => ({ referenceId: ref.id, quote }));
      onLocate(first.ref, { references, sourcePassages, ...(claim ? { claim, quote: first.quote } : {}), overviewEntryId: id, mode: "view", locationRevision: performance.now() });
    }}><Quote size={13} aria-hidden="true"/><span>{tr("原话", "Source")}</span></button>;
  const highlighted = (text: string, id: string) => activeId === id ? <mark className="overview-active-claim">{text}</mark> : text;
  const chapterLink = (chapter: Chapter) => chapter &&
    <button type="button" className="overview-action-chip" aria-label={tr("查看章节", "Read chapter")} title={tr("查看章节", "Read chapter")} onClick={() => onRead(chapter.id, chapter.heading)}>
      <span>{tr("章节", "Chapter")}</span><ArrowUpRight size={13} aria-hidden="true"/>
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
    if (await save(current => saveOverviewChoice(current, question, optionId, zh), tr("已更新共识，将同步用于下次续聊。", "Decision saved and synced for continuation."))) setEditing(undefined);
  }

  const savePlanText = async (text: string) => {
    const cleaned = text.trim();
    const ok = await save(current => ({
      ...current,
      updatedAt: Date.now(),
      projectMaintenance: { ...current.projectMaintenance, currentPlan: cleaned || undefined },
    }), cleaned ? tr("已更新当前计划，将同步用于下次续聊。", "Current plan saved and synced for continuation.") : tr("已清空手写计划。", "Cleared custom plan."));
    if (ok) setEditingPlan(false);
  };

  const addManualDecision = async () => {
    const cleaned = newDecisionText.trim();
    if (!cleaned) return;
    const now = Date.now();
    const id = `manual:${now}`;
    const ok = await save(current => {
      const ledger = current.wikiKnowledge;
      if (ledger) {
        return {
          ...current,
          updatedAt: now,
          wikiKnowledge: {
            ...ledger,
            decisionsAt: now,
            decisionArbitrations: {
              ...ledger.decisionArbitrations,
              [id]: { choice: "custom", question: tr("手动记录的关键决定", "Manual key decision"), text: cleaned, mode: "custom", locallyApplied: true, at: now, unitIds: [] },
            },
          },
        };
      }
      const first = current.sections[0];
      if (!first) return current;
      return {
        ...current,
        updatedAt: now,
        sections: current.sections.map((section, idx) => idx === 0
          ? { ...section, claims: [...(section.claims ?? []), { text: cleaned, quote: "", evidenceIds: [], holder: "decided" as const, userDecided: true, checked: true, continuation: true }] }
          : section),
      };
    }, tr("已记录关键决定，将同步用于下次续聊。", "Decision recorded and synced for continuation."));
    if (ok) { setNewDecisionText(""); setAddingDecision(false); }
  };

  const applyDecisionAdjustment = async (item: DecisionItem, mode: "edit" | "downgrade_ai" | "reopen", nextText?: string) => {
    const id = item.receiptId;
    const receipt = id ? session.wikiKnowledge?.decisionArbitrations?.[id] : undefined;
    if (id && receipt && (mode === "edit" || mode === "reopen")) {
      const ok = await save(current => editOverviewDecision(current, id, receipt.at, mode === "reopen" ? undefined : nextText),
        mode === "reopen" ? tr("已移回待决问题。", "Moved back to open questions.") : tr("已更新共识，将同步用于下次续聊。", "Decision saved and synced for continuation."));
      if (ok) setEditing(undefined);
      return;
    }
    const now = Date.now();
    const unitId = item.unitId ?? (session.wikiKnowledge && wikiLedgerUnits(session.wikiKnowledge).some(unit => unit.id === item.id) ? item.id : undefined);
    const cleaned = nextText?.trim() ?? "";
    const message = mode === "downgrade_ai"
      ? tr("已降级为 AI 建议，不再作为已定共识。", "Changed to AI suggestion.")
      : mode === "reopen"
        ? tr("已移回待决状态。", "Moved back to open.")
        : tr("已更新共识，将同步用于下次续聊。", "Decision saved and synced for continuation.");
    const ok = await save(current => {
      const nextHolder = mode === "downgrade_ai" ? "ai" as const : mode === "reopen" ? "open" as const : "decided" as const;
      const sections = current.sections.map(section => {
        if (!section.claims?.length) return section;
        let touched = false;
        const claims = section.claims.map(claim => {
          const matched = claim.text === item.text || (unitId && claim.unitIds?.includes(unitId));
          if (!matched) return claim;
          touched = true;
          return {
            ...claim,
            ...(mode === "edit" && cleaned ? { text: cleaned } : {}),
            holder: nextHolder,
            holderMark: true,
            userDecided: nextHolder === "decided",
            checked: true,
          };
        });
        return touched ? { ...section, claims } : section;
      });
      let wikiKnowledge = current.wikiKnowledge;
      if (wikiKnowledge) {
        if (id && wikiKnowledge.decisionArbitrations?.[id] && mode === "downgrade_ai") {
          const arbitrations = { ...wikiKnowledge.decisionArbitrations };
          delete arbitrations[id];
          wikiKnowledge = { ...wikiKnowledge, decisionArbitrations: arbitrations, decisionsAt: now };
        }
        if (unitId) {
          const verdict = mode === "downgrade_ai" ? undefined : mode === "reopen" ? "open" as const : "confirmed" as const;
          wikiKnowledge = withDecision(wikiKnowledge, [unitId], verdict, undefined, [mode === "edit" && cleaned ? cleaned : item.text], { locallyApplied: true });
        }
        if (mode === "edit" && cleaned) {
          const receiptKey = id ?? `edit:${item.id}`;
          wikiKnowledge = {
            ...wikiKnowledge,
            decisionsAt: now,
            decisionArbitrations: {
              ...wikiKnowledge.decisionArbitrations,
              [receiptKey]: {
                choice: "custom",
                question: item.text,
                text: cleaned,
                mode: "custom",
                locallyApplied: true,
                at: now,
                unitIds: unitId ? [unitId] : [],
              },
            },
          };
        }
      }
      return { ...current, updatedAt: now, sections, ...(wikiKnowledge ? { wikiKnowledge } : {}) };
    }, message);
    if (ok) setEditing(undefined);
  };

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

  const discussionRoadmap = plan?.discussion;
  const planRows = plan?.personal ? [] : plan?.items ?? [];
  const fallbackPlanContext = useMemo(() => {
    if (plan?.personal || planRows.length > 0 || !session.wikiKnowledge) return { reported: undefined, proposals: [] as NonNullable<ExtendedPlan["proposals"]> };
    const units = wikiLedgerUnits(session.wikiKnowledge).filter(unit => !unit.about && !unit.evidence.pasted);
    const reportedUnits = units.filter(unit => unit.delivery === "user_reported");
    const reported = plan?.reportedProgress ?? (reportedUnits.length ? {
      date: Math.max(0, ...reportedUnits.map(unit => unit.evidence.discussedAt ?? 0)) || undefined,
      items: [...new Set(reportedUnits.map(unit => unit.statement.trim()).filter(Boolean))].slice(-3),
    } : undefined);
    const proposals = plan?.proposals?.length ? plan.proposals : units
      .filter(unit => unit.kind === "plan" && unit.adoption?.status === "proposal" && unit.statement.trim().length >= 12)
      .slice(-3)
      .map(unit => ({
        id: unit.id,
        text: unit.statement.trim(),
        scope: unit.subject,
      }));
    return { reported, proposals };
  }, [plan, planRows.length, session.wikiKnowledge]);
  const reportedProgress = plan?.personal ? undefined : (plan?.reportedProgress ?? fallbackPlanContext.reported);
  const planProposals = plan?.personal || planRows.length > 0 ? [] : (plan?.proposals ?? fallbackPlanContext.proposals);
  const planCount = planRows.length;

  const copyConsensus = async () => {
    const lines: string[] = [`# ${session.title}`];
    const intro = session.projectMaintenance?.overview?.trim() || session.brief?.summary?.trim();
    if (intro) lines.push("", intro);
    if (plan?.personal) {
      lines.push("", `## ${tr("当前计划", "Current plan")}`, plan.personal);
    } else if (planRows.length) {
      lines.push("", `## ${tr("当前计划", "Current plan")}`, ...planRows.map(item => `- ${item.text}`));
    }
    if (data.decisions.length) {
      lines.push("", `## ${tr("已定的关键决定", "Key decisions")}`, ...data.decisions.map(item => `- ${item.text}`));
    }
    if (pending.length) {
      lines.push("", `## ${tr("待决问题", "Open questions")}`, ...pending.map(item => `- ${item.text}`));
    }
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopiedConsensus(true);
      window.setTimeout(() => setCopiedConsensus(false), 1800);
    } catch {
      setFeedback({ error: true, text: tr("复制失败，请检查剪贴板权限。", "Could not copy to clipboard.") });
    }
  };

  type Choice = ProjectOverviewWorkspace["decisions"][number]["choice"];
  const editButton = (id: string, choice: Choice) => actions && choice &&
    <button type="button" className="overview-action-chip" aria-expanded={editing === id}
      aria-label={tr("修改选择", "Change choice")} title={tr("修改选择", "Change choice")}
      onClick={() => setEditing(previous => previous === id ? undefined : id)}><Pencil size={13} aria-hidden="true"/><span>{tr("调整", "Edit")}</span></button>;
  const choiceEditor = (id: string, choice: Choice) => editing === id && choice && actions &&
    <div className="overview-question-detail"><p>{choice.question.text}</p>
      <OverviewChoices key={choice.option} question={choice.question} selected={choice.option} zh={zh} working={working}
        onChoose={option => void choose(choice.question, option)}/>
      {choice.previous?.length ? <WikiDisclosure label={tr("此前的选择", "Previous choices")} className="overview-disclosure">
        <ul>{choice.previous.map((entry, index) => <li key={entry.at + "-" + index}>{entry.answer}</li>)}</ul>
      </WikiDisclosure> : null}
    </div>;
  const decisionRow = (rawItem: ProjectOverviewWorkspace["decisions"][number]) => {
    const item = rawItem as DecisionItem;
    const id = item.receiptId;
    const receipt = id ? session.wikiKnowledge?.decisionArbitrations?.[id] : undefined;
    const chapterName = item.chapterTitle ?? (item.chapter?.id ? sectionTitles.get(item.chapter.id) : undefined);
    const originText = item.origin ? ORIGIN_LABEL[item.origin][zh ? 0 : 1] : receipt ? tr("已确认", "Confirmed") : undefined;
    const dateText = item.decidedAt ? new Intl.DateTimeFormat(zh ? "zh-CN" : "en", { month: "numeric", day: "numeric" }).format(item.decidedAt) : undefined;
    const canAdjust = Boolean(actions && (!item.choice || receipt));
    return <li key={item.id} className="overview-row">
      <div className="overview-decision-row">
        <div className="overview-decision-main">
          <span className="overview-entry-text">{highlighted(item.text, item.id)}</span>
          {(chapterName || originText || dateText) ? <div className="overview-decision-meta">
            {chapterName ? <span className="overview-meta-tag">{chapterName}</span> : null}
            {originText ? <small>{originText}{dateText ? ` · ${dateText}` : ""}</small> : dateText ? <small>{dateText}</small> : null}
          </div> : null}
        </div>
        <div className="overview-entry-tools">
          {evidence(item.basis, item.id, item.text)}
          {chapterLink(item.chapter)}
          {canAdjust ? <button type="button" className="overview-action-chip" aria-label={tr("编辑决定", "Edit decision")}
            aria-expanded={editing === item.id} onClick={() => { setDecisionText(item.text); setEditing(previous => previous === item.id ? undefined : item.id); }}>
            <Pencil size={13} aria-hidden="true"/><span>{tr("调整", "Edit")}</span>
          </button> : editButton(item.id, item.choice)}
        </div>
      </div>
      {editing === item.id && canAdjust ? <form className="overview-decision-editor" onSubmit={event => { event.preventDefault(); void applyDecisionAdjustment(item, "edit", decisionText); }}>
        <label>{tr("决定内容", "Decision")}<textarea value={decisionText} onChange={event => setDecisionText(event.target.value)} maxLength={500} rows={2}/></label>
        <div className="overview-question-footer">
          <button type="button" className="overview-text-button" disabled={working} onClick={() => void applyDecisionAdjustment(item, "downgrade_ai")}>{tr("降为 AI 建议", "Mark as AI suggestion")}</button>
          <button type="button" className="overview-text-button" disabled={working} onClick={() => void applyDecisionAdjustment(item, "reopen")}>{tr("移回待决", "Reopen")}</button>
          <button type="button" className="overview-text-button" onClick={() => setEditing(undefined)}>{tr("取消", "Cancel")}</button>
          <button type="submit" className="overview-choice" disabled={working || !decisionText.trim() || decisionText.trim() === item.text}>{tr("保存决定", "Save decision")}</button>
        </div>
      </form> : choiceEditor(item.id, item.choice)}
    </li>;
  };
  const planLine = (id: string, label: string, text: string, tools: ReactNode, choice: Choice, status?: string) => <li key={id} className="overview-plan-line">
    <div className="overview-plan-type">{label}{status && <small>{status}</small>}</div>
    <p>{highlighted(text, id)}</p>
    <div className="overview-plan-actions">{tools}{editButton(id, choice)}</div>
    {choiceEditor(id, choice)}
  </li>;
  const [showAllDecisions, setShowAllDecisions] = useState(false);
  const visibleDecisions = showAllDecisions ? data.decisions : data.decisions.slice(0, 5);
  const planLabel = tr("当前计划", "Current plan");
  const decisionLabel = tr("已定的关键决定", "Key decisions");
  const showPlanSection = Boolean(plan?.personal || planCount > 0 || discussionRoadmap || planProposals.length > 0 || reportedProgress);
  const showConsensusCopy = Boolean(data.decisions.length > 0 || plan?.personal || planCount > 0);
  return <>
    {feedback && <div className={`overview-feedback-banner${feedback.error ? " is-error" : ""}`} role={feedback.error ? "alert" : "status"}>
      <span>{feedback.text}</span>
      <button type="button" aria-label={tr("关闭提示", "Dismiss")} onClick={() => setFeedback(undefined)}><X size={13} aria-hidden="true"/></button>
    </div>}
    <WikiDecisionCards session={session} questions={pending} deferred={deferredQuestions} zh={zh} onLocate={onLocate} onRead={onRead}/>
    {showPlanSection && <section className="overview-fold overview-plan" aria-label={planLabel}>
      <WikiDisclosure defaultOpen className="overview-section-toggle" label={<>{planLabel}{planCount > 0 && <small>{planCount}</small>}</>}>
        {editingPlan ? <form className="overview-plan-editor" onSubmit={event => { event.preventDefault(); void savePlanText(planDraft); }}>
          <textarea autoFocus rows={3} maxLength={1000} aria-label={tr("当前计划内容", "Current plan")} placeholder={tr("写下当前阶段目标或下一步要推进的事情…", "Write your current milestone or next steps…")} value={planDraft} disabled={working} onChange={event => setPlanDraft(event.target.value)}/>
          <div className="overview-question-footer">
            {plan?.personal ? <button type="button" className="overview-text-button" disabled={working} onClick={() => void savePlanText("")}>{tr("恢复自动提取", "Reset to extracted")}</button> : null}
            <button type="button" className="overview-text-button" onClick={() => setEditingPlan(false)}>{tr("取消", "Cancel")}</button>
            <button type="submit" className="overview-choice" disabled={working}>{tr("保存计划", "Save plan")}</button>
          </div>
        </form> : <>
          {plan?.personal && <div className="overview-plan-group overview-personal-plan">
            <ReaderGuide content={plan.personal} zh={zh} complete/>
          </div>}
          {planRows.length > 0 && <div className="overview-plan-group">
            <ul className="overview-list">
              {planRows.map(item => planLine(item.unit.id, item.roadmap ? tr("交付顺序", "Delivery order") : tr("版本安排", "Release plan"),
                item.text, <>{evidence([{ ref: item.source, quote: item.unit.evidence.quote, text: item.text }], item.unit.id, item.text)}{chapterLink(data.planChapters[item.unit.id])}</>, data.planChoices[item.unit.id]))}
            </ul>
          </div>}
          {reportedProgress?.items.length ? <div className="overview-plan-progress">
            <span className="overview-plan-badge is-done">{tr("最近进展", "Recent progress")}</span>
            <p>{reportedProgress.items.join(zh ? "；" : "; ")}</p>
          </div> : null}
          {planProposals.length > 0 ? <div className="overview-plan-proposals">
            <div className="overview-plan-proposals-head">
              <span className="overview-plan-badge is-proposal">{tr("AI 提案 · 未确认", "AI proposals · unconfirmed")}</span>
            </div>
            <ul className="overview-list">
              {planProposals.map(proposal => <li key={proposal.id} className="overview-proposal-row">
                <span>{proposal.text}</span>
                {actions ? <button type="button" className="overview-action-chip is-adopt" disabled={working} onClick={() => void savePlanText(proposal.text)}>{tr("采纳为计划", "Adopt")}</button> : null}
              </li>)}
            </ul>
          </div> : null}
          <div className="overview-card-footer">
            {actions ? <button type="button" className="overview-text-button" onClick={() => { setPlanDraft(plan?.personal ?? ""); setEditingPlan(true); }}>
              <Pencil size={13} aria-hidden="true"/>{plan?.personal ? tr("编辑当前计划", "Edit plan") : tr("写下当前计划", "Write current plan")}
            </button> : null}
            {discussionRoadmap && <button type="button" className="overview-chapter-link" onClick={() => onRead(discussionRoadmap.sectionId, discussionRoadmap.heading)}>
              {tr("查看路线图", "Read the roadmap")}<ArrowUpRight size={14} aria-hidden="true"/>
            </button>}
          </div>
        </>}
      </WikiDisclosure>
    </section>}
    {(data.decisions.length > 0 || actions) && (data.decisions.length > 0 || addingDecision) && <section className="overview-fold" aria-label={decisionLabel}>
      <WikiDisclosure defaultOpen className="overview-section-toggle" label={<>{decisionLabel}<small>{data.decisions.length}</small></>}>
        <ul className="overview-list">{visibleDecisions.map(decisionRow)}</ul>
        {addingDecision ? <form className="overview-decision-editor is-adding" onSubmit={event => { event.preventDefault(); void addManualDecision(); }}>
          <label>{tr("新增关键决定", "New key decision")}<textarea autoFocus value={newDecisionText} placeholder={tr("例如：第一版只支持 ESP32 模块化元件，不做 PCB 设计。", "e.g. V1 only supports ESP32 modular parts; no PCB design.")} onChange={event => setNewDecisionText(event.target.value)} maxLength={500} rows={2}/></label>
          <div className="overview-question-footer">
            <button type="button" className="overview-text-button" onClick={() => { setAddingDecision(false); setNewDecisionText(""); }}>{tr("取消", "Cancel")}</button>
            <button type="submit" className="overview-choice" disabled={working || !newDecisionText.trim()}>{tr("保存决定", "Save decision")}</button>
          </div>
        </form> : null}
        <div className="overview-card-footer">
          {data.decisions.length > 5 ? <button type="button" className="overview-text-button overview-more-decisions" onClick={() => setShowAllDecisions(value => !value)}>
            {showAllDecisions ? tr("收起部分决定", "Show fewer decisions") : tr(`展开全部 ${data.decisions.length} 条决定`, `Show all ${data.decisions.length} decisions`)}
          </button> : null}
          {actions && !addingDecision ? <button type="button" className="overview-text-button" onClick={() => setAddingDecision(true)}>
            <Plus size={13} aria-hidden="true"/>{tr("记一条决定", "Add decision")}
          </button> : null}
          {showConsensusCopy ? <button type="button" className="overview-text-button overview-copy-consensus" onClick={() => void copyConsensus()}>
            {copiedConsensus ? <Check size={13} aria-hidden="true"/> : <Copy size={13} aria-hidden="true"/>}
            {copiedConsensus ? tr("已复制续聊共识", "Consensus copied") : tr("复制续聊共识", "Copy consensus")}
          </button> : null}
        </div>
      </WikiDisclosure>
    </section>}
  </>;
}
