import { resolveWikiReading } from "../ai/wiki-knowledge-reading";
import { wikiUnitStatuses } from "../ai/wiki-knowledge-state";
import type { FocusEvidence, FocusSession } from "./focus-session";
import { historyTime, orderHistoryMessages } from "./history-order";
import { evolutionAnalysis, evolutionRecords } from "./product-evolution";
import { confirmedHistoryEvent, historyConfirmation } from "./project-claim-relations";
import { factTextKey } from "./project-fact-state";
import { statementEvidence } from "./statement-evidence";
import { wikiQuoteRange } from "./wiki-claims";
import { availableWikiEvidence, currentWikiEvidence, wikiEvidenceKey } from "./wiki-evidence-link";
import { DECIDING_KINDS, STATE_KINDS, wikiStatementWithConditions } from "./wiki-knowledge";
import { wikiSourceReading } from "./wiki-source-reading";

const DIRECTION = /目标用户|产品定位|核心价值|主要用途|旨在解决|面向.{0,24}(?:用户|人群|团队)|\b(?:target users|positioning|core value|product purpose|aims to solve)\b/iu;
const RELEASE_SCOPE = /首版|第一版|版本范围|发布范围|上线范围|交付范围|\b(?:MVP|first release|release scope|launch scope|v\d+\.\d+)\b/iu;
const DELIVERY = /商店|商城|发布|上架|交付|\b(?:store|release|ship|delivery)\b/iu;
const CHANGE = /调整为|收缩为|扩大到|改为|改用|转为|转向|替换|停止|放弃|移除|延期|延后|后续|暂缓|仅|只|正式确认|\b(?:switch(?:ed)? to|pivot(?:ed)?|drop(?:ped)?|replace(?:d)?|defer(?:red)?|only)\b/iu;
const WORKFLOW = /关键链路|核心流程|核心链路|闭环|端到端|最小可用|试点|公开测试|\b(?:core workflow|end[- ]to[- ]end|pilot|public beta)\b/iu;
const FOUNDATION = /基础架构|数据架构|持久化|数据模型|授权边界|隐私|本地优先|\b(?:architecture|persistence|data model|privacy|local[- ]first)\b/iu;
const CAPABILITY = /导入|检索|搜索|原文定位|知识库|导出|同步|Wiki|Context Pack|MCP|Reader|\b(?:import|retrieval|search|export|sync|integration)\b/iu;
const DETAIL = /排版|字号|间距|圆角|边框|配色|颜色|对齐|按钮文案|占位符|\b(?:padding|font size|spacing|border radius|button label|placeholder)\b/iu;
const FINISHED = /已(?:经)?(?:正式)?(?:实现|完成|通过|上线|发布|接入|做完|跑通|打通|上架)|(?:完成|实现|上线|发布|跑通|打通|上架)了|\b(?:completed|implemented|finished|released|shipped)\b/iu;
const RELEASED = /已(?:经)?(?:正式)?(?:发布|上线|上架)|(?:发布|上线|上架)了|\b(?:released|shipped)\b/iu;
const LIMIT = 8;

export type ProjectMilestone = {
  id:string; text:string; status:"decision"|"earlier"|"reported"|"release"; source:FocusEvidence;
  reason?: string;
  relatedSources?: FocusEvidence[];
  conversationId:string; messageIndex:number; discussedAt?:number;
};
type Candidate = ProjectMilestone & { topic: string; impact: number; grounded: boolean; mergeId?: string };
type MilestoneInput = Pick<ProjectMilestone, "id" | "text" | "status" | "source">
  & Partial<Pick<ProjectMilestone, "messageIndex" | "discussedAt">>
  & { subject?: string; grounded?: boolean; mergeId?: string; reasonQuote?: string };
export const projectMilestoneLabel=(status:ProjectMilestone["status"],zh:boolean)=>({
  decision:zh?"已确认决定":"Confirmed decision",
  earlier:zh?"此前确认":"Earlier decision",
  reported:zh?"用户报告完成":"User reports completion",
  release:zh?"用户报告发布":"User reports release",
})[status];

