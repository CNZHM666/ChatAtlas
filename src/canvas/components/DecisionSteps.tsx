import { useMemo, useState } from "react";
import { ChevronLeft } from "lucide-react";
import { wikiLedgerUnits, type WikiKnowledgeLedger, type WikiUnitAboutRole, type WikiWritingQuestion } from "../../shared/wiki-knowledge";
import { pendingWriterQuestions, pendingWritingQuestions, wikiNamedProjects, withExcludedProject, withWritingAnswer } from "../../ai/wiki-writing-questions";

type Option = { id: string; label: string; tag?: string; quiet?: boolean };
/** A name the user may leave out: key, as shown, and what the material says it is. */
type Pick = { key: string; name: string; detail: string };
/** kind: a short label for the type of question; title: what is asked about, in full; ask: the question about it;
 * quotes: how the discussion said it, for the user to judge by. pick: names to tick instead of one answer. */
type Step = { id: string; kind: string; title: string; ask?: string; quotes?: string[]; options: Option[]; apply: (ledger: WikiKnowledgeLedger, answer: string | undefined) => WikiKnowledgeLedger;
  /** A question the user may answer in their own words instead. */
  write?: (ledger: WikiKnowledgeLedger, text: string) => WikiKnowledgeLedger;
  pick?: Pick[] };

const ROLE: Record<WikiUnitAboutRole, [string, string]> = { other_project: ["另一个项目", "Another project"], competitor: ["竞品", "Competitor"], reference: ["参考", "Reference"] };

/** The questions before writing, one at a time: an answer moves on to the next, the last one starts writing.
 * Skipping a question leaves it to the AI's reading; nothing here is required. Each question shows what it is about
 * first, then the question, so no answer depends on guessing what "这一点" means. */
