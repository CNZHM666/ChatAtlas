import {expect,it} from "vitest";
import {createRequestQueue} from "./directory-request-queue";
import {MAX_CONCURRENCY} from "./model-routing";

it("lets the shared reading and directory queue widen to the provider's adaptive level",async()=>{
 let active=0,peak=0;const queue=createRequestQueue(()=>8,new AbortController().signal);
 await Promise.all(Array.from({length:10},()=>queue.run(async()=>{active++;peak=Math.max(peak,active);await new Promise(resolve=>setTimeout(resolve,0));active--;})));
 expect(peak).toBe(Math.min(8,MAX_CONCURRENCY));
});
