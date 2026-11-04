import {expect,it,vi} from "vitest";
import {executeBatches} from "./batch-executor";
import {MAX_CONCURRENCY} from "./model-routing";

it("resumes available workers after a temporary reduction instead of permanently retiring them",async()=>{
 let limit=2,active=0,peak=0;const finish:Array<()=>void>=[];
 const running=executeBatches([0,1,2,3,4],{capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,get maxConcurrency(){return limit;}}},async item=>{
  active++;peak=Math.max(peak,active);await new Promise<void>(resolve=>finish.push(()=>{active--;resolve();}));return item;
 });
 await vi.waitFor(()=>expect(finish).toHaveLength(2));limit=1;finish.shift()!();finish.shift()!();
 await vi.waitFor(()=>expect(finish).toHaveLength(1));limit=3;finish.shift()!();
 await vi.waitFor(()=>expect(finish).toHaveLength(2));finish.shift()!();finish.shift()!();
 expect(await running).toEqual([0,1,2,3,4]);expect(peak).toBe(2);
});

it("drains in-flight work on failure and does not start remaining paid work",async()=>{
 const seen:number[]=[];
 await expect(executeBatches([0,1,2],{capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,maxConcurrency:2}},async item=>{seen.push(item);if(!item)throw Error("failed");return item;})).rejects.toThrow("failed");
 expect(seen).toEqual([0,1]);
});

it.each([NaN,Infinity,-1,0,1.9,8])("normalizes an invalid or fractional concurrency limit without hanging: %s",async maxConcurrency=>{
 let active=0,peak=0;
 const items=[0,1,2,3,4,5,6,7];
 const result=await executeBatches(items,{capabilities:{textGeneration:true,structuredOutput:"json",embeddings:false,maxConcurrency}},async item=>{active++;peak=Math.max(peak,active);await Promise.resolve();active--;return item;});
 // The provider's adaptive level sets the width, bounded by MAX_CONCURRENCY.
 expect(result).toEqual(items);expect(peak).toBe(maxConcurrency===8?Math.min(8,MAX_CONCURRENCY):1);
});
