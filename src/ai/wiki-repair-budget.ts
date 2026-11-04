import {RECOVERY_POLICY} from "./recovery-policy";
const LIMITS=RECOVERY_POLICY.directory;

/** Independent catalogue windows must not starve one another, or the final
 * reconciliation. Reserve synchronously so concurrent windows cannot overspend.
 * Limits count requested output ceilings, not actual provider billing. */
export function createWikiRepairBudget() {
 const local={count:0,tokens:0},global={count:0,tokens:0};
 return {
  get count(){return local.count+global.count;},
  get tokens(){return local.tokens+global.tokens;},
  window(compact:boolean){
   const pool=compact?global:local,window={count:0,tokens:0};
   const canReserve=(tokens=0)=>window.count<LIMITS.windowAttempts&&window.tokens+tokens<=LIMITS.windowOutputTokens
    // Small ownership replies use 800 tokens rather than a whole directory's
    // ceiling. Allow those savings to serve later windows of long catalogues;
    // the aggregate token cap and each window's four attempts still apply.
    &&pool.count<(compact?LIMITS.globalRepairs:LIMITS.localRepairs)&&pool.tokens+tokens<=LIMITS.poolOutputTokens;
   return {
    canReserve,
    reserve(tokens:number){
     if(!canReserve(tokens))return;
     window.count++;window.tokens+=tokens;pool.count++;pool.tokens+=tokens;
     let refunded=false;
     // Only call after a cache hit has passed this invocation's validation.
     return ()=>{if(refunded)return;refunded=true;window.count--;window.tokens-=tokens;pool.count--;pool.tokens-=tokens;};
    },
   };
  },
 };
}
