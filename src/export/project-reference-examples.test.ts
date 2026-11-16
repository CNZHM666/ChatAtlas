import {expect,it} from "vitest";
import {annotateReferenceExamples,compactReferenceHeadings} from "./project-reference-examples";

const fence=(language:string,text:string)=>`~~~${language}\n${text}\n~~~`;

it("annotates only appendix payloads, preserves deferrals and is repeatable",()=>{
 const example=fence("text","Workflow v0.2\nDraft → Simulation");
 const before=`## Project\n\n${example}\n\n## Examples\n\n### Workflow · Current reference · v0.2\n\n${example}\n\n## Notes\n\n${example}`;
 const format=(value:string)=>annotateReferenceExamples(value,"Examples",false,[{feature:"Wokwi 仿真",stage:"v0.2"}]);
 const after=format(before);
 expect(after).toContain("**Design proposal** · Source label v0.2 · Apply the confirmed deferral (v0.2 Wokwi 仿真).");
 expect(after.split(example)).toHaveLength(4);
 expect(after).toContain(`## Project\n\n${example}\n\n## Examples`);
 expect(format(after)).toBe(after);
});

it("distinguishes requirement data, interfaces, flags and sample prices",()=>{
 const requirements=fence("json",'{"name":"Calendar","requirements":[]}');
 const contract=fence("ts","interface Project { id: string }");
 const flags=fence("ts","features: { fast: true }");
 const prices=fence("text","Cable $3.90");
 const body=`## Examples\n\n### Requirements\n\n${requirements}\n\n### Project contract · superseded\n\n${contract}\n\n### Switches\n\n${flags}\n\n### Shopping list\n\n${prices}`;
 const result=annotateReferenceExamples(body,"Examples",false,[]);
 expect(result).toContain("Requirement-stage data example");
 expect(result).toContain("**Historical proposal** · Stage unspecified · Interface draft.");
 expect(result).toContain("Illustrative switch values");
 expect(result).toContain("Prices are illustrative and need verification");
 for(const original of [requirements,contract,flags,prices])expect(result).toContain(original);
});

it("uses concise standalone titles and retains real stage and scope exceptions",()=>{
 const flow=fence("text","Input\n  ├─ simple → Preview\n  └─ complex → Review");
 const early=fence("text","Draft → BOM + Code → Simulation");
 const body=`## 参考示例附录

### 开发计划

#### 参考示例 · 2 项

##### 1. 修改校验与回滚流程 · milestone3

${flow}

##### 2. 功能边界约束的流程示例 · 原稿 v0.1，适用范围待核对

${early}

### 外部参考项目

#### 数据转换流程

${flow}`;
 const result=compactReferenceHeadings(annotateReferenceExamples(body,"参考示例附录",true,[
  {feature:"Wokwi 仿真",stage:"V0.1"},{feature:"固件代码生成",stage:"V0.1"},{feature:"PCB",stage:"V0.2"},
 ],true),"参考示例附录");
 expect(result).toContain("修改校验与回滚流程 · Milestone 3");
 expect(result).toContain("早期完整流程构想");
 expect(result).toContain("V0.1 Wokwi 仿真、V0.1 固件代码生成");
 expect(result).toContain("**外部参考**");
 expect(result).not.toMatch(/阶段未注明|目录草图|设计构想|PCB/u);
 expect(result).toContain(flow);
 expect(result).toContain(early);
});

it("names neighboring tree alternatives and requirements data from their literal content",()=>{
 const a=fence("text","catalog/\n  images/\n  source.json");
 const b=fence("text","catalog/\n  metadata/\n  source.json");
 const json=fence("json",'{ "requirements": [] }');
 const body=`## Reference examples appendix\n\n### Layout\n\n#### Examples\n\n##### 1. Directory structure\n\n${a}\n\n##### 2. Directory structure\n\n${b}\n\n##### 3. JSON example\n\n${json}`;
 const result=annotateReferenceExamples(body,"Reference examples appendix",false,[],true);
 expect(result).toContain("Directory layout · catalog/（images/）");
 expect(result).toContain("Directory layout · catalog/（metadata/）");
 expect(result).toContain("Requirements data example");
 for(const original of [a,b,json])expect(result).toContain(original);
});
