import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {memoryCases,memoryHardCases,memoryNegativeCases} from "../../evaluation/memory-search/cases";
import {getDatabase} from "../storage/db";
import {invalidateStoredMessageSearchIndex} from "../storage/messages";
import {messageFullTextSearch,MessageFullTextSearch} from "./message-fulltext";
import {historyRequest} from "./history-request";
import {searchMemory} from "../sidecar/context-engine";

it("compares baseline and expanded local retrieval on 38 labelled synthetic questions",async()=>{
 const db=await getDatabase();for(const name of ["messages","conversations"] as const)await db.clear(name);
 const conversation={id:"evaluation",title:"脱敏结构的合成讨论",platform:"chatgpt" as const,url:"",messageCount:1008,updatedAt:1};await db.put("conversations",conversation);
 const tx=db.transaction("messages","readwrite");
 for(const [index,item] of [...memoryCases,...Array.from({length:1000},(_,i)=>({id:`noise:${i}`,text:`无关的散步与咖啡记录。第 ${i} 次讨论天气，未涉及技术产品。`}))].entries())await tx.store.put({id:item.id,conversationId:conversation.id,role:"user",messageIndex:index,content:item.text,preview:item.text,contentHash:item.id,createdAt:1,updatedAt:1});
 await tx.done;invalidateStoredMessageSearchIndex();
 const network=vi.spyOn(globalThis,"fetch").mockRejectedValue(Error("Local evaluation must not use network"));
 try{
  const start=performance.now();await messageFullTextSearch.prepare();const coldMs=performance.now()-start;
  const cases=[...memoryCases.flatMap(item=>item.queries.map(query=>({query,expected:item.id,reason:"Labelled literal or natural-language query"}))),...memoryHardCases,...memoryNegativeCases.map(query=>({query,expected:"",reason:"Explicit negative"}))];
  let baseline=0,current=0,negativeHits=0,citations=0,totalCitations=0,mrr=0;const latencies:number[]=[],failures:Array<{query:string;expected:string;actual:string[];reason:string}>=[];
  for(const item of cases){
   const before=await messageFullTextSearch.search(historyRequest(item.query).query,{requireBodyMatch:true,proximity:120,limit:5,conversationIds:[conversation.id]});
   if(item.expected&&before.hits.some(hit=>hit.messageId===item.expected))baseline++;
   const at=performance.now(),after=await searchMemory(item.query,[conversation]);latencies.push(performance.now()-at);
   const ids=after.hits.slice(0,5).map(hit=>hit.id),rank=ids.indexOf(item.expected);
   if(item.expected&&rank>=0){current++;mrr+=1/(rank+1);}else if(item.expected)failures.push({...item,actual:ids});
   if(!item.expected)negativeHits+=after.hits.length;
   for(const hit of after.hits){totalCitations++;if(hit.sourceRange&&hit.message.content.slice(hit.sourceRange.start,hit.sourceRange.end)===hit.sourceRange.excerpt)citations++;}
  }
  const restoreStart=performance.now();await new MessageFullTextSearch().prepare();const restoreMs=performance.now()-restoreStart,positives=cases.filter(item=>item.expected).length,sorted=latencies.sort((a,b)=>a-b);
  console.info("ATLAS_MEMORY_EVALUATION",JSON.stringify({dataset:"38 synthetic labelled questions, 1008 messages; no real-user accuracy claim",cases:cases.length,baselineRecallAt5:baseline/positives,recallAt5:current/positives,mrrAt5:mrr/positives,citationAccuracy:citations/totalCitations,negativeHits,coldMs:Math.round(coldMs),restoreMs:Math.round(restoreMs),p50Ms:Math.round(sorted[Math.floor(sorted.length*.5)]),p95Ms:Math.round(sorted[Math.floor(sorted.length*.95)]),modelCalls:0,tokenCost:0,failures}));
  expect(current).toBeGreaterThanOrEqual(baseline);expect(current/positives).toBeGreaterThanOrEqual(.75);expect(negativeHits).toBe(0);expect(citations).toBe(totalCitations);expect(network).not.toHaveBeenCalled();
 }finally{network.mockRestore();}
},30000);
