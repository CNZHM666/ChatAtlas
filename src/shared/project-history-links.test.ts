import { expect,it } from "vitest";
import { historyReplacementTargets } from "./project-history-links";
import type { ProjectHistoryEvent } from "./project-state";
const event=(id:string,after:string,extra:Partial<ProjectHistoryEvent>={}):ProjectHistoryEvent=>({id,title:"采购",area:"采购",version:"v0.1",after,before:"",reason:"",status:"documented",quote:"完整商城及其他方案",evidenceIds:["e"],beforeQuote:"",beforeEvidenceIds:[],...extra});
it("shares conservative whole-state matching across display and context",()=>{
 const base=event("base","完整商城。"),next=event("new","缺件清单",{before:"完整商城"});
 expect(historyReplacementTargets(next,[base,next])).toEqual([base]);
 expect(historyReplacementTargets({...next,area:"库存"},[base])).toEqual([]);
 expect(historyReplacementTargets({...next,before:"商城",beforeQuote:base.quote,beforeEvidenceIds:base.evidenceIds},[base])).toEqual([]);
 expect(historyReplacementTargets(next,[{...base,after:"加入库存识别，并采用完整商城"}])).toEqual([]);
});
