import { knowledgeOwner, knowledgeStage } from "../shared/knowledge-subject";
import { sourceMessageSignature } from "../shared/source-signature";
import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitStatus, WikiUserAnswer } from "../shared/wiki-knowledge";
import { wikiQuestionUsesExternalAlternative } from "./wiki-question-parse";

const ALL = /(?:所有|全部|各)(?:风险)?等级|(?:所有|全部)用户|\ball (?:risk )?(?:levels|users)\b/iu;
const NARROW = /(?:仅|只)(?:限)?(?:适用(?:于)?)?\s*((?:高|中|低)(?:风险)?)(?:等级|用户)?|\bonly (high|medium|low)(?:[- ]risk)?\b/iu;
const UNIVERSAL_ANSWER = /全(?:部|部适用)|所有|统一适用|\ball\b|\buniversal\b/iu;
const SCOPE_QUESTION = /(?:是否|要不要|可否)(?:同样|统一)?适用于?|\b(?:does|should) (?:it )?apply to\b/iu;
const UNSETTLED = /都保留|均采用|并存|暂缓|暂不决定|待定|不确定|\b(?:both|defer|undecided|not sure)\b/iu;
const LIMIT_VALUE = /\d+(?:\.\d+)?\s*(?:(?:[-~～–—至到])\s*\d+(?:\.\d+)?)?\s*(?:次|条|个|项|%|times?|items?)/iu;
const keyText=(text:string)=>text.normalize("NFKC").toLowerCase().replace(/[\s。!?？！？]+/gu,"");

type Choice = { receipt: WikiUserAnswer; ids: string[]; scope: string };
export interface WikiDecisionConflict {
  id: string;
  question: string;
  choices: Choice[];
  selected?: string;
}

export function wikiArbitrationStatuses(conflicts: readonly WikiDecisionConflict[]) {
  const statuses = new Map<string, "contested" | "history">();
  for (const conflict of conflicts) for (const choice of conflict.choices) {
    if (conflict.selected === choice.scope) continue;
    for (const id of choice.ids) statuses.set(id, conflict.selected ? "history" : "contested");
  }
  return statuses;
}

function inclusionAxis(question: string, label: string) {
  const text = question.normalize("NFKC");
  const boundary = SCOPE_QUESTION.exec(text);
  if (!boundary || !ALL.test(text.slice(boundary.index))) return;
  const body = text.slice(0, boundary.index);
  const amount = LIMIT_VALUE.exec(body);
  const operation = body.replace(LIMIT_VALUE, "")
    .replace(/最多|至多|的(?:上限|限额)|\b(?:at most|upper limit|per day)\b|[\s，。？]/giu, "");
  // Proactive and automatic describe the same reminder trigger when the
  // question gives exactly the same operation and limit. Other modifiers stay.
  const action = operation.replace(/(?:主动|自动)(?=提醒)/gu, "");
  const narrow = NARROW.exec(label);
  const scope = narrow?.[1] ?? narrow?.[2] ?? (UNIVERSAL_ANSWER.test(label) ? "all" : "");
  if (!amount || action.length < 3 || !scope || !/上限|限额|最多|至多|\b(?:limit|at most)\b/iu.test(body)) return;
  return { key: JSON.stringify(["scope",action.toLowerCase(), amount[0].replace(/\s/gu, "").replace(/[~～–—至到]/gu, "-"),
    knowledgeOwner(body), knowledgeStage(body)]), scope };
}

/** Compare the chosen scope of each saved receipt. The units attached to the
 * option are context and may contain independent rules. */
export function wikiDecisionConflicts(ledger: WikiKnowledgeLedger, units: readonly WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>): WikiDecisionConflict[] {
  const byId = new Map(units.map(unit => [unit.id, unit]));
  const questions = new Map(ledger.writingQuestions?.map(item => [item.id, item]));
  const axes = new Map<string, Choice[]>();
  for (const receipt of ledger.userAnswers ?? []) {
    const question=questions.get(receipt.questionId);
    if (question && wikiQuestionUsesExternalAlternative(question, id => byId.get(id))) continue;
    const option = question?.options.find(item => item.id === receipt.optionId);
    const alternatives=question?.options.filter(item=>!UNSETTLED.test(item.label))??[];
    const binary=option&&alternatives.includes(option)&&alternatives.length===2&&/还是|二选一|\b(?:either|versus)\b/iu.test(receipt.question)
      ? { key: JSON.stringify(["choice",keyText(receipt.question),alternatives.map(item=>keyText(item.label)).sort()]), scope:keyText(option.label) }
      : undefined;
    const axis = option && (inclusionAxis(receipt.question, receipt.answer)??binary);
    if (!axis || !option) continue;
    const projectedId = "answer:" + receipt.questionId + ":" + receipt.optionId;
    const ids = statuses.get(projectedId) === "confirmed" ? [projectedId]
      : option.actions.flatMap(action => action.do === "confirm" ? action.units : []).filter(id =>
        statuses.get(id) === "confirmed" && ledger.decisions?.[id]?.at === receipt.at && !byId.get(id)?.about);
    if (!ids.length) continue;
    axes.set(axis.key, [...axes.get(axis.key) ?? [], { receipt, ids, scope: axis.scope }]);
  }
  return [...axes].flatMap(([key, choices]) => {
    if (new Set(choices.map(choice=>choice.scope)).size<2
      || key.startsWith('["scope"')&&!choices.some(choice=>choice.scope==="all")) return [];
    const id = "arbitration:" + sourceMessageSignature(key);
    const selected = ledger.decisionArbitrations?.[id];
    const ordered = [...choices].sort((a, b) => b.receipt.at - a.receipt.at);
    const latest = ordered[0].receipt;
    const choice = ordered.find(item => item.receipt.questionId === selected?.choice);
    const replacement = selected && selected.at >= latest.at && (selected.mode === "custom" || selected.mode === "merge") ? "replacement" : undefined;
    return [{ id, question: latest.question, choices: ordered,
      selected: replacement ?? (choice && selected && selected.at >= latest.at ? choice.scope : undefined) }];
  });
}
