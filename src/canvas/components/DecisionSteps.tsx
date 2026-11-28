import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiUnitAboutRole } from "../../shared/wiki-knowledge";
import { wikiNamedProjects, withExcludedProject } from "../../ai/wiki-writing-questions";
import { answerProjectQuestion, projectQuestionDetails, wikiPrewritingProjectQuestions } from "../../ai/wiki-project-decisions";
import "../decision-steps.css";

type Option = { id: string; label: string; tag?: string; quiet?: boolean };
/** A name the user may leave out: key, as shown, and what the material says it is. */
type Pick = { key: string; name: string; detail: string };
/** kind: a short label for the type of question; title: what is asked about, in full; ask: the question about it;
 * quotes: how the discussion said it, for the user to judge by. pick: names to tick instead of one answer. */
type Step = { id: string; kind: string; title: string; ask?: string; quotes?: string[]; originals?: string[]; options: Option[]; apply: (ledger: WikiKnowledgeLedger, answer: string | undefined) => WikiKnowledgeLedger;
  /** A question the user may answer in their own words instead. */
  write?: (ledger: WikiKnowledgeLedger, text: string) => WikiKnowledgeLedger;
  pick?: Pick[] };

const ROLE: Record<WikiUnitAboutRole, [string, string]> = { other_project: ["另一个项目", "Another project"], competitor: ["竞品", "Competitor"], reference: ["参考", "Reference"] };

