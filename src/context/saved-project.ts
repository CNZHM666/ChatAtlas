import {projectIntroduction,projectKnowledgeView,projectKnowledgeSection} from "../shared/project-knowledge-view";
import { estimateTokens } from "../shared/atlas/policy.js";
import { wikiSections } from "../shared/wiki-navigation";
import { projectMatters } from "../shared/project-matters";
import {evolutionRecords} from "../shared/product-evolution";
import {generatedProse} from "../shared/generated-structure-prose";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { queryTerms } from "../search/query";
import {projectSnapshot} from "../shared/project-snapshot";
import {projectOverviewContent} from "../shared/project-overview";
import { formatContext } from "./format";
import { contextBudgets, contextProfiles, type ContextBundle, type ContextItem, type ContextOptions, type ContextSectionKind, type ProjectKnowledge } from "./types";

const normalize=(value:string)=>value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu," ").trim();
const stop=new Set(["继续","开发","优化","完善","项目","功能","任务","调整","实现","修改","配置","相关","continue","develop","improve","project","task"]);

/** Consume saved knowledge verbatim. Raw messages only validate provenance;
 * they never become a second source of generated plans or a replacement Wiki. */
export function buildSavedProjectContext(knowledge:ProjectKnowledge,options:ContextOptions):ContextBundle {
 const {session}=knowledge,enabled=new Set(options.sections),profile=contextProfiles[options.length];
 const terms=[...new Set(queryTerms(options.task).filter(term=>!stop.has(term)&&term.length>1))];
 const score=(text:string)=>{const value=normalize(text),words=new Set(value.match(/[a-z0-9+#._-]+/gu)??[]);return terms.reduce((sum,term)=>sum+Number(/^[a-z0-9+#._-]+$/u.test(term)?words.has(term):value.includes(term)),0);};
 const kinds:ContextSectionKind[]=["overview","wiki","decisions","progress","next","history","evidence"];
 const selection=Object.fromEntries(kinds.map(kind=>[kind,{available:0,matching:0,included:0}])) as ContextBundle["selection"];
 const omissions={unsupported:0,duplicate:0,relevance:0,depth:0,budget:0,disabled:0};
 const bundle:ContextBundle={schemaVersion:1,id:`saved-context:${session.id}`,projectId:session.id,projectName:session.title,task:options.task,generatedAt:Date.now(),locale:options.zh?"zh-CN":"en",sections:[],sources:[],knowledgeSignature:knowledge.signature,tokenBudget:Number.isFinite(options.tokenBudget)?Math.max(256,Math.min(60000,options.tokenBudget!)):contextBudgets[options.length],estimatedTokens:0,tokenCountKind:"estimate",basis:"saved",knowledgeUpdatedAt:session.updatedAt,purpose:options.task.trim()?"task":"overview",length:options.length,requestedSections:[...options.sections],selection,omissions,omittedItems:0,invalidSources:0,supersededItems:0,sourcesStale:knowledge.sourcesStale};
 if(options.requirements)bundle.requirements={...options.requirements};
 const messages=new Map(knowledge.messages.map(message=>[JSON.stringify([message.conversationId,message.id]),message]));
 const conversations=new Map(knowledge.conversations.map(conversation=>[conversation.id,conversation]));
 const signatures=new Map<string,string>();
 const references=new Map([...session.evidence,...session.projectEvolutionAnalysis?.evidence??[],...session.projectHistoryAnalysis?.evidence??[]].map(ref=>[ref.id,ref]));
 const sourceIds=(evidenceIds:string[])=>[...new Set(evidenceIds.flatMap(id=>{
  const ref=references.get(id);if(!ref)return [];
  const messageKey=JSON.stringify([ref.conversationId,ref.messageId]);
  const message=messages.get(messageKey),conversation=conversations.get(ref.conversationId);
  const signature=message?(signatures.get(messageKey)??sourceMessageSignature(message.content)):undefined;
  if(signature)signatures.set(messageKey,signature);
  const expected=ref.sourceSignature??session.sourceSignatures?.[ref.conversationId]?.[ref.messageId];
  const inScope=session.sourceConversationIds.includes(ref.conversationId)&&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===ref.conversationId&&block.messageIds.includes(ref.messageId)));
  const role=session.sourceRoles?.[ref.conversationId]?.[ref.messageId];
  if(!message||!conversation||!inScope||expected&&signature!==expected||role&&role!==message.role||!wikiQuoteRange(message.content,ref.excerpt)){bundle.invalidSources++;bundle.sourcesStale=true;return [];}
  const key=JSON.stringify([ref.conversationId,ref.messageId]);
  const existing=bundle.sources.find(source=>source.id===key);
  if(existing){if(!existing.evidenceIds.includes(id))existing.evidenceIds.push(id);}
  else bundle.sources.push({id:key,evidenceIds:[id],conversationId:ref.conversationId,messageId:ref.messageId,title:conversation.title,signature:signature!,updatedAt:message.updatedAt,role:message.role,messageIndex:message.messageIndex,...(/^https?:\/\//u.test(conversation.url)?{url:conversation.url}:{})});
  return [key];
 }))];
 const selected=new Map<ContextSectionKind,ContextItem[]>();
 const sync=()=>{bundle.sections=kinds.flatMap(kind=>{const items=selected.get(kind);return items?.length?[{kind,items}]:[];});};
 const add=(kind:ContextSectionKind,item:ContextItem,evidenceIds:string[]=[],explicit=false)=>{
  selection[kind].available++;
  if(!enabled.has(kind)){omissions.disabled++;return false;}
  selection[kind].matching++;
  const previous=selected.get(kind)??[];
  if(previous.some(row=>normalize(row.text)===normalize(item.text))){omissions.duplicate++;return false;}
  const oldSources=bundle.sources.map(source=>({...source,evidenceIds:[...source.evidenceIds]})),oldInvalid=bundle.invalidSources,oldStale=bundle.sourcesStale;
  item.sourceIds=[...new Set([...item.sourceIds,...sourceIds(evidenceIds)])];
  selected.set(kind,[...previous,item]);sync();
  if(!explicit&&estimateTokens(formatContext(bundle))>bundle.tokenBudget){selected.set(kind,previous);bundle.sources=oldSources;bundle.invalidSources=oldInvalid;bundle.sourcesStale=oldStale;sync();omissions.budget++;return false;}
  selection[kind].included++;return true;
 };
 const view=projectKnowledgeView(session),introduction=projectIntroduction(session),overview=projectOverviewContent(session),brief=overview.text;
 if(brief.trim())add("overview",{id:"summary",text:brief,status:introduction.source==="personal"?"personal":"background",sourceIds:[],updatedAt:session.updatedAt,literal:true},overview.evidenceIds,true);
 else if(session.goal.trim())add("overview",{id:"goal",text:`${options.zh?"原始整理目标":"Original organization goal"}: ${session.goal}`,status:"personal",sourceIds:[],updatedAt:session.updatedAt,literal:true},[],true);
 const representedQuestions=new Set<string>();
 for(const [index,block] of projectSnapshot(session).entries()){
  if(block.role!=="questions")continue;
  if(options.task.trim()&&!score(block.text)&&!["constraint","scope","status"].includes(block.role))continue;
  const qualifier=block.status==="proposal"&&!/建议|提议|proposal|suggest/iu.test(block.text)?options.zh?"讨论建议：":"Proposed in discussion: ":block.status==="planned"&&!/计划|planned/iu.test(block.text)?options.zh?"计划：":"Planned: ":block.status==="reported"&&!/报告|reported/iu.test(block.text)?options.zh?"用户报告：":"User reported: ":"";
  const text=(block.role==="questions"?options.zh?"尚未解决：":"Unresolved: ":qualifier)+block.text;
  if(add("next",{id:`snapshot:${index}`,text,status:"open",sourceIds:[],updatedAt:session.updatedAt,literal:true,...(knowledge.sourcesStale?{currency:"unreviewed" as const}:{})},block.evidenceIds))representedQuestions.add(normalize(block.text));
 }
 const pages=wikiSections(session).map(page=>page.userEdited||page.origin==="user"?page:{...page,body:generatedProse(projectKnowledgeSection(page,session,view).body,session.evidence.filter(ref=>page.evidenceIds.includes(ref.id)).map(ref=>ref.excerpt)).body}).filter(page=>page.body.trim());
 const explicit=options.wikiSectionIds!==undefined||options.mode==="full";
 const chosen=new Set(options.wikiSectionIds??(options.mode==="full"?pages.map(page=>page.id):[]));
 const ranked=pages.map((page,index)=>({page,index,score:score(page.title)*6+score(page.body.match(/^#{1,6}\s+.+$/gmu)?.join("\n")??"")*3+score(page.body)})).sort((a,b)=>b.score-a.score||a.index-b.index);
 let pageCount=0;const seenPages=new Map<string,ContextItem>();
 for(const row of ranked){
  const {page}=row;
  if(explicit&&!chosen.has(page.id)){selection.wiki.available++;omissions.disabled++;continue;}
  if(!explicit&&options.task.trim()&&!row.score){selection.wiki.available++;omissions.relevance++;continue;}
  const repeated=seenPages.get(normalize(page.body));
  if(!explicit&&repeated){selection.wiki.available++;selection.wiki.matching++;omissions.duplicate++;repeated.sourceIds=[...new Set([...repeated.sourceIds,...sourceIds(page.evidenceIds)])];continue;}
  if(!explicit&&pageCount>=profile.wikiPages){selection.wiki.available++;selection.wiki.matching++;omissions.depth++;continue;}
  const text=`### ${page.wikiDisplayTitle??page.title}\n\n${page.body}`;
  const item:ContextItem={id:`wiki:${page.id}`,text,status:page.origin==="user"||page.userEdited?"personal":page.kind==="proposal"?"proposal":"background",sourceIds:[],updatedAt:session.updatedAt,literal:true,...(knowledge.sourcesStale||page.reviewIssue||page.evidenceReview?.invalidClaims?{currency:"unreviewed" as const}:{})};
  if(add("wiki",item,page.evidenceIds,explicit)){pageCount++;seenPages.set(normalize(page.body),item);}
 }
 // Restore the user's Wiki order after relevance has selected whole chapters.
 selected.get("wiki")?.sort((a,b)=>pages.findIndex(page=>`wiki:${page.id}`===a.id)-pages.findIndex(page=>`wiki:${page.id}`===b.id));sync();
 const inWiki=(text:string)=>selected.get("wiki")?.some(item=>normalize(item.text).includes(normalize(text)));
 for(const module of Object.values(session.projectMaintenance?.modules??{})){
  const text=[module.title,module.purpose,module.inputs?.length?`${options.zh?"输入":"Inputs"}: ${module.inputs.join("、")}`:"",module.outputs?.length?`${options.zh?"输出":"Outputs"}: ${module.outputs.join("、")}`:""].filter(Boolean).join("\n\n");
  if(options.task.trim()&&!score(text)){selection.decisions.available++;omissions.relevance++;continue;}
  if(inWiki(text)){selection.decisions.available++;omissions.duplicate++;continue;}
  add("decisions",{id:`personal:module:${module.id}`,text,status:"personal",sourceIds:[],updatedAt:session.updatedAt,literal:true});
 }
 for(const matter of projectMatters(session)){
  if(matter.status==="dismissed")continue;
  if(matter.status==="open"&&!view.questions.some(question=>question.id===matter.id&&question.type===matter.type)&&!matter.personal)continue;
  if(matter.status==="open"&&representedQuestions.has(normalize(matter.text))){omissions.duplicate++;continue;}
  const kind=matter.type==="question"?matter.status==="resolved"?"progress":"next":"decisions";
  if(matter.type!=="question"&&matter.status!=="resolved"&&!matter.personal)continue;
  const text=[matter.text,matter.resolution,matter.resolutionReason].filter(Boolean).join("\n\n");
  if(options.task.trim()&&!score(text)){selection[kind].available++;omissions.relevance++;continue;}
  if(inWiki(text)){selection[kind].available++;omissions.duplicate++;continue;}
  if((selected.get(kind)?.length??0)>=profile.limits[kind]){selection[kind].available++;omissions.depth++;continue;}
  add(kind,{id:`matter:${matter.type}:${matter.id}`,text,status:matter.personal?"personal":matter.status==="resolved"?"confirmed":"open",sourceIds:[],updatedAt:matter.updatedAt??session.updatedAt,literal:true},matter.sources.map(source=>source.id));
 }
 for(const [id,action] of Object.entries(session.projectMaintenance?.actions??{})){
  if(options.task.trim()&&!score(action.text))continue;
  const kind=action.done?"progress":"next";
  if(inWiki(action.text)){selection[kind].available++;omissions.duplicate++;continue;}
  add(kind,{id:`action:${id}`,text:action.text,status:action.done?"reported":"planned",sourceIds:[],updatedAt:session.updatedAt,literal:true});
 }
 for(const record of evolutionRecords(session)){
  if(record.hidden)continue;
  const event=record.event,text=[event.title,event.before?`${options.zh?"此前":"Before"}: ${event.before}`:"",event.after,event.reason].filter(Boolean).join("\n\n");
  if(options.task.trim()&&!score(text)){selection.history.available++;omissions.relevance++;continue;}
  if((selected.get("history")?.length??0)>=profile.limits.history){selection.history.available++;omissions.depth++;continue;}
  add("history",{id:`evolution:${record.id}`,text,status:record.personal?"personal":event.status==="proposal"?"proposal":"recorded",sourceIds:[],updatedAt:session.updatedAt,literal:true,...(record.sourceStale?{currency:"unreviewed" as const}:{})},record.sources.map(source=>source.id));
 }
 if(enabled.has("evidence"))for(const source of [...bundle.sources]){
  const message=messages.get(JSON.stringify([source.conversationId,source.messageId]))!;
  const refs=source.evidenceIds.flatMap(id=>{const ref=references.get(id),range=ref&&wikiQuoteRange(message.content,ref.excerpt);return range?[message.content.slice(range.start,range.end)]:[];});
  if(refs.length)add("evidence",{id:`original:${source.id}`,text:[...new Set(refs)].join("\n\n"),status:"recorded",sourceIds:[source.id],updatedAt:source.updatedAt,literal:true});
 }
 bundle.taskEvidenceMatched=!options.task.trim()||Boolean(selection.wiki.included||selection.decisions.included||selection.next.included);
 const used=new Set(bundle.sections.flatMap(section=>section.items.flatMap(item=>item.sourceIds))),sourceOrder=[...used];bundle.sources=bundle.sources.filter(source=>used.has(source.id)).sort((a,b)=>sourceOrder.indexOf(a.id)-sourceOrder.indexOf(b.id));
 bundle.omittedItems=Object.values(omissions).reduce((sum,count)=>sum+count,0);bundle.estimatedTokens=estimateTokens(formatContext(bundle));
 return bundle;
}
