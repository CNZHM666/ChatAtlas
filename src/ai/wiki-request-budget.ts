import type { StructuredAIRequest } from "./provider";
import type { ModelTokenLimits } from "./provider-model-limits";
import { requestBudget } from "./request-policy";

export type WikiBudgetModel = { modelId?: string; capabilities?: ModelTokenLimits };

/** Estimate JSON independently of source size. The caller supplies the number
 * of returned rows and their approximate size, including quotes or prose.
 * The floor leaves room for framing and short batches. */
export function wikiStructuredOutput(rows: number, tokensPerRow: number, ceiling: number, floor = 500) {
  return Math.min(ceiling, Math.max(floor, Math.ceil(240 + rows * tokensPerRow)));
}

export function wikiRequestFits(request: Parameters<typeof requestBudget>[0] & Pick<StructuredAIRequest<never>, "maxOutputTokens" | "inputBudgetScale">, { modelId, capabilities }: WikiBudgetModel, expectedOutput: number, inputScale = request.inputBudgetScale ?? 1) {
  if (!modelId) return true;
  const budget = requestBudget(request, modelId);
  const input = Math.ceil(budget.inputTokens * inputScale);
  const inputLimit = Math.min(budget.maxInputTokens, capabilities?.maxInputTokens ?? Infinity);
  const available = Math.min(request.maxOutputTokens ?? Infinity, budget.maxOutputTokens, capabilities?.maxOutputTokens ?? Infinity,
    (capabilities?.maxContextTokens ?? Infinity) - input - 256);
  return input <= inputLimit && expectedOutput <= available;
}
