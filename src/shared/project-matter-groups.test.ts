import {expect,it} from "vitest";
import {projectSession} from "../test/project-fixture";
import {projectMatters,patchMatter} from "./project-matters";
import {matterCategory,matterCategories} from "./project-matter-groups";
it("groups by unambiguous provenance and explicit user placement without changing facts",()=>{
 const session=projectSession(),matter=projectMatters(session)[0],before=structuredClone(session);
 expect(matterCategory(session,matter)).toBe("one");session.sections.push({...session.sections[0],id:"two",title:"另一个主题"});
 expect(matterCategory(session,matter)).toBe("one");expect(matterCategory(session,{...matter,linkedKnowledgeIds:["two"]})).toBe("two");
 const maintenance=patchMatter(session,matter,{category:"one"});expect(matterCategory({...session,projectMaintenance:maintenance},projectMatters({...session,projectMaintenance:maintenance})[0])).toBe("one");
 expect(matterCategory(session,{...matter,category:""})).toBe("");expect(matterCategory(session,{...matter,category:"deleted"})).toBe("");expect(session.projectMaintenance).toEqual(before.projectMaintenance);expect(maintenance.decisions?.[matter.id].confirmed).toBe(false);
});
it("automatically groups the screenshot's ambiguous-source questions without changing project records",()=>{
 const session=projectSession(),base=projectMatters(session)[0];
 session.sections=[{...session.sections[0],id:"implementation",title:"开发实施与验证体系"},{...session.sections[0],id:"models",title:"核心功能：视觉与零件管理"},{...session.sections[0],id:"architecture",title:"系统架构与基础设施"}];
 const before=structuredClone(session);
 const examples=[
  ["开发实施顺序：是否先通过 Mock 数据证明 IR-to-Canvas 链路稳定性，再接入真实 AI API？","implementation"],
  ["LocalInterpreter与LLMInterpreter的具体路由阈值如何定义？","models"],
  ["视觉识别模型在V1阶段的具体选型及Catalog匹配算法细节？","models"],
  ["BYOK模式下，若用户未配置Key，系统降级体验的具体边界在哪里？","topic:access"],
  ["真实多协议 Benchmark 测试的具体指标与通过标准是什么？","implementation"],
 ];
 const matters=examples.map(([text])=>({...base,text,displayTitle:undefined}));
 for(const [index,[,category]] of examples.entries())expect(matterCategory(session,matters[index])).toBe(category);
 expect(matterCategories(session,true,matters)).toContainEqual({id:"topic:access",title:"接入与安全"});expect(session).toEqual(before);
});
it("keeps manual choices including explicit uncategorized, preserves reverse knowledge links, and never guesses a tied subject",()=>{
 const session=projectSession(),matter={...projectMatters(session)[0],text:"待核对内容",sources:[]};
 session.sections=[{...session.sections[0],title:"相同主题"},{...session.sections[0],id:"two",title:"相同主题",matterLinks:[{id:matter.id,type:matter.type,signature:"old",linkedAt:1}]}];
 expect(matterCategory(session,matter)).toBe("two");expect(matterCategory(session,{...matter,category:""})).toBe("");
 expect(matterCategory(session,{...matter,category:"one"})).toBe("one");expect(matterCategory(session,{...matter,category:"topic:access"})).toBe("topic:access");
 session.sections[1].matterLinks=[];expect(matterCategory(session,{...matter,text:"相同主题需要处理什么？"})).toBe("");
});
