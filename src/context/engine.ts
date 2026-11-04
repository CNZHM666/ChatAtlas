import { retainedProjectKnowledge } from "../shared/retained-project-knowledge";
import {buildSavedProjectContext} from "./saved-project";
import {generatedContextContent,historicalMarketJudgment,nestedWikiHeadings} from "./generated-content";
import {originalArchitecture} from "./architecture";
import { readProjectAssertion, overstatesProjectEvidence } from "../shared/project-assertion";
import { referenceEvidence,statementEvidence } from "../shared/statement-evidence";
import { equivalentContextText } from "./content-equivalence";
import { boundaryEvidence, boundaryScope, proposalEvidence } from "./boundary-evidence";
import { usableWikiClaim } from "../shared/wiki-review";
import { linkedMatterKnowledge } from "../shared/project-knowledge-links";
import { projectFactState } from "../shared/project-fact-state";
import { estimateTokens } from "../shared/atlas/policy.js";
import { evolutionRecords, evolutionAnalysis, evolutionWorkLabels } from "../shared/product-evolution";
import { projectMatters } from "../shared/project-matters";
import { sourceQuestions } from "../shared/source-question";
import { projectStateModel, projectQuestionItems } from "../shared/project-state";
import { sourceMessageSignature } from "../shared/source-signature";
import { wikiQuoteRange } from "../shared/wiki-claims";
import { discussionBlocks } from "../shared/discussion-context";
import { evidencePresentation } from "../shared/evidence-presentation";
import { queryTerms } from "../search/query";
import {subjectQueryVariants} from "../search/subject-query";
import {projectSubjectGroups,projectSubjectKey} from "../shared/project-subjects";
import { effectiveProjectEvolution, evolutionStateKey } from "../shared/project-evolution";
import { productReleaseEvents } from "../shared/product-releases";
import { formatContext } from "./format";
import { relatedSourceExcerpt } from "./source-excerpts";
import { contextBudgets, contextProfiles, type ContextBundle, type ContextItem, type ContextOptions, type ContextSectionKind, type ContextSource, type ContextStatus, type ProjectKnowledge } from "./types";

const normalized = (text: string) => text.normalize("NFKC").toLowerCase().replace(/\s+/gu, " ").trim();
const clean = (text: string) => evidencePresentation(text).trim();
interface Candidate extends ContextItem { kind: ContextSectionKind; priority: number; relevance: number; dedupKey: string; family?: "module" | "relation"; group?: string; required?: boolean; globalBoundary?: boolean }
const essentialCondition = (text:string) => /不能|不得|必须|禁止|始终|仅限|不自动|不覆盖|must|never|only|without|do not/iu.test(text);

