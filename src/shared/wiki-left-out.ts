import { LEAVES_OUT } from "./negation";
import { PHASE } from "./stage-words";

const LEAVES = new RegExp(LEAVES_OUT, "u"), STAGE = new RegExp(`当前|${PHASE.source}`, "iu");
/** What a line leaves out, for a list of what is not done now: "初期采用免费核心功能加一次性“30天AI守护计划”付费模式，暂不做
 * 强制会员或周订阅。" stood whole under 暂不做, the plan it opens with read as left out. Its clauses from the first leaving
 * something out, with the stage it names ("初期暂不做强制会员或周订阅。"); a line opening on what it leaves out is kept. */
export function leftOutClause(statement: string): string {
  const clauses = statement.trim().split(/(?<=[，,；;])/u), at = clauses.findIndex(clause => LEAVES.test(clause));
  if (at <= 0) return statement.trim();
  const rest = clauses.slice(at).join("").trim().replace(/[，,；;。.]+$/u, ""), stage = statement.match(STAGE)?.[0];
  return `${stage && !rest.includes(stage) ? stage : ""}${rest}。`;
}
