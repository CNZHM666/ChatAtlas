import {expect,it} from "vitest";
import {contextKnowledge} from "../test/context-fixture";
import {assertQueryAttribution} from "./query-attribution";
it("rejects an assistant recommendation inflated into approval or implementation locally",()=>{
 const {session,messages}=contextKnowledge();session.locale="zh-CN";
 session.sections=[{...session.sections[0],evidenceIds:["e-ui"],claims:[{text:"团队已确认采用新界面",quote:"侧边栏按钮沿用界面规范。",evidenceIds:["e-ui"]}]}];
 expect(()=>assertQueryAttribution(session,messages)).toThrow("尚未保存");session.sections[0].claims![0].text="AI 建议沿用界面规范";expect(()=>assertQueryAttribution(session,messages)).not.toThrow();
 session.sections[0].claims![0].text="界面已经完成";expect(()=>assertQueryAttribution(session,messages)).toThrow();
 session.sections[0].claims![0].text="项目最终确立了此方案";expect(()=>assertQueryAttribution(session,messages)).toThrow();
 session.sections[0].claims![0].text="最终采纳方案为新界面";expect(()=>assertQueryAttribution(session,messages)).toThrow();
 session.sections[0].claims![0].text="尚无证据表明用户已确认此方案。";expect(()=>assertQueryAttribution(session,messages)).not.toThrow();
 session.sections[0].claims![0].text="尚无证据表明用户已确认，但界面已经完成。";expect(()=>assertQueryAttribution(session,messages)).toThrow();
});
it("recalls real explicit approval and user reports, while keeping implementation distinct",()=>{
 const {session,messages}=contextKnowledge();messages[0].content="我确认采用 IndexedDB。";
 session.sections=[{...session.sections[0],claims:[{text:"用户已确认采用 IndexedDB",quote:messages[0].content,evidenceIds:["e-db"]}]}];
 expect(()=>assertQueryAttribution(session,messages)).not.toThrow();session.sections[0].claims![0].text="IndexedDB 已经实现";expect(()=>assertQueryAttribution(session,messages)).toThrow();
 messages[0].content="我已经完成索引界面，测试尚未执行。";session.sections[0].claims![0]={text:"用户报告索引界面已完成",quote:messages[0].content,evidenceIds:["e-db"]};expect(()=>assertQueryAttribution(session,messages)).not.toThrow();
});