/** Rules only: no model, network, writes, embedding or interpretation of instructions inside references. */
export function buildProjectContext(knowledge: ProjectKnowledge, options: ContextOptions): ContextBundle {
  if(options.basis==="saved")return buildSavedProjectContext(knowledge,options);
  const { session } = knowledge, zh = options.zh, l = (cn: string, en: string) => zh ? cn : en, profile=contextProfiles[options.length];
  const retained=retainedProjectKnowledge(session,knowledge.messages);
  const model = projectStateModel(session), stale = knowledge.sourcesStale || Boolean(model?.stale||model?.decisionsStale||model?.architectureStale);
  const enabled = new Set(options.sections), messages = new Map(knowledge.messages.map(message => [message.id, message]));
  const questions=sourceQuestions(knowledge.messages.filter(message=>session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===message.conversationId&&block.messageIds.includes(message.id))));
  const pool = new Set(session.sourceConversationIds), validSources = new Map<string, ContextSource>();
  const refs = new Map<string, string>();
  let invalidSources = 0, supersededItems = 0, omittedItems = 0;
  const omissions={unsupported:0,duplicate:0,relevance:0,depth:0,budget:0,disabled:0};
  const omit=(reason:"unsupported"|"relevance"|"depth"|"budget")=>{omittedItems++;omissions[reason]++;};
  const panorama=!options.task.trim();
  const effective = effectiveProjectEvolution(session, knowledge.messages);
  const factState = projectFactState(session, effective);
  const timeline=evolutionRecords(session);
  const subjects=projectSubjectGroups(timeline.filter(record=>!record.personal&&!record.hidden&&!record.sourceStale).map(record=>record.event));
  const historyEvidence = [...effective.flatMap(item => item.evidence),...timeline.flatMap(item=>item.sources)];
  // Approval context is read from the scoped original turn, never manufactured by a model.
  // These transient references do not change stored evidence or user content.
  const scopedOriginals=knowledge.messages.filter(message=>pool.has(message.conversationId)&&(session.scope?.kind!=="goal"||session.scope.blocks?.some(block=>block.conversationId===message.conversationId&&block.messageIds.includes(message.id))));
  const architecture=originalArchitecture(scopedOriginals.filter(message=>session.sourceSignatures?.[message.conversationId]?.[message.id]===sourceMessageSignature(message.content)&&session.sourceRoles?.[message.conversationId]?.[message.id]===message.role));
  const modules=[...model?.modules??[],...retained.modules.filter(module=>!model?.modules.some(current=>current.title===module.title&&current.purpose===module.purpose)),...architecture.modules.filter(module=>![...model?.modules??[],...retained.modules].some(current=>current.title===module.title))];
  const aliases=new Map([...retained.modules,...architecture.modules].flatMap(module=>{const canonical=modules.find(item=>item.id===module.id)??modules.find(item=>item.title===module.title&&item.purpose===module.purpose);return canonical?[[module.id,canonical.id] as const]:[];}));
  const relations=[...model?.relations??[],...[...retained.relations,...architecture.relations].map(edge=>({...edge,from:aliases.get(edge.from)??edge.from,to:aliases.get(edge.to)??edge.to}))];
  const citedPositions=new Set(session.evidence.flatMap(ref=>{const message=messages.get(ref.messageId);return message?[JSON.stringify([ref.conversationId,message.messageIndex])]:[];}));
  const citedMessages=new Set(session.evidence.map(ref=>JSON.stringify([ref.conversationId,ref.messageId])));
  const contextEvidence=scopedOriginals.filter(message=>session.sourceSignatures?.[message.conversationId]?.[message.id]===sourceMessageSignature(message.content)&&session.sourceRoles?.[message.conversationId]?.[message.id]===message.role&&(citedPositions.has(JSON.stringify([message.conversationId,message.messageIndex-1]))||Boolean(message.replyToMessageId&&citedMessages.has(JSON.stringify([message.conversationId,message.replyToMessageId]))))).map(message=>({id:`context-original:${JSON.stringify([message.conversationId,message.id])}`,conversationId:message.conversationId,messageId:message.id,title:"",excerpt:message.content,sourceSignature:sourceMessageSignature(message.content)}));
  for (const ref of [...session.evidence, ...historyEvidence,...contextEvidence,...architecture.evidence]) {
    const message = messages.get(ref.messageId), conversation = knowledge.conversations.find(item => item.id === ref.conversationId);
    const savedSource = [...(session.projectState?.sources ?? []), ...(session.projectHistoryAnalysis?.sources ?? []),...(session.projectEvolutionAnalysis?.sources??[])].find(item => item.conversationId === ref.conversationId && item.messageId === ref.messageId);
    const expected = ref.sourceSignature ?? session.sourceSignatures?.[ref.conversationId]?.[ref.messageId] ?? savedSource?.signature
      ?? session.scope?.blocks?.find(block => block.conversationId === ref.conversationId)?.messageSignatures[ref.messageId];
    const role = savedSource?.role ?? session.sourceRoles?.[ref.conversationId]?.[ref.messageId];
    if (!message || !conversation || !pool.has(ref.conversationId) || message.conversationId !== ref.conversationId ||
      session.scope?.kind === "goal" && !session.scope.blocks?.some(block => block.conversationId === ref.conversationId && block.messageIds.includes(ref.messageId)) ||
      expected && expected !== sourceMessageSignature(message.content) || role && role !== message.role || !Number.isFinite(message.updatedAt) || !wikiQuoteRange(message.content, ref.excerpt)) { invalidSources++; continue; }
    const id = JSON.stringify([ref.conversationId, ref.messageId]);
    const existing = validSources.get(id);
    const range = wikiQuoteRange(message.content, ref.excerpt)!;
    const excerpt = message.content.slice(range.start, range.end);
    if (existing) { existing.evidenceIds.push(ref.id); existing.excerpts = [...new Set([...(existing.excerpts ?? []), excerpt])]; }
    else validSources.set(id, { id, evidenceIds: [ref.id], conversationId: ref.conversationId, messageId: ref.messageId,
      excerpts: [excerpt], question: questions.get(message.id), title: conversation.title.replace(/\s+/gu, " ").slice(0, 120), role: message.role, updatedAt: message.updatedAt, messageIndex:message.messageIndex,
      signature: sourceMessageSignature(message.content), ...(/^https?:\/\/[^\s]+$/iu.test(conversation.url) ? { url: conversation.url } : {}) });
    refs.set(ref.id, id);
  }
  const originalQuote = (evidenceId: string, quote: string) => {
    const sourceId = refs.get(evidenceId), source = sourceId && validSources.get(sourceId);
    const message = source && messages.get(source.messageId), range = message && wikiQuoteRange(message.content, quote);
    return range && message ? { sourceId: sourceId!, text: message.content.slice(range.start, range.end) } : undefined;
  };
  const proofFor=(item:{quote:string;evidenceIds:string[]})=>item.evidenceIds.flatMap(id=>{const quote=originalQuote(id,item.quote);if(!quote)return [];const source=validSources.get(quote.sourceId)!;const message=messages.get(source.messageId)!;return [{id,quote,source,message,intent:statementEvidence(message.content,item.quote)}];});
  const approvalContext=new Map<string,typeof scopedOriginals>();
  for(const message of scopedOriginals.filter(message=>message.role==="user"&&validSources.has(JSON.stringify([message.conversationId,message.id]))))for(const key of [JSON.stringify([message.conversationId,message.messageIndex-1]),...(message.replyToMessageId?[JSON.stringify([message.conversationId,message.replyToMessageId])]:[])])approvalContext.set(key,[...approvalContext.get(key)??[],message]);
  const readAssertion=(proofs:ReturnType<typeof proofFor>)=>readProjectAssertion(proofs.map(proof=>({message:proof.message,quote:proof.quote.text})),proofs.flatMap(proof=>[...approvalContext.get(JSON.stringify([proof.message.conversationId,proof.message.messageIndex]))??[],...approvalContext.get(JSON.stringify([proof.message.conversationId,proof.message.id]))??[]]));
  const confirmationProofs=(reading:ReturnType<typeof readAssertion>,proofs:ReturnType<typeof proofFor>=[])=>{
    if(!reading.confirmation)return [];
    const approval=contextEvidence.filter(ref=>ref.conversationId===reading.confirmation!.message.conversationId&&ref.messageId===reading.confirmation!.message.id).slice(0,1).flatMap(ref=>proofFor({quote:reading.confirmation!.quote,evidenceIds:[ref.id]}));
    const antecedents=proofs.filter(proof=>proof.source.role==="assistant"&&proof.message.conversationId===reading.confirmation!.message.conversationId).flatMap(proof=>{
      const quote=proposalEvidence(proof.message.content,proof.quote.text);
      return proofFor({quote,evidenceIds:[proof.id]});
    });
    return [...antecedents,...approval];
  };
  const generatedText=(text:string,status:ContextStatus,proofs:ReturnType<typeof proofFor>)=>{
    if(status==="preference"||status==="reported"||status==="planned")return proofs.filter(proof=>proof.source.role==="user").map(proof=>proof.quote.text).join("\n\n")||text;
    if(overstatesProjectEvidence(text,status))return proofs.length?l("证据不足以支持原摘要的确认或验证表述。原始讨论：","Evidence does not support the summary's approval or verification claim. Original discussion:")+"\n\n"+proofs.map(proof=>proof.quote.text).join("\n\n"):l("此记录缺少确认或验证依据。","This record lacks approval or verification evidence.");
    return text;
  };
  const projectTerms = new Set(queryTerms(session.title));
  // The selected project is already the scope. Its name cannot make every Wiki page task-relevant.
  const taskTerms = subjectQueryVariants(options.task,subjects).map(task=>queryTerms(task).filter(term => !projectTerms.has(term) && !["ai", "项目", "开发", "继续", "我要", "进行", "修改", "调整", "优化", "完善", "实现", "增加", "修复", "功能", "任务","与","和","及","或","关于","配置"].includes(term)));
  const terms=taskTerms[0];
  const relevance = (text: string) => {
    const value = normalized(text), identifiers = new Set(value.match(/[a-z0-9+#._-]+/gu) ?? []);
    return Math.max(0,...taskTerms.map(terms=>terms.filter(term => /^[a-z0-9+#._-]+$/u.test(term) ? identifiers.has(term) : value.includes(term)).length));
  };
  const candidates: Candidate[] = [];
  const add = (kind: ContextSectionKind, id: string, text: string, status: ContextStatus, evidenceIds: string[] = [], priority = 0, taskText = text, dedupText = text, extra:Pick<Candidate,"family"|"group"|"required"|"quotes"|"referenceIds"|"confirmationBasis"|"scope"|"globalBoundary"|"literal">={}) => {
    if (!text.trim()) return;
    const sourceIds = [...new Set(evidenceIds.flatMap(ref => refs.has(ref) ? [refs.get(ref)!] : []))];
    // Do not re-export generated conclusions whose only original evidence has disappeared or changed.
    if (evidenceIds.some(ref => !refs.has(ref)) && status !== "personal") { if (enabled.has(kind)) omit("unsupported"); return; }
    if(!extra.literal&&status!=="personal"&&status!=="confirmed")text=generatedText(text,status,evidenceIds.flatMap(id=>{const ref=session.evidence.find(ref=>ref.id===id);return ref?proofFor({quote:ref.excerpt,evidenceIds:[id]}):[];}));
    candidates.push({ kind, id, text, status, ...(stale&&sourceIds.length&&status!=="personal"?{currency:"unreviewed" as const}:{}), sourceIds, priority, relevance: relevance(taskText), updatedAt: session.updatedAt,
      dedupKey: `${kind === "evidence" ? "original:" : status==="personal"?"personal:":""}${normalized(dedupText)}`, ...extra,...extra.literal&&options.task.trim()?{relevance:relevance(text)}:{} });
  };
  const savedOverview=session.projectMaintenance?.overview ?? (session.brief?.summary || model?.summary || "");
  const personalOverview=session.projectMaintenance?.overview!==undefined||session.briefUserEdited;
  // Legacy batches sometimes concatenated several introductions. The brief is
  // an introduction, not an unsourced current-state report; keep its first complete
  // paragraph. Full Wiki and the original summary remain untouched in storage.
  const overview=personalOverview?savedOverview:options.task.trim()?(savedOverview.match(/^[^。！？!?\n]+[。！？!?]?/u)?.[0]??savedOverview):savedOverview.split(/\n\s*\n/u)[0];
  add("overview", "summary", overview, session.projectMaintenance?.overview !== undefined || session.briefUserEdited ? "personal" : "uncertain", [], 100);
  // Source-organization instructions are not long-term project goals.
  const genericGoal=/^(?:把|将|请|帮我)?(?:全部|所有|这些|已选)|^(?:create|organize|summari[sz]e)\b.*\ball (?:selected )?(?:chats|conversations|sources)\b/iu.test(session.goal.trim());
  const organizingGoal=/^(?:帮我|请)?(?:创建|整理|总结|找回|复习)|^(?:create|organize|summari[sz]e|find|review)\b/iu.test(session.goal.trim());
  if (!genericGoal && normalized(session.goal) !== normalized(overview)) {
    if (!organizingGoal) add("overview", "goal", session.goal, "personal", [], 95);
    else if (!overview.trim()) add("overview", "goal", `${l("原始整理目标", "Original organization goal")}：${session.goal}`, "personal", [], 95);
  }
  const retiredTexts = new Set(effective.flatMap(item => [item.event.before, ...item.previous.map(event => event.after)]).filter(Boolean).map(evolutionStateKey));
  const retiredProofs=effective.flatMap(item=>[...item.previous.flatMap(proofFor),...item.event.beforeQuote&&(item.event.changeKind==="change"||item.event.changeKind==="retire")?proofFor({quote:item.event.beforeQuote,evidenceIds:item.event.beforeEvidenceIds}):[]]);
  const activeHistory=evolutionAnalysis(session)??session.projectHistoryAnalysis;
  if((activeHistory?.unselectedMessages||activeHistory?.coverage?.partialMessages)&&(enabled.has("decisions")||enabled.has("history")))add(enabled.has("decisions")?"decisions":"history","evolution:candidate-coverage",l("演进只分析了候选讨论，部分历史消息或长消息片段未审阅，不能据此保证当前方案完整。","Evolution covers candidate discussions; some messages or long-message excerpts were not reviewed, so current choices may be incomplete."),"uncertain",[],120,undefined,undefined,{required:true});
  const unresolvedTexts = new Set(activeHistory && [4, 5, 6].includes(activeHistory.version) ? activeHistory.events.filter(event => event.area && !effective.some(item => item.event.area === event.area)).flatMap(event => [event.before, event.after]).filter(Boolean).map(evolutionStateKey) : []);
  for(const record of timeline) {
    if(record.hidden||record.sourceStale)continue;
    const event=record.event;
    const meaningful=event.recordKind!=="reference"&&(Boolean(event.before)&&["change","retire"].includes(event.changeKind??"")||event.decisionStatus==="confirmed"||Boolean(event.workStatus&&event.workStatus!=="unknown"));
    if(!meaningful&&panorama&&options.mode!=="full")continue;
    const state:ContextStatus=record.personal?"personal":readAssertion(proofFor(event)).status==="preference"?"preference":event.status==="proposal"?"proposal":event.status==="uncertain"?"uncertain":"recorded";
    if(panorama&&state==="preference"&&!event.before)continue;
    const historyProofs=[...proofFor(event),...event.beforeQuote?proofFor({quote:event.beforeQuote,evidenceIds:event.beforeEvidenceIds}):[],...event.reasonQuote?proofFor({quote:event.reasonQuote,evidenceIds:event.reasonEvidenceIds??[]}):[]];
    add("history", "evolution:"+record.id, [event.title,event.before?l("旧方案", "Before")+"："+event.before:"",l("变化", "Change")+"："+event.after,event.reason?l("原因", "Reason")+"："+event.reason:"",evolutionWorkLabels[event.workStatus??"unknown"][zh?0:1],l("历史参考，不代表当前方案。", "Historical reference, not a current choice.")].filter(Boolean).join("\n\n"),state,record.sources.map(ref=>ref.id),event.before?76:40,undefined,undefined,{quotes:historyProofs.map(proof=>proof.quote)});
    if(record.personal&&event.decisionStatus==="confirmed")add("decisions","personal:evolution:"+record.id,event.after+(event.reason?"\n\n"+event.reason:""),"personal",[],90);
  }
  // Reuse the latest traceable work report per area, without re-extracting history or claiming code verification.
  const latestWork=new Map<string,typeof timeline[number]>();
  for(const record of timeline)if(record.event.area)latestWork.set(projectSubjectKey(record.event,subjects),record);
  for(const record of latestWork.values()){
    const event=record.event;if(record.sourceStale||record.personal||record.orderUncertain||event.changeKind==="retire"||!event.workQuote||!event.workEvidenceIds?.length||!event.workStatus||event.workStatus==="unknown")continue;
    const ids=event.workEvidenceIds.filter(id=>refs.has(id)&&wikiQuoteRange(messages.get(validSources.get(refs.get(id)!)!.messageId)!.content,event.workQuote!));
    if(!ids.length)continue;
    const userReport=ids.some(id=>{const source=validSources.get(refs.get(id)!)!,message=messages.get(source.messageId)!;const intent=statementEvidence(message.content,event.workQuote!);return source.role==="user"&&(event.workStatus==="planned"?intent.plan:intent.report);});
    if(event.workStatus!=="planned"&&!userReport)continue;
    const status:ContextStatus=event.workStatus==="planned"?(userReport?"planned":"proposal"):userReport?"reported":"recorded";
    add("progress",`evolution-work:${record.id}`,[event.title,event.after,evolutionWorkLabels[event.workStatus][zh?0:1],l("原文中的进展记录，未验证实际代码、测试或部署。","Progress recorded in discussion; actual code, tests and deployment are not verified.")].join("\n\n"),status,ids,82,event.title+" "+event.area+" "+event.after,undefined,{quotes:ids.flatMap(id=>originalQuote(id,event.workQuote!)??[])});
  }
  const coverageKind=enabled.has("decisions")?"decisions":"overview";
  if (session.projectHistoryAnalysis?.pendingBatches&&(enabled.has("decisions")||enabled.has("overview"))) add(coverageKind, "history:partial-coverage", l(`版本分析尚有 ${session.projectHistoryAnalysis.pendingBatches} 批材料待补齐。以下确认仅覆盖已核验部分，未处理的后续讨论可能改变当前方案。`, `Version analysis has ${session.projectHistoryAnalysis.pendingBatches} pending batches. The following approvals cover reviewed material only; later unprocessed discussions may change the current plan.`), "uncertain", [], 120, undefined, undefined, { required: true });
  if(session.projectEvolutionAnalysis?.pendingBatches&&(enabled.has("decisions")||enabled.has("history")))add(enabled.has("decisions")?"decisions":"history","evolution:partial",l("演变分析仍有材料待补齐，当前内容只覆盖已核验部分。","Evolution analysis has pending material; current content covers reviewed portions only."),"uncertain",[],120,undefined,undefined,{required:true});
  if(model?.reviewNotes?.some(note=>note.category==="source_batch")&&(enabled.has("decisions")||enabled.has("overview")))add(coverageKind,"architecture:partial-coverage",l("架构分析仍有材料待补齐，已保留模块与关系只代表已核验部分。","Architecture has pending material; retained modules and relationships cover reviewed portions only."),"uncertain",[],120,undefined,undefined,{required:true});
  for (const item of effective) {
    const details = options.length === "short" ? [] : [...(item.event.additions ?? []), ...(options.length === "detailed" ? item.event.modifications ?? [] : [])];
    const reason = item.event.reason && item.event.reasonQuote && (options.length !== "short" || essentialCondition(item.event.reason)) ? item.event.reason : "";
    add("decisions", `current:${item.event.id}`, `${item.event.area}：${item.event.after}${item.event.changeKind === "retire" ? `\n\n${l("此方案已明确放弃，不作为当前技术选型。", "This approach was explicitly abandoned and is not a current choice.")}` : ""}${details.length ? `\n\n${[...new Set(details.map(detail => detail.text))].join("\n\n")}` : ""}${reason ? `\n\n${l("记录的原因", "Recorded reason")}：${reason}` : ""}`, "confirmed", [...new Set(item.evidence.map(ref => ref.id))], 94,undefined,undefined,{quotes:[{quote:item.event.quote,ids:item.event.evidenceIds},{quote:item.event.confirmationQuote??"",ids:item.event.confirmationEvidenceIds??[]},{quote:reason?item.event.reasonQuote??"":"",ids:item.event.reasonEvidenceIds??[]}].flatMap(proof=>proof.ids.flatMap(id=>originalQuote(id,proof.quote)??[]))});
  }
  for (const [id, maintenance] of Object.entries(session.projectMaintenance?.productReleases ?? {})) {
    if (maintenance.hidden || !maintenance.edited) continue;
    const release=productReleaseEvents(session,true).find(item=>item.id===id);
    if(release&&!release.editedFields.some(field=>field!=="version"))continue;
    const edit = maintenance.edited;
    add("decisions", `personal:release:${id}`, [`${l("产品版本", "Product version")} ${edit.version}：${edit.summary}`, ...options.length === "short" ? [] : edit.additions, ...options.length === "detailed" ? edit.modifications : [], options.length !== "short" && edit.reason ? `${l("个人记录的原因", "Personally recorded reason")}：${edit.reason}` : ""].filter(Boolean).join("\n\n"), "personal", [], 94);
  }
  const maintainedMatters=projectMatters(session);
  for(const matter of maintainedMatters) if(matter.status==="resolved"&&matter.resolution&&!retiredTexts.has(evolutionStateKey(matter.resolution))) {
    add(matter.type==="question"?"progress":"decisions",matter.id,matter.resolution+(matter.type==="boundary"?[[l("包含", "Included"),matter.included],[l("暂不包含", "Excluded"),matter.excluded],[l("阶段", "Phase"),matter.phase]].filter(([,value])=>value).map(([label,value])=>"\n\n"+label+"："+value).join(""):"")+(matter.resolutionReason?"\n\n"+l("用户记录的处理说明", "User-recorded resolution notes")+"："+matter.resolutionReason:""),matter.type==="question"?"personal":"confirmed",[],95,matter.text+" "+matter.resolution,undefined,{required:matter.type==="boundary",confirmationBasis:"atlas"});
  }
  for (const decision of [...model?.decisions??[],...retained.decisions.filter(record=>!model?.decisions.some(item=>item.id===record.id||item.text===record.text)).map(record=>({...record,userEdited:false,confirmed:false}))]) {
    const maintained=maintainedMatters.find(matter=>matter.id===decision.id&&matter.type==="decision");
    const approvedRecord=decision.confirmed;
    if(maintained?.status==="dismissed"||maintained?.status==="resolved"&&maintained.resolution)continue;
    if (decision.status === "superseded" || retiredTexts.has(evolutionStateKey(decision.text))) {
      supersededItems++;
      // A task-specific warning keeps the next AI from reviving an obsolete choice.
      // No inferred replacement or reason is added when the record does not supply one.
      if (terms.length && relevance(decision.text) > 0) add("decisions", `obsolete:${decision.id}`, `${l("已被替代的历史方案，不作为当前任务的选型", "Superseded historical approach; do not use as the current choice")}：${decision.text}`, "recorded", decision.evidenceIds, 110, decision.text);
      continue;
    }
    // Automatic summaries are search hints, never evidence. A lexical match only
    // selects a literal original window; it does not certify summary entailment.
    const rawProofs=proofFor(decision),rawReading=readAssertion(rawProofs);
    const proofs=decision.userEdited||approvedRecord||rawReading.status==="preference"?rawProofs:rawProofs.flatMap(proof=>boundaryEvidence(decision.text,proof.message.content,proof.quote.text).map(text=>({...proof,quote:{...proof.quote,text}})));
    if(!decision.userEdited&&!proofs.length&&(decision.evidenceIds.length||!approvedRecord)){if(enabled.has("decisions"))omit("unsupported");continue;}
    // Approval refers to the complete original proposal, including alternatives;
    // a narrowed display window must not change the user's choice semantics.
    const reading=rawReading.confirmation?rawReading:readAssertion(proofs);
    const approval=confirmationProofs(reading,rawProofs),allProofs=[...proofs,...approval];
    const assistantOnly=proofs.length>0&&proofs.every(proof=>proof.source.role==="assistant");
    const state:ContextStatus=decision.userEdited&&!approvedRecord?"personal":reading.status==="preference"&&!approvedRecord?"preference":unresolvedTexts.has(evolutionStateKey(decision.text))?"uncertain":approvedRecord?"confirmed":reading.status==="confirmed"?"confirmed":assistantOnly||reading.status==="proposal"||decision.status==="proposal"?"proposal":maintained?.status==="open"&&decision.status==="documented"?"uncertain":decision.status==="documented"?"recorded":"uncertain";
    const literal=!decision.userEdited&&!approvedRecord;
    const displayed=literal&&reading.confirmation?proofs.map(proof=>({...proof,quote:{...proof.quote,text:proposalEvidence(proof.message.content,decision.quote)}})):proofs;
    const text=literal?[...new Set(displayed.map(proof=>proof.quote.text))].join("\n\n"):decision.text;
    const displayProofs=[...displayed,...approval];
    add("decisions",decision.id,`${!literal&&maintained?.status==="open"&&!["confirmed","preference"].includes(state)?l("待决定：","Open choice: "):""}${text}`,state,decision.userEdited?[]:allProofs.map(proof=>proof.id),state==="confirmed"?94:75,decision.text,decision.text,{quotes:displayProofs.map(proof=>proof.quote),literal,...(approvedRecord?{confirmationBasis:"atlas" as const}:{}),scope:boundaryScope(text)});
  }
  for (const constraint of [...model?.constraints??[],...retained.constraints.filter(record=>!model?.constraints.some(item=>item.id===record.id||item.text===record.text)).map(record=>({...record,userEdited:false}))]) {
    const maintained=maintainedMatters.find(matter=>matter.id===constraint.id&&matter.type==="boundary");
    if(maintained?.status==="dismissed"||maintained?.status==="resolved"&&maintained.resolution)continue;
    if (constraint.status === "superseded"||retiredTexts.has(evolutionStateKey(constraint.text))) { supersededItems++; continue; }
    if(constraint.userEdited){
      const scope=boundaryScope(constraint.text),approved=session.projectMaintenance?.constraints?.[constraint.id]?.confirmed===true;
      add("decisions",constraint.id,constraint.text,approved?"confirmed":"personal",[],95,undefined,undefined,{required:true,...approved?{confirmationBasis:"atlas" as const}:{},scope});
      continue;
    }
    // constraints are candidates, not automatically adopted instructions. Reuse the
    // same original-role/approval checks as decisions, then export literal windows.
    const windows=proofFor(constraint).flatMap(proof=>boundaryEvidence(constraint.text,proof.message.content,proof.quote.text).map(text=>({...proof,quote:{...proof.quote,text}})));
    const proofs=windows.filter(proof=>!retiredProofs.some(old=>old.quote.sourceId===proof.quote.sourceId&&(wikiQuoteRange(old.quote.text,proof.quote.text)||wikiQuoteRange(proof.quote.text,old.quote.text))));
    if(windows.length!==proofs.length)supersededItems++;
    if(!proofs.length){if(enabled.has("decisions"))omit("unsupported");continue;}
    const reading=readAssertion(proofs),approval=confirmationProofs(reading,proofs);
    const text=[...new Set(proofs.map(proof=>proof.quote.text))].join("\n\n");
    const scope=boundaryScope(text);
    const status:ContextStatus=unresolvedTexts.has(evolutionStateKey(constraint.text))?"uncertain":reading.status;
    const globalBoundary=!scope&&proofs.some(proof=>proof.source.role==="user"&&!proof.intent.reference)&&
      /不能覆盖原始|不(?:得|能|要)覆盖用户|不自动发送|不得自动发送|未经.{0,12}(?:授权|确认)|全局边界|\b(?:never overwrite|do not auto.?send|without (?:consent|authorization))\b/iu.test(text);
    add("decisions",constraint.id,text,status,[...proofs,...approval].map(proof=>proof.id),status==="confirmed"?94:status==="proposal"?35:65,constraint.text,text,{quotes:[...proofs,...approval].map(proof=>proof.quote),scope,globalBoundary,literal:true});
  }
  for (const module of modules) {
    if (module.status === "superseded") { supersededItems++; continue; }
    const inputs=options.length==="short"?module.inputs.filter(essentialCondition):module.inputs;
    const outputs=options.length==="short"?module.outputs.filter(essentialCondition):module.outputs;
    const body = [`${module.title}：${module.purpose}`, inputs.length ? `${l("输入", "Inputs")}：${inputs.join("；")}` : "", outputs.length ? `${l("输出", "Outputs")}：${outputs.join("；")}` : ""].filter(Boolean).join("\n\n");
    const raw=proofFor(module),windows=raw.flatMap(proof=>boundaryEvidence(module.title+" "+module.purpose,proof.message.content,proof.quote.text).map(text=>({...proof,quote:{...proof.quote,text}})));
    const proofs=windows.length?windows:raw,reading=readAssertion(windows);
    if(proofs.some(proof=>retiredProofs.some(old=>old.quote.sourceId===proof.quote.sourceId&&(wikiQuoteRange(old.quote.text,proof.quote.text)||wikiQuoteRange(proof.quote.text,old.quote.text)))))continue;
    const personal="userEdited" in module&&module.userEdited;
    const status:ContextStatus=personal?"personal":model?.architectureStale?"uncertain":reading.status==="reported"?"reported":reading.status==="planned"?"planned":reading.status==="confirmed"?"confirmed":proofs.every(proof=>proof.source.role==="assistant")&&proofs.length?"proposal":module.status==="proposal"?"proposal":"recorded";
    add("decisions", `module:${module.id}`, body, status, personal ? [] : module.evidenceIds, 78, `${module.title}\n${module.purpose}\n${module.inputs.join(" ")}\n${module.outputs.join(" ")}`, body, {family:"module",quotes:proofs.map(proof=>proof.quote)});
  }
  for (const relation of relations) {
    const from = modules.find(module => module.id === relation.from && module.status !== "superseded");
    const to = modules.find(module => module.id === relation.to && module.status !== "superseded");
    const supported = relation.quote && relation.evidenceIds.some(id => {
      const sourceId = refs.get(id), source = sourceId && validSources.get(sourceId);
      return source && wikiQuoteRange(messages.get(source.messageId)!.content, relation.quote);
    });
    if (!from || !to || "userEdited" in from&&from.userEdited || "userEdited" in to&&to.userEdited || !relation.label || !supported) continue;
    const reading=readAssertion(proofFor(relation));
    const state:ContextStatus = model?.architectureStale || from.status === "uncertain" || to.status === "uncertain" ? "uncertain" : reading.status==="proposal"||from.status === "proposal" || to.status === "proposal" ? "proposal" : "recorded";
    const arrow=`${from.title} → ${to.title}`,label=normalized(relation.label).replace(/^(?:数据流|流程|flow)\s*[:：]\s*/iu,"").replace(/->/gu,"→");
    add("decisions", `relation:${relation.from}:${relation.to}`, `${l("模块协作", "Module relationship")}：${arrow}${label===normalized(arrow)?"":"\n\n"+relation.label}`, state, relation.evidenceIds, 79, `${from.title} ${from.purpose} ${to.title} ${to.purpose} ${relation.label}`, undefined, {family:"relation",quotes:proofFor(relation).map(proof=>proof.quote)});
  }
  if (!model) for (const [index, item] of (session.brief?.confirmed ?? []).entries()) add("decisions", `brief:${index}`, clean(item.text), session.briefUserEdited ? "personal" : "uncertain", item.evidenceIds, 75);
  if (!model) for (const kind of ["decisions", "constraints"] as const) for (const [id, record] of Object.entries(session.projectMaintenance?.[kind] ?? {})) {
    if (!record.hidden && record.matterStatus!=="dismissed" && !record.resolution) add("decisions", id, record.text, "confirmed" in record && record.confirmed ? "confirmed" : "personal", [], 95, undefined, undefined, { required: kind === "constraints",...record.confirmed?{confirmationBasis:"atlas" as const}:{},scope:boundaryScope(record.text) });
  }
  // Use all grounded claims, not the Brief's display-limited three progress rows.
  const groundedClaims = new Map<string, Array<{ index:number; claim:NonNullable<typeof session.sections[number]["claims"]>[number]; evidenceIds:string[]; status:ContextStatus; approval:ReturnType<typeof proofFor> }>>();
  for (const section of session.sections) {
    if (section.userEdited || section.origin || section.reviewIssue) continue;
    const claims = (section.claims ?? []).flatMap((claim,index) => {
      if ((!usableWikiClaim(section, claim)&&!claim.evidenceIds.length) || factState.retiredClaim(claim)) return [];
      const evidenceIds = claim.evidenceIds.filter(id => section.evidenceIds.includes(id) && refs.has(id) && (()=>{const source=validSources.get(refs.get(id)!)!,message=messages.get(source.messageId)!;return Boolean(wikiQuoteRange(message.content,claim.quote));})());
      if (!evidenceIds.length) return [];
      const proofs=proofFor(claim),reading=readAssertion(proofs);
      let status:ContextStatus=claim.verification==="supported"?factState.claimStatus(claim,[],evidenceIds.map(id=>validSources.get(refs.get(id)!)!.role)):"draft";
      if(reading.status==="preference")status="preference";
      else if(claim.workStatus==="reported")status=reading.status==="reported"?"reported":proofs.every(proof=>proof.source.role==="assistant")?"recorded":"uncertain";
      else if(claim.workStatus==="planned")status=reading.status==="planned"?"planned":proofs.every(proof=>proof.source.role==="assistant")?"proposal":"uncertain";
      else if(claim.overviewRole==="decision")status=reading.status==="confirmed"?"confirmed":reading.status==="proposal"?"proposal":"uncertain";
      else if(!usableWikiClaim(section,claim))return [];
      return [{index,claim,evidenceIds,status,approval:confirmationProofs(reading,proofs)}];
    });
    groundedClaims.set(section.id,claims);
    for (const {index,claim,evidenceIds,status,approval} of claims) {
      if (!claim.overviewRole || ["scope","workflow","constraint"].includes(claim.overviewRole) || retiredTexts.has(evolutionStateKey(claim.text))) continue;
      const kind=claim.overviewRole==="next"?"next":claim.overviewRole==="decision"?"decisions":"progress";
      const literal=kind==="decisions",windows=literal?proofFor(claim).flatMap(proof=>boundaryEvidence(claim.text,proof.message.content,proof.quote.text).map(text=>({...proof.quote,text}))):[];
      if(literal&&!windows.length){if(enabled.has(kind))omit("unsupported");continue;}
      const text=literal?[...new Set(windows.map(proof=>proof.text))].join("\n\n"):claim.workStatus==="reported"&&status!=="reported"&&status!=="draft"?l("未取得可确认的用户进度报告；以下原文只能作为历史讨论参考。","No reliable user work report was established; the original below is historical discussion only."):generatedText(claim.text,status,proofFor(claim));
      add(kind,`wiki-brief:${section.id}:${index}`,text,status,[...evidenceIds,...approval.map(proof=>proof.id)],status==="reported"?92:80,claim.text,claim.text,{quotes:[...(literal?windows:evidenceIds.flatMap(id=>originalQuote(id,claim.quote)??[])),...approval.map(proof=>proof.quote)],literal});
    }
  }
  for(const [index,entry] of (session.brief?.confirmed??[]).entries()){
    if(session.briefUserEdited){add("decisions",`brief-personal:${index}`,entry.text,"personal",[],90);continue;}
    const proofs=entry.evidenceIds.flatMap(id=>{const ref=session.evidence.find(ref=>ref.id===id);return ref?proofFor({quote:ref.excerpt,evidenceIds:[id]}):[];}).flatMap(proof=>boundaryEvidence(entry.text,proof.message.content,proof.quote.text).map(text=>({...proof,quote:{...proof.quote,text}})));
    if(!proofs.length){if(enabled.has("decisions"))omit("unsupported");continue;}
    const reading=readAssertion(proofs),approval=confirmationProofs(reading,proofs),all=[...proofs,...approval];
    const kind=reading.status==="reported"?"progress":"decisions";
    add(kind,`brief-source:${index}`,[...new Set(proofs.map(proof=>proof.quote.text))].join("\n\n"),reading.status,all.map(proof=>proof.id),reading.status==="reported"?92:85,entry.text,entry.text,{quotes:all.map(proof=>proof.quote),literal:true,scope:boundaryScope(proofs.map(proof=>proof.quote.text).join("\n"))});
  }
  for (const action of model?.actions ?? []) {
    if (action.status === "superseded") { supersededItems++; continue; }
    add(action.done ? "progress" : "next", action.id, `${action.done ? l("用户标记完成", "Marked complete by user") : l("待完成", "To do")}：${action.text}`,
      action.personal || action.done ? "personal" : action.status === "documented" ? "planned" : "proposal", action.personal || action.done ? [] : action.evidenceIds, 70);
  }
  if(!model)for(const [id,action] of Object.entries(session.projectMaintenance?.actions??{}))add(action.done?"progress":"next",id,(action.done?l("用户标记完成：","Marked complete by user: "):l("待完成：","To do: "))+action.text,"personal",[],90);
  for (const matter of maintainedMatters.filter(item=>item.type!=="question"&&item.status==="open")){
    const known=candidates.find(candidate=>candidate.kind==="decisions"&&candidate.id===matter.id);
    if(known&&enabled.has("decisions"))continue;
    // The open-items route must not revive summaries withheld for bad evidence.
    if(!matter.personal&&!known)continue;
    const text=matter.personal?l(matter.type==="decision"?"待决定：":"待确认边界：",matter.type==="decision"?"Open choice: ":"Open boundary: ")+matter.text:known!.text;
    add("next",`open:${matter.type}:${matter.id}`,text,known?.status??"personal",matter.sources.map(ref=>ref.id),65,known?.text??matter.text,undefined,known?{quotes:known.quotes,literal:known.literal,scope:known.scope}:{});
  }
  for (const question of projectQuestionItems(session).filter(item => !item.resolved && !item.dismissed)) {
    const current=question.personal||session.briefUserEdited;
    add("next",question.key,l(current?"待处理问题：":"历史问题（当前是否仍待解决未知）：",current?"Open question: ":"Historical question (current status unknown): ")+question.text,current?"open":"uncertain",question.sources.map(ref=>ref.id),current?80:20);
  }
  for (const section of session.sections) {
    const personal = section.userEdited || section.origin === "user";
    const linkPending=linkedMatterKnowledge(session,section).some(link=>!link.current);
    if(!personal&&section.evidenceIds.some(id=>!refs.has(id))){if(enabled.has("wiki"))omit("unsupported");continue;}
    const claims=groundedClaims.get(section.id)??[];
    const sectionStatus:ContextStatus=linkPending||section.reviewIssue?"uncertain":personal?"personal":section.kind==="proposal"?"proposal":"background";
    // Keep complete paragraphs and code. A chapter's source list is not evidence for every paragraph.
    const blocks=discussionBlocks(personal?section.body:generatedContextContent(clean(section.body),section.evidenceIds.flatMap(id=>{const ref=session.evidence.find(ref=>ref.id===id);return ref?[ref.excerpt]:[];})),Infinity);
    let headings="",subject="";
    for (const [index, block] of blocks.entries()) {
      if (!personal&&/^(?:#{1,6} [^\n]+\n?)+$/u.test(block.text.trim())) {headings+=(headings?"\n\n":"")+block.text.trim();subject=block.text;continue;}
      if (!personal && retiredTexts.has(evolutionStateKey(block.text))) { supersededItems++;headings="";continue; }
      const attached=claims.filter(({claim})=>normalized(block.text).includes(normalized(claim.text)));
      const backgroundProofs=!personal&&!attached.length&&overstatesProjectEvidence(block.text,"background")?section.evidenceIds.flatMap(id=>{const ref=session.evidence.find(ref=>ref.id===id);return ref?proofFor({quote:ref.excerpt,evidenceIds:[id]}):[];}):[];
      const states=new Set(attached.map(item=>item.status));
      const state=personal||linkPending||section.reviewIssue?sectionStatus:attached.length&&states.size===1&&attached.some(item=>normalized(item.claim.text)===normalized(block.text))?attached[0].status:sectionStatus;
      const ids=personal?[]:attached.length?[...new Set(attached.flatMap(item=>[...item.evidenceIds,...item.approval.map(proof=>proof.id)]))]:backgroundProofs.map(proof=>proof.id);
      const referenceIds=!personal&&!ids.length?[...new Set(section.evidenceIds.map(id=>refs.get(id)!))]:[];
      const body=personal?block.text.trim():nestedWikiHeadings((headings?headings+"\n\n":"")+historicalMarketJudgment(generatedText(block.text.trim(),state,[...attached.flatMap(item=>proofFor(item.claim)),...backgroundProofs]),zh,section.title+"\n"+subject));
      if(!body.trim())continue;
      add("wiki", `${section.id}:${index}`, `### ${section.title}\n\n${linkPending?l("关联事项结论待同步，以下正文需核对。","Linked conclusion needs review; verify this article.")+"\n\n":""}${body}`, state, ids, 25, `${section.title}\n${block.text}`, block.text,{group:section.id,referenceIds,quotes:[...attached.flatMap(item=>item.evidenceIds.flatMap(id=>originalQuote(id,item.claim.quote)??[])),...attached.flatMap(item=>item.approval.map(proof=>proof.quote)),...backgroundProofs.map(proof=>proof.quote)]});
      headings="";
    }
  }

  for (const source of validSources.values()) {
    const message = messages.get(source.messageId)!;
    for (const [index, block] of discussionBlocks(message.content, Infinity).entries()) {
      // Export quoted original blocks surrounding a retained quote, not all of the conversation.
      if (!session.evidence.some(ref => {
        const range = source.evidenceIds.includes(ref.id) ? wikiQuoteRange(message.content, ref.excerpt) : undefined;
        return range && range.start < block.end && range.end > block.start;
      })) continue;
      add("evidence", `${source.id}:${index}`, block.text.trim().split("\n").map(row => `> ${row}`).join("\n"), "recorded", source.evidenceIds, 15, block.text);
    }
  }
  const pinned=session.projectMaintenance?.nextMatter;
  if(pinned&&maintainedMatters.some(matter=>matter.id===pinned.id&&matter.type===pinned.type&&matter.status==="open"))for(const candidate of candidates)if(candidate.kind==="next"&&(candidate.id===pinned.id||candidate.id===`open:${pinned.type}:${pinned.id}`)){candidate.priority=120;candidate.required=true;}
  const incidentalDetail=(item:Candidate)=>panorama&&item.status==="proposal"&&!item.family&&/字体|字号|行高|边距|配色|排版|README|双\s*Tab|面板.{0,12}(?:Tab|切换)|浅色模式|深色模式|font[- ]?(?:family|size)|line-height|padding|typography|light mode|dark mode/iu.test(item.dedupKey);
  // Advice earns overview space by explaining a retained capability, choice or
  // meaningful change. Being an AI suggestion is never a selection reason.
  const anchors=candidates.filter(item=>item.kind==="overview"||item.family==="module"||item.kind==="history"&&/evolution:/u.test(item.id)||item.kind==="decisions"&&item.status==="confirmed");
  const overviewRelated=(item:Candidate)=>item.family==="module"||anchors.some(anchor=>{
    if(anchor===item)return false;
    if(anchor.sourceIds.some(id=>item.sourceIds.includes(id)))return true;
    const terms=queryTerms(anchor.text).filter(term=>!projectTerms.has(term)&&!["ai","ui","项目","用户","建议","采用","功能","历史","讨论"].includes(term));
    const found=terms.filter(term=>/^[a-z][a-z\d_.+-]+$/u.test(term)?new Set(normalized(item.text).match(/[a-z\d_.+-]+/gu)).has(term):normalized(item.text).includes(term));
    return found.some(term=>/^[a-z][a-z\d_.+-]+$/u.test(term))||found.length>=3;
  });
  const historicalRecord=(item:Candidate)=>item.kind==="decisions"&&!item.family&&!item.globalBoundary&&["proposal","recorded","uncertain"].includes(item.status)&&!item.required;
  const quotedCandidate=(item:Candidate)=>item.quotes?.some(quote=>{const source=validSources.get(quote.sourceId),message=source&&messages.get(source.messageId);return message&&referenceEvidence(message.content,quote.text);});
  const taskMatches = (item: Candidate) => item.required || !incidentalDetail(item)&&(item.scope!=="task" || Boolean(options.task.trim())&&item.relevance>0) && (panorama?(!(item.status==="proposal"||historicalRecord(item)&&quotedCandidate(item))||options.mode==="full"||overviewRelated(item)):(item.kind==="overview"||item.globalBoundary||item.relevance>0));
  const order: ContextSectionKind[] = ["overview", "decisions", "progress", "next", "history", "wiki", "evidence"];
  const selection = Object.fromEntries(order.map(kind => [kind, {
    available: new Set(candidates.filter(item => item.kind === kind).map(item => item.dedupKey)).size,
    matching: new Set(candidates.filter(item => item.kind === kind && taskMatches(item)).map(item => item.dedupKey)).size,
    included: 0,
  }])) as ContextBundle["selection"];
  const unique = new Map<string, Candidate>();
  omissions.disabled=candidates.filter(item=>!enabled.has(item.kind)).length;
  for (const item of candidates.filter(item => enabled.has(item.kind))) {
    const near=item.kind==="wiki"&&item.status!=="personal"?[...unique.values()].find(other=>other.kind==="wiki"&&other.status===item.status&&[...other.sourceIds,...other.referenceIds??[]].some(id=>[...item.sourceIds,...item.referenceIds??[]].includes(id))&&equivalentContextText(other.text,item.text)):undefined;
    const factTwin=item.status!=="personal"&&item.kind==="wiki"&&item.quotes?.length?[...unique.values()].find(other=>other.kind!=="evidence"&&other.status===item.status&&equivalentContextText(other.text,item.text)&&other.quotes?.some(quote=>item.quotes?.some(proof=>proof.sourceId===quote.sourceId&&proof.text===quote.text))):undefined;
    const literalTwin=item.literal?[...unique.values()].find(other=>other.literal&&other.kind===item.kind&&other.status===item.status&&other.scope===item.scope&&normalized(other.text)===normalized(item.text)):undefined;
    const key = `${item.scope??"project"}:${literalTwin?.dedupKey??factTwin?.dedupKey??near?.dedupKey??item.dedupKey}`, existing = unique.get(key);
    if (!existing) unique.set(key, { ...item });
    else {
      omissions.duplicate++;
      // An unconfirmed Wiki retelling is not contrary evidence against a
      // sourced or personally approved snapshot. Keep it as related material.
      if((item.kind==="wiki"||item.id.startsWith("wiki-brief:"))&&existing.kind!=="wiki"&&["confirmed","reported","planned"].includes(existing.status)&&item.status!==existing.status){existing.referenceIds=[...new Set([...existing.referenceIds??[],...item.sourceIds,...item.referenceIds??[]])];existing.relevance=Math.max(existing.relevance,item.relevance);continue;}
      existing.sourceIds = [...new Set([...existing.sourceIds, ...item.sourceIds])];
      // Same text with incompatible states must not silently inherit the most confident state.
      if(existing.status==="background")existing.status=item.status;
      else if(item.status!=="background"&&existing.status!==item.status)existing.status="uncertain";
      existing.referenceIds=[...new Set([...existing.referenceIds??[],...item.referenceIds??[]])];
      if(item.currency)existing.currency=item.currency;
      if (item.relevance > existing.relevance && item.kind===existing.kind) { existing.text = item.text; existing.id = item.id; existing.kind = item.kind; }
      existing.priority = Math.max(existing.priority, item.priority); existing.relevance = Math.max(existing.relevance, item.relevance);
      existing.required ||= item.required;
      existing.globalBoundary ||= item.globalBoundary;
      existing.quotes=[...new Map([...existing.quotes??[],...item.quotes??[]].map(quote=>[JSON.stringify([quote.sourceId,quote.text]),quote])).values()];
    }
  }
  const capabilitiesFor=(sections:ContextBundle["sections"])=>sections.flatMap(section=>section.items.flatMap(item=>{
    const module=item.id.startsWith("module:")?modules.find(module=>item.id===`module:${module.id}`):undefined;
    const page=!module?session.sections.find(page=>item.id.startsWith(`wiki-brief:${page.id}:`)&&page.claims?.some(claim=>claim.overviewRole==="progress")||item.id.startsWith(`${page.id}:`)&&page.wikiSubtopics?.length):undefined;
    if(!module&&!page)return [];
    if(!item.sourceIds.length&&item.status!=="personal")return [];
    return [{title:module?.title??(page!.title.replace(/(?:进度|开发阶段)\s*$/u,"")||page!.title),status:item.status,sourceIds:item.sourceIds,...item.currency?{currency:item.currency}:{}}];
  })).filter((item,index,all)=>all.findIndex(other=>other.title===item.title)===index).slice(0,options.length==="short"?3:options.length==="standard"?5:8);
  const bundle: ContextBundle = { schemaVersion: 1, id: crypto.randomUUID(), projectId: session.canvasId || session.id, projectName: session.title,
    task: options.task.trim(), purpose: options.task.trim()?"task":"overview", generatedAt: Date.now(), locale: zh ? "zh-CN" : "en", sections: [], sources: [], knowledgeSignature: knowledge.signature,
    tokenBudget: Number.isFinite(options.tokenBudget)?Math.max(256,Math.min(60_000,options.tokenBudget!)):contextBudgets[options.length], length:options.length, requestedSections:[...options.sections], taskEvidenceMatched:false, selection, estimatedTokens: 0, tokenCountKind: "estimate", omittedItems: 0, invalidSources, supersededItems, sourcesStale: stale };
  // Reserve the complete coverage footer up front so accounting cannot push accepted content over budget.
  bundle.omittedItems = unique.size + omittedItems;
  // Reserve upper bounds for reason counts while selecting, including the footer.
  const upper=candidates.length+omittedItems;
  bundle.omissions={unsupported:upper,duplicate:upper,relevance:upper,depth:upper,budget:upper,disabled:upper};
  // A long user task stays verbatim, but cannot create extra room for automatic material.
  const selectionBudget=bundle.tokenBudget;
  const optionalBudgets=panorama?{history:.18,wiki:.20,proposal:.12,overview:.24}:{history:.10,wiki:.42,proposal:.30,overview:.14};
  const spent={history:0,wiki:0,proposal:0,overview:0};
  const counts:Partial<Record<ContextSectionKind,number>>={},families={module:0,relation:0},wikiPages=new Set<string>();
  let historical=0;
  const historicalLimit={short:1,standard:2,detailed:4}[options.length];
  const ranked=[...unique.values()].sort((a,b)=>b.priority+Math.min(60,b.relevance*12)-a.priority-Math.min(60,a.relevance*12));
  // Reserve a useful project snapshot before filling the pack with optional rules.
  // This is selection order, never another budget exemption.
  const matching=ranked.filter(taskMatches),snapshot=new Set<Candidate>(matching.filter(item=>item.kind==="overview"));
  for(const choose of [matching.find(item=>item.family==="module"),matching.find(item=>item.kind==="progress"&&item.status==="reported")??matching.find(item=>item.kind==="progress"),matching.find(item=>item.kind==="decisions"&&item.status==="confirmed")])if(choose)snapshot.add(choose);
  const remaining=ranked.filter(item=>!item.required&&!snapshot.has(item)),preferred=new Set<Candidate>();
  if(panorama){
    // Current records precede historical advice; then offer one example from
    // each broad topic before filling the remaining history allowance.
    for(const item of remaining)if(["decisions","progress","next"].includes(item.kind)&&!historicalRecord(item))preferred.add(item);
  }
  for (const candidate of [...ranked.filter(item=>item.required),...ranked.filter(item=>!item.required&&snapshot.has(item)),...preferred,...remaining.filter(item=>!preferred.has(item))]) {
    // Knowledge may be large and permanent. Context is a task-specific selection, even for Dashboard records.
    if (!taskMatches(candidate)) { omit("relevance"); continue; }
    const sectionFull = (counts[candidate.kind] ?? 0) >= (candidate.kind==="next"&&!options.task.trim()?Math.min(3,profile.limits.next):profile.limits[candidate.kind]);
    const familyFull = candidate.family && families[candidate.family] >= (candidate.family === "module" ? profile.modules : profile.relations);
    const pagesFull = candidate.kind === "wiki" && candidate.group && !wikiPages.has(candidate.group) && wikiPages.size >= profile.wikiPages;
    const isHistorical=panorama&&historicalRecord(candidate)&&options.mode!=="full";
    if (!candidate.required && (sectionFull || familyFull || pagesFull || isHistorical&&historical>=historicalLimit)) { omit("depth"); continue; }
    const allowance=candidate.kind==="history"?"history":candidate.kind==="wiki"?"wiki":candidate.kind==="overview"?"overview":historicalRecord(candidate)?"proposal":undefined;
    const cost=estimateTokens(candidate.text+(candidate.quotes??[]).map(quote=>quote.text).join("\n"));
    if(!candidate.required&&allowance&&spent[allowance]+cost>selectionBudget*optionalBudgets[allowance]){omit("budget");continue;}
    const sections = bundle.sections.map(section => ({ ...section, items: [...section.items] }));
    const section = sections.find(section => section.kind === candidate.kind);
    const { kind, priority: _priority, relevance: _relevance, dedupKey: _dedupKey, family:_family, group:_group, required:_required, globalBoundary:_globalBoundary, ...item } = candidate;
    void _priority; void _relevance; void _dedupKey; void _family; void _group; void _required; void _globalBoundary;
    if (section) section.items.push(item); else sections.push({ kind, items: [item] });
    // Quote containment deduplication depends on section order. Account using the
    // final reading order, so reserving progress cannot undercount later evidence.
    sections.sort((a,b)=>order.indexOf(a.kind)-order.indexOf(b.kind));
    const sources = [...new Set(sections.flatMap(section => section.items.flatMap(item => [...item.sourceIds,...item.referenceIds??[]])))].map(id => validSources.get(id)!);
    if (candidate.required || estimateTokens(formatContext({ ...bundle, sections, sources, capabilities:capabilitiesFor(sections) })) <= selectionBudget) {
      bundle.sections = sections; bundle.sources = sources; counts[kind] = (counts[kind] ?? 0) + 1;
      if (candidate.family) families[candidate.family]++;
      if(isHistorical)historical++;
      if(allowance)spent[allowance]+=cost;
      if (candidate.kind === "wiki" && candidate.group) wikiPages.add(candidate.group);
    }
    else omit("budget");
  }
  for (const section of bundle.sections) selection[section.kind].included = section.items.length;
  bundle.sections.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  // JSON handoffs use the same selected windows as portable text. Broad saved
  // excerpts stay in storage, not hidden inside the exported source metadata.
  bundle.sources=bundle.sources.map(source=>{
    const excerpts=[...new Set(bundle.sections.flatMap(section=>section.items.flatMap(item=>item.quotes??[])).filter(quote=>quote.sourceId===source.id).map(quote=>quote.text))];
    if(excerpts.length)return {...source,excerpts};
    const related=relatedSourceExcerpt(source);
    return {...source,excerpts:related?[related]:[],...!related&&source.excerpts?.length?{excerptOmitted:true}:{}};
  });
  bundle.omittedItems = omittedItems;
  bundle.omissions=omissions;
  bundle.capabilities=capabilitiesFor(bundle.sections);
  bundle.taskEvidenceMatched=bundle.sections.some(section=>section.kind!=="overview"&&section.items.some(item=>relevance(item.text)>0&&item.status!=="background"&&item.status!=="uncertain"&&item.status!=="draft"&&(item.sourceIds.length>0||item.status==="personal"||item.status==="confirmed")));
  bundle.estimatedTokens = estimateTokens(formatContext(bundle));
  return bundle;
}
