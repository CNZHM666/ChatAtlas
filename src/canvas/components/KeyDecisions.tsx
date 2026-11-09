import { useMemo, useState, type ReactNode } from "react";
import { Check, RotateCcw, X } from "lucide-react";
import type { WikiKnowledgeLedger, WikiUserDecision } from "../../shared/wiki-knowledge";
import { wikiDecisionQuestions, withVersionAnswer, type WikiDecisionCandidate, type WikiVersionAnswer, type WikiVersionQuestion } from "../../ai/wiki-key-decisions";

type Verdict = WikiUserDecision["verdict"] | undefined;

/** The key points the discussion left as suggestions, for the user to confirm as decisions or set aside: before a
 * document is written, and later in the knowledge ledger. A click shows at once; saving follows behind it. */
export function KeyDecisions({ ledger, zh, onDecide, onLedger, intro, footer, open: initiallyOpen = true, onActivity }: {
  ledger: WikiKnowledgeLedger | undefined; zh: boolean;
  onDecide: (unitIds: string[], verdict: Verdict) => Promise<void> | void;
  /** Applies a version answer to the ledger; without it no version question is asked. */
  onLedger?: (change: (ledger: WikiKnowledgeLedger) => WikiKnowledgeLedger) => Promise<void> | void;
  intro?: ReactNode; footer?: ReactNode; open?: boolean;
  /** Called on any answer, so a waiting step knows the user is here. */
  onActivity?: () => void;
}) {
  // Which version holds now comes first; a point asked there is not asked again below. At most eight questions.
  const asking = Boolean(onLedger), { versions: questions, candidates } = useMemo(() => wikiDecisionQuestions(ledger, zh, asking), [ledger, zh, asking]);
  const [answers, setAnswers] = useState<Record<string, WikiVersionAnswer | null>>({});
  // Verdicts given here and not yet saved, shown at once (saving the project can take a moment).
  const [local, setLocal] = useState<Record<string, Verdict | null>>({}), [error, setError] = useState("");
  if (!candidates.length && !questions.length) return null;
  const answerOf = (question: WikiVersionQuestion) => question.id in answers ? answers[question.id] ?? undefined : question.answer;
  const verdictOf = (item: WikiDecisionCandidate) => item.id in local ? local[item.id] ?? undefined : item.verdict;
  const open = candidates.filter(item => !verdictOf(item)).length + questions.filter(question => !answerOf(question)).length;
  const answer = (question: WikiVersionQuestion, value: WikiVersionAnswer) => {
    if (!onLedger) return;
    const next = answerOf(question) === value ? undefined : value;
    setAnswers(current => ({ ...current, [question.id]: next ?? null })); setError(""); onActivity?.();
    void Promise.resolve(onLedger(current => withVersionAnswer(current, question, next))).catch(() => { setAnswers(current => { const copy = { ...current }; delete copy[question.id]; return copy; }); setError(zh ? "保存失败，请重试。" : "Could not save. Retry."); });
  };
  const decide = (item: WikiDecisionCandidate, verdict: Verdict) => {
    setLocal(current => ({ ...current, [item.id]: verdict ?? null })); setError(""); onActivity?.();
    void Promise.resolve(onDecide(item.unitIds, verdict)).catch(() => { setLocal(current => { const next = { ...current }; delete next[item.id]; return next; }); setError(zh ? "保存失败，请重试。" : "Could not save. Retry."); });
  };
  const holder = (item: WikiDecisionCandidate) => item.status === "relayed" ? zh ? "来自你提供的资料" : "From your material" : item.status === "open" ? zh ? "仍在讨论" : "Still open" : zh ? "AI 建议" : "AI proposal";
  return <details className="key-decisions" open={initiallyOpen}>
    <summary><strong>{zh ? "可调整的建议" : "Suggestions to adjust"}</strong><small>{open ? zh ? `${open} 条 · 可选` : `${open} · optional` : zh ? "都已处理" : "All handled"}</small></summary>
    {intro ?? <p className="key-decisions-intro">{zh ? "文档已按讨论写成，这些 AI 反复提到的建议照原样标为「AI 建议」。想把哪条改成你的决定或不采用，在这里改；不改也不影响阅读。" : "The document is written as discussed; these suggestions the AI kept making stay labelled as AI proposals. Change any to your decision or set it aside here; nothing needs doing."}</p>}
    {questions.length ? <ol className="key-decisions-versions">{questions.map(question => { const chosen = answerOf(question); return <li key={question.id} className={chosen ? "is-answered" : undefined}>
      <div><p>{question.question}</p>{question.chapter ? <small>{question.chapter}</small> : null}</div>
      <div className="key-decisions-options" role="radiogroup" aria-label={question.question}>
        {[...question.options.map((option, index) => ({ id: option.id, label: option.label, tag: question.kind === "versions" ? index ? zh ? "后来" : "Later" : zh ? "先前" : "Earlier" : index === 0 ? zh ? "最新" : "Newest" : undefined, quiet: false })),
          ...(question.kind === "versions" ? [{ id: "both", label: zh ? "两个都要" : "Both hold", tag: undefined, quiet: true }] : []), { id: "open", label: zh ? "还没定" : "Not settled", tag: undefined, quiet: true }]
          .map(option => <button key={option.id} type="button" role="radio" aria-checked={chosen === option.id} className={option.quiet ? "is-quiet" : undefined} onClick={() => answer(question, option.id)}><span className="decision-steps-dot" aria-hidden="true" />{option.tag ? <em>{option.tag}</em> : null}<span>{option.label}</span></button>)}
      </div>
    </li>; })}</ol> : null}
    <ol>{candidates.map(item => { const verdict = verdictOf(item); return <li key={item.id} className={verdict ? `is-${verdict}` : undefined}>
      <div><p>{item.statement}</p><small>{[item.chapter, holder(item), item.unitIds.length > 1 ? zh ? `讨论中出现 ${item.unitIds.length} 次` : `${item.unitIds.length} mentions` : ""].filter(Boolean).join(" · ")}</small></div>
      {verdict ? <span className="key-decisions-verdict">{verdict === "confirmed" ? zh ? "已确认" : "Confirmed" : verdict === "open" ? zh ? "还没定" : "Not settled" : zh ? "不采用" : "Set aside"}<button type="button" aria-label={zh ? `撤销：${item.statement}` : `Undo: ${item.statement}`} title={zh ? "撤销" : "Undo"} onClick={() => decide(item, undefined)}><RotateCcw size={13} aria-hidden="true" /></button></span>
        : <span className="key-decisions-actions"><button type="button" className="primary" aria-label={zh ? `确认为决定：${item.statement}` : `Confirm as decision: ${item.statement}`} onClick={() => decide(item, "confirmed")}><Check size={14} aria-hidden="true" />{zh ? "确认" : "Confirm"}</button><button type="button" aria-label={zh ? `不采用：${item.statement}` : `Set aside: ${item.statement}`} onClick={() => decide(item, "rejected")}><X size={14} aria-hidden="true" />{zh ? "不采用" : "Set aside"}</button></span>}
    </li>; })}</ol>
    {error ? <p className="key-decisions-error" role="alert">{error}</p> : null}
    {footer}
  </details>;
}
