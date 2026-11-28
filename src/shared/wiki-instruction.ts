import { DEFAULT_PROJECT_GOAL } from "./constants";
import { knowledgeTerms } from "./knowledge-subject";
import type { WikiKnowledgeUnit } from "./wiki-knowledge";

const BUILTIN_GOALS = new Set<string>(Object.values(DEFAULT_PROJECT_GOAL));
const EXCLUDE_CLAUSE = /(?:略过|忽略|跳过|排除|不用写|不要写|不展开|去掉|skip|ignore|exclude|omit|without)\s*[:：]?\s*([^，。；,;]+)/giu;
const PREFER_DECIDED = /已拍板|已定|定稿|当前决定|最终方案|确定方案|decided|confirmed|settled|final/iu;
const PREFER_DELIVERY = /交付|里程碑|验收|排期|路线图|开发顺序|阶段计划|delivery|milestone|acceptance|roadmap|schedule/iu;
const PREFER_CONSTRAINTS = /选型|约束|限制|架构|边界|风险|原则|selection|constraint|architecture|boundary|criteria/iu;

/** Returns trimmed user organization instructions, ignoring empty or built-in placeholder goals. */
export function normalizeOrganizationInstruction(raw?: string): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed || BUILTIN_GOALS.has(trimmed)) return undefined;
  return trimmed.slice(0, 500);
}

export interface InstructionFocus {
  raw: string;
  focusTerms: Set<string>;
  excludeTerms: Set<string>;
  preferDecided: boolean;
  preferDelivery: boolean;
  preferConstraints: boolean;
}

export function parseInstructionFocus(instruction: string): InstructionFocus {
  const excludeTerms = new Set<string>();
  const withoutExcluded = instruction.replace(EXCLUDE_CLAUSE, (_match, clause: string) => {
    for (const term of knowledgeTerms(clause)) excludeTerms.add(term);
    return " ";
  });
  const focusTerms = new Set<string>();
  for (const term of knowledgeTerms(withoutExcluded)) {
    if (!excludeTerms.has(term)) focusTerms.add(term);
  }
  return {
    raw: instruction,
    focusTerms,
    excludeTerms,
    preferDecided: PREFER_DECIDED.test(withoutExcluded),
    preferDelivery: PREFER_DELIVERY.test(withoutExcluded),
    preferConstraints: PREFER_CONSTRAINTS.test(withoutExcluded),
  };
}

/** Bounded priority adjustment during unit curation so user-requested focus items survive subject quotas. */
export function instructionUnitBoost(
  instruction: string | undefined,
  unit: Pick<WikiKnowledgeUnit, "subject" | "statement" | "kind" | "details" | "adoption">,
  status?: string,
): number {
  const normalized = normalizeOrganizationInstruction(instruction);
  if (!normalized) return 0;
  const focus = parseInstructionFocus(normalized);
  const unitTerms = knowledgeTerms(`${unit.subject} ${unit.statement} ${unit.details.join(" ")}`);
  let focusHits = 0;
  for (const term of focus.focusTerms) if (unitTerms.has(term)) focusHits++;
  let excludeHits = 0;
  for (const term of focus.excludeTerms) if (unitTerms.has(term)) excludeHits++;

  let delta = Math.min(4, focusHits * 2);
  if (focus.preferDecided && (status === "confirmed" || unit.adoption.status === "user_decision" || unit.adoption.status === "user_adopted")) {
    delta += 2;
  }
  if (focus.preferDelivery && (unit.kind === "plan" || unit.kind === "report")) {
    delta += 2.5;
  }
  if (focus.preferConstraints && (unit.kind === "constraint" || unit.kind === "decision" || unit.kind === "mechanism")) {
    delta += 2;
  }
  if (excludeHits > 0 && focusHits === 0 && status !== "confirmed" && unit.adoption.status !== "user_decision") {
    delta -= Math.min(2.5, excludeHits * 1.5);
  }
  return Math.max(-2.5, Math.min(5, delta));
}
