import "fake-indexeddb/auto";
import { expect, it } from "vitest";
import { getDatabase } from "../storage/db";
import { MessageFullTextSearch } from "./message-fulltext";

it("measures a synthetic mixed-language corpus without touching originals", async () => {
  const db=await getDatabase(); for (const name of ["messages","conversations","messageSearchDocuments","messageSearchManifests","messageSearchState"] as const) await db.clear(name);
  await db.put("conversations", {id:"perf",title:"Mixed corpus",platform:"chatgpt",url:"",updatedAt:1,messageCount:2000});
  const tx=db.transaction("messages","readwrite"); let bytes=0;
  for(let n=0;n<2000;n++) { const content=`项目架构与电气验证。 async function buildContext(task_${n}) { return modelAdapter; }\n${"中文消息 English reference GPIO_pin context memory. ".repeat(20)}`; bytes+=new TextEncoder().encode(content).length; await tx.store.put({id:`perf-${String(n).padStart(4,"0")}`,conversationId:"perf",content,role:"assistant",preview:"",contentHash:String(n),messageIndex:n,createdAt:n,updatedAt:n}); }
  await tx.done;
  const engine=new MessageFullTextSearch(), start=performance.now(); await engine.prepare(); const buildMs=performance.now()-start;
  const samples:number[]=[];
  for(let n=0;n<20;n++) { const at=performance.now(), result=await engine.search(`task_${1500+n}`,{limit:10}); samples.push(performance.now()-at); expect(result.hits).toHaveLength(1); }
  const sorted=samples.sort((a,b)=>a-b), at=performance.now(); const broad=await engine.search("电气验证",{limit:10}); const broadMs=performance.now()-at;
  expect(broad.total).toBe(2000); expect(await db.count("messages")).toBe(2000); expect(sorted.at(-1)).toBeLessThan(2000);
  const derivedBytes = new TextEncoder().encode(JSON.stringify({ documents: await db.getAll("messageSearchDocuments"), manifests: await db.getAll("messageSearchManifests"), state: await db.getAll("messageSearchState") })).length;
  console.info("ATLAS_FULLTEXT_BENCHMARK", JSON.stringify({environment:"Vitest/jsdom + fake-indexeddb, synthetic data",messages:2000,bytes,derivedBytes,buildMs:Math.round(buildMs),queryMedianMs:Number(sorted[10].toFixed(2)),queryP95Ms:Number(sorted[18].toFixed(2)),broadQueryMs:Math.round(broadMs)}));
},30000);
