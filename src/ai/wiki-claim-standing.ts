import { knowledgeTerms } from "../shared/knowledge-subject";
import { missingWikiConditions, statesCore, wikiStatementWithConditions, type WikiKnowledgeUnit, type WikiUnitStatus } from "../shared/wiki-knowledge";
import { withStop } from "../shared/wiki-sentences";
import { claimSupported } from "./wiki-claim-support";

const ADOPTION = /确定为|已确定|确定(?=不|采用|使用|选择|引入)|已(?:决定|确认)(?:采用|使用|选择)?|\b(?:has been|was) (?:decided|confirmed|selected)\b/iu;
const PLAN = /计划|建议|目标|规划|拟|将|扩(?:展|充)|\b(?:plan|proposal|target|expand|aim)\b/iu;
const PRESENT = /内置|已(?:实现|支持|部署|上线|完成)|\b(?:ships with|has implemented|is deployed|already supports)\b/iu;
const QUANTITY = /\d+(?:\.\d+)?(?:\s*[-–—~～至到]\s*\d+(?:\.\d+)?)?\s*(?:个|种|项|条|类|\b(?:items|types|entries|modules|features)\b)/giu;
const quantityKeys = (text: string) => [...text.matchAll(QUANTITY)].map(match => match[0].replace(/\s+/gu, "").replace(/[–—~～至到]/gu, "-"));
export const wikiStandingCandidate = (text: string) => ADOPTION.test(text) || PRESENT.test(text) || PLAN.test(text) && quantityKeys(text).length > 1;
const clean = (text: string) => text.replace(/\*\*|__/gu, "");
const stageLabel = (text: string) => clean(text).match(/^(?:第[一二三四五六七八九十\d]+(?:版|阶段)|首版|V\d+(?:\.\d+)*(?:\s*版本|\s*阶段)?|\b(?:phase|milestone|stage|version)\s+[\w.]+)/iu)?.[0];
const proposal = (text: string, zh: boolean) => {
  const stage = stageLabel(text);
  return stage ? (zh ? "讨论中的「" + stage + "」目标：" : "Proposed " + stage + " target: ") + text.slice(stage.length).trimStart()
    : (zh ? "讨论中的建议：" : "Proposal from the discussion: ") + text;
};

/** Render only standing the bound sources support. Splitting a mixed plan uses
 * the individual source statements so figures and conditions travel together. */
export function wikiClaimStanding(text: string, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>, zh: boolean): Array<{ text: string; units: WikiKnowledgeUnit[] }> | undefined {
  const eligible = units.filter(unit => !unit.about && !unit.evidence.pasted && unit.evidence.role === "assistant"
    && ["plan", "decision", "constraint", "mechanism"].includes(unit.kind) && ["proposal", "analysis"].includes(statuses.get(unit.id) ?? ""));
  if (!eligible.length || eligible.length !== units.length || units.some(unit => missingWikiConditions(unit, text).length)) return;
  const plain = clean(text);
  const counts = new Set(quantityKeys(plain));
  if (PLAN.test(plain) && counts.size > 1 && eligible.length > 1) {
    const clauses = plain.split(/[，,；;]\s*(?=(?:但|另|随后|后来|后续)?(?:建议|计划|拟)|(?:but|separately|later)\s+(?:propos|suggest|plan))/iu);
    const parts = clauses.flatMap(clause => {
      const figures = quantityKeys(clause);
      if (!figures.length) return [];
      const matches = eligible.filter(unit => {
        const supported = new Set(quantityKeys(unit.statement));
        return figures.every(figure => supported.has(figure)) && (statesCore(unit.statement, clause) || claimSupported(clause, [unit]));
      });
      if (matches.length !== 1) return [];
      const [unit] = matches;
      const stage = stageLabel(clause);
      const text = stage && PLAN.test(clause) ? (zh ? "讨论中的建议：" : "Proposal from the discussion: ") + clause
        : proposal(wikiStatementWithConditions(unit, zh), zh);
      return [{ text: withStop(text), units: [unit] }];
    });
    if (clauses.length > 1 && parts.length === clauses.length && new Set(parts.map(part => part.units[0].id)).size === clauses.length) {
      return parts;
    }
  }
  if (ADOPTION.test(plain) && !/(?:确认|决定)执行|\bconfirmed for implementation\b/iu.test(plain) && claimSupported(plain, eligible)) {
    return [{ text: (zh ? "讨论中的建议：" : "Proposal from the discussion: ") + plain.replace(ADOPTION, word =>
      /为$/u.test(word) ? "采用" : /^(?:has been|was)/iu.test(word) ? "was proposed" : ""), units: eligible }];
  }
  if (PRESENT.test(plain) && stageLabel(plain) && eligible.every(unit => unit.kind === "plan") && claimSupported(plain, eligible)) {
    return [{ text: proposal(plain, zh), units: eligible }];
  }
}

/** Older chapter openings have no claim bindings. Use a source only when its
 * proposal independently supports the decision clause, and no overlapping
 * confirmed point would be downgraded. */
export function wikiOpeningStanding(text: string, units: WikiKnowledgeUnit[], statuses: ReadonlyMap<string, WikiUnitStatus>, zh: boolean) {
  if (!ADOPTION.test(text)) return text;
  return text.split(/(?<=[。！？\n])|(?<=[.!?])(?=\s)/u).map(sentence => {
    const match = ADOPTION.exec(sentence);
    if (!match) return sentence;
    const terms = knowledgeTerms(sentence.slice(match.index + match[0].length));
    if (terms.size < 3) return sentence;
    const candidates = units.filter(unit => {
      const known = knowledgeTerms(unit.statement);
      return [...terms].filter(term => known.has(term)).length / terms.size >= .7;
    });
    if (!wikiClaimStanding(sentence.slice(match.index), candidates, statuses, zh)) return sentence;
    const before = sentence.slice(0, match.index);
    const boundary = Math.max(before.lastIndexOf("，"), before.lastIndexOf(","), before.lastIndexOf("；"));
    return boundary >= 0 && zh
      ? before.slice(0, boundary) + "。" + before.slice(boundary + 1).trimStart() + sentence.slice(match.index).replace(ADOPTION, "建议采用")
      : wikiClaimStanding(sentence, candidates, statuses, zh)?.[0]?.text ?? sentence;
  }).join("");
}
