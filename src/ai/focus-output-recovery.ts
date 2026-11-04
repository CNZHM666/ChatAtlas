import { getDatabase } from "../storage/db";
import { sourceMessageSignature } from "../shared/source-signature";
import { AIProviderResponseError } from "./provider-errors";
import { DemoApiError } from "./demo-api";

export function outputWasTruncated(error: unknown): boolean {
  // Shrinking the input does not fix hidden reasoning exhausting the output
  // cap. Stop instead of recursively paying for the same non-answer.
  if (error instanceof AIProviderResponseError && error.outputDiagnostics?.receivedCharacters === 0 && ((error.outputDiagnostics.reasoningCharacters ?? 0) > 0 || (error.outputDiagnostics.reasoningTokens ?? 0) > 0)) return false;
  return (error instanceof AIProviderResponseError || error instanceof DemoApiError) && error.code === "PROVIDER_OUTPUT_TRUNCATED";
}

/** Only partition hints are stored here; model results keep their normal exact cache identity. */
async function planKey(prompt: string, modelId: string) {
  const digest = globalThis.crypto?.subtle ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(prompt)))].map(byte => byte.toString(16).padStart(2, "0")).join("") : `${sourceMessageSignature(prompt)}:${sourceMessageSignature([...prompt].reverse().join(""))}`;
  return `focus-output-split-v1:${modelId}:${digest}`;
}

export async function hasOutputSplit(prompt: string, modelId = ""): Promise<boolean> {
 return Boolean(await outputSplitStrategy(prompt,modelId));
}

export async function outputSplitStrategy(prompt:string,modelId=""):Promise<"split"|"topic"|"owner"|undefined>{
  if (!globalThis.indexedDB) return;
  try {
    const plan = await (await getDatabase()).get("semanticDecisionCache", await planKey(prompt, modelId));
    return plan?.result === "split" || plan?.result === "topic" || plan?.result === "owner" ? plan.result : undefined;
  } catch { return; }
}

export async function rememberOutputSplit(prompt: string, modelId = "",strategy:"split"|"topic"|"owner"="split"): Promise<void> {
  if (!globalThis.indexedDB) return;
  try {
    const id = await planKey(prompt, modelId);
    await (await getDatabase()).put("semanticDecisionCache", { id, taskType: "synthesis", inputHash: id, analysisVersion: 1, providerId: "focus-output-recovery", modelId, result: strategy, createdAt: Date.now() });
  } catch { /* Recovery still works when local storage is unavailable. */ }
}
