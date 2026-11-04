import "fake-indexeddb/auto";
import {expect,it,vi} from "vitest";
import {getDatabase} from "../storage/db";
import {createAtlasAIFromProvider} from "./atlas-ai";
import {synthesizeCoveredFocus} from "./focus-coverage";
import {validateFocusResult} from "./focus-session";
import {transcriptPassages} from "../search/transcript-index";
import {AIProviderResponseError} from "./provider-errors";
import {createWikiPlanningCheckpoints} from "./wiki-planning-checkpoint";
import {WIKI_EDITORIAL_PASS,WIKI_EDITORIAL_PASS_V4} from "./wiki-editorial-instructions";
import {WIKI_QUALITY_INSTRUCTIONS} from "./wiki-quality-instructions";
import {CURRENT_WIKI_READER_STATUS_INSTRUCTIONS,EDITION4_WIKI_COMPOSITION_INSTRUCTIONS,EDITION5_WIKI_COMPOSITION_INSTRUCTIONS,EDITION6_WIKI_COMPOSITION_INSTRUCTIONS,WIKI_COMPOSITION_INSTRUCTIONS,LEGACY_WIKI_COMPOSITION_INSTRUCTIONS,WIKI_CLAIM_LIMIT_INSTRUCTIONS,WIKI_READER_STATUS_INSTRUCTIONS} from "./wiki-composition-instructions";
import type {StructuredAIRequest} from "./provider";
import type {Conversation} from "../shared/types";
import type {CoverageMaterial} from "./focus-coverage";
// One-sentence fixtures exercise resume mechanics; the length-based subtopic merge has its own tests.
vi.mock("./wiki-subtopic-budget",async original=>({...await original<typeof import("./wiki-subtopic-budget")>(),mergeThinWikiChapters:(sections:unknown[])=>({sections,merged:0,toName:[]})}));

it.each([undefined,1,2,3,4,5,6] as const)("resumes edition %s drafts with their original writing identity while fresh tasks use the new policy",async oldEdition=>{
 const db=await getDatabase(),beforeIds=new Set((await db.getAll("semanticDecisionCache")).map(row=>row.id));
 const runId=crypto.randomUUID(),source:Conversation={id:runId,title:"保存规则",platform:"chatgpt",url:"",updatedAt:1,messageCount:1};
 const passages=transcriptPassages(source,[{id:runId,conversationId:runId,messageIndex:0,role:"user",content:"只有确认后才能保存，失败时保留原文。",preview:"",contentHash:"",createdAt:1,updatedAt:1}]);
 let reads=0,plans=0,initial=0,completions=0,timeout=true,legacy=false;
 let initialRequest:{system:string;prompt:string}|undefined;
 const raw={id:runId,modelId:"fixture",testConnection:async()=>({ok:true as const,model:"fixture"}),generateStructured:async<T,>(request:StructuredAIRequest<T>)=>{
  const data=JSON.parse(request.prompt);
  if(data.presentation==="wiki_topic_plan"){
   plans++;return request.validate({scope:[], pages:[{title:"保存规则",subtopics:["授权","失败保护"].map(title=>({title,sectionIds:data.sections.map((item:{id:string})=>item.id)}))}]});
  }
  if(!data.coverage.final){reads++;return request.validate({title:"笔记",sections:[{title:"保存规则",body:"只有确认后才能保存，失败时保留原文。",kind:"finding",transition:"",evidenceIds:data.passages.map((item:{id:string})=>item.id)}]});}
  const completing=request.system.includes("TARGETED COMPLETION");
  if(completing){completions++;if(timeout){timeout=false;throw new AIProviderResponseError("PROVIDER_TIMEOUT");}}
  else{initial++;initialRequest={system:request.system,prompt:request.prompt};}
  expect(request.system.includes(WIKI_EDITORIAL_PASS)).toBe(legacy&&(oldEdition===2||oldEdition===3||oldEdition===4));
  expect(request.system.includes(WIKI_QUALITY_INSTRUCTIONS)).toBe(!legacy);
  expect(request.system.includes(WIKI_CLAIM_LIMIT_INSTRUCTIONS)).toBe(!legacy||oldEdition!==undefined&&oldEdition>=3);
  expect(request.system.includes(WIKI_READER_STATUS_INSTRUCTIONS)).toBe(legacy&&(oldEdition===4||oldEdition===5));
  expect(request.system.includes(CURRENT_WIKI_READER_STATUS_INSTRUCTIONS)).toBe(!legacy);
  return request.validate({title:"保存规则",sections:data.wikiTopics.map((topic:{ownerId:string;title:string;subtopics:Array<{title:string}>})=>({title:topic.title,wikiOwnerId:topic.ownerId,kind:"finding",transition:"",body:topic.subtopics.slice(0,completing?undefined:1).map(child=>`## ${child.title}\n\n只有确认后才能保存，失败时保留原文。`).join("\n\n"),evidenceIds:data.passages.map((item:{id:string})=>item.id)}))});
 }};
 const ai=createAtlasAIFromProvider(raw,{id:"ai-settings",provider:"openai",model:"fixture",baseUrl:"https://fixture.invalid",apiKey:"fixture",updatedAt:1});
 const run=()=>synthesizeCoveredFocus({goal:"复习保存规则",mode:"work",locale:"zh-CN",sources:[source],passages,ai,collectProjectKnowledge:true,signal:new AbortController().signal,validate:validateFocusResult});
 await expect(run()).rejects.toMatchObject({code:"PROVIDER_TIMEOUT"});
 const entries=(await db.getAll("semanticDecisionCache")).filter(row=>!beforeIds.has(row.id));
 const composition=entries.find(row=>row.id.includes(":composition-editorial-v16:"))!;
 const saved=composition.result as {current:CoverageMaterial[];writingEdition?:number};expect(saved.writingEdition).toBe(7);
 const writing=entries.find(row=>row.id.includes(":writing:"))!;
 const ledger=createWikiPlanningCheckpoints(()=>ai.getAnalysisKey!(),new AbortController().signal);
 // Model an actual pre-upgrade ledger: the same validated draft was written
 // under the legacy policy, without an edition field. No provider cache needed.
 if(oldEdition===undefined)delete saved.writingEdition;else saved.writingEdition=oldEdition;
 await db.put("semanticDecisionCache",composition);
 const oldId=await ledger.key("writing",[initialRequest!.system.replace(WIKI_COMPOSITION_INSTRUCTIONS,oldEdition===6?EDITION6_WIKI_COMPOSITION_INSTRUCTIONS:oldEdition===5?EDITION5_WIKI_COMPOSITION_INSTRUCTIONS:oldEdition===4?EDITION4_WIKI_COMPOSITION_INSTRUCTIONS:LEGACY_WIKI_COMPOSITION_INSTRUCTIONS+(oldEdition===3?WIKI_EDITORIAL_PASS+WIKI_CLAIM_LIMIT_INSTRUCTIONS:oldEdition===2?WIKI_EDITORIAL_PASS:oldEdition===1?WIKI_EDITORIAL_PASS_V4:"")),initialRequest!.prompt,saved.current]);
 await ledger.write(oldId,writing.result);await db.delete("semanticDecisionCache",writing.id);
 for(const row of entries)if(!row.providerId.startsWith("focus-"))await db.delete("semanticDecisionCache",row.id);
 legacy=true;const result=await run();
 expect({reads,plans,initial,completions}).toEqual({reads:1,plans:1,initial:1,completions:2});
 expect(result.result.sections[0].body.match(/^## /gmu)).toHaveLength(2);
});
