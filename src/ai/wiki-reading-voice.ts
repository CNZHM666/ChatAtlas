import type { WikiKnowledgeLedger, WikiKnowledgeUnit, WikiUnitStatus } from "../shared/wiki-knowledge";
import { restoreWikiMisdatedDuration } from "../shared/wiki-measures";

const REFERENCE_ONLY = /^(?:仅|只)(?:作(?:为)?|供)?参考(?:资料)?(?:[，、, ]*(?:不直接采用|暂不采用|不纳入(?:当前)?(?:方案|范围)))?[。.]?$|^(?:(?:use|keep|treat)(?: (?:it|this))? as )?(?:reference only|only as (?:a )?reference)[.!]?$/iu;
const REJECTION = /否定|否决|拒绝|rejected|declined/iu;
const STATED_GOAL = /^((?:[\p{Script=Han}]{1,18})?目标)(?:被定义为|定义为|是|分为)(?=\S)/u;
const GOAL_EN = /^(?:the )?(?:(?:product|project|user) )?(?:goal|objective) (?:is defined as|is to|falls into)\b/iu;
const CONDITIONAL = /^(?:(?:验证标准(?:为|是)?|验证假设(?:为|是)?)[：:]\s*)?(?:若(?!干)|如果|假如|倘若|\b(?:if|suppose)\b)/iu;
const EXPERIMENT = /实验|假设|验证|试验|信号|观察|\b(?:test|experiment|hypothesis|observe|signal)\b/iu;
const OPINION_REQUEST = /(?:持(?:何种|什么)看法|你(?:怎么|如何)看|你觉得(?:怎么|如何|怎样)|\bwhat (?:do you think|is your opinion))[^。！？.!?\n]{0,8}[。！？.!?]?$/iu;

export function wikiDiscussionPrompt(unit: WikiKnowledgeUnit) {
  return unit.evidence.role === "user" && !unit.evidence.pasted && ["question", "plan"].includes(unit.kind)
    && !unit.evidence.code && OPINION_REQUEST.test(unit.statement.trim());
}

export function wikiReferenceOnlyUnits(ledger: WikiKnowledgeLedger): Set<string> {
  const questions = new Map(ledger.writingQuestions?.map(question => [question.id, question]));
  return new Set(ledger.userAnswers?.flatMap(answer => {
    const option = questions.get(answer.questionId)?.options.find(item => item.id === answer.optionId);
    if (!option || !REFERENCE_ONLY.test((answer.answer || option.label).trim())) return [];
    return option.actions.flatMap(action => action.do === "reject" ? action.units.filter(id => {
      const decision = ledger.decisions?.[id];
      return decision?.verdict === "rejected" && decision.at === answer.at;
    }) : []);
  }));
}

export function wikiReadingClaimText(text: string, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>,
  referenceOnly: ReadonlySet<string>, zh: boolean): string {
  if (zh) text = restoreWikiMisdatedDuration(text, units);
  const [unit] = units;
  if (!unit || units.some(source => source.evidence.role !== "assistant" || source.evidence.pasted)) return text;
  if (units.length === 1 && referenceOnly.has(unit.id) && REJECTION.test(text) && text.includes(unit.statement.trim().replace(/[。.]$/u, ""))) {
    const source = unit.statement.trim().replace(/[。.]$/u, "");
    return zh ? `本项目仅将这条资料作为参考：「${source}」。` : `The project treats this material as reference only: “${source}.”`;
  }
  if (units.some(source => statuses.get(source.id) !== "proposal")) return text;
  const lead = zh ? "讨论中的建议：" : "Proposal from the discussion: ";
  if ((zh ? STATED_GOAL : GOAL_EN).test(text)) return lead + (zh ? text.replace(/^(\S+?目标)(?:被定义为|定义为)/u, "$1是") : text);
  if (CONDITIONAL.test(text) && units.some(source => EXPERIMENT.test(`${source.subject} ${source.evidence.quote}`))) {
    return zh ? text.replace(/^(?:验证标准|验证假设)(?:为|是)?[：:]\s*/u, "验证提案：")
      .replace(/([，,]\s*)(?:则|就)(?:可以|可)?(?:验证|证实|证明)(?=\S)/u, "$1可作为线索，帮助判断")
      : text.replace(/(,\s*)(?:then )?(?:this |that )?(?:would |will )?(?:prove|confirm|validate)\b/iu, "$1this could help assess");
  }
  return text;
}
