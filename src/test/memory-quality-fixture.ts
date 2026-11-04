import {sourceMessageSignature} from "../shared/source-signature";
import {projectStateSignature} from "../shared/project-state";
import {projectHistorySignature, projectHistorySourceSignature} from "../shared/project-history";
import type {ProjectKnowledge,ContextOptions} from "../context/types";
import type {ConversationMessage} from "../shared/types";

export const memoryQualityOptions:ContextOptions={zh:true,task:"",mode:"full",length:"detailed",sections:["overview","decisions","progress","next","wiki","history"]};
/** Synthetic two-platform project; deliberately includes misleading generated prose. */
export function memoryQualityFixture():ProjectKnowledge {
 const rows:Array<[string,string,"user"|"assistant",string,number]>=[
  ["design","preference","user","我喜欢使用卡片式首页这种设计，但还没有正式定案。",0],
  ["design","suggestion","assistant","建议将卡片式首页确定为新手设计基准。",1],
  ["design","prompt","user","给我按照这一套设计一个提示词。",2],
  ["search","storage","user","我决定采用 IndexedDB 保存原始消息，不自动上传聊天。",0],
  ["search","options","assistant","方案一：只做 Orama 全文检索。\n方案二：保留 Orama 全文检索，增加可选语义召回。",1],
  ["search","approval","user","就按第二种。",2],
  ["search","report","user","我已经完成搜索界面的 UI，索引更新仍未开发，测试尚未执行。",3],
  ["search","ai-model","assistant","建议未来考虑 Transformers.js，目前没有做选型决定。",4],
 ];
 const messages:ConversationMessage[]=rows.map(([conversationId,id,role,content,messageIndex],index)=>({id,conversationId,role,content,messageIndex,preview:content,contentHash:sourceMessageSignature(content),createdAt:1700000000000+index*1000,updatedAt:1700000000000+index*1000}));
 const evidence=messages.filter(message=>message.id!=="approval").map(message=>({id:`e:${message.id}`,conversationId:message.conversationId,messageId:message.id,title:"项目讨论",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
 const session:ProjectKnowledge["session"]={id:"beacon-memory",mode:"work",title:"Beacon 学习工作区",goal:"帮助学习者恢复项目理解",locale:"zh-CN",createdAt:1,updatedAt:1700000100000,activeSectionId:"position",completedSectionIds:[],notes:"",sourceConversationIds:["design","search"],sourceSignatures:Object.fromEntries(["design","search"].map(id=>[id,Object.fromEntries(messages.filter(message=>message.conversationId===id).map(message=>[message.id,sourceMessageSignature(message.content)]))])),sourceRoles:Object.fromEntries(["design","search"].map(id=>[id,Object.fromEntries(messages.filter(message=>message.conversationId===id).map(message=>[message.id,message.role]))])),sourceMessageOrder:Object.fromEntries(["design","search"].map(id=>[id,messages.filter(message=>message.conversationId===id).map(message=>message.id)])),evidence,
 brief:{summary:"Beacon 帮助学习者恢复项目理解。",turningPoints:[],confirmed:[],openQuestions:[]},
 sections:[
  {id:"position",title:"界面方向",kind:"finding",transition:"",body:"团队确认了卡片式首页作为正式设计基准。",evidenceIds:["e:preference","e:suggestion"],claims:[{text:"团队确认了卡片式首页作为正式设计基准。",quote:messages[0].content,evidenceIds:["e:preference"],verification:"supported",overviewRole:"decision"}]},
  {id:"architecture",title:"技术选型",kind:"finding",transition:"",body:"经过多轮评估，最终确定 Transformers.js。",evidenceIds:["e:ai-model"]},
  {id:"work",title:"搜索进度",kind:"finding",transition:"",body:"搜索界面的 UI 已完成，索引更新仍未开发，测试尚未执行。",evidenceIds:["e:report"],claims:[{text:"搜索界面的 UI 已完成，索引更新仍未开发，测试尚未执行。",quote:messages.find(message=>message.id==="report")!.content,evidenceIds:["e:report"],overviewRole:"progress",workStatus:"reported"}]},
 ],
 projectState:{signature:"",generatedAt:1,basis:"organized",verification:"original",summary:"Beacon 项目",modules:[],relations:[],constraints:[],actions:[],decisions:[
  {id:"choice:layout",text:"团队确认了卡片式首页作为正式设计基准。",quote:messages[0].content,evidenceIds:["e:preference"],reason:"",status:"documented"},
  {id:"choice:storage",text:"采用 IndexedDB 保存原始消息，不自动上传聊天。",quote:messages.find(message=>message.id==="storage")!.content,evidenceIds:["e:storage"],reason:"",status:"documented"},
  {id:"choice:search",text:"保留 Orama 全文检索，增加可选语义召回。",quote:"保留 Orama 全文检索，增加可选语义召回。",evidenceIds:["e:options"],reason:"",status:"documented"},
 ]}};
 session.projectState!.signature=projectStateSignature(session);
 // A previous extraction incorrectly promoted preference to a confirmed event.
 session.projectEvolutionAnalysis={version:6,kind:"evolution",signature:"",sourceSignature:"",generatedAt:1,evidence,sources:messages.map(message=>({id:`e:${message.id}`,conversationId:message.conversationId,messageId:message.id,role:message.role,signature:sourceMessageSignature(message.content),messageIndex:message.messageIndex,discussedAt:message.createdAt})),events:[{id:"layout-event",title:"首页决定",area:"首页",recordKind:"event",status:"documented",changeKind:"adopt",decisionStatus:"confirmed",version:"",before:"",after:"团队确认了卡片式首页作为正式设计基准。",reason:"",quote:"我喜欢使用卡片式首页这种设计",evidenceIds:["e:preference"],beforeQuote:"",beforeEvidenceIds:[]}]};
 session.projectEvolutionAnalysis!.signature=projectHistorySignature(session);
 session.projectEvolutionAnalysis!.sourceSignature=projectHistorySourceSignature(session,messages);
 return {session,messages,conversations:[{id:"design",title:"设计讨论",platform:"chatgpt",url:"https://chatgpt.com/c/synthetic-design",updatedAt:1,messageCount:3},{id:"search",title:"搜索实现",platform:"claude",url:"https://claude.ai/chat/synthetic-search",updatedAt:2,messageCount:5}],signature:"synthetic",sourcesStale:false};
}

export function longMemoryHistoryFixture(){
 const session=memoryQualityFixture().session;session.id="cedar-history";session.title="Cedar 研究笔记";session.projectState=undefined;session.projectEvolutionAnalysis=undefined;session.sections=[];session.sourceConversationIds=["alpha","beta","gamma"];session.evidence=[];
 const messages:ConversationMessage[]=[],critical:string[]=[];
 for(const conversationId of session.sourceConversationIds){
  const append=(id:string,content:string,role:ConversationMessage["role"],messageIndex:number)=>messages.push({id,conversationId,content,role,messageIndex,createdAt:1700000000000+messageIndex*1000,updatedAt:1,contentHash:"",preview:""});
  for(let index=0;index<120;index++)append(`${conversationId}:noise:${index}`,"普通学习笔记："+"这段内容解释数学概念及其推导，并记录课堂上的例子。".repeat(12),"assistant",index);
  const turns=["建议采用 Quartz 本地缓存。","可以","建议选择：\n方案一：仅本地阅读。\n方案二：本地阅读加按需导出。","就按第二种。","先不改了，继续沿用现有方案。","不做了"];
  turns.forEach((content,index)=>{const id=`${conversationId}:critical:${index}`;critical.push(id);append(id,content,index===0||index===2?"assistant":"user",120+index);});
 }
 session.sourceMessageOrder=Object.fromEntries(session.sourceConversationIds.map(id=>[id,messages.filter(message=>message.conversationId===id).map(message=>message.id)]));
 session.sourceSignatures=Object.fromEntries(session.sourceConversationIds.map(id=>[id,Object.fromEntries(messages.filter(message=>message.conversationId===id).map(message=>[message.id,sourceMessageSignature(message.content)]))]));
 session.sourceRoles=Object.fromEntries(session.sourceConversationIds.map(id=>[id,Object.fromEntries(messages.filter(message=>message.conversationId===id).map(message=>[message.id,message.role]))]));
 return {session,messages,critical};
}
