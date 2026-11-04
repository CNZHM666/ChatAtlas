import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {validateMatterAssessment} from "./project-matter-assessment";

function fixture(){
 const session=projectSession(),question="首版采用本地存储还是云数据库？",answer="我决定首版采用本地存储。";
 session.evidence=[{id:"e1",conversationId:"source",messageId:"m1",title:"讨论",excerpt:question},{id:"e2",conversationId:"source",messageId:"m2",title:"讨论",excerpt:answer}];
 session.sourceMessageOrder={source:["m1","m2"]};
 const sources=[{id:"e1",text:question,conversationId:"source",messageId:"m1",role:"user"},{id:"e2",text:answer,conversationId:"source",messageId:"m2",role:"user"}];
 const proof={quote:question,evidenceIds:["e1"]};
 const value={subject:"首版存储方案",scope:"V1",state:"settled",settlement:{text:"首版采用本地存储",quote:answer,evidenceIds:["e2"]}};
 return {session,sources,proof,value};
}
it("keeps both the original unresolved choice and its later literal user answer",()=>{
 const {session,sources,proof,value}=fixture();const result=validateMatterAssessment(value,proof,sources,session);
 expect(result).toMatchObject({state:"settled",subject:"首版存储方案",scope:"V1",settlement:{evidenceIds:["e2"]}});
 expect(proof.evidenceIds).toEqual(["e1"]);
});
it.each([
 ["assistant", "我决定首版采用本地存储。"],
 ["user","建议首版采用本地存储。"],
 ["user","如果采用本地存储，我们可以先验证。"],
 ["user","下一步计划完成本地存储。"],
 ["user", "以下是参考提示词：\n我决定首版采用本地存储。"],
 ["user", "还没决定是否采用本地存储。"],
])("does not close a pending decision from %s material: %s",(role,text)=>{
 const {session,sources,proof,value}=fixture();sources[1]={...sources[1],role,text};value.settlement.quote=text.includes("参考")?"我决定首版采用本地存储。":text;
 expect(validateMatterAssessment(value,proof,sources,session)?.state).toBe("open");
});
it("requires a later position and respects the selected source scope",()=>{
 const {session,sources,proof,value}=fixture();session.sourceMessageOrder={source:["m2","m1"]};
 expect(validateMatterAssessment(value,proof,sources,session)?.state).toBe("open");
 session.sourceMessageOrder={source:["m1","m2"]};session.scope={kind:"goal",blocks:[{conversationId:"source",title:"讨论",messageIds:["m1"],messageSignatures:{}}]};
 expect(validateMatterAssessment(value,proof,sources,session)?.state).toBe("open");
});
it("does not infer chronology between unrelated conversations without timestamps",()=>{
 const {session,sources,proof,value}=fixture();session.sourceConversationIds.push("other");sources[1].conversationId="other";session.evidence[1].conversationId="other";session.sourceMessageOrder={source:["m1"],other:["m2"]};
 expect(validateMatterAssessment(value,proof,sources,session)?.state).toBe("open");
});
it("does not turn ordinary constraints into unanswered choices",()=>{
 const {session,sources}=fixture();sources[0].text="首版只做本地数据存储。";
 expect(validateMatterAssessment({subject:"首版存储",state:"open"},{quote:sources[0].text,evidenceIds:["e1"]},sources,session)?.state).toBe("context");
});
it.each(["我已经完成欢迎页面。","我决定首版采用付费订阅。","我决定 V2 采用本地存储。","我已经完成本地存储的页面设计。"])('does not resolve a question with an unrelated, different-version or narrower artifact: %s',text=>{
 const {session,sources,proof,value}=fixture();sources[1].text=text;value.settlement.quote=text;
 expect(validateMatterAssessment(value,proof,sources,session)?.state).toBe("open");
});
