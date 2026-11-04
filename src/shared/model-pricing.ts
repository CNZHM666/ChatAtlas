/** User-supplied CNY per million tokens. Missing rates mean unknown, never free. */
export interface ModelTokenPrice {inputCnyPerMillion?:number;outputCnyPerMillion?:number;cachedInputCnyPerMillion?:number}
export const MODEL_TOKEN_PRICES:Record<string,ModelTokenPrice>={
 "qwen/deepseek-v4.1-flash-1017":{
  // 待填写：由用户提供输入、输出价格（元 / 百万 Token），不得猜测。
  inputCnyPerMillion:undefined,outputCnyPerMillion:undefined,
  // 待填写：如有缓存命中，用户还需提供缓存输入价格。
  cachedInputCnyPerMillion:undefined,
 },
 "qwen/qwen3.8-flash":{
  // 待填写：由用户提供输入、输出价格（元 / 百万 Token），不得猜测。
  inputCnyPerMillion:undefined,outputCnyPerMillion:undefined,
  // 待填写：如有缓存命中，用户还需提供缓存输入价格。
  cachedInputCnyPerMillion:undefined,
 },
};

/** Only provider-reported tokens are priced by the caller. No historical ledger
 * rewrite, model-family fallback, currency conversion or assumed cache discount. */
export function modelUsageCostCny(providerId:string,modelId:string,inputTokens:number,outputTokens:number,cachedInputTokens=0):number|undefined{
 const price=MODEL_TOKEN_PRICES[`${providerId}/${modelId}`];
 const valid=(value:number|undefined):value is number=>value!==undefined&&Number.isFinite(value)&&value>=0;
 if(!price||!valid(price.inputCnyPerMillion)||!valid(price.outputCnyPerMillion)||![inputTokens,outputTokens,cachedInputTokens].every(valid)||cachedInputTokens>inputTokens)return;
 if(cachedInputTokens>0&&!valid(price.cachedInputCnyPerMillion))return;
 return ((inputTokens-cachedInputTokens)*price.inputCnyPerMillion+cachedInputTokens*(price.cachedInputCnyPerMillion??0)+outputTokens*price.outputCnyPerMillion)/1_000_000;
}
