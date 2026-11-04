import type {AIUsageEvent} from "../shared/types";
import {AIProviderHttpError,AIProviderResponseError,AIProviderValidationError} from "./provider-errors";
import {WikiPreflightError} from "./writing-preflight";

export type FailureOrigin=NonNullable<AIUsageEvent["failureOrigin"]>;
export function failureOrigin(error:unknown,prompt?:string):FailureOrigin|undefined {
 if(error instanceof WikiPreflightError)return "local";
 if(error instanceof AIProviderValidationError&&error.code==="PROVIDER_SCHEMA_wiki_owner_missing_or_unknown"&&prompt){
  try{const parsed=JSON.parse(prompt),data=parsed.data??parsed;if(Array.isArray(data.wikiTopics)&&!data.wikiTopics.length)return "local";}catch{/* Unknown request shape is not evidence of a local fault. */}
 }
 if(error instanceof AIProviderHttpError)return "provider";
 if(error instanceof TypeError)return "network";
 if(error instanceof AIProviderValidationError)return "model";
 if(error instanceof AIProviderResponseError)return originForCode(error.code);
 return error&&typeof error==="object"&&"code" in error&&typeof error.code==="string"?originForCode(error.code):undefined;
}
function originForCode(code:string):FailureOrigin|undefined {
 if(/^(?:WIKI_PREFLIGHT_|TASK_INPUT_LIMIT)/u.test(code))return "local";
 if(/^(?:PROVIDER_TIMEOUT|PROVIDER_STREAM_INCOMPLETE|NETWORK_|ETIMEDOUT|ECONNRESET)/u.test(code))return "network";
 if(/^(?:PROVIDER_HTTP_|PROVIDER_MODEL_NOT_FOUND|PROVIDER_RESPONSE_REJECTED|RATE_LIMITED|PROVIDER_BUSY)/u.test(code))return "provider";
 if(/^PROVIDER_(?:SCHEMA_|OUTPUT_TRUNCATED|EMPTY_RESPONSE|INVALID_RESPONSE)/u.test(code))return "model";
 return undefined;
}
/** Older records retain unknown provenance rather than guessing from message text. */
export const usageFailureOrigin=(event:AIUsageEvent)=>event.failureOrigin??originForCode(event.errorCode??"");
export const isSentUsage=(event:AIUsageEvent)=>event.status!=="cached"&&event.requestSent!==false;
export function failuresByOrigin(events:AIUsageEvent[]) {
 const counts={local:0,model:0,provider:0,network:0,unknown:0};
 for(const event of events)if(event.status==="failed")counts[usageFailureOrigin(event)??"unknown"]++;
 return counts;
}
