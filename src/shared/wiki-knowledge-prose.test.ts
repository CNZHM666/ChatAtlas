import {expect,it} from "vitest";
import {knowledgeBodyPresentation} from "./wiki-knowledge-prose";

const wrapper=/（未核实）/u;

it.each([
 "需要区分这些内容的性质：本次材料没有提供这些设计已实现或已被用户采纳的依据。",
 "演示视频方面，助手要求实际第一版没有实现的功能不要在视频里模拟成已经完成。",
 "评分仅为 5/10，认为其未能有效区分已实现功能与设计构想。",
 "这些是 Atlas 的目标能力，并不代表每一项目前都已经实现。",
 "材料未显示相关功能已实现。",
 "记录未提供全部测试已经通过的依据。",
])("keeps a sentence that negates or requires completion in its own words: %s",sentence=>{
 const output=knowledgeBodyPresentation(sentence);
 expect(output).not.toMatch(wrapper);
 expect(output).toContain(sentence.slice(0,12));
});

it("still qualifies a direct completion assertion",()=>{
 expect(knowledgeBodyPresentation("材料未显示搜索已经完成，但导出已经完成。")).toMatch(wrapper);
 expect(knowledgeBodyPresentation("统一搜索已经完成。")).toBe("据讨论，统一搜索已经完成（未核实）。");
 expect(knowledgeBodyPresentation("Notes show search was implemented.",[],false)).toBe("According to the discussion, notes show search was implemented (unverified).");
 expect(knowledgeBodyPresentation("Search is not implemented yet.",[],false)).not.toMatch(/unverified/u);
});

it("keeps attribution, quotations and leading citations readable around the completion qualifier",()=>{
 // A report already names its actor; only the short qualifier is added.
 expect(knowledgeBodyPresentation("用户报告 M2 已完成。")).toBe("用户报告 M2 已完成（未核实）。");
 expect(knowledgeBodyPresentation("用户确认M2已完成，架构稳定。")).toBe("用户确认M2已完成，架构稳定（未核实）。");
 // A completion word inside a quoted example message is not a delivery claim.
 expect(knowledgeBodyPresentation("界面可以显示“方案结构已通过检查”这样的提示。")).toBe("界面可以显示“方案结构已通过检查”这样的提示。");
 expect(knowledgeBodyPresentation("前文。[e3] 这些测试已经通过。")).toBe("前文。[e3]据讨论，这些测试已经通过（未核实）。");
 // A proposal said to be implemented keeps the proposal and qualifies the delivery.
 expect(knowledgeBodyPresentation("AI建议并已实施的关键约束包括两条。")).toBe("AI建议并据称已实施的关键约束包括两条。");
});
