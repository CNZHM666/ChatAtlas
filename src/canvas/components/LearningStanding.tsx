import { useState, type ReactNode } from "react";
import { BookOpen, ClipboardCheck, GraduationCap, Target, TriangleAlert } from "lucide-react";
import type { FocusSession } from "../../shared/focus-session";
import { learningOverview, type LearningItem } from "../../shared/wiki-learning-overview";
import { LEARNING_BETA, learningBetaNote } from "../../shared/wiki-document-type";

/** Items shown before "show the rest": three long sentences side by side read as a wall. */
const SHOWN = 3;

/** Where a learner stands, under a learning document's overview: the goal, then a path from what is learned to what is
 * still to learn (the next step first) and what is left for now, each point once under its latest standing, then the
 * mistakes and self-tests, each from the conversation. A project shows nothing here. */
export function LearningStanding({ session, zh }: { session: FocusSession; zh: boolean }) {
  const standing = learningOverview(session.wikiKnowledge);
  if (!standing) return null;
  const l = (cn: string, en: string) => zh ? cn : en;
  const by = session.wikiKnowledge?.documentTypeBy === "user" ? l("你选择的类型", "your choice") : l("自动识别", "detected");
  // The next step is the one planned when the conversation ended: it says as of when.
  const asOf = standing.asOf ? `${new Date(standing.asOf).getMonth() + 1}/${new Date(standing.asOf).getDate()}` : "";
  const basis = (item: LearningItem) => item.by === "user" ? l("你说的", "you said") : l("AI 看过练习后的判断", "AI's judgement from your exercises");
  const steps = [
    { key: "learned", tone: "is-learned", title: l("已学会", "Learned"), items: standing.learned, basis: true },
    { key: "todo", tone: "is-next", title: l("待学", "Still to learn"), items: standing.todo, basis: false },
    { key: "skip", tone: "is-later", title: l("暂不学", "Left for now"), items: standing.skip, basis: false },
  ].filter(step => step.items.length);
  return <section className="learning-standing" aria-label={l("学习进度", "Where you stand")}>
    <header><GraduationCap size={17} aria-hidden="true" /><h2>{l("学习进度", "Where you stand")}</h2>{standing.asOf ? <time dateTime={new Date(standing.asOf).toISOString()}>{l(`截至 ${new Date(standing.asOf).getMonth() + 1}/${new Date(standing.asOf).getDate()}`, `As of ${new Date(standing.asOf).getMonth() + 1}/${new Date(standing.asOf).getDate()}`)}</time> : null}<span title={l("类型不对时，可在输入区选择「项目」后重新整理", "If the type is wrong, choose Project in the input area and organize again")}>{l(`按学习整理 · ${by}`, `Organized as learning · ${by}`)}</span>{LEARNING_BETA ? <span className="learning-beta" title={learningBetaNote(zh)}>{l("测试中", "Beta")}</span> : null}</header>
    {standing.goal.length ? <div className="learning-standing-goal"><h3><Target size={15} aria-hidden="true" />{l("学习目标", "Goal")}</h3><ul>{standing.goal.map(item => <li key={item.unitId}>{item.text}</li>)}</ul></div> : null}
    {steps.length ? <ol className="learning-path" aria-label={l("学习路径", "Learning path")}>
      {steps.map(step => <li key={step.key} className={step.tone}>
        <h3>{step.title}<em>{step.items.length}</em></h3>
        <Items items={step.items} zh={zh} render={item => <>{item.status === "next" ? <strong>{asOf ? l(`下一步（截至 ${asOf} 的对话）：`, `Next (as of ${asOf}): `) : l("下一步：", "Next: ")}</strong> : null}{item.text}{step.basis ? <small>{basis(item)}</small> : null}</>} />
      </li>)}
    </ol> : null}
    {standing.mistakes.length || standing.checks.length || standing.methods.length ? <div className="learning-standing-notes">
      {standing.mistakes.length ? <section className="is-mistakes"><h3><TriangleAlert size={15} aria-hidden="true" />{l("常见错误与纠正", "Mistakes and fixes")}</h3><Items items={standing.mistakes} zh={zh} /></section> : null}
      {standing.methods.length ? <section className="is-methods"><h3><BookOpen size={15} aria-hidden="true" />{l("学习方法与资源", "How you study, and with what")}</h3><Items items={standing.methods} zh={zh} /></section> : null}
      {standing.checks.length ? <section className="is-checks"><h3><ClipboardCheck size={15} aria-hidden="true" />{l("自测与验收", "Self-tests")}</h3><Items items={standing.checks} zh={zh} /></section> : null}
    </div> : null}
  </section>;
}

function Items({ items, zh, render = item => item.text }: { items: LearningItem[]; zh: boolean; render?: (item: LearningItem) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const shown = open ? items : items.slice(0, SHOWN), rest = items.length - SHOWN;
  return <>
    <ul>{shown.map(item => <li key={item.unitId}>{render(item)}</li>)}</ul>
    {rest > 0 ? <button type="button" className="learning-standing-more" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? zh ? "收起" : "Show less" : zh ? `展开其余 ${rest} 条` : `Show ${rest} more`}</button> : null}
  </>;
}
