import type {AtlasAIProvider,StructuredAIRequest} from "./provider";
import type {AtlasAI} from "./atlas-ai";
import {createWikiPlanningCheckpoints} from "./wiki-planning-checkpoint";

/** The existing planning ledger survives eviction of ordinary model responses.
 * Only validated completed steps are stored; reading caches are never cleared. */
export function wikiRevisionCache(ai:AtlasAIProvider,signal:AbortSignal){
  const ledger=ai.getAnalysisKey?createWikiPlanningCheckpoints(()=>ai.getAnalysisKey!(),signal):undefined;
  let hits=0;
  return {get hits(){return hits;},async run<T>(request:StructuredAIRequest<T>,revalidate?:(value:unknown)=>T,onReuse?:()=>void):Promise<T>{
    signal.throwIfAborted();
    const id=ledger?await ledger.key("revision-v1",[request.system,request.prompt,request.temperature,request.maxOutputTokens]):undefined;
    const saved=id?await ledger!.read<unknown>(id):undefined;
    if(saved!==undefined&&revalidate){
      let result:T|undefined,valid=false;
      try{result=revalidate(saved);valid=true;}
      catch{signal.throwIfAborted();await ledger!.remove(id!,saved);}
      if(valid){signal.throwIfAborted();hits++;onReuse?.();await (ai as Partial<AtlasAI>).recordReuse?.(request as StructuredAIRequest<unknown>,"checkpoint").catch(()=>undefined);return result!;}
    }
    const result=await ai.generateStructured({...request,onCacheHit:()=>{hits++;onReuse?.();request.onCacheHit?.();}});
    signal.throwIfAborted();
    const valid=revalidate?revalidate(result):result;
    if(id&&revalidate)await ledger!.write(id,valid);
    return valid;
  }};
}
