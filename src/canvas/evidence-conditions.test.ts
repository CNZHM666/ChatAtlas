import {expect,it} from "vitest";
import {evidenceConditionDescription,evidenceConditions,evidenceConditionsMatch} from "./evidence-conditions";

it.each([
 ["若 10 人以上明显愿意做项目。","至少十名用户愿意继续做项目",true],
 ["10人以上","20个人以上",false],
 ["10人以上","10个人以下",false],
 ["10人以上","超过10人",false],
 ["少于3人","3人以下",false],
 ["少于3人","小于三个人",true],
 ["5-8人","5～8个人",true],
 ["5-8人","5～9个人",false],
 ["20名用户中少于3人","20名用户，其中少于3名用户",true],
 ["20名用户中少于3人","20名用户，其中少于4名用户",false],
 ["10秒以上","至少10毫秒",false],
 ["2天以内","不超过二日",true],
 ["90%","90.0%",true],
 ["大约10人","10人",false],
])("checks values, units and numeric bounds: %s / %s",(claim,text,expected)=>{
 expect(evidenceConditionsMatch(evidenceConditions(claim),text)).toBe(expected);
});

it("does not turn model/version numbers or list numbering into quantity conditions",()=>{
 expect(evidenceConditions('ESP32、V0.1、GPT-4.1、1. Beginner Journey、步骤 2')).toEqual([]);
 expect(evidenceConditions('AI 文件管理器，而非一个聊天机器人')).toEqual([]);
 expect(evidenceConditionDescription('若 10 人以上明显愿意做项目。')).toBe('明显愿意做项目。');
});
