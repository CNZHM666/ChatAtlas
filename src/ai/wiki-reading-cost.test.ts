import {singleOwnerPlan} from "../test/wiki-outline-fixture";
import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {coverageMaterials,synthesizeCoveredFocus} from "./focus-coverage";
import {transcriptPassages} from "../search/transcript-index";
import {requestBudget} from "./request-policy";
import {validateFocusResult} from "./focus-session";
import type {Conversation,ConversationMessage} from "../shared/types";
import type {StructuredAIRequest} from "./provider";

it("reduces synthetic initial-reading requests without removing any source character",async()=>{
 const source:Conversation={id:"cost-fixture",title:"长期项目",platform:"chatgpt",url:"",messageCount:459,updatedAt:1};
 const messages:ConversationMessage[]=Array.from({length:459},(_,index)=>({id:`m${index}`,conversationId:source.id,role:index%2?"assistant":"user",messageIndex:index,content:`讨论${index}：${"原始条件与解释。".repeat(224)}${index===458?"先不采用新架构，继续保留现有方案。":"保留此处的独特约束。"}`,preview:"",contentHash:"",createdAt:1,updatedAt:1}));
 const passages=transcriptPassages(source,messages),{materials}=coverageMaterials(passages,[source]);
 const request=(items:typeof materials)=>({taskType:"focus_session" as const,system:"",prompt:JSON.stringify({intent:"Preserve the complete chronological discussion for later reuse.",mode:"review",strategy:"review",locale:"zh-CN",analysisMode:"balanced",projectKnowledge:true,semanticStructure:false,coverage:{confirmedSourceCount:1,includedSourceCount:1,sampled:false,stage:"reading",final:false,sourceSegmentCount:items.length,...(items[0].precedingContext?{precedingContext:items[0].precedingContext}:{})},passages:items.map(({id,conversationId,sourceConversationIds,title,messageId,date,text})=>({id,conversationId,sourceConversationIds,title,messageId,date,text}))})});
 const before:Array<typeof materials>=[];let chunk:typeof materials=[];
 for(const item of materials){if(chunk.length&&requestBudget(request([...chunk,item]),"qwen3.7-flash").inputTokens>12500){before.push(chunk);chunk=[];}chunk.push(item);}if(chunk.length)before.push(chunk);
 const after:Array<{tokens:number;texts:string[]}>=[];
 await synthesizeCoveredFocus({goal:"整理项目",mode:"work",locale:"zh-CN",sources:[source],passages,modelId:"qwen3.7-flash",collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult,
  ai:{generateStructured:singleOwnerPlan,canReuseProjectKnowledge:true,synthesize:async<T,>(task:StructuredAIRequest<T>)=>{
   const data=JSON.parse(task.prompt);if(!data.coverage.final)after.push({tokens:requestBudget(task,"qwen3.7-flash").inputTokens,texts:data.passages.map((item:{text:string})=>item.text)});
   return task.validate({title:"项目",sections:[{title:"现行约束",body:"## 具体机制\n\n用户暂不采用新架构，保留现有方案；细节需核对原始消息。",transition:"",kind:"finding",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});
  }}});
 expect(after.length).toBeLessThan(before.length);expect(after.flatMap(batch=>batch.texts)).toEqual(materials.map(item=>item.text));
 const beforeTokens=before.reduce((sum,batch)=>sum+requestBudget(request(batch),"qwen3.7-flash").inputTokens,0),afterTokens=after.reduce((sum,batch)=>sum+batch.tokens,0);
 expect(afterTokens).toBeLessThan(beforeTokens);
 console.info("SYNTHETIC_READING_BUDGET",JSON.stringify({sourceCharacters:messages.reduce((sum,message)=>sum+message.content.length,0),materialBlocks:materials.length,beforeRequests:before.length,afterRequests:after.length,beforeEstimatedInputTokens:beforeTokens,afterEstimatedInputTokens:afterTokens,sourceCharactersPreserved:true}));
});
