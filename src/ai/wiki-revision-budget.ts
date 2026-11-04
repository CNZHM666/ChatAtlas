import type {AtlasAIProvider} from "./provider";
import {writingInputScale} from "./token-calibration";

/** Revision requests are sized by provider-reported tokens, like Wiki writing.
 * The scale is rounded up to one decimal so a retry rebuilds the same batches
 * and reuses their checkpoints; the shared demo service keeps its own budget. */
export function revisionInputScale(ai:Pick<AtlasAIProvider,"id"|"modelId">):number{
 if(ai.id==="atlas-demo")return 1;
 return Math.min(1,Math.ceil(writingInputScale(ai.modelId)*10)/10);
}

/** Input room for one revision request: the task policy, bounded by the model's
 * real context when the provider reports it, otherwise the local fallback. */
export function revisionInputLimit(ai:Pick<AtlasAIProvider,"capabilities">,policyMax:number,outputTokens:number,fallback:number):number{
 const context=ai.capabilities?.maxContextTokens;
 return Math.max(0,Math.min(policyMax,context&&Number.isFinite(context)?context-outputTokens-1000:fallback));
}
