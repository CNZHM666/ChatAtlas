import { failureOrigin } from "./failure-origin";
import { AIProviderHttpError, AIProviderResponseError } from "./provider-errors";
import type { StructuredAIRequest } from "./provider";

export function wikiBatchFailure(error: unknown): NonNullable<import("../shared/wiki-knowledge").WikiUnitBatch["failure"]> {
  const code = (error as { code?: unknown } | null)?.code;
  return {
    kind: code === "PROVIDER_OUTPUT_TRUNCATED" ? "truncated" as const : failureOrigin(error) ?? "unknown",
    ...(typeof code === "string" && /^[A-Z0-9_]{1,100}$/iu.test(code) ? { code } : {}),
  };
}

/** Retrying transport is bounded separately from schema repair and output splitting. */
export function wikiTransportFailure(error: unknown) {
  return failureOrigin(error) === "network"
    || error instanceof AIProviderHttpError && (error.status === 429 || error.status === 502 || error.status === 503 || error.status === 504);
}

export function wikiCannotFit(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  if (error instanceof AIProviderResponseError && code === "PROVIDER_OUTPUT_TRUNCATED"
    && error.outputDiagnostics?.receivedCharacters === 0
    && (error.outputDiagnostics.reasoningTokens || error.outputDiagnostics.reasoningCharacters)) return false;
  return code === "LOCAL_INPUT_BUDGET" || code === "LOCAL_INPUT_CHARACTERS"
    || code === "PROVIDER_OUTPUT_TRUNCATED" || error instanceof AIProviderHttpError && error.status === 413;
}

export function wikiRequestIdentity<T>(request: StructuredAIRequest<T>): StructuredAIRequest<T> {
  return request.trace?.operationId ? request : { ...request, trace: { ...request.trace, operationId: crypto.randomUUID() } };
}

export type WikiRecoveryReason = NonNullable<NonNullable<StructuredAIRequest<never>["trace"]>["recoveryReason"]>;

export function wikiSplitReason(error: unknown): WikiRecoveryReason {
  return wikiBatchFailure(error).kind === "truncated" ? "output_truncation" : wikiCannotFit(error) ? "input_budget" : "schema";
}

export function wikiRecoveryRequest<T>(request: StructuredAIRequest<T>, parent: Pick<StructuredAIRequest<never>, "trace">, reason: WikiRecoveryReason): StructuredAIRequest<T> {
  return { ...request, trace: { ...request.trace, operationId: crypto.randomUUID(),
    parentOperationId: parent.trace?.operationId, recoveryReason: reason, recoveryDepth: (parent.trace?.recoveryDepth ?? 0) + 1 } };
}

export function waitForWikiRetry(signal: AbortSignal, ms: number) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