function reportedStatus(text:string,quote:string,original=quote):ProjectMilestone["status"]|undefined {
  if(!FINISHED.test(text)||!FINISHED.test(quote)||!statementEvidence(original,quote).report)return;
  return RELEASED.test(text)&&RELEASED.test(quote)?"release":"reported";
}

function originalReason(text: string, quote: string) {
  const match = quote.match(/(?:^|[，,。；;\n]|\.\s+|\s)(因为[^。！？!?；;\n]+|(?:主要原因是|目的是|这样做是为了)[^。！？!?；;\n]+|(?:because|the reason is)\s+[^.!?;\n]+)/iu);
  const reason = match?.[1].trim();
  return reason && reason.length <= 140 && !factTextKey(text).includes(factTextKey(reason)) ? reason : undefined;
}

function milestoneImpact(text: string, subject: string, status: ProjectMilestone["status"]) {
  const area = `${subject} ${text}`;
  const decision = status === "decision" || status === "earlier";
  if (decision && (DIRECTION.test(text) || DIRECTION.test(subject) && (CHANGE.test(text) || /决定|解决|服务|面向|\b(?:decid(?:e|ed)|serve|solve)\b/iu.test(text)))) {
    return { topic: "direction", impact: 5 };
  }
  if (DETAIL.test(text)) return;
  if (decision && RELEASE_SCOPE.test(area) && (CHANGE.test(text) || CAPABILITY.test(text) || WORKFLOW.test(text) || DELIVERY.test(text))) return { topic: "scope", impact: 5 };
  if (status === "release") return { topic: "delivery", impact: 4 };
  if (WORKFLOW.test(area)) return { topic: "workflow", impact: 4 };
  if (FOUNDATION.test(area)) return { topic: "architecture", impact: CHANGE.test(text) ? 4 : 3 };
  if (CAPABILITY.test(area)) return { topic: "capability", impact: CHANGE.test(text) ? 3 : 2 };
}

function selectMilestones(candidates: Candidate[]): ProjectMilestone[] {
  const chronological = orderHistoryMessages(candidates);
  const ranked = [...chronological].sort((a, b) => b.impact - a.impact || Number(b.grounded) - Number(a.grounded));
  const byText = new Map<string, Candidate>(), byMerge = new Map<string, Candidate>();
  const distinct: Candidate[] = [];
  for (const item of ranked) {
    const key = JSON.stringify([item.status, factTextKey(item.text)]);
    const merge = item.mergeId && JSON.stringify([item.status, item.mergeId]);
    const previous = byText.get(key) ?? (merge ? byMerge.get(merge) : undefined);
    const node = previous ?? { ...item };
    byText.set(key, node);
    if (merge) byMerge.set(merge, node);
    if (!previous) { distinct.push(node); continue; }
    node.reason ??= item.reason;
    const refs = [node.source, ...node.relatedSources ?? []];
    if (!refs.some(ref => ref.conversationId === item.source.conversationId && ref.messageId === item.source.messageId)) {
      node.relatedSources = [...node.relatedSources ?? [], item.source];
    }
  }
  // Give different kinds of change room within each impact level.
  const picks: Candidate[] = [], seenTopics = new Set<string>();
  for (const item of distinct) {
    const key = JSON.stringify([item.impact, item.topic]);
    if (seenTopics.has(key)) continue;
    seenTopics.add(key);
    picks.push(item);
  }
  const selected = new Set(picks);
  const priority = [...picks, ...distinct.filter(item => !selected.has(item))].sort((a, b) => b.impact - a.impact);
  return orderHistoryMessages(priority.slice(0, LIMIT)).map(({ id, text, status, source, conversationId, messageIndex, discussedAt, relatedSources, reason }) =>
    ({ id, text, status, source, conversationId, messageIndex, discussedAt, ...(reason ? { reason } : {}), ...(relatedSources?.length ? { relatedSources } : {}) }));
}

