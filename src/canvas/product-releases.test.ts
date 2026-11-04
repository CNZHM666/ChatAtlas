import { expect, it } from "vitest";
import { productReleaseEvents, productReleaseStatus } from "./product-releases";
import { projectSession } from "../test/project-fixture";
import type { ProjectHistoryEvent } from "../shared/project-state";
function event(id:string,index:number,after:string,extra:Partial<ProjectHistoryEvent>={}):ProjectHistoryEvent {
  return {id,title:"采购",version:"v0.2",before:"",after,reason:"",status:"documented",decisionStatus:"confirmed",quote:`v0.2 ${after}`,evidenceIds:[id],beforeQuote:"",beforeEvidenceIds:[],position:{conversationId:"c",messageId:id,messageIndex:index,offset:0},...extra};
}
function releases(events:ProjectHistoryEvent[]){const session=projectSession();session.projectState!.history=events;return productReleaseEvents(session);}
it("reassesses field provenance when a renamed release is regenerated with different content",()=>{
 const session=projectSession();session.projectState!.history=[event("a",1,"旧清单")];session.projectMaintenance={productReleases:{"v0.2":{updatedAt:1,editedFields:["version"],edited:{version:"我的首版",summary:"旧清单",additions:[],modifications:[],reason:""}}}};
 expect(productReleaseEvents(session)[0].editedFields).toEqual(["version"]);session.projectState!.history[0].after="新清单";
 expect(productReleaseEvents(session)[0].editedFields).toEqual(["version","summary"]);expect(productReleaseEvents(session)[0].summary).toBe("旧清单");
});
it("keeps first-occurrence release order even after a late amendment",()=>{
 expect(releases([event("a",1,"商城",{version:"v0.1"}),event("b",5,"Reader",{version:"v0.2"}),event("c",10,"清单",{version:"v0.1",before:"商城"})]).map(item=>item.version)).toEqual(["v0.1","v0.2"]);
});
it("exposes partial confirmation and refuses to call unknown order a later proposal",()=>{
 const release=releases([event("a",1,"采购"),event("b",1,"库存",{area:"库存",status:"proposal",decisionStatus:"proposed",position:{conversationId:"d",messageId:"b",messageIndex:1}})])[0];
 expect(productReleaseStatus(release,true)).toBe("部分已确认");expect(release.pendingEvents).toHaveLength(1);expect(release.pendingOrderUncertain).toBe(true);expect(release.laterProposals).toBe(false);
});
it("marks unknown chronology between different releases without invalidating each recorded approval",()=>{
 const groups=releases([event("a",1,"采购",{version:"v0.1"}),event("b",1,"库存",{version:"v0.2",position:{conversationId:"d",messageId:"b",messageIndex:1}})]);
 expect(groups.every(group=>group.timelineOrderUncertain)).toBe(true);expect(groups.every(group=>group.status==="confirmed")).toBe(true);
});
it("uses original discussion order, retains confirmed revisions and isolates later AI proposals",()=>{
  const old=event("old",1,"完整商城"),next=event("new",5,"缺件清单",{before:"完整商城",beforeQuote:"v0.2 完整商城",beforeEvidenceIds:["old"]}),proposal=event("proposed",9,"恢复完整商城",{status:"proposal",decisionStatus:"proposed"});
  const release=releases([proposal,next,old])[0];
  expect(release.events.map(event=>event.id)).toEqual(["old","new","proposed"]);
  expect(release.summary).toBe("缺件清单");expect(release.status).toBe("confirmed");
  expect(release.pendingEvents).toEqual([proposal]);expect(release.events[0].after).toBe("完整商城");
});
it("adds independently confirmed features without discarding earlier choices",()=>{
  const release=releases([event("later",5,"中文分词",{area:"搜索"}),event("base",1,"缺件清单",{area:"采购"})])[0];
  expect(release.summary).toContain("中文分词");expect(release.summary).toContain("缺件清单");expect(release.currentEvents).toHaveLength(2);
});
it("orders changes in one message by original quote position",()=>{
  const earlier=event("first",1,"完整商城"),later=event("second",1,"缺件清单",{before:"完整商城",position:{conversationId:"c",messageId:"first",messageIndex:1,offset:100}});
  later.position!.messageId="first";
  expect(releases([later,earlier])[0].summary).toBe("缺件清单");
});
it("uses approval position and cannot overwrite an approved revision with an unapproved later response",()=>{
  const old=event("old",1,"完整商城"),next=event("new",2,"缺件清单",{before:"完整商城",confirmationPosition:{conversationId:"c",messageId:"approval",messageIndex:5,offset:0}});
  expect(releases([next,old])[0].summary).toBe("缺件清单");
});
it("keeps unknown cross-conversation chronology uncertain instead of choosing the last array item",()=>{
  const first=event("first",1,"完整商城"),second=event("second",1,"缺件清单",{before:"完整商城",position:{conversationId:"d",messageId:"second",messageIndex:1}});
  const release=releases([second,first])[0];expect(release.status).toBe("uncertain");expect(release.orderUncertain).toBe(true);expect(release.currentEvents).toHaveLength(2);
});
it("uses original timestamps across conversations and marks uncertain output explicitly",()=>{
  const first=event("first",1,"完整商城",{position:{conversationId:"c",messageId:"first",messageIndex:1,discussedAt:1700000000000}}),second=event("second",1,"缺件清单",{before:"完整商城",position:{conversationId:"d",messageId:"second",messageIndex:1,discussedAt:1700000005000}});
  expect(releases([second,first])[0].summary).toBe("缺件清单");
  expect(productReleaseStatus(releases([event("uncertain",1,"缺件清单",{status:"uncertain",decisionStatus:"unknown"})])[0],true)).toBe("待确认");
});
it("does not label unresolved replacement mappings as a final confirmed version",()=>{
  const release=releases([event("base",1,"加入库存识别，并采用完整商城。"),event("new",2,"缺件清单",{before:"完整商城"})])[0];
  expect(release.status).toBe("uncertain");expect(release.currentEvents).toHaveLength(2);
});
it("uses existing message order on legacy records and preserves local edits and deletion",()=>{
  const session=projectSession(),first=event("old",1,"完整商城"),next=event("new",2,"缺件清单",{before:"完整商城"});
  delete first.position;delete next.position;
  session.evidence=[{id:"old",conversationId:"c",messageId:"old",title:"讨论",excerpt:"v0.2 完整商城"},{id:"new",conversationId:"c",messageId:"new",title:"讨论",excerpt:"v0.2 缺件清单"}];
  session.sourceMessageOrder={c:["old","new"]};session.projectState!.history=[next,first];
  expect(productReleaseEvents(session)[0].summary).toBe("缺件清单");
  session.projectMaintenance={productReleases:{"v0.2":{updatedAt:1,hidden:true,edited:{version:"测试版",summary:"我的方案",additions:[],modifications:[],reason:""}}}};
  expect(productReleaseEvents(session)).toEqual([]);expect(productReleaseEvents(session,true)[0]).toMatchObject({summary:"我的方案",status:"edited",version:"测试版"});
});
