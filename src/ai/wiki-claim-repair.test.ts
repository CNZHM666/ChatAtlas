import "fake-indexeddb/auto";
import {expect,it} from "vitest";
import {wikiClaimIssues,wikiClaimRepairRequest} from "./wiki-claim-repair";
import {synthesizeCoveredFocus,type CoverageMaterial} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {transcriptPassages} from "../search/transcript-index";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
import {listAIUsage} from "../storage/ai-usage";
import {analyzeOrganizationRuns,organizationAnalysisCsv} from "./usage-analysis";
import {validateProviderOutput,requestBudget} from "./request-policy";

const quote="只有用户确认后才保存。";
const batch:CoverageMaterial[]=[{id:"e1",conversationId:"c",sourceConversationIds:["c"],messageId:"m",title:"保存",text:`user: ${quote}`,rawEvidenceIds:["e1"],wikiOwnerId:"owner"}];
const draft=()=>({title:"保存",sections:[{title:"保存",body:"ARTICLE_PROSE 必须完整保留。",transition:"",kind:"finding",wikiOwnerId:"owner",evidenceIds:["e1"],claims:[{text:"用户确认后保存",quote:"",evidenceIds:["e1"]}]}]});
const patch={claims:[{path:"sections[0].claims[0]",quote,evidenceIds:["e1"]}]};
it("reports exact invalid fields after decoding the real provider wire",()=>{
 const request={taskType:"focus_session" as const,system:"Compose",prompt:JSON.stringify({intent:"保存",mode:"work",strategy:"work",locale:"zh-CN",coverage:{final:true,stage:"synthesis"},passages:[{id:"material-long",text:quote,wikiOwnerId:"owner"}],wikiTopics:[{ownerId:"owner",title:"保存"}]}),validate:(value:unknown)=>value};
 try{validateProviderOutput(request,draft());throw new Error("Expected validation failure");}catch(error){
  expect(error).toMatchObject({code:"PROVIDER_SCHEMA_invalid_wiki_claim",fieldPaths:["sections[0].claims[0].quote"],wikiClaimIssues:[{path:"sections[0].claims[0].quote",reason:"required_text"}]});
  expect(JSON.stringify((error as {wikiClaimDraft:unknown}).wikiClaimDraft)).toContain("material-long");
 }
});
it("repairs only metadata, sends no article, validates literal proof, and preserves the draft",()=>{
 const original=draft(),before=structuredClone(original),repair=wikiClaimRepairRequest(original,batch,value=>validateFocusResult(value,[{id:"e1",conversationId:"c",messageId:"m",title:"保存",excerpt:quote}]),batch);
 expect(repair).toBeDefined();expect(repair!.request.prompt).not.toContain("ARTICLE_PROSE");
 expect(repair!.request.maxAttempts).toBe(1);expect(repair!.request.maxOutputTokens).toBeLessThan(2400);
 expect(requestBudget(repair!.request)).toMatchObject({maxInputTokens:14000,maxOutputTokens:2400});
 const value=repair!.apply(patch);expect(value.sections[0].body).toBe(original.sections[0].body);expect(value.sections[0].claims?.[0]).toMatchObject({quote,text:"用户确认后保存",evidenceIds:["e1"]});
 expect(original).toEqual(before);expect(repair!.request.validate(patch)).toEqual(patch);
});
it("requires unambiguous literal support when a missing evidence list is repaired",()=>{
 const value=draft();value.sections[0].claims[0]={text:"用户确认后保存",quote,evidenceIds:[]};
 const duplicated=[...batch,{...batch[0],id:"e2"}];value.sections[0].evidenceIds=["e1","e2"];
 const repair=wikiClaimRepairRequest(value,duplicated,()=>({title:"",sections:[]}),batch)!;
 expect(()=>repair.apply(patch)).toThrow();
});
it.each([
 {claims:[{...patch.claims[0],quote:"虚构的原文"}]},
 {claims:[{...patch.claims[0],evidenceIds:["foreign"]}]},
 {claims:[{...patch.claims[0],text:"改写结论"}]},
 {claims:[patch.claims[0],patch.claims[0]]},
 {claims:[]},
 {claims:[patch.claims[0]],sections:[]},
])("rejects a patch that invents support, edits text or changes the response: %j",value=>{
 expect(()=>wikiClaimRepairRequest(draft(),batch,()=>({title:"",sections:[]}),batch)!.apply(value)).toThrow();
});
it("does not silently delete overflow, foreign citations or missing claim text",()=>{
 const overflow=draft();overflow.sections[0].claims=Array.from({length:13},()=>({text:"条件",quote,evidenceIds:["e1"]}));
 expect(wikiClaimIssues(overflow)).toContainEqual({path:"sections[0].claims",reason:"too_many_claims"});
 expect(wikiClaimRepairRequest(overflow,batch,()=>({title:"",sections:[]}),batch)).toBeUndefined();
 const foreign=draft();foreign.sections[0].claims[0].evidenceIds=["foreign"];
 expect(wikiClaimRepairRequest(foreign,batch,()=>({title:"",sections:[]}),batch)).toBeUndefined();
 const empty=draft();empty.sections[0].claims[0].text="";
 expect(wikiClaimRepairRequest(empty,batch,()=>({title:"",sections:[]}),batch)).toBeUndefined();
});
it("rejects a quote that exists only in a generated note rather than the original message",()=>{
 const repair=wikiClaimRepairRequest(draft(),batch,()=>({title:"",sections:[]}),[{...batch[0],text:"助手只是提出保存建议，用户尚未确认。"}])!;
 expect(()=>repair.apply(patch)).toThrow();
});
it.each([false,true])("keeps the article and fixes one bad claim with a small recovery call; pause=%s",async pause=>{
 const id=crypto.randomUUID(),source:Conversation={id,title:"保存",platform:"chatgpt",url:"",updatedAt:1,messageCount:1};
 const passages=transcriptPassages(source,[{id:"m",conversationId:id,messageIndex:0,role:"user",content:quote,preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 let reads=0,plans=0,writes=0,repairs=0,interrupted=pause,controller=new AbortController();
 const prose="## 授权\n\nARTICLE_PROSE：只有用户确认后才保存；其他条件保持原样。";
 const ai=createAtlasAIFromProvider({id:"fixture",modelId:id,testConnection:async()=>({ok:true,model:id}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_claim_repair"){
   repairs++;expect(request.maxAttempts).toBe(1);expect(request.maxOutputTokens).toBeLessThan(2400);expect(request.prompt).not.toContain("ARTICLE_PROSE");
   if(interrupted){interrupted=false;controller.abort();controller.signal.throwIfAborted();}
   return request.validate({claims:data.fields.map((field:{path:string;allowedEvidenceIds:string[]})=>({path:field.path,quote,evidenceIds:field.allowedEvidenceIds}))});
  }
  if(data.presentation==="wiki_topic_plan"){plans++;return request.validate({scope:[], pages:[{title:"保存",subtopics:[{title:"授权",sectionIds:data.sections.map((item:{id:string})=>item.id)}]}]});}
  if(!data.coverage.final){reads++;return request.validate({title:"保存",sections:[{title:"保存",body:quote,transition:"",kind:"finding",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  writes++;const evidenceIds=data.passages.map((_item:unknown,index:number)=>`e${index+1}`);
  return validateProviderOutput(request,{title:"保存",sections:[{title:"保存",body:prose,transition:"",kind:"finding",wikiOwnerId:data.wikiTopics[0].ownerId,evidenceIds,claims:[{text:"确认后保存",quote:"",evidenceIds}]}]});
 }},{id:"ai-settings",provider:"openai",model:id,apiKey:"fixture",baseUrl:"https://fixture.invalid",updatedAt:1},undefined,id);
 const run=()=>synthesizeCoveredFocus({goal:"复习保存条件",mode:"work",locale:"zh-CN",sources:[source],passages,ai,collectProjectKnowledge:true,signal:controller.signal,validate:validateFocusResult});
 if(pause){await expect(run()).rejects.toThrow();controller=new AbortController();}
 const result=await run();expect(result.result.sections[0].body).toBe(prose);expect(result.result.sections[0].claims?.[0].quote).toBe(quote);
 expect({reads,plans,writes}).toEqual({reads:1,plans:1,writes:1});expect(repairs).toBe(pause?2:1);
 const events=(await listAIUsage()).filter(event=>event.runId===id),failed=events.find(event=>event.errorCode==="PROVIDER_SCHEMA_invalid_wiki_claim");
 expect(failed?.claimValidation).toContainEqual({path:"sections[0].claims[0].quote",reason:"required_text"});
 const csv=organizationAnalysisCsv(analyzeOrganizationRuns([],events,[]));expect(csv).toContain("claimValidation");expect(csv).not.toContain("ARTICLE_PROSE");
 const before={reads,plans,writes,repairs};await run();expect({reads,plans,writes,repairs}).toEqual(before);
});
