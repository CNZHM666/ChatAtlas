import type {StructuredAIRequest} from "./provider";
import {requestBudget} from "./request-policy";
import {writingInputScale} from "./token-calibration";

/** The first variant, most detailed first, whose input fits its task budget.
 * Large projects then send a shorter request instead of none at all; the last
 * variant is returned when nothing fits, so the usual input-limit error stays.
 * Fit is judged like the send-time check: on the model's calibrated estimate. */
export function fittingRequest<T>(variants:Array<()=>StructuredAIRequest<T>>,modelId?:string):StructuredAIRequest<T>{
 let request!:StructuredAIRequest<T>;
 const scale=writingInputScale(modelId);
 for(const variant of variants){
  request=variant();
  const budget=requestBudget(request,modelId);
  if(budget.inputTokens*scale<=budget.maxInputTokens)return request;
 }
 return request;
}
