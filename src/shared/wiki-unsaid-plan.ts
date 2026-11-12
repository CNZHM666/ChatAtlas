import { knowledgeTerms } from "./knowledge-subject";
import type { WikiKnowledgeUnit } from "./wiki-knowledge";

const PLAN_LEAD = /^(?:而|但|并且?|同时)?(?:本项目|该项目|项目|我们|我方|我)(?:则|也)?(?:计划|打算|准备|决定|将要?|会)/u;
const UNSAID = .7;
/** A plan the user did not say, read into their question: 「我看现在主流的戒色app是买断制的……你感觉这种怎么样」 was
 * stored as "主流戒色App多采用买断制……，而本项目计划采用基础功能永久免费、高级AI服务订阅的模式。", and that plan stood in
 * the competitor table as the project's, 〔你〕, against the 30-day plan the project went with. The clause of a user's
 * point naming the project's plan, when most of its words are not in the user's message. */
export function unsaidPlanClause(unit: Pick<WikiKnowledgeUnit, "statement" | "evidence">): string | undefined {
  if (unit.evidence.role !== "user" || unit.evidence.pasted) return undefined;
  const clauses = unit.statement.trim().split(/(?<=[，,；;])/u);
  if (clauses.length < 2) return undefined;
  const quoted = knowledgeTerms(unit.evidence.quote);
  for (const clause of clauses.slice(1)) {
    const bare = clause.trim().replace(/[，,；;。.]+$/u, "");
    if (!PLAN_LEAD.test(bare)) continue;
    const terms = [...knowledgeTerms(bare.replace(PLAN_LEAD, ""))];
    if (terms.length && terms.filter(term => !quoted.has(term)).length / terms.length >= UNSAID) return bare;
  }
  return undefined;
}
/** The point without that plan: "主流戒色App多采用买断制（评估后付费解锁）。" */
export function withoutUnsaidPlan<T extends Pick<WikiKnowledgeUnit, "statement" | "evidence">>(unit: T): T {
  const clause = unsaidPlanClause(unit);
  if (!clause) return unit;
  const clauses = unit.statement.trim().split(/(?<=[，,；;])/u).filter(item => item.trim().replace(/[，,；;。.]+$/u, "") !== clause);
  const statement = `${clauses.join("").trim().replace(/[，,；;。.]+$/u, "")}。`;
  return { ...unit, statement };
}
/** The ledger with each user's point said as the user said it. */
export function withUnsaidPlansOut<L extends { batches: { units: WikiKnowledgeUnit[] }[] }>(ledger: L): L {
  let changed = false;
  const batches = ledger.batches.map(batch => { const units = batch.units.map(unit => { const next = withoutUnsaidPlan(unit); if (next !== unit) changed = true; return next; }); return changed ? { ...batch, units } : batch; });
  return changed ? { ...ledger, batches } : ledger;
}