/** A compact projection of existing original-backed knowledge. Dates denote
 * the source message's date. The original decision and actual release stay separate. */
export function projectTimeline(session:FocusSession, reading?:ReturnType<typeof resolveWikiReading>):ProjectMilestone[] {
  if(session.mode!=="work"||session.wikiKnowledge?.documentType==="learning")return [];
  const refs=currentWikiEvidence(session), byId=new Map(refs.map(ref=>[ref.id,ref]));
  const sources=new Map(refs.map(ref=>[wikiEvidenceKey(ref),ref]));
  const byMessage = new Map<string, FocusEvidence[]>();
  for (const ref of refs) {
    const key = JSON.stringify([ref.conversationId, ref.messageId]);
    const items = byMessage.get(key) ?? [];
    items.push(ref);
    byMessage.set(key, items);
  }
  const findSource = (conversationId: string, messageId: string, quote: string) => {
    const exact = sources.get(wikiEvidenceKey({ conversationId, messageId, excerpt: quote }));
    if (exact) return exact;
    const containing = byMessage.get(JSON.stringify([conversationId, messageId]))?.filter(ref => wikiQuoteRange(ref.excerpt, quote));
    return containing?.length === 1 ? containing[0] : undefined;
  };
  const candidates:Candidate[]=[];
  const add=({ id, text, status, source, messageIndex: index, discussedAt, subject = "", grounded = true, mergeId, reasonQuote }: MilestoneInput)=>{
    const line=text.trim().replace(/\s*\n\s*/gu," ");
    const impact=milestoneImpact(line,subject,status);
    if(!line||line.length>320||!impact)return;
    const messageIndex=session.sourceMessageOrder?.[source.conversationId]?.indexOf(source.messageId);
    candidates.push({id,text:line,status,source,conversationId:source.conversationId,...impact,grounded,mergeId,
      reason: reasonQuote ? originalReason(line, reasonQuote) : undefined,
      messageIndex:messageIndex!==undefined&&messageIndex>=0?messageIndex:index??0,discussedAt:historyTime(discussedAt)});
  };
  if(session.wikiKnowledge){
    const { statuses, units, ledger, organization } = reading ?? resolveWikiReading(session.wikiKnowledge);
    const mergeIds = new Map(organization?.merged.flatMap(group => [group.id, ...group.from].map(id => [id, group.id] as const)));
    const replaced = new Set(organization?.relations.filter(link => link.status === "resolved" && link.kind === "replaces"
      && statuses.get(link.newer) === "confirmed").map(link => link.older));
    const originalStatuses = replaced.size ? wikiUnitStatuses(units.filter(unit => replaced.has(unit.id)), { relations: [] }, ledger.decisions) : undefined;
    for(const unit of units){
      const standing = statuses.get(unit.id);
      const earlier = standing === "history" && originalStatuses?.get(unit.id) === "confirmed";
      if(unit.about||unit.evidence.pasted||(!earlier && !["confirmed","reported","stated"].includes(standing ?? "")))continue;
      const {quote,role,messageId,conversationId,messageIndex}=unit.evidence;
      const ref=findSource(conversationId,messageId,quote);
      const savedRole=ref&&session.sourceRoles?.[conversationId]?.[messageId];
      if(!ref||savedRole&&savedRole!==role)continue;
      const text=wikiStatementWithConditions(unit,session.locale!=="en");
      const subject = `${unit.subject} ${unit.facet ?? ""} ${unit.evidence.section ?? ""}`;
      const group = mergeIds.get(unit.id);
      // Keep distinct applicability limits even when the ledger files both under one entry.
      const mergeId = group && JSON.stringify([group, unit.conditions ?? [], unit.details]);
      if((standing==="reported"||standing==="stated")&&role==="user"&&STATE_KINDS.includes(unit.kind)){
        const status=reportedStatus(text,quote,ref.excerpt);
        if(status)add({id:unit.id,text,status,source:ref,messageIndex,subject,mergeId,reasonQuote:quote});
      }else if((standing==="confirmed"||earlier)&&DECIDING_KINDS.includes(unit.kind)){
        const status = earlier ? "earlier" : "decision";
        const approval=unit.adoption.approval;
        const confirmedRef=approval&&(byId.get(approval.evidenceId)??findSource(conversationId,approval.messageId,approval.quote));
        const confirmedRole=approval&&session.sourceRoles?.[conversationId]?.[approval.messageId];
        if(approval&&confirmedRef&&confirmedRef.conversationId===conversationId&&confirmedRef.messageId===approval.messageId
          && (!confirmedRole||confirmedRole==="user")&&wikiQuoteRange(confirmedRef.excerpt,approval.quote)){
          add({id:unit.id,text,status,source:confirmedRef,messageIndex,subject,mergeId,reasonQuote:approval.quote});
        }else{
          add({id:unit.id,text,status,source:ref,messageIndex,subject,grounded:role==="user",mergeId,reasonQuote:role==="user"?quote:undefined});
        }
      }
    }
  }
  for(const page of session.sections){
    if(page.userEdited||page.origin||page.reviewIssue)continue;
    for(const claim of page.claims??[]){
      if(claim.markOnly||claim.verification==="uncertain"||!milestoneImpact(claim.text,claim.subject??"",RELEASED.test(claim.text)?"release":"decision"))continue;
      const reading=wikiSourceReading(session,claim);
      const proof=reading?.sources.find(source=>source.role==="user"&&byId.has(source.id));
      const ref=proof&&byId.get(proof.id);
      if(!ref)continue;
      const status=reading?.reported?reportedStatus(claim.text,claim.quote,ref.excerpt):reading?.status==="confirmed"?"decision":undefined;
      if(status)add({ id:`${page.id}:${proof.id}:${factTextKey(claim.text)}`,text:claim.text,status,source:ref,
        messageIndex:proof.messageIndex,discussedAt:proof.discussedAt,subject:claim.subject,
        reasonQuote:wikiQuoteRange(ref.excerpt,claim.quote)?claim.quote:undefined });
    }
  }
  const analysis=evolutionAnalysis(session);
  if(analysis){
    const signatures=new Map(analysis.sources.map(source=>[source.id,source]));
    const originalRefs=new Map(analysis.evidence.filter(ref=>availableWikiEvidence(session,ref)).map(ref=>[ref.id,ref]));
    for(const {event,personal,sourceStale} of evolutionRecords(session)){
      if(personal||sourceStale||event.status!=="documented"||event.recordKind&&event.recordKind!=="event")continue;
      const proofs=[...new Set([...event.evidenceIds,...event.confirmationEvidenceIds??[],...event.workEvidenceIds??[]])].flatMap(id=>{
        const ref=originalRefs.get(id),source=signatures.get(id);
        return ref&&source&&source.conversationId===ref.conversationId&&source.messageId===ref.messageId?[{...source,text:ref.excerpt}]:[];
      });
      const work=proofs.find(source=>source.role==="user"&&event.workEvidenceIds?.includes(source.id)&&wikiQuoteRange(source.text,event.workQuote??""));
      const status=work&&reportedStatus(event.after,event.workQuote??"");
      const confirmation=historyConfirmation(event);
      const proof=status?work:confirmedHistoryEvent(event,proofs)?proofs.find(source=>source.role==="user"
        && confirmation.evidenceIds.includes(source.id)&&wikiQuoteRange(source.text,confirmation.quote)):undefined;
      if(proof)add({id:event.id,text:event.after,status:status??"decision",source:originalRefs.get(proof.id)!,
        messageIndex:proof.messageIndex,discussedAt:proof.discussedAt,subject:event.area,reasonQuote:status?event.workQuote:confirmation.quote});
    }
  }
  return selectMilestones(candidates);
}