/** Keep selected options editable until writing starts. */
export function DecisionSteps({ ledger, zh, onDone, onInteract, chooseMode = false }: {
  ledger: WikiKnowledgeLedger; zh: boolean;
  chooseMode?: boolean;
  onInteract?: () => void;
  /** Writing starts with the answers given so far. */
  onDone: (counts: { shown: number; answered: number; skipped: number }, apply: (ledger: WikiKnowledgeLedger) => WikiKnowledgeLedger) => void;
}) {
  const named = useMemo(() => wikiNamedProjects(ledger), [ledger]);
  const allUnits = useMemo(() => new Map(wikiLedgerUnits(ledger).map(unit => [unit.id, unit])), [ledger]);
  const [answers, setAnswers] = useState<Record<string, string>>({}), [drafts, setDrafts] = useState<Record<string, string>>({});
  const [scopeChanges, setScopeChanges] = useState<Record<string, { name: string; leave: boolean }>>({});
  const [typed, setTyped] = useState<Pick[]>([]);
  const interactedRef = useRef(false);
  const notifyInteract = () => {
    if (interactedRef.current) return;
    interactedRef.current = true;
    onInteract?.();
  };
  const scoped = useMemo(() => Object.values(scopeChanges).reduce((current, item) => withExcludedProject(current, item.name, item.leave), ledger), [ledger, scopeChanges]);
  const excluded = useMemo(() => {
    const next = new Set(named.filter(item => item.excluded).map(item => item.key));
    for (const [key, item] of Object.entries(scopeChanges)) {
      if (item.leave) next.add(key);
      else next.delete(key);
    }
    return next;
  }, [named, scopeChanges]);
  const pickStep = useMemo<Step[]>(() => named.length ? [{
    id: "exclude",
    kind: zh ? "排除项目" : "Leave out",
    title: zh ? "讨论里还提到了这些产品或项目" : "The discussion also names these",
    ask: zh ? "勾选本次不写入的项目。" : "Select items to leave out of this document.",
    options: [],
    apply: current => current,
    write: (current, text) => withExcludedProject(current, text, true),
    pick: named.map(item => ({ key: item.key, name: item.name, detail: zh ? `${ROLE[item.role][0]}${item.count ? ` · ${item.count} 条` : ""}` : `${ROLE[item.role][1]}${item.count ? ` · ${item.count}` : ""}` })),
  }] : [], [named, zh]);
  const questionSteps = useMemo<Step[]>(() => wikiPrewritingProjectQuestions(scoped, zh).map((entry): Step => {
    const { title, ask, ids, options } = projectQuestionDetails(entry);
    const anchors = [...new Set(ids)].flatMap(id => allUnits.get(id) ?? []);
    return {
      id: entry.question.id,
      kind: zh ? "待决问题" : "Open question",
      title: title || ask,
      ask: title ? ask : undefined,
      quotes: [...new Set(anchors.map(unit => unit.statement))].slice(0, 3),
      originals: [...new Set(anchors.map(unit => unit.evidence.quote.trim()).filter(Boolean))].slice(0, 4),
      options: options.map(option => ({ id: option.id, label: option.label })),
      apply: (current, answer) => answerProjectQuestion(current, entry, { choice: answer }),
      write: (current, text) => answerProjectQuestion(current, entry, { text }),
    };
  }), [scoped, allUnits, zh]);
  const steps = useMemo(() => [...pickStep, ...questionSteps], [pickStep, questionSteps]);
  const [activeId, setActiveId] = useState<string>();
  const index = Math.max(0, steps.findIndex(item => item.id === activeId));
  const step = steps[index];
  const visited = useRef(new Set<string>());
  const heading = useRef<HTMLHeadingElement>(null), moved = useRef(false);
  useLayoutEffect(() => {
    if (step && !step.pick) visited.current.add(step.id);
    if (moved.current) { moved.current = false; heading.current?.focus({ preventScroll: true }); }
  }, [step]);
  if (!step) return null;
  const last = index === steps.length - 1;
  const draft = drafts[step.id] ?? "";
  const setDraft = (text: string) => setDrafts(current => ({ ...current, [step.id]: text }));
  const go = (next: number) => { moved.current = true; setActiveId(steps[next]?.id); };
  const choose = (option: string) => {
    if (answers[step.id] !== option) {
      setAnswers(current => ({ ...current, [step.id]: option }));
      setDraft("");
    }
  };
  const clear = () => {
    setAnswers(current => { const next = { ...current }; delete next[step.id]; return next; });
    setDraft("");
  };
  const toggle = (item: Pick) => {
    const leave = !excluded.has(item.key);
    setScopeChanges(current => ({ ...current, [item.key]: { name: item.name, leave } }));
    setAnswers(current => ({ ...current, [step.id]: "picked" }));
  };
  // What the user writes instead of an option is kept in their words, for the writer; on the list of names, a typed
  // name is left out and joins the list.
  const writeOwn = () => {
    const text = draft.trim();
    if (!text || !step.write) return;
    setDraft("");
    if (step.pick) {
      const item = { key: text.toLocaleLowerCase(), name: text, detail: zh ? "你输入的" : "Typed" };
      setTyped(current => current.some(previous => previous.key === item.key) ? current : [...current, item]);
      toggle(item);
      return;
    }
    setAnswers(current => ({ ...current, [step.id]: `text:${text}` }));
  };
  const option = (item: Option) => <button key={item.id} type="button" role="radio" aria-checked={answers[step.id] === item.id} className={item.quiet ? "is-quiet" : undefined} onClick={() => choose(item.id)}>
    {item.quiet ? null : <span className="decision-steps-dot" aria-hidden="true" />}{item.tag ? <em>{item.tag}</em> : null}<span>{item.label}</span>
  </button>;
  const main = step.options.filter(item => !item.quiet), quiet = step.options.filter(item => item.quiet);
  const own = answers[step.id]?.startsWith("text:") ? answers[step.id].slice(5) : "";
  const hasAnswers = Object.keys(answers).length > 0;
  const finish = () => {
    const active = steps.filter(item => !item.pick && visited.current.has(item.id));
    const chosen = active.filter(item => answers[item.id] || drafts[item.id]?.trim());
    onDone({ shown: active.length, answered: chosen.length, skipped: active.length - chosen.length }, initial =>
      chosen.reduce((current, item) => {
        const answer = answers[item.id], typed = drafts[item.id]?.trim() || (answer?.startsWith("text:") ? answer.slice(5) : undefined);
        return typed ? item.write?.(current, typed) ?? current : item.apply(current, answer);
      }, Object.values(scopeChanges).reduce((current, change) => withExcludedProject(current, change.name, change.leave), initial)));
  };
  return <section className="decision-steps" onPointerDownCapture={notifyInteract} onFocusCapture={notifyInteract} aria-label={zh ? "写作前确认" : "Before writing"}>
    {(steps.length > 1 || !step.pick) && <header>
      {index ? <button type="button" className="decision-steps-back" aria-label={zh ? "上一题" : "Previous"} onClick={() => go(index - 1)}><ChevronLeft size={16} aria-hidden="true" /></button> : null}
      <span>{zh ? "写作前确认" : "Before writing"}</span>
      <ol className="decision-steps-progress" aria-label={zh ? `第 ${index + 1} 题，共 ${steps.length} 题` : `Question ${index + 1} of ${steps.length}`}>{steps.map((item, at) => <li key={item.id} className={at === index ? "is-current" : answers[item.id] ? "is-answered" : undefined}><button type="button" className="decision-steps-progress-dot" aria-label={zh ? `跳到第 ${at + 1} 题` : `Go to question ${at + 1}`} aria-current={at === index ? "step" : undefined} onClick={() => go(at)} /></li>)}</ol>
      <small>{index + 1} / {steps.length}</small>
    </header>}
    <span className="decision-steps-kind">{step.kind}</span>
    <h3 ref={heading} tabIndex={-1}>{step.title}</h3>
    {step.ask ? <p className="decision-steps-ask">{step.ask}</p> : null}
    {step.quotes?.length ? <ul className="decision-steps-quotes" aria-label={zh ? "讨论中的说法" : "As said in the discussion"}>{step.quotes.map(quote => <li key={quote}>{quote}</li>)}</ul> : null}
    {step.originals?.length ? <details className="decision-steps-originals">
      <summary>{zh ? "查看原话" : "Read original excerpts"}</summary>
      {step.originals.map(quote => <blockquote key={quote}>{quote}</blockquote>)}
    </details> : null}
    {step.pick ? <div className="decision-steps-options" role="group" aria-label={step.ask ?? step.title}>
      {[...step.pick, ...typed].map(item => <button key={item.key} type="button" role="checkbox" aria-checked={excluded.has(item.key)} onClick={() => toggle(item)}>
        <span className="decision-steps-box" aria-hidden="true" /><span>{item.name}</span><em>{excluded.has(item.key) ? zh ? "不写入" : "Left out" : item.detail}</em>
      </button>)}
    </div> : <div key={step.id} role="radiogroup" aria-label={step.ask ?? step.title}>
      <div className="decision-steps-options">{main.map(option)}</div>
      {quiet.length ? <div className="decision-steps-quiet">{quiet.map(option)}</div> : null}
    </div>}
    {step.write ? <form className="decision-steps-own" onSubmit={event => { event.preventDefault(); writeOwn(); }}>
      <input value={draft} onChange={event => setDraft(event.target.value)} placeholder={step.pick ? zh ? "列表里没有？输入要排除的名字" : "Not listed? Type a name to leave out" : own || (zh ? "都不对？直接写下实际情况" : "None fits? Say how it is")} aria-label={step.pick ? zh ? "输入要排除的名字" : "Name to leave out" : zh ? "用自己的话回答" : "Answer in your own words"} maxLength={step.pick ? 40 : 200} />
      <button type="submit" disabled={!draft.trim()}>{step.pick ? zh ? "排除" : "Leave out" : zh ? "确定" : "Save"}</button>
    </form> : null}
    <footer>
      {!last && <button type="button" className="decision-steps-skip" onClick={finish}>{hasAnswers && !chooseMode ? zh ? "直接写作" : "Write now" : zh ? "全部跳过" : "Skip all"}</button>}
      <div className="decision-steps-actions">
        {!step.pick && answers[step.id] ? <button type="button" onClick={clear}>{zh ? "清除回答" : "Clear answer"}</button> : null}
        {last ? <button type="button" className="primary" onClick={finish}>{chooseMode ? zh ? "选择写作模式" : "Choose writing mode" : zh ? "开始写作" : "Start writing"}</button> : <button type="button" className="decision-steps-next" onClick={() => go(index + 1)}>{step.pick || answers[step.id] || draft.trim() ? zh ? "下一题" : "Next" : zh ? "跳过此题" : "Skip"}</button>}
      </div>
    </footer>
  </section>;
}
