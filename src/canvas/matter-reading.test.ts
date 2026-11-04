import { expect, it } from "vitest";
import type { ProjectMatter } from "../shared/project-matters";
import { matterReadingSummary, matterReadingTitle } from "./matter-reading";
const matter: ProjectMatter = {id:"q",type:"question",status:"resolved",text:"需求到操作计划的核心流程是否可用？",originalText:"需求到操作计划的核心流程是否可用？",sources:[],personal:true,resolution:"已完成核心流程验证。",resolutionReason:"已验证需求输入、计划生成和预览；实物测试仍需单独进行。"};
it("shortens a reading label without changing the original question",()=>{
  expect(matterReadingTitle(matter)).toBe("需求到操作计划的核心流程验证");
  expect(matterReadingTitle({...matter,displayTitle:"自定标题"})).toBe("自定标题");
  expect(matter.text.endsWith("是否可用？")).toBe(true);
});
it("keeps literal incomplete conditions and only suppresses exact repeated prose",()=>{
  const result=matterReadingSummary(matter);
  expect(result.text).toContain("实物测试仍需单独进行。");
  expect(matterReadingSummary(matter,"已完成核心流程验证。").inBody).toBe(false);
  expect(matterReadingSummary(matter,"**已完成核心流程验证。**\n实物测试仍需单独进行。").inBody).toBe(true);
  expect(matterReadingSummary({...matter,resolutionReason:undefined,resolution:"验证通过。"},"未验证通过。").inBody).toBe(false);
  expect(matterReadingSummary({...matter,resolutionReason:undefined},"> 已完成核心流程验证。").inBody).toBe(false);
  expect(matterReadingSummary({...matter,resolutionReason:undefined},"```text\n已完成核心流程验证。\n```").inBody).toBe(false);
});
it("retains boundary restrictions and the applicable phase",()=>{
  const result=matterReadingSummary({...matter,type:"boundary",excluded:"自动下单",phase:"v0.1"});
  expect(result.text).toContain("暂不包含：自动下单");expect(result.text).toContain("适用阶段：v0.1");
});
