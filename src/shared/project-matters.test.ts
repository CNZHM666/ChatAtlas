import { expect, it } from "vitest";
import { projectSession } from "../test/project-fixture";
import { patchMatter, projectMatters, matterTitle } from "./project-matters";

it("preserves six legacy questions and both independent record types without modifying source data",()=>{
  const session=projectSession();session.brief={summary:"",turningPoints:[],confirmed:[],openQuestions:Array.from({length:6},(_,index)=>`第 ${index} 个问题：`+"完整条件与原始问题描述。".repeat(12))};
  const before=structuredClone(session), matters=projectMatters(session), questions=matters.filter(item=>item.type==="question");
  expect(questions).toHaveLength(6);expect(matters.filter(item=>item.type==="decision")).toHaveLength(1);expect(matters.filter(item=>item.type==="boundary")).toHaveLength(1);
  expect(matterTitle(questions[0]).length).toBeLessThan(questions[0].text.length);expect(questions[0].text).toBe(session.brief.openQuestions[0]);expect(session).toEqual(before);
});
it("treats AI records as candidates and protects a user decision when the original choice changes",()=>{
  const session=projectSession();let decision=projectMatters(session).find(item=>item.type==="decision")!;
  expect(decision.status).toBe("open");session.projectMaintenance=patchMatter(session,decision,{matterStatus:"resolved",resolution:"采用个人选定方案",resolutionReason:"成本可控"});
  decision=projectMatters(session).find(item=>item.id===decision.id)!;expect(decision.status).toBe("resolved");
  session.projectState!.decisions[0].text="新讨论选择另一方案";
  expect(projectMatters(session).find(item=>item.id===decision.id)).toMatchObject({status:"open",resolution:"采用个人选定方案",resolutionReason:"成本可控"});
});
