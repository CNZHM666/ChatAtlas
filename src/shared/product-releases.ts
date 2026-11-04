import type { FocusSession } from "./focus-session";
import type { ProjectHistoryEvent } from "./project-state";
import { compareHistoryPositions, historyTime, orderHistoryMessages, type HistoryPosition } from "./history-order";
import { productReleaseKey } from "./project-history-links";
import { isProductReleaseLabel } from "./product-release-signals";
import { historyReplacementTargets, historyStateKey as textKey } from "./project-history-links";

function eventPosition(session:FocusSession,event:ProjectHistoryEvent):HistoryPosition|undefined {
  if(event.position)return event.position;
  const sources=session.projectHistoryAnalysis?.sources??session.projectState?.sources??[];
  for(const id of event.evidenceIds){
    const source=sources.find(source=>source.id===id),ref=[...session.evidence,...session.projectHistoryAnalysis?.evidence??[]].find(ref=>ref.id===id);
    const conversationId=source?.conversationId??ref?.conversationId,messageId=source?.messageId??ref?.messageId;
    if(!conversationId||!messageId)continue;
    const savedIndex=session.sourceMessageOrder?.[conversationId]?.indexOf(messageId),messageIndex=source?.messageIndex??(savedIndex!==undefined&&savedIndex>=0?savedIndex:undefined);
    if(messageIndex!==undefined)return {conversationId,messageId,messageIndex,discussedAt:source?.discussedAt??event.discussedAt};
  }
}
export function productReleaseEvents(session:FocusSession, includeHidden=false){
  const raw=session.projectHistoryAnalysis?.events??session.projectState?.history??[];
  const grouped=new Map<string,typeof raw>();
  for(const event of raw){if(!isProductReleaseLabel(event.version??""))continue;const key=productReleaseKey(event.version);grouped.set(key,[...(grouped.get(key)??[]),event]);}
  const groups=[...grouped.entries()].map(([id,unsorted])=>{
    const positioned=unsorted.map((event,index)=>({event,index,position:eventPosition(session,event)}));
    const events=orderHistoryMessages(positioned.map(item=>({...item,conversationId:item.position?.conversationId??`unknown:${item.index}`,messageIndex:item.position?.messageIndex??0,offset:item.position?.offset,discussedAt:item.position?.discussedAt??item.event.discussedAt}))).map(item=>item.event);
    const position=(event:ProjectHistoryEvent)=>event.confirmationPosition??eventPosition(session,event);
    const compare=(a:ProjectHistoryEvent,b:ProjectHistoryEvent)=>{
      const result=compareHistoryPositions(position(a),position(b));
      if(result!==undefined)return result;
      // Legacy records with actual original timestamps can still be read.
      if(!position(a)&&!position(b)){const first=historyTime(a.discussedAt),second=historyTime(b.discussedAt);if(first!==undefined&&second!==undefined&&first!==second)return first-second;}
    };
    const replaces=(later:ProjectHistoryEvent,earlier:ProjectHistoryEvent)=>historyReplacementTargets(later,events).includes(earlier)&&(compare(later,earlier)??0)>0;
    const confirmed=events.filter(event=>event.decisionStatus==="confirmed"&&event.status==="documented");
    const pool=confirmed.length?confirmed:events.filter(event=>event.status!=="uncertain");
    const currentEvents=pool.filter(event=>!pool.some(later=>replaces(later,event)));
    const effective=currentEvents.length?currentEvents:events;
    const pendingEvents=confirmed.length?events.filter(event=>!confirmed.includes(event)&&!confirmed.some(later=>replaces(later,event)||textKey(later.after)===textKey(event.after)&&textKey(later.area??"")===textKey(event.area??""))):[];
    const pendingOrderUncertain=pendingEvents.some(event=>confirmed.every(current=>compare(event,current)===undefined));
    const laterProposals=pendingEvents.length>0&&!pendingOrderUncertain&&pendingEvents.every(event=>confirmed.some(current=>(compare(event,current)??0)>0));
    const orderUncertain=effective.some((event,index)=>effective.slice(0,index).some(other=>compare(event,other)===undefined&&textKey(event.after)!==textKey(other.after)));
    const unresolvedReplacement=effective.some(event=>Boolean(event.before)&&effective.some(earlier=>earlier!==event&&(compare(event,earlier)??0)>0&&(!event.area||!earlier.area||textKey(event.area)===textKey(earlier.area))&&!historyReplacementTargets(event,events).includes(earlier)));
    const maintenance=session.projectMaintenance?.productReleases?.[id],edit=maintenance?.edited;
    const status=edit?"edited":orderUncertain||unresolvedReplacement||effective.some(event=>event.status==="uncertain")?"uncertain":confirmed.length?"confirmed":effective.every(event=>event.status==="proposal")?"proposal":"documented";
    const original={version:events[0].version,summary:[...new Set(effective.map(event=>event.after))].join("\n\n"),additions:[...new Set(effective.flatMap(event=>(event.additions??[]).map(detail=>detail.text)))],modifications:[...new Set(effective.flatMap(event=>(event.modifications??[]).map(detail=>detail.text)))],reason:[...new Set(effective.map(event=>event.reason).filter(Boolean))].join("\n")};
    const editedFields=edit?[...new Set([...(maintenance?.editedFields??[]),...(Object.keys(original) as Array<keyof typeof original>).filter(field=>JSON.stringify(edit[field])!==JSON.stringify(original[field]))])]:[];
    return {id,...original,...edit,original,events,currentEvents:effective,pendingEvents,pendingOrderUncertain,laterProposals,orderUncertain,status,hidden:Boolean(maintenance?.hidden),userEdited:Boolean(edit),editedFields,incomplete:Boolean(session.projectHistoryAnalysis?.pendingBatches),
      retirements:effective.filter(event=>event.changeKind==="retire"),
      position:events[0]?eventPosition(session,events[0]):undefined};
  }).filter(group=>includeHidden||!group.hidden).sort((a,b)=>compareHistoryPositions(a.position,b.position)??0);
  return groups.map(group=>({...group,timelineOrderUncertain:groups.some(other=>other.id!==group.id&&compareHistoryPositions(group.position,other.position)===undefined)}));
}
export type ProductRelease = ReturnType<typeof productReleaseEvents>[number];
export function productReleaseStatus(release:Pick<ProductRelease,"status"> & Partial<Pick<ProductRelease,"pendingEvents"|"incomplete">>,zh:boolean){
  if(release.incomplete)return zh?"分析待补齐":"Analysis incomplete";
  if(release.status==="confirmed"&&release.pendingEvents?.length)return zh?"部分已确认":"Partly confirmed";
  return ({confirmed:zh?"已确认":"Confirmed",proposal:zh?"规划":"Planned",uncertain:zh?"待确认":"Needs review",documented:zh?"讨论记录":"Discussed",edited:zh?"个人修改":"Edited"})[release.status];
}