export function DecisionSteps({ ledger, zh, onChange, onDone, writing = false, questions, busy = false }: {
  ledger: WikiKnowledgeLedger; zh: boolean;
  /** While writing: only the questions the writer asks, with no list of names to leave out. */
  writing?: boolean;
  /** Those questions as they come, while the chapters are still written: the list only grows. */
  questions?: WikiWritingQuestion[];
  /** The chapters are still being written: finishing answers does not end anything yet. */
  busy?: boolean;
  onChange: (change: (ledger: WikiKnowledgeLedger) => WikiKnowledgeLedger) => void;
  /** Writing starts with the answers given so far. */
  onDone: () => void;
}) {
  // Worked out once from the ledger the step opened with; answers are read back from the current ledger.
  const [initial] = useState(ledger);
  const named = useMemo(() => writing ? [] : wikiNamedProjects(initial), [initial, writing]);
  // First the names the material gives besides this project, to leave out by ticking them, with no model in between:
  // left to the model, one run asked about none of them and another project's 30 points were written as this one's.
  // Then only the writer's own questions about this material, with its answers and room for the user's own.
  const steps = useMemo((): Step[] => {
    const statements = new Map(wikiLedgerUnits(initial).map(unit => [unit.id, unit.statement]));
    const pick: Step[] = named.length ? [{ id: "exclude", kind: zh ? "排除项目" : "Leave out", title: zh ? "讨论里还提到了这些产品或项目" : "The discussion also names these", ask: zh ? "勾选不要写进这份 Wiki 的（可多选，也可以直接输入名字）" : "Tick those to leave out of this Wiki (several, or type a name)",
      options: [], apply: current => current, write: (current, text) => withExcludedProject(current, text, true),
      pick: named.map(item => ({ key: item.key, name: item.name, detail: zh ? `${ROLE[item.role][0]}${item.count ? ` · ${item.count} 条` : ""}` : `${ROLE[item.role][1]}${item.count ? ` · ${item.count}` : ""}` })) }] : [];
    return [...pick, ...(writing ? questions ?? pendingWriterQuestions(initial) : pendingWritingQuestions(initial).filter(question => question.stage !== "writing")).map((question): Step => ({ id: question.id, kind: writing ? zh ? "写作中发现" : "Found while writing" : zh ? "写作前提问" : "Before writing", title: question.about, ask: question.ask,
      quotes: question.unitIds.flatMap(id => statements.get(id) ?? []).slice(0, 3), options: question.options.map(option => ({ id: option.id, label: option.label })),
      apply: (current, answer) => withWritingAnswer(current, question, answer), write: (current, text) => withWritingAnswer(current, question, undefined, text) }))];
  }, [initial, named, writing, questions, zh]);
  const [index, setIndex] = useState(0), [answers, setAnswers] = useState<Record<string, string>>({}), [draft, setDraft] = useState("");
  const [excluded, setExcluded] = useState(() => new Set(named.filter(item => item.excluded).map(item => item.key))), [typed, setTyped] = useState<Pick[]>([]);
  const step = steps[index];
  if (!step) return null;
  const last = index === steps.length - 1;
  const choose = (option: string) => {
    const next = answers[step.id] === option ? undefined : option;
    setAnswers(current => { const copy = { ...current }; if (next) copy[step.id] = next; else delete copy[step.id]; return copy; });
    onChange(current => step.apply(current, next));
    if (next && !last) setIndex(index + 1);
  };
  const toggle = (item: Pick) => {
    const leave = !excluded.has(item.key);
    setExcluded(current => { const copy = new Set(current); if (leave) copy.add(item.key); else copy.delete(item.key); return copy; });
    setAnswers(current => ({ ...current, [step.id]: "picked" }));
    onChange(current => withExcludedProject(current, item.name, leave));
  };
  // What the user writes instead of an option is kept in their words, for the writer; on the list of names, a typed
  // name is left out and joins the list.
  const writeOwn = () => {
    const text = draft.trim();
    if (!text || !step.write) return;
    setDraft("");
    onChange(current => step.write!(current, text));
    if (step.pick) {
      const item = { key: text.toLocaleLowerCase(), name: text, detail: zh ? "你输入的" : "Typed" };
      setTyped(current => [...current, item]); setExcluded(current => new Set(current).add(item.key)); setAnswers(current => ({ ...current, [step.id]: "picked" }));
      return;
    }
    setAnswers(current => ({ ...current, [step.id]: `text:${text}` }));
    if (!last) setIndex(index + 1);
  };
  const option = (item: Option) => <button key={item.id} type="button" role="radio" aria-checked={answers[step.id] === item.id} className={item.quiet ? "is-quiet" : undefined} onClick={() => choose(item.id)}>
    {item.quiet ? null : <span className="decision-steps-dot" aria-hidden="true" />}{item.tag ? <em>{item.tag}</em> : null}<span>{item.label}</span>
  </button>;
  const main = step.options.filter(item => !item.quiet), quiet = step.options.filter(item => item.quiet);
  const own = answers[step.id]?.startsWith("text:") ? answers[step.id].slice(5) : "";
  return <section className="decision-steps" aria-label={writing ? zh ? "写作中发现的问题" : "Found while writing" : zh ? "写作前确认" : "Before writing"}>
    <header>
      {index ? <button type="button" className="decision-steps-back" aria-label={zh ? "上一题" : "Previous"} onClick={() => setIndex(index - 1)}><ChevronLeft size={16} aria-hidden="true" /></button> : null}
      <span>{writing ? zh ? "写作中发现的问题" : "Found while writing" : zh ? "写作前确认" : "Before writing"}</span>
      <ol className="decision-steps-progress" aria-label={zh ? `第 ${index + 1} 题，共 ${steps.length} 题` : `Question ${index + 1} of ${steps.length}`}>{steps.map((item, at) => <li key={item.id} className={at === index ? "is-current" : answers[item.id] ? "is-answered" : undefined} />)}</ol>
      <small>{index + 1} / {steps.length}</small>
    </header>
    <span className="decision-steps-kind">{step.kind}</span>
    <h3>{step.title}</h3>
    {step.ask ? <p className="decision-steps-ask">{step.ask}</p> : null}
    {step.quotes?.length ? <ul className="decision-steps-quotes" aria-label={zh ? "讨论中的说法" : "As said in the discussion"}>{step.quotes.map(quote => <li key={quote}>{quote}</li>)}</ul> : null}
    {step.pick ? <div className="decision-steps-options" role="group" aria-label={step.ask ?? step.title}>
      {[...step.pick, ...typed].map(item => <button key={item.key} type="button" role="checkbox" aria-checked={excluded.has(item.key)} onClick={() => toggle(item)}>
        <span className="decision-steps-box" aria-hidden="true" /><span>{item.name}</span><em>{excluded.has(item.key) ? zh ? "不写入" : "Left out" : item.detail}</em>
      </button>)}
    </div> : <div role="radiogroup" aria-label={step.ask ?? step.title}>
      <div className="decision-steps-options">{main.map(option)}</div>
      {quiet.length ? <div className="decision-steps-quiet">{quiet.map(option)}</div> : null}
    </div>}
    {step.write ? <form className="decision-steps-own" onSubmit={event => { event.preventDefault(); writeOwn(); }}>
      <input value={draft} onChange={event => setDraft(event.target.value)} placeholder={step.pick ? zh ? "列表里没有？输入要排除的名字" : "Not listed? Type a name to leave out" : own || (zh ? "都不对？直接写下实际情况" : "None fits? Say how it is")} aria-label={step.pick ? zh ? "输入要排除的名字" : "Name to leave out" : zh ? "用自己的话回答" : "Answer in your own words"} maxLength={step.pick ? 40 : 200} />
      <button type="submit" disabled={!draft.trim()}>{step.pick ? zh ? "排除" : "Leave out" : zh ? "确定" : "Save"}</button>
    </form> : null}
    <footer>
      <button type="button" className="decision-steps-skip" onClick={onDone}>{writing ? Object.keys(answers).length ? zh ? "按回答更新" : "Update the draft" : zh ? "保持现稿" : "Keep the draft" : Object.keys(answers).length ? zh ? "直接写作" : "Write now" : zh ? "全部跳过" : "Skip all"}</button>
      {last ? <button type="button" className="primary" onClick={onDone}>{writing ? busy ? zh ? "答完了，继续写" : "Done, keep writing" : zh ? "按回答更新" : "Update the draft" : zh ? "开始写作" : "Start writing"}</button> : <button type="button" className="decision-steps-next" onClick={() => setIndex(index + 1)}>{step.pick ? zh ? "下一步" : "Next" : zh ? "跳过此题" : "Skip"}</button>}
    </footer>
  </section>;
}
