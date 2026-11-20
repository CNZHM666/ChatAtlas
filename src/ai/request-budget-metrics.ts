import type { AIUsageEvent } from "../shared/types";
import { isSentUsage } from "./failure-origin";

type UsageBudget = { samples: number; used: number; limit: number; utilization?: number };
type StageBudget = { stage: string; requests: number; unavailable: number; input: UsageBudget; output: UsageBudget };

export function stageBudgetMetrics(requests: AIUsageEvent[]) {
  const stages = new Map<string, StageBudget>();
  for (const event of requests) {
    const inputLimit = event.inputTokenLimit ?? 0;
    const outputLimit = event.outputTokenLimit ?? 0;
    if (inputLimit <= 0 && outputLimit <= 0) continue;
    const stage = event.stage ?? event.taskType;
    const row = stages.get(stage) ?? {
      stage, requests: 0, unavailable: 0,
      input: { samples: 0, used: 0, limit: 0 }, output: { samples: 0, used: 0, limit: 0 },
    };
    row.requests++;
    if (event.tokenSource !== "provider") row.unavailable++;
    else {
      for (const [budget, used, limit] of [[row.input, event.inputTokens, inputLimit], [row.output, event.outputTokens, outputLimit]] as const) {
        if (!Number.isFinite(limit) || limit <= 0) continue;
        budget.samples++;
        budget.used += used;
        budget.limit += limit;
        budget.utilization = budget.used / budget.limit;
      }
    }
    stages.set(stage, row);
  }
  return [...stages.values()];
}

export function retryRecoveryMetrics(events: AIUsageEvent[]) {
  const operations = new Map<string, AIUsageEvent[]>();
  const children = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.operationId) continue;
    const attempts = operations.get(event.operationId) ?? [];
    attempts.push(event);
    operations.set(event.operationId, attempts);
    if (event.parentOperationId && event.operationId !== event.parentOperationId) {
      const group = children.get(event.parentOperationId) ?? new Set();
      group.add(event.operationId);
      children.set(event.parentOperationId, group);
    }
  }
  const last = new Map([...operations].map(([id, attempts]) =>
    [id, [...attempts].sort((a, b) => b.createdAt - a.createdAt || b.attempt - a.attempt)[0]] as const));
  const recovered = (id: string, path: ReadonlySet<string>): boolean => {
    if (path.has(id)) return false;
    const result = last.get(id);
    if (result && result.status !== "failed") return true;
    const next = children.get(id);
    return Boolean(next?.size && [...next].every(child => recovered(child, new Set([...path, id]))));
  };
  const eligible = [...operations].filter(([id, attempts]) => {
    const parent = last.get(id)?.parentOperationId;
    return (!parent || !operations.has(parent)) && attempts.some(event => event.status === "failed")
      && (attempts.length > 1 || children.has(id));
  });
  const retried = events.filter(event => isSentUsage(event) && (event.attempt > 1 ||
    event.recoveryReason !== undefined && (event.recoveryReason !== "input_budget" ||
      Boolean(event.parentOperationId && operations.get(event.parentOperationId)?.some(parent => parent.status === "failed" && isSentUsage(parent))))));
  const confirmed = eligible.filter(([id]) => recovered(id, new Set())).length;
  return {
    requests: retried.length,
    providerTokens: retried.reduce((sum, event) => sum + (event.tokenSource === "provider" ? event.inputTokens + event.outputTokens : 0), 0),
    unavailableUsage: retried.filter(event => event.tokenSource !== "provider").length,
    knownCostCny: retried.some(event => event.costCny !== undefined) ? retried.reduce((sum, event) => sum + (event.costCny ?? 0), 0) : undefined,
    unknownCostRequests: retried.filter(event => event.costCny === undefined || (event.pendingCostCny ?? 0) > 0).length,
    attemptedOperations: eligible.length,
    recoveredOperations: confirmed,
    successRate: eligible.length ? confirmed / eligible.length : undefined,
  };
}
