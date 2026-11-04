import {expect,it} from "vitest";
import {withoutGeneratedClaims} from "./generated-claims-prose";
import {generatedProse} from "./generated-structure-prose";
import {leakedClaims} from "../test/claims-prose-fixture";

it("removes the reported complete Claims list while preserving narrative, names and workflow",()=>{
 const body=`Notion 是可选目的地。Find → Verify → Update → Reuse。\n\n${leakedClaims}\n\n## 本地搜索\n\n无需上传全部私人对话。`;
 const result=generatedProse(body);expect(result.removedBlocks).toBe(1);expect(result.body).not.toMatch(/Claims:|evidenceIds:|- text:| quote:/u);expect(result.body).toContain("Find → Verify → Update → Reuse");expect(result.body).toContain("## 本地搜索");expect(body).toContain("evidenceIds");
 expect(generatedProse(leakedClaims)).toEqual({body:"",removedBlocks:1});
});
it("recognizes multiline fields, escaped strings and styled headings without swallowing following normal items",()=>{
 const body='### **Claims:**\n\n- text: "保留 \\"引号\\""\n  quote: "原句"\n  evidenceIds: ["e6", "e7"]';
 const valid=body.replaceAll('\\\\"','\\"');expect(withoutGeneratedClaims(valid).removedBlocks).toBe(1);
 const mixed=`${leakedClaims}\n- 继续展示普通产品说明。\n\n后续正文。`;
 const result=withoutGeneratedClaims(mixed);expect(result.body).toContain("- 继续展示普通产品说明。");expect(result.body).toContain("后续正文。");expect(result.body).not.toContain("evidenceIds");
});
it("recognizes the exported bare-text Claims leak while preserving original examples",()=>{
 const body='claims:\n\n- text: Atlas 使用本地索引，失败保留原文。quote: "建议使用本地索引。"\n  evidenceIds: ["e1"]\n\n## 原文阅读\n\n完整条件仍可阅读。';
 const result=withoutGeneratedClaims(body);expect(result.removedBlocks).toBe(1);expect(result.body).toBe("## 原文阅读\n\n完整条件仍可阅读。");
 expect(withoutGeneratedClaims(body,[body]).body).toBe(body);
 expect(withoutGeneratedClaims("接口示例：\n\n"+body).body).toContain("evidenceIds");
});
it.each([
 'Claims:\n\n- text: "术语解释"',
 'Claims:\n\n- text: "说明" quote: "原句"',
 'Claims:\n\n- text: "说明" quote: "原句" evidenceIds: []',
 'Claims:\n\n- text: "说明" quote: "原句" evidenceIds: ["e1"] another: "真实字段"',
 'Claims:\n\n- 普通英文列表，介绍保险理赔。',
])("retains incomplete or unrelated content instead of guessing: %s",body=>{expect(withoutGeneratedClaims(body)).toEqual({body,removedBlocks:0});});
it("keeps quoted originals, declared API examples, fenced code and inline mentions verbatim",()=>{
 for(const body of [`\`\`\`yaml\n${leakedClaims}\n\`\`\``,leakedClaims.split("\n").map(line=>"> "+line).join("\n"),`这是接口格式示例：\n\n${leakedClaims}`,"普通正文讨论 Claims: 和 evidenceIds 的实现。"]){expect(withoutGeneratedClaims(body)).toEqual({body,removedBlocks:0});}
 expect(withoutGeneratedClaims(leakedClaims,[leakedClaims])).toEqual({body:leakedClaims,removedBlocks:0});
});
