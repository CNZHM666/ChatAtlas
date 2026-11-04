import {expect,it} from "vitest";
import {wikiWritingQuality} from "./wiki-writing-quality";
import {wikiCatalogueSummary} from "./wiki-catalogue";
import {contextKnowledge} from "../test/context-fixture";
import type {CoverageMaterial} from "./focus-coverage";
const inventory={details:[{kind:"module",title:"Hardware IR",status:"proposed"},{kind:"constraints",text:"失败时保留原IR"},{kind:"decisions",text:"先保持6个元件"},{kind:"questions",text:"电压校验尚未验证"}],originals:{q1:{role:"user",text:"PRIVATE_LONG_ORIGINAL",sourceIds:["private"]}}};
const source:CoverageMaterial={id:"n",wikiOwnerId:"o",conversationId:"c",sourceConversationIds:["c"],messageId:"m",title:"主题",text:"讨论来源。\n\nSOURCE DETAIL INVENTORY (evidence):\n"+JSON.stringify(inventory),rawEvidenceIds:["e"]};
it("uses bounded inventory subjects in planning without sending originals, keeping writing evidence intact",()=>{
 const page={...contextKnowledge().session.sections[0],body:source.text},before=page.body;
 const summary=wikiCatalogueSummary(page);expect(summary).toContain("Hardware IR");expect(summary).toContain("电压校验尚未验证");expect(summary).not.toContain("PRIVATE_LONG_ORIGINAL");expect(page.body).toBe(before);expect(summary.length).toBeLessThanOrEqual(700);
});
it("flags thin explanations and result checklists as editorial hints without changing text or forcing retries",()=>{
 const page={...contextKnowledge().session.sections[0],wikiOwnerId:"o",body:"## 校验流程\n\n检查后提交。\n\n| 测试结果 | 是否通过 |\n|---|---|\n|电压|✅|"},before=page.body;
 const result=wikiWritingQuality(page,[source]);expect(result.writingQuality?.issues.map(issue=>issue.code)).toContain("result_checklist");expect(result.body).toBe(before);
 const thin=wikiWritingQuality({...page,body:"## 校验流程\n\n检查后提交。"},[source]);expect(thin.writingQuality?.issues).toEqual([{code:"thin_subtopic",title:"校验流程"}]);
 const concise=wikiWritingQuality({...page,body:"## 技术栈\n\n- TypeScript\n- Zod"},[source]);expect(concise.writingQuality).toBeUndefined();
});

it("reports missing openings, duplicate headings and batch commentary only for a complete chapter, preserving source quotes and body",()=>{
 const detail="检索结果需要保留原始消息位置与前后文，便于之后核对。".repeat(30);
 const body=`## Context Engine\n\n当前提供的源材料中未涉及该机制，无法描述。\n\n${detail}\n\n## ContextEngine\n\n> 当前提供的源材料中未涉及，不应把引用当作批次说明。\n\n\`\`\`md\n## ContextEngine\n\`\`\``;
 const page={...contextKnowledge().session.sections[0],body};
 // A small or single-subtopic chapter deliberately has no opening.
 const small=wikiWritingQuality({...page,body:"## 机制\n\n只有用户确认后执行。"},[],{completeChapter:true});
 expect(small.writingQuality).toBeUndefined();
 expect(wikiWritingQuality(page,[]).writingQuality).toBeUndefined();
 const result=wikiWritingQuality(page,[],{completeChapter:true});
 expect(result.writingQuality?.issues).toEqual([{code:"missing_overview",title:""},{code:"batch_commentary",title:""},{code:"duplicate_heading",title:"ContextEngine"}]);
 expect(result.body).toBe(body);
 const overview={...page,body:"本章说明检索如何运行，以及失败时保留原文的限制。\n\n## 机制\n\n只有用户确认后执行；是否实现仍待核对。"};
 expect(wikiWritingQuality(overview,[],{completeChapter:true}).writingQuality).toBeUndefined();
});

it("flags dense outlines and processing residue without deleting arrays, quotes or prose",()=>{
 const body="本章介绍保存规则。\n\n## 保存\n\n虽然本批次材料主要聚焦于技术实施，但仍需核对适用条件。\n\n保留已有记录并先核对原始来源 []。\n\n`const items = [];`\n\n> 原文标记 []。\n\n"+Array.from({length:8},(_,i)=>`### 规则${i}\n\n条件${i}必须保留。`).join("\n\n");
 const page={...contextKnowledge().session.sections[0],body};
 const result=wikiWritingQuality(page,[],{completeChapter:true});
 expect(result.writingQuality?.issues.map(item=>item.code)).toEqual(["dense_outline","batch_commentary","empty_citation"]);
 expect(result.body).toBe(body);
});
