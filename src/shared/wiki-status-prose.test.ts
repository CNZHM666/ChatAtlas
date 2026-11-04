import {expect,it} from "vitest";
import {wikiStatusProse} from "./wiki-status-prose";
import {projectKnowledgeSection} from "./project-knowledge-view";
import {projectSession} from "../test/project-fixture";
import type {FocusSection} from "./focus-session";

const claim={text:"记忆对象携带 evidence 字段",quote:"q",evidenceIds:["e1"]};
const proposals={claims:[{...claim,workStatus:"proposed" as const},{...claim,text:"保留 Orama",workStatus:"proposed" as const}]} as Pick<FocusSection,"claims"|"userEdited"|"origin">;

it("drops clauses that only repeat the chapter's unconfirmed-proposal status",()=>{
 const body=[
  "Atlas 以原始消息为事实来源，主张消息级检索。上述方案多为建议或讨论中的设计，尚未确认实施。",
  "",
  "## 记忆架构",
  "",
  "记忆对象携带 evidence 字段，便于追溯。这一结构目前是 AI建议，材料未显示用户已确认采用。",
  "",
  "AI建议把索引改为独立持久化，理由是提高恢复可靠性；该变更在材料中仍属提议，未见用户确认。",
  "",
  "这是 AI建议，材料未显示用户已确认采用。",
 ].join("\n");
 expect(wikiStatusProse(body,proposals)).toBe([
  "Atlas 以原始消息为事实来源，主张消息级检索。",
  "",
  "## 记忆架构",
  "",
  "记忆对象携带 evidence 字段，便于追溯。",
  "",
  "AI建议把索引改为独立持久化，理由是提高恢复可靠性。",
 ].join("\n"));
});

it("keeps substance, nouns, formatting, code, tables and quotations",()=>{
 const body=[
  "Orama 不自动理解语义，尚未确认采用。需要区分 AI建议与用户确认。",
  "**这一结构目前是 AI建议，材料未显示用户已确认采用。**",
  "> 这一结构目前是 AI建议，材料未显示用户已确认采用。",
  "| 方案 | 这一结构目前是 AI建议，材料未显示用户已确认采用 |",
  "```",
  "这一结构目前是 AI建议，材料未显示用户已确认采用。",
  "```",
  "用户原话是“该架构为 AI建议，材料未显示用户已确认实施。”",
 ].join("\n");
 expect(wikiStatusProse(body,proposals)).toBe(body);
});

it("unwraps the completion caution only around a recommendation",()=>{
 expect(wikiStatusProse("讨论记录提及“建议人工标注约 50 条样本，覆盖已实现未发布等情形”，完成情况尚未确认。",proposals)).toBe("建议人工标注约 50 条样本，覆盖已实现未发布等情形。");
 expect(wikiStatusProse("据讨论，建议人工标注约 50 条样本，覆盖已实现未发布等情形（未核实）。",proposals)).toBe("建议人工标注约 50 条样本，覆盖已实现未发布等情形。");
 const completion="据讨论，M2 已完成（未核实）。";
 expect(wikiStatusProse(completion,proposals)).toBe(completion);
});

it("changes nothing when the chapter has confirmations, is personal, or has no claims",()=>{
 const body="AI建议采用混合检索。这一结构目前是 AI建议，材料未显示用户已确认采用。";
 const reading={signature:"",status:"confirmed" as const,reported:false,currentStage:false,sources:[]};
 expect(wikiStatusProse(body,{claims:[{...claim,workStatus:"proposed"},{...claim,sourceReading:reading}]})).toBe(body);
 expect(wikiStatusProse(body,{...proposals,userEdited:true})).toBe(body);
 expect(wikiStatusProse(body,{claims:[]})).toBe(body);
});

it("applies in the shared reading projection for Chinese chapters only",()=>{
 const session=projectSession();session.locale="zh-CN";
 const section={...session.sections[0],body:"记忆对象携带 evidence 字段。这一结构目前是 AI建议，材料未显示用户已确认采用。",claims:proposals.claims};
 session.sections=[section];
 expect(projectKnowledgeSection(section,session).body).not.toContain("材料未显示");
 session.locale="en";
 expect(projectKnowledgeSection(section,session).body).toContain("材料未显示");
});

it("names the AI actor once per subsection in a mostly-proposal chapter",()=>{
 const body=["AI建议采用混合检索。AI建议先建立索引。","","## 缓存","","AI建议缓存检索结果。AI建议按版本失效。界面提示“AI建议已采纳”。AI建议发现了缓存问题。"].join("\n");
 expect(wikiStatusProse(body,proposals)).toBe(["AI建议采用混合检索。建议先建立索引。","","## 缓存","","AI建议缓存检索结果。建议按版本失效。界面提示“AI建议已采纳”。AI建议发现了缓存问题。"].join("\n"));
 const reading={signature:"",status:"confirmed" as const,reported:false,currentStage:false,sources:[]};
 // Mixed chapters keep every actor: user decisions and AI proposals sit side by side.
 const mixed={claims:[{...claim,workStatus:"proposed" as const},{...claim,sourceReading:reading}]};
 expect(wikiStatusProse("AI建议采用混合检索。AI建议先建立索引。",mixed)).toBe("AI建议采用混合检索。AI建议先建立索引。");
});
